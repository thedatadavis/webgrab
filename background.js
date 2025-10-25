// background.js - Service Worker for HTML Archiver Extension (IndexedDB with Batches)

const DB_NAME = 'HtmlBatchArchiveDB';
const DB_VERSION = 1; // Increment if schema changes
const BATCHES_STORE_NAME = 'batches';
const PAGES_STORE_NAME = 'pages';
let db = null; // Holds the IndexedDB database connection

// --- Database Initialization and Schema ---
function initializeDatabase() {
  return new Promise((resolve, reject) => {
    if (db) {
      resolve(db);
      return;
    }
    console.log("Initializing IndexedDB for batches...");

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error("IndexedDB error:", event.target.error);
      reject("IndexedDB error: " + event.target.error);
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      console.log("IndexedDB initialized successfully.");
      db.onerror = (event) => {
        console.error(`Database error: ${event.target.error}`);
      };
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      console.log("IndexedDB upgrade needed.");
      const tempDb = event.target.result;

      // Create 'batches' store
      if (!tempDb.objectStoreNames.contains(BATCHES_STORE_NAME)) {
        console.log(`Creating object store: ${BATCHES_STORE_NAME}`);
        const batchStore = tempDb.createObjectStore(BATCHES_STORE_NAME, { keyPath: 'id', autoIncrement: true });
        batchStore.createIndex('name_idx', 'name', { unique: true }); // Ensure batch names are unique
        console.log("'batches' store created with 'name_idx'.");
      }

      // Create 'pages' store
      if (!tempDb.objectStoreNames.contains(PAGES_STORE_NAME)) {
        console.log(`Creating object store: ${PAGES_STORE_NAME}`);
        const pageStore = tempDb.createObjectStore(PAGES_STORE_NAME, { keyPath: 'url' });
        pageStore.createIndex('batchId_idx', 'batchId', { unique: false }); // Index for finding pages by batch
        console.log("'pages' store created with 'batchId_idx'.");
      }

      console.log("IndexedDB upgrade complete.");
    };
  });
}

// --- Helper Functions (getTransaction, accessStore - slightly modified) ---
async function getTransaction(storeNames, mode) { // Can accept array of store names
  if (!db) {
    await initializeDatabase();
    if (!db) throw new Error("Database connection failed.");
  }
  // Ensure storeNames is always an array for the transaction function
  const names = Array.isArray(storeNames) ? storeNames : [storeNames];
  return db.transaction(names, mode);
}

// Simplified accessStore - assumes single store operation for clarity here
// For multi-store operations, manage transactions directly
async function accessStore(storeName, mode, operation) {
  const transaction = await getTransaction(storeName, mode);
  const store = transaction.objectStore(storeName);
  return new Promise((resolve, reject) => {
    const request = operation(store);
    // Use transaction events for final promise resolution/rejection
    transaction.oncomplete = () => {
        // request.result might be undefined for clear/delete, handle this
        resolve(request.result);
    };
    transaction.onerror = (event) => {
        console.error(`Transaction error in ${storeName} (${mode}):`, event.target.error);
        reject(event.target.error);
    };
     // Individual request errors are often precursors to transaction errors
    if (request) {
       request.onerror = (event) => {
          console.error(`Request error in ${storeName} (${mode}):`, event.target.error);
          // Don't reject here, let the transaction error handle it for consistency
       };
       // If it's a cursor, success might fire multiple times, don't resolve prematurely
       if (!(request instanceof IDBCursor)) {
           request.onsuccess = () => {
               // Don't resolve here for write operations; wait for transaction.oncomplete
                if (mode === 'readonly') {
                    // For read operations, resolve on request success is okay
                    // For count(), getAll(), get()
                }
           };
       }
    } else {
        // If operation doesn't return a request (e.g., direct store.clear()),
        // the transaction.oncomplete will handle the resolve.
    }
  });
}


// --- Batch Management Functions ---

async function createBatch(name, description = '') {
    if (!name || name.trim() === '') {
        throw new Error("Batch name cannot be empty.");
    }
    const trimmedName = name.trim();
    const now = new Date().toISOString();
    const newBatch = {
        name: trimmedName,
        description: description,
        createdAt: now,
        lastSavedAt: now,
        pageCount: 0
    };
    try {
        const batchId = await accessStore(BATCHES_STORE_NAME, 'readwrite', store => store.add(newBatch));
        console.log(`Batch created: ${trimmedName} (ID: ${batchId})`);
        return { ...newBatch, id: batchId }; // Return the full batch object with ID
    } catch (error) {
        if (error.name === 'ConstraintError') {
             console.warn(`Batch name "${trimmedName}" already exists.`);
             throw new Error(`Batch name "${trimmedName}" already exists.`);
        }
        console.error("Error creating batch:", error);
        throw error; // Re-throw other errors
    }
}

