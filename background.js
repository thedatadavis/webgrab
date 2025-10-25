const DB_NAME = 'WebgrabDB';
const DB_VERSION = 1;
const BATCHES_STORE_NAME = 'batches';
const PAGES_STORE_NAME = 'pages';

// Don't rely on global db variable - always open fresh
// Service workers can terminate and lose global state

// --- IndexedDB Initialization ---

function openDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (event) => {
            console.error("Database error:", event.target.error);
            reject("Database error: " + event.target.error);
        };

        request.onsuccess = (event) => {
            const db = event.target.result;
            console.log("Database opened successfully.");
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            console.log("Database upgrade needed.");
            const db = event.target.result;
            
            // Create batches store (id = uuid, name)
            if (!db.objectStoreNames.contains(BATCHES_STORE_NAME)) {
                db.createObjectStore(BATCHES_STORE_NAME, { keyPath: 'id' });
                console.log(`Object store "${BATCHES_STORE_NAME}" created.`);
            }
            
            // Create pages store (url = key, batchId, site, params, html_content, retrieved_at)
            if (!db.objectStoreNames.contains(PAGES_STORE_NAME)) {
                const pageStore = db.createObjectStore(PAGES_STORE_NAME, { keyPath: 'url' });
                // Add index for batchId for efficient batch-based retrieval/deletion
                pageStore.createIndex('batchIdIndex', 'batchId', { unique: false });
                console.log(`Object store "${PAGES_STORE_NAME}" created with index on batchId.`);
            }
        };
    });
}

// --- Database Operations ---

async function createBatchInDb(name) {
    if (!name) return { success: false, error: 'Batch name cannot be empty.' };

    try {
        const db = await openDb();
        
        // Check if name already exists BEFORE starting transaction
        const existingBatches = await getAllBatchesFromDb();
        if (existingBatches.some(batch => batch.name.toLowerCase() === name.toLowerCase())) {
            db.close();
            return { success: false, error: 'Batch name already exists.' };
        }

        const transaction = db.transaction(BATCHES_STORE_NAME, 'readwrite');
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
                reject({ success: false, error: event.target.error?.message || 'Failed to add batch' });
            };

            transaction.oncomplete = () => {
                db.close();
            };

            transaction.onerror = (event) => {
                console.error("Transaction error:", event.target.error);
                db.close();
            };
        });
    } catch (error) {
        console.error("Failed to create batch:", error);
        return { success: false, error: error.message || error };
    }
}

async function getAllBatchesFromDb() {
    try {
        const db = await openDb();
        const transaction = db.transaction(BATCHES_STORE_NAME, 'readonly');
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

            transaction.oncomplete = () => {
                db.close();
            };

            transaction.onerror = (event) => {
                console.error("Transaction error:", event.target.error);
                db.close();
            };
        });
    } catch (error) {
        console.error("Failed to get batches:", error);
        return [];
    }
}

async function addPageToDb(pageData) {
    try {
        const db = await openDb();
        
        // Single transaction for atomicity - check existence within the transaction
        const transaction = db.transaction([PAGES_STORE_NAME, BATCHES_STORE_NAME], 'readwrite');
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

        let shouldIncrementCount = false;
        let operationComplete = false;

        return new Promise((resolve, reject) => {
            // First check if page exists
            const getRequest = pageStore.getKey(pageData.url);
            
            getRequest.onsuccess = () => {
                const pageExists = !!getRequest.result;
                shouldIncrementCount = !pageExists;
                console.log(`Page ${pageData.url} exists? ${pageExists}`);

                // Now put the page (add or update)
                const putRequest = pageStore.put(pageRecord);
                
                putRequest.onsuccess = () => {
                    // Update batch metadata
                    const batchRequest = batchStore.get(pageData.batchId);
                    
                    batchRequest.onsuccess = () => {
                        const batch = batchRequest.result;
                        if (batch) {
                            if (shouldIncrementCount) {
                                batch.pageCount = (batch.pageCount || 0) + 1;
                                console.log(`Incrementing page count for batch ${pageData.batchId}`);
                            }
                            batch.lastSavedAt = pageData.retrieved_at;
                            batchStore.put(batch);
                        } else {
                            console.warn(`Batch ${pageData.batchId} not found during page save.`);
                        }
                    };

                    batchRequest.onerror = (e) => {
                        console.error("Error getting batch for update:", e.target.error);
                    };
                };

                putRequest.onerror = (e) => {
                    console.error("Error putting page:", e.target.error);
                };
            };

            getRequest.onerror = (e) => {
                console.error("Error checking page existence:", e.target.error);
            };

            transaction.oncomplete = () => {
                if (!operationComplete) {
                    operationComplete = true;
                    console.log("Page operation completed successfully.");
                    db.close();
                    resolve({ success: true });
                }
            };

            transaction.onerror = (event) => {
                if (!operationComplete) {
                    operationComplete = true;
                    console.error("Transaction error:", event.target.error);
                    db.close();
                    reject({ success: false, error: event.target.error?.message || 'Transaction failed' });
                }
            };

            transaction.onabort = (event) => {
                if (!operationComplete) {
                    operationComplete = true;
                    console.error("Transaction aborted:", event.target.error);
                    db.close();
                    reject({ success: false, error: 'Transaction aborted' });
                }
            };
        });
    } catch (error) {
        console.error("Failed to add page:", error);
        return { success: false, error: error.message || error };
    }
}

