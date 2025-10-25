const DB_NAME = 'WebgrabDB';
const DB_VERSION = 1;
const BATCHES_STORE_NAME = 'batches';
const PAGES_STORE_NAME = 'pages';

let db = null;

// --- IndexedDB Initialization ---

function openDb() {
    return new Promise((resolve, reject) => {
        if (db) {
            resolve(db);
            return;
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (event) => {
            console.error("Database error:", event.target.error);
            reject("Database error: " + event.target.error);
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            console.log("Database opened successfully.");
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            console.log("Database upgrade needed.");
            let tempDb = event.target.result;
            // Create batches store (id = uuid, name)
            if (!tempDb.objectStoreNames.contains(BATCHES_STORE_NAME)) {
                tempDb.createObjectStore(BATCHES_STORE_NAME, { keyPath: 'id' });
                 console.log(`Object store "${BATCHES_STORE_NAME}" created.`);
            }
            // Create pages store (url = key, batchId, site, params, html_content, retrieved_at)
            if (!tempDb.objectStoreNames.contains(PAGES_STORE_NAME)) {
               const pageStore = tempDb.createObjectStore(PAGES_STORE_NAME, { keyPath: 'url' });
                // Add index for batchId for efficient batch-based retrieval/deletion
                pageStore.createIndex('batchIdIndex', 'batchId', { unique: false });
                console.log(`Object store "${PAGES_STORE_NAME}" created with index on batchId.`);
            }
             // Assign the upgraded db instance so the onsuccess handler gets it
             db = tempDb;
        };
    });
}

// --- Database Operations ---

async function createBatchInDb(name) {
    if (!name) return { success: false, error: 'Batch name cannot be empty.' };

    try {
        const dbInstance = await openDb();
        
        // Check if name already exists - moved BEFORE transaction
        const existingBatches = await getAllBatchesFromDb(dbInstance);
        if (existingBatches.some(batch => batch.name.toLowerCase() === name.toLowerCase())) {
            return { success: false, error: 'Batch name already exists.' };
        }

        // Now create the transaction
        const transaction = dbInstance.transaction(BATCHES_STORE_NAME, 'readwrite');
        const store = transaction.objectStore(BATCHES_STORE_NAME);

        const newBatch = {
            id: crypto.randomUUID(),
            name: name,
            createdAt: new Date().toISOString(),
            lastSavedAt: null,
            pageCount: 0
        };

        return new Promise((resolve, reject) => {
            const request = store.add(newBatch);
            
            request.onsuccess = () => {
                console.log("Batch added:", newBatch);
                resolve({ success: true, newBatch: newBatch });
            };
            
            request.onerror = (event) => {
                console.error("Error adding batch:", event.target.error);
                reject({ success: false, error: event.target.error });
            };
        });
    } catch (error) {
        console.error("Failed to create batch:", error);
        return { success: false, error: error.message || error };
    }
}


async function getAllBatchesFromDb(dbInstance = null) {
     // Allows passing an existing DB instance to avoid reopening
    try {
        const currentDb = dbInstance || await openDb();
        const transaction = currentDb.transaction(BATCHES_STORE_NAME, 'readonly');
        const store = transaction.objectStore(BATCHES_STORE_NAME);
        const request = store.getAll();

        return new Promise((resolve, reject) => {
            request.onsuccess = () => {
                // Sort alphabetically by name, case-insensitive
                const sortedBatches = request.result.sort((a, b) =>
                    a.name.toLowerCase().localeCompare(b.name.toLowerCase())
                );
                resolve(sortedBatches);
            };
            request.onerror = (event) => {
                 console.error("Error getting all batches:", event.target.error);
                reject(event.target.error);
            };
        });
    } catch (error) {
        console.error("Failed to get batches:", error);
        return []; // Return empty array on failure
    }
}


async function addPageToDb(pageData) {
    try {
        const dbInstance = await openDb();
        // Check if page already exists before updating batch count
        let pageExists = false;
        const getTransaction = dbInstance.transaction(PAGES_STORE_NAME, 'readonly');
        const pageStoreGet = getTransaction.objectStore(PAGES_STORE_NAME);
        const getRequest = pageStoreGet.getKey(pageData.url); // More efficient check

        pageExists = await new Promise((resolve, reject) => {
            getRequest.onsuccess = () => resolve(!!getRequest.result); // Resolve true if key exists
            getRequest.onerror = (e) => reject(e.target.error);
        });

         console.log(`Page ${pageData.url} exists? ${pageExists}`);


        // Use a single transaction for page add/update and batch update
        const transaction = dbInstance.transaction([PAGES_STORE_NAME, BATCHES_STORE_NAME], 'readwrite');
        const pageStore = transaction.objectStore(PAGES_STORE_NAME);
        const batchStore = transaction.objectStore(BATCHES_STORE_NAME);

        // Prepare page data
        const pageRecord = {
            url: pageData.url,
            batchId: pageData.batchId,
            site: pageData.site,
            params: pageData.params,
            html_content: pageData.html_content,
            retrieved_at: pageData.retrieved_at,
        };

        const pageRequest = pageStore.put(pageRecord); // Use put to add or update

        // Only update batch count if the page didn't exist before this operation
        let batchUpdateRequest = null;
        if (!pageExists) {
            const batchRequest = batchStore.get(pageData.batchId);
            batchRequest.onsuccess = () => {
                const batch = batchRequest.result;
                if (batch) {
                    batch.pageCount = (batch.pageCount || 0) + 1;
                    batch.lastSavedAt = pageData.retrieved_at; // Update last saved time
                    batchUpdateRequest = batchStore.put(batch); // Put the updated batch back
                     console.log(`Incrementing page count for batch ${pageData.batchId}`);
                } else {
                    console.warn(`Batch ${pageData.batchId} not found during page save count update.`);
                }
            };
             batchRequest.onerror = (e) => console.error("Error getting batch for count update:", e.target.error);
        } else {
             // If page exists, still update the lastSavedAt timestamp for the target batch
              const batchRequest = batchStore.get(pageData.batchId);
              batchRequest.onsuccess = () => {
                  const batch = batchRequest.result;
                  if (batch) {
                      batch.lastSavedAt = pageData.retrieved_at; // Update last saved time
                      batchUpdateRequest = batchStore.put(batch);
                       console.log(`Updating lastSavedAt for batch ${pageData.batchId} due to page update.`);
                  } else {
                       console.warn(`Batch ${pageData.batchId} not found during page update lastSavedAt.`);
                  }
              };
               batchRequest.onerror = (e) => console.error("Error getting batch for lastSavedAt update:", e.target.error);
        }


        return new Promise((resolve, reject) => {
            // Wait for all operations in the transaction to complete
            transaction.oncomplete = () => {
                console.log("Page added/updated and batch meta potentially updated successfully.");
                resolve({ success: true });
            };
            transaction.onerror = (event) => {
                console.error("Transaction error adding page/updating batch:", event.target.error);
                 // Check specific request errors if needed
                 if (pageRequest.error) console.error(" - Page put error:", pageRequest.error);
                 if (batchUpdateRequest && batchUpdateRequest.error) console.error(" - Batch update error:", batchUpdateRequest.error);
                reject({ success: false, error: event.target.error });
            };
            // Ensure individual request errors are also caught (though transaction.onerror should handle it)
            pageRequest.onerror = (event) => {
                console.error("Error putting page:", event.target.error);
                // Don't reject here, let the transaction handle it
            };

        });
    } catch (error) {
        console.error("Failed to add page:", error);
        return { success: false, error: error.message || error };
    }
}


async function getPagesForBatch(batchId) {
    try {
        const dbInstance = await openDb();
        const transaction = dbInstance.transaction(PAGES_STORE_NAME, 'readonly');
        const store = transaction.objectStore(PAGES_STORE_NAME);
        const index = store.index('batchIdIndex');
        const request = index.getAll(IDBKeyRange.only(batchId)); // Use index

        return new Promise((resolve, reject) => {
            request.onsuccess = () => {
                resolve(request.result);
            };
            request.onerror = (event) => {
                console.error(`Error getting pages for batch ${batchId}:`, event.target.error);
                reject(event.target.error);
            };
        });
    } catch (error) {
        console.error("Failed to get pages for batch:", error);
        return [];
    }
}

async function deleteBatchAndPages(batchId) {
    try {
        const dbInstance = await openDb();
        const transaction = dbInstance.transaction([BATCHES_STORE_NAME, PAGES_STORE_NAME], 'readwrite');
        const batchStore = transaction.objectStore(BATCHES_STORE_NAME);
        const pageStore = transaction.objectStore(PAGES_STORE_NAME);
        const pageIndex = pageStore.index('batchIdIndex');

        // 1. Delete the batch record
        const batchDeleteRequest = batchStore.delete(batchId);

        // 2. Find and delete all associated pages using the index
        const pageCursorRequest = pageIndex.openCursor(IDBKeyRange.only(batchId));
        let pagesDeletedCount = 0;

        pageCursorRequest.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                pageStore.delete(cursor.primaryKey); // Delete page by its primary key (url)
                pagesDeletedCount++;
                cursor.continue();
            }
            // No more pages, deletion process for pages is done within this cursor loop
        };


        return new Promise((resolve, reject) => {
             // Report success/failure when the *entire transaction* completes or aborts
            transaction.oncomplete = () => {
                 console.log(`Batch ${batchId} and ${pagesDeletedCount} pages deleted successfully.`);
                resolve({ success: true, pagesDeletedCount: pagesDeletedCount });
            };
            transaction.onerror = (event) => {
                 console.error(`Transaction error deleting batch ${batchId}:`, event.target.error);
                 // Log specific request errors if available
                if(batchDeleteRequest.error) console.error(" - Batch delete error:", batchDeleteRequest.error);
                if(pageCursorRequest.error) console.error(" - Page cursor/delete error:", pageCursorRequest.error);
                reject({ success: false, error: event.target.error });
            };
             // Individual request error logging (less critical as transaction should catch it)
             batchDeleteRequest.onerror = e => console.error("Batch delete request failed:", e.target.error);
             pageCursorRequest.onerror = e => console.error("Page cursor request failed:", e.target.error);

        });

    } catch (error) {
        console.error("Failed to delete batch and pages:", error);
        return { success: false, error: error.message || error };
    }
}