async function getBatches() {
    try {
        const batches = await accessStore(BATCHES_STORE_NAME, 'readonly', store => store.getAll());
        // Sort alphabetically by name for consistent dropdown order
        return batches.sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
        console.error("Error fetching batches:", error);
        return []; // Return empty array on error
    }
}

async function deleteBatch(batchId) {
    if (typeof batchId !== 'number' || batchId <= 0) {
        throw new Error("Invalid Batch ID provided for deletion.");
    }
    console.log(`Attempting to delete batch ID: ${batchId}`);
    try {
        // Need a single readwrite transaction spanning both stores
        const transaction = await getTransaction([BATCHES_STORE_NAME, PAGES_STORE_NAME], 'readwrite');
        const batchStore = transaction.objectStore(BATCHES_STORE_NAME);
        const pageStore = transaction.objectStore(PAGES_STORE_NAME);
        const pageIndex = pageStore.index('batchId_idx');

        return new Promise((resolve, reject) => {
             // 1. Delete pages associated with the batch
            const cursorRequest = pageIndex.openCursor(IDBKeyRange.only(batchId));
            let deletedPagesCount = 0;

            cursorRequest.onsuccess = event => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete(); // Delete the page record
                    deletedPagesCount++;
                    cursor.continue();
                } else {
                    // Finished deleting pages, now delete the batch record
                    console.log(`Deleted ${deletedPagesCount} pages for batch ID ${batchId}.`);
                    const deleteBatchRequest = batchStore.delete(batchId);

                    // No need for specific onsuccess/onerror for deleteBatchRequest
                    // as the transaction's events will cover it.
                }
            };
             // Let the overall transaction handlers manage final resolve/reject
            transaction.oncomplete = () => {
                console.log(`Batch ID ${batchId} deleted successfully.`);
                resolve(true);
            };
            transaction.onerror = (event) => {
                console.error(`Error deleting batch ID ${batchId}:`, event.target.error);
                reject(event.target.error);
            };
             cursorRequest.onerror = (event) => {
                 console.error(`Error iterating pages for deletion (Batch ID ${batchId}):`, event.target.error);
                 // Don't reject here, let transaction error handle it.
            };
        });

    } catch (error) {
        console.error("Error initiating batch deletion transaction:", error);
        throw error;
    }
}

// --- Page Management Functions ---