async function getPagesForBatch(batchId) {
    try {
        const db = await openDb();
        const transaction = db.transaction(PAGES_STORE_NAME, 'readonly');
        const store = transaction.objectStore(PAGES_STORE_NAME);
        const index = store.index('batchIdIndex');
        const request = index.getAll(IDBKeyRange.only(batchId));

        return new Promise((resolve, reject) => {
            request.onsuccess = () => {
                resolve(request.result);
            };
            
            request.onerror = (event) => {
                console.error(`Error getting pages for batch ${batchId}:`, event.target.error);
                reject(event.target.error);
            };

            transaction.oncomplete = () => {
                db.close();
            };

            transaction.onerror = (event) => {
                console.error("Transaction error:", event.target.error);
                db.close();
            };
        });
    } catch (error) {
        console.error("Failed to get pages for batch:", error);
        return [];
    }
}

async function deleteBatchAndPages(batchId) {
    try {
        const db = await openDb();
        const transaction = db.transaction([BATCHES_STORE_NAME, PAGES_STORE_NAME], 'readwrite');
        const batchStore = transaction.objectStore(BATCHES_STORE_NAME);
        const pageStore = transaction.objectStore(PAGES_STORE_NAME);
        const pageIndex = pageStore.index('batchIdIndex');

        let pagesDeletedCount = 0;
        let operationComplete = false;

        return new Promise((resolve, reject) => {
            // Delete the batch record
            const batchDeleteRequest = batchStore.delete(batchId);
            
            batchDeleteRequest.onerror = (e) => {
                console.error("Batch delete request failed:", e.target.error);
            };

            // Find and delete all associated pages using cursor
            const pageCursorRequest = pageIndex.openCursor(IDBKeyRange.only(batchId));
            
            pageCursorRequest.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    pageStore.delete(cursor.primaryKey);
                    pagesDeletedCount++;
                    cursor.continue();
                }
            };

            pageCursorRequest.onerror = (e) => {
                console.error("Page cursor request failed:", e.target.error);
            };

            transaction.oncomplete = () => {
                if (!operationComplete) {
                    operationComplete = true;
                    console.log(`Batch ${batchId} and ${pagesDeletedCount} pages deleted successfully.`);
                    db.close();
                    resolve({ success: true, pagesDeletedCount: pagesDeletedCount });
                }
            };

            transaction.onerror = (event) => {
                if (!operationComplete) {
                    operationComplete = true;
                    console.error(`Transaction error deleting batch ${batchId}:`, event.target.error);
                    db.close();
                    reject({ success: false, error: event.target.error?.message || 'Delete failed' });
                }
            };

            transaction.onabort = (event) => {
                if (!operationComplete) {
                    operationComplete = true;
                    console.error(`Transaction aborted:`, event.target.error);
                    db.close();
                    reject({ success: false, error: 'Transaction aborted' });
                }
            };
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
            if (!request.action) {
                sendResponse({ success: false, error: 'No action specified' });
                return;
            }

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
                    let injectionResults;
                    try {
                        injectionResults = await chrome.scripting.executeScript({
                            target: { tabId: request.tabId },
                            func: () => document.documentElement.outerHTML,
                        });
                    } catch (injectionError) {
                        console.error('Script injection failed:', injectionError);
                        sendResponse({ 
                            success: false, 
                            error: 'Could not retrieve page HTML. The page may restrict extensions or require special permissions.' 
                        });
                        return;
                    }

                    if (!injectionResults || injectionResults.length === 0 || !injectionResults[0].result) {
                        console.error('Script injection returned no result');
                        sendResponse({ success: false, error: 'Could not retrieve page HTML content.' });
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
                    if (!pages || pages.length === 0) {
                        sendResponse({ success: false, error: 'No pages found in this batch to export.' });
                        return;
                    }

                    // Return the pages to the popup for download handling
                    sendResponse({ 
                        success: true, 
                        pages: pages,
                        batchName: request.batchName,
                        batchId: request.batchId
                    });
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
            sendResponse({ 
                success: false, 
                error: error.message || 'An unexpected error occurred in the background script.' 
            });
        }
    })();

    return true; // Keep message channel open for async response
});

console.log("Background service worker loaded and listener attached.");