// --- Message Handling ---

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Background received message:", request);

    // Use async IIFE to handle promises with sendResponse
    (async () => {
        try {
            await openDb(); // Ensure DB is open before handling messages

            switch (request.action) {
                 case 'createBatch': {
                    const result = await createBatchInDb(request.name);
                    sendResponse(result);
                    break;
                 }
                case 'getBatches': {
                    const batches = await getAllBatchesFromDb();
                    sendResponse({ success: true, batches: batches });
                    break;
                }
                case 'savePage': {
                    if (!request.batchId || !request.tabId || !request.url) {
                        sendResponse({ success: false, error: 'Missing batchId, tabId, or url for savePage action.' });
                        return;
                    }

                    // Inject script to get HTML content
                    const injectionResults = await chrome.scripting.executeScript({
                        target: { tabId: request.tabId },
                        func: () => document.documentElement.outerHTML,
                    });

                    if (chrome.runtime.lastError || !injectionResults || injectionResults.length === 0 || !injectionResults[0].result) {
                        console.error('Script injection failed:', chrome.runtime.lastError || 'No result from script');
                        sendResponse({ success: false, error: 'Could not retrieve page HTML. Check console for details. Does the page forbid extensions?' });
                        return;
                    }

                    const htmlContent = injectionResults[0].result;
                    const url = new URL(request.url);

                    const pageData = {
                        url: request.url,
                        batchId: request.batchId,
                        site: url.hostname,
                        params: url.search,
                        html_content: htmlContent,
                        retrieved_at: new Date().toISOString(),
                    };

                    const saveResult = await addPageToDb(pageData);
                    sendResponse(saveResult);
                    break;
                }
                 case 'exportBatch': {
                    if (!request.batchId || !request.batchName) {
                         sendResponse({ success: false, error: 'Missing batchId or batchName for export.' });
                         return;
                    }
                    const pages = await getPagesForBatch(request.batchId);
                    if (!pages) {
                         sendResponse({ success: false, error: 'Failed to retrieve pages for export.' });
                         return;
                    }

                    // Format as JSON Lines
                    const jsonlData = pages.map(page => JSON.stringify(page)).join('\n');
                    const blob = new Blob([jsonlData], { type: 'application/jsonl' });
                    const blobUrl = URL.createObjectURL(blob);

                    // Generate filename
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                     // Sanitize batch name for filename
                    const safeBatchName = request.batchName.replace(/[^a-z0-9_-]/gi, '_').substring(0, 50);
                    const filename = `webgrab_batch_${safeBatchName}_${request.batchId.substring(0, 8)}_${timestamp}.jsonl`;


                    // Use downloads API
                     chrome.downloads.download({
                         url: blobUrl,
                         filename: filename,
                         saveAs: true // Prompt user for save location
                     }, (downloadId) => {
                         if (chrome.runtime.lastError) {
                             console.error("Download failed:", chrome.runtime.lastError);
                             sendResponse({ success: false, error: `Download initiation failed: ${chrome.runtime.lastError.message}` });
                             URL.revokeObjectURL(blobUrl); // Clean up blob URL even on failure
                         } else {
                             console.log("Download initiated with ID:", downloadId);
                             // Success is implied, but we need to revoke the blob URL *after* the download might have started
                             // There isn't a perfect callback for download *completion*, so revoke after a short delay
                             setTimeout(() => URL.revokeObjectURL(blobUrl), 1000); // Clean up after 1 second
                             sendResponse({ success: true });
                         }
                     });
                    // Note: sendResponse might be called *before* the download completes,
                    // but it needs to be called to close the message channel.
                    break;
                 }
                 case 'deleteBatch': {
                    if (!request.batchId) {
                         sendResponse({ success: false, error: 'Missing batchId for delete.' });
                         return;
                    }
                    const deleteResult = await deleteBatchAndPages(request.batchId);
                    sendResponse(deleteResult);
                    break;
                 }

                default:
                    console.warn("Unknown action received:", request.action);
                    sendResponse({ success: false, error: `Unknown action: ${request.action}` });
            }
        } catch (error) {
            console.error("Error processing message:", error);
            sendResponse({ success: false, error: error.message || 'An unexpected error occurred in the background script.' });
        }
    })(); // Immediately invoke the async function

    return true; // Indicates that the response is sent asynchronously
});

// Initial DB opening when the service worker starts
openDb().catch(err => console.error("Initial database open failed:", err));

console.log("Background script loaded and listener attached.");