async function addPageToDb(batchId, url, htmlContent) {
   if (typeof batchId !== 'number' || batchId <= 0) {
        throw new Error("Invalid Batch ID provided for saving page.");
   }
   console.log(`Attempting to save page to Batch ID ${batchId}: ${url}`);

  try {
    const urlObj = new URL(url);
    const site = urlObj.hostname;
    const params = urlObj.search;
    const now = new Date().toISOString();

    const pageData = {
      url: url, // Primary key for pages store
      batchId: batchId, // Link to the batch
      site: site,
      params: params,
      html_content: htmlContent,
      retrieved_at: now
    };

    // Use a single transaction to update both stores
    const transaction = await getTransaction([BATCHES_STORE_NAME, PAGES_STORE_NAME], 'readwrite');
    const batchStore = transaction.objectStore(BATCHES_STORE_NAME);
    const pageStore = transaction.objectStore(PAGES_STORE_NAME);

    return new Promise((resolve, reject) => {
        let isNewPage = true; // Assume new until we check

         // Check if page already exists to correctly update batch count
        const getRequest = pageStore.get(url);

        getRequest.onsuccess = event => {
            if (event.target.result) {
                isNewPage = false; // Page exists, this will be an update
                 console.log(`Page ${url} exists, updating content.`);
            } else {
                 console.log(`Page ${url} is new.`);
            }

             // Put/Update the page data
            const putPageRequest = pageStore.put(pageData);

            // putPageRequest.onsuccess = () => { // Not needed, wait for transaction
            // };
        };
        getRequest.onerror = event => {
             console.error(`Error checking existence of page ${url}:`, event.target.error);
            // Don't reject here, let transaction error handle it
        };


        // Update batch metadata *after* page put starts
        transaction.oncomplete = async () => {
             try {
                 // Fetch the batch *again* within a *new* transaction to update count safely
                 const readTx = await getTransaction(BATCHES_STORE_NAME, 'readonly');
                 const readStore = readTx.objectStore(BATCHES_STORE_NAME);
                 const batchGetReq = readStore.get(batchId);

                 batchGetReq.onsuccess = async (getEvent) => {
                     const batch = getEvent.target.result;
                     if (batch) {
                         const updatedBatch = {
                             ...batch,
                             lastSavedAt: now,
                             pageCount: isNewPage ? (batch.pageCount || 0) + 1 : batch.pageCount // Increment only if new
                         };
                         // Start *another* transaction just for the batch update
                         try {
                              await accessStore(BATCHES_STORE_NAME, 'readwrite', store => store.put(updatedBatch));
                              console.log(`Batch ${batchId} metadata updated. New count: ${updatedBatch.pageCount}`);
                              resolve({ status: 'success', url: url }); // Final success
                         } catch (updateErr) {
                              console.error(`Failed to update batch ${batchId} metadata after page save:`, updateErr);
                              // Resolve anyway, page was saved, but log the count issue
                              resolve({ status: 'partial_success', url: url, message: "Page saved, but batch metadata update failed." });
                         }
                     } else {
                          console.error(`Batch ID ${batchId} not found during metadata update.`);
                          resolve({ status: 'partial_success', url: url, message: "Page saved, but linked batch not found for metadata update." });
                     }
                 };
                  batchGetReq.onerror = (getErrEvent) => {
                       console.error(`Error fetching batch ${batchId} for metadata update:`, getErrEvent.target.error);
                       resolve({ status: 'partial_success', url: url, message: "Page saved, but failed to fetch batch for metadata update." });
                  };

             } catch (outerUpdateErr) {
                 console.error("Error initiating batch metadata update transaction:", outerUpdateErr);
                 resolve({ status: 'partial_success', url: url, message: "Page saved, but failed to initiate batch metadata update." });
             }

        };

        transaction.onerror = (event) => {
             console.error(`Error saving page ${url} or checking existence:`, event.target.error);
             reject(event.target.error);
        };
    });

  } catch (error) {
    console.error(`Critical error saving page ${url} to Batch ID ${batchId}:`, error);
    throw error;
  }
}

async function getPageCount(batchId = null) {
    try {
        if (batchId !== null && typeof batchId === 'number' && batchId > 0) {
            // Count pages for a specific batch
            const index = (await getTransaction(PAGES_STORE_NAME, 'readonly')).objectStore(PAGES_STORE_NAME).index('batchId_idx');
            const count = await new Promise((resolve, reject) => {
                 const request = index.count(IDBKeyRange.only(batchId));
                 request.onsuccess = () => resolve(request.result);
                 request.onerror = (event) => reject(event.target.error);
            });
             return count;
        } else {
             // Count all pages (though maybe less useful now)
             const count = await accessStore(PAGES_STORE_NAME, 'readonly', store => store.count());
            return count;
        }
    } catch(error) {
         console.error(`Error getting page count (Batch ID: ${batchId}):`, error);
         throw error;
    }
}


// --- Export Function ---
async function exportBatchJsonl(batchId, batchName = 'export') {
    if (typeof batchId !== 'number' || batchId <= 0) {
        throw new Error("Invalid Batch ID provided for export.");
    }
    console.log(`Starting export for Batch ID: ${batchId}`);

    const transaction = await getTransaction(PAGES_STORE_NAME, 'readonly');
    const store = transaction.objectStore(PAGES_STORE_NAME);
    const index = store.index('batchId_idx'); // Use the index
    const cursorRequest = index.openCursor(IDBKeyRange.only(batchId)); // Filter by batchId
    let lines = [];
    let count = 0;

    return new Promise((resolve, reject) => {
        cursorRequest.onsuccess = event => {
            const cursor = event.target.result;
            if (cursor) {
                try {
                    lines.push(JSON.stringify(cursor.value));
                    count++;
                } catch (stringifyError) {
                    console.error("Error stringifying record:", cursor.value, stringifyError);
                }
                 // Batch processing to avoid memory issues with huge batches
                 if (lines.length >= 500) { // Process in chunks of 500 lines
                    // In a real implementation, you might stream this to a file directly
                    // For simplicity here, we build up the array
                    console.log(`Processed ${count} records so far...`);
                 }
                cursor.continue();
            } else {
                // End of cursor iteration
                console.log(`Export prepared for batch ${batchId} with ${count} records.`);
                if (count === 0) {
                     console.log("Batch is empty, nothing to export.");
                     resolve({ status: 'empty' }); // Indicate empty batch
                     return;
                }

                const jsonlContent = lines.join('\n');
                const blob = new Blob([jsonlContent], { type: 'application/jsonl' });
                const blobUrl = URL.createObjectURL(blob);

                // Sanitize batch name for filename
                const safeBatchName = batchName.replace(/[^a-z0-9_\-\.]/gi, '_').substring(0, 50);
                const filename = `batch_${safeBatchName}_${batchId}_export.jsonl`;

                chrome.downloads.download({
                    url: blobUrl,
                    filename: filename,
                    saveAs: true
                }).then(() => {
                     resolve({ status: 'success' });
                }).catch(downloadError => {
                    console.error("Error starting download:", downloadError);
                    reject(downloadError);
                });
            }
        };

        cursorRequest.onerror = event => {
             console.error(`Error reading cursor for batch ${batchId}:`, event.target.error);
             reject(event.target.error);
        };
        transaction.onerror = (event) => {
            console.error(`Export transaction error for batch ${batchId}:`, event.target.error);
            reject(event.target.error);
        };
    });
}

// --- Message Handling ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Page saving
  if (request.type === 'SAVE_CURRENT_PAGE') {
    (async () => {
      if (!request.payload || typeof request.payload.batchId !== 'number') {
        sendResponse({ status: 'error', message: "No batch selected." });
        return;
      }
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs.length === 0 || !tabs[0].id) throw new Error("No active tab found.");

        const results = await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: () => ({ url: window.location.href, html: document.documentElement.outerHTML })
        });
        if (!results || !results[0]?.result) throw new Error("Failed to retrieve page content.");

        const { url, html } = results[0].result;
        await addPageToDb(request.payload.batchId, url, html);
        sendResponse({ status: 'success', url: url });
      } catch (err) {
        console.error("Error in SAVE_CURRENT_PAGE:", err);
        sendResponse({ status: 'error', message: err.message || "Unknown error" });
      }
    })();
    return true; // Async
  }

  // Batch operations
  else if (request.type === 'CREATE_BATCH') {
      (async () => {
          try {
              const newBatch = await createBatch(request.payload.name, request.payload.description);
              sendResponse({ status: 'success', batch: newBatch });
          } catch (err) {
              sendResponse({ status: 'error', message: err.message || "Failed to create batch" });
          }
      })();
      return true; // Async
  }
  else if (request.type === 'GET_BATCHES') {
      (async () => {
          try {
              const batches = await getBatches();
              sendResponse({ status: 'success', batches: batches });
          } catch (err) {
              sendResponse({ status: 'error', message: err.message || "Failed to get batches" });
          }
      })();
      return true; // Async
  }
  else if (request.type === 'DELETE_BATCH') {
       (async () => {
          if (!request.payload || typeof request.payload.batchId !== 'number') {
             sendResponse({ status: 'error', message: "Invalid batch ID for deletion." });
             return;
          }
          try {
              await deleteBatch(request.payload.batchId);
              sendResponse({ status: 'success' });
          } catch (err) {
              sendResponse({ status: 'error', message: err.message || "Failed to delete batch" });
          }
      })();
      return true; // Async
  }

  // Counting
  else if (request.type === 'GET_PAGE_COUNT') {
     (async () => {
         try {
             // Pass batchId if provided, otherwise it counts all pages (null)
             const batchId = request.payload?.batchId ?? null;
             const count = await getPageCount(batchId);
             sendResponse({ status: 'success', count: count });
         } catch (err) {
             sendResponse({ status: 'error', message: err.message || "Failed to get count", count: 0 });
         }
     })();
     return true; // async
  }

  // Exporting
  else if (request.type === 'EXPORT_BATCH_JSONL') {
     (async () => {
         if (!request.payload || typeof request.payload.batchId !== 'number') {
             sendResponse({ status: 'error', message: "Invalid batch ID for export." });
             return;
         }
         try {
             const result = await exportBatchJsonl(request.payload.batchId, request.payload.batchName);
              if (result.status === 'empty') {
                  sendResponse({ status: 'success', message: 'Batch is empty, nothing exported.' });
              } else {
                 sendResponse({ status: 'success' });
              }
         } catch (err) {
             sendResponse({ status: 'error', message: err.message || "Export failed" });
         }
     })();
     return true; // async
  }

  return false; // Default case
});

// --- Initialization on Startup ---
initializeDatabase().catch(err => {
    console.error("Initial database initialization failed on startup:", err);
});

console.log("Background script loaded (IndexedDB with Batches version).");

