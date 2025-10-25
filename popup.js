// popup.js - Logic for the HTML Archiver popup window (IndexedDB with Batches)

// --- DOM Elements ---
const batchSelect = document.getElementById('batch-select');
const pageCountEl = document.getElementById('page-count');
const saveBtn = document.getElementById('save-page-btn');
const exportBtn = document.getElementById('export-data-btn');
const deleteBtn = document.getElementById('delete-batch-btn'); // Renamed from clearBtn
const statusMsgEl = document.getElementById('status-message');
const showNewBatchBtn = document.getElementById('show-new-batch-btn');
const newBatchSection = document.getElementById('new-batch-section');
const newBatchNameInput = document.getElementById('new-batch-name');
const createBatchBtn = document.getElementById('create-batch-btn');
const cancelNewBatchBtn = document.getElementById('cancel-new-batch-btn');

// --- State ---
let isLoading = false; // Prevent multiple clicks while processing
let currentBatches = []; // Cache the list of batches
let selectedBatchId = null; // ID of the currently selected batch

// --- Utility Functions ---

function setLoading(button, loading) {
    isLoading = loading;
    const buttonsToToggle = [saveBtn, exportBtn, deleteBtn, createBatchBtn, showNewBatchBtn];

    buttonsToToggle.forEach(btn => {
        if (btn) { // Ensure button exists
             const originalText = btn.dataset.originalText || btn.textContent;
             if (loading && !btn.dataset.originalText) {
                 btn.dataset.originalText = originalText;
             }
             if (btn === button) { // Specific button being actioned
                 btn.textContent = loading ? 'Processing...' : originalText;
             }
             btn.disabled = loading; // Disable all during any operation
             if (!loading) {
                 delete btn.dataset.originalText; // Clean up data attribute
             }
        }
    });

    // Also disable select dropdown during processing
    batchSelect.disabled = loading;

    // After loading finishes, re-evaluate button states based on selection
    if (!loading) {
        updateButtonStates();
        updatePageCount(); // Refresh count
    }
}

function showStatus(message, isError = false, duration = null) {
    statusMsgEl.textContent = message;
    statusMsgEl.className = `text-xs text-center mt-3 h-4 ${isError ? 'text-red-500' : 'text-slate-500'}`;
    const clearDuration = duration !== null ? duration : (isError ? 5000 : 3000);
    // Clear the message after duration
    if (clearDuration > 0) {
        setTimeout(() => {
            if (statusMsgEl.textContent === message) { // Only clear if it hasn't been replaced
                 statusMsgEl.textContent = '';
                 statusMsgEl.className = 'text-xs text-center text-slate-500 mt-3 h-4';
            }
        }, clearDuration);
    }
}

function updateButtonStates() {
    const hasSelection = selectedBatchId !== null;
    saveBtn.disabled = !hasSelection || isLoading;
    exportBtn.disabled = !hasSelection || isLoading;
    deleteBtn.disabled = !hasSelection || isLoading;

     // Ensure export/delete are disabled if the selected batch has 0 pages (checked in updatePageCount)
     if (hasSelection) {
         chrome.runtime.sendMessage({ type: 'GET_PAGE_COUNT', payload: { batchId: selectedBatchId } }, (response) => {
             if (response && response.status === 'success' && !isLoading) { // Don't override loading state
                 const count = response.count ?? 0;
                 exportBtn.disabled = (count === 0);
                 deleteBtn.disabled = (count === 0);
             } else if (!isLoading) {
                  exportBtn.disabled = true; // Disable on error too
                  deleteBtn.disabled = true;
             }
         });
     }
}

// --- Batch Management UI ---

function populateBatchSelect(selectLast = false) {
    const previousValue = batchSelect.value; // Store previous selection attempt
    batchSelect.innerHTML = '<option value="">-- No Batch Selected --</option>'; // Clear existing options

    currentBatches.forEach(batch => {
        const option = document.createElement('option');
        option.value = batch.id;
        option.textContent = batch.name;
        batchSelect.appendChild(option);
    });

    // Try to restore previous selection or select the last one if requested (after creation)
     let valueToSet = "";
     if (selectLast && currentBatches.length > 0) {
        valueToSet = currentBatches[currentBatches.length - 1].id.toString();
     } else if (previousValue) {
          // Check if previous value still exists
          if (currentBatches.some(b => b.id.toString() === previousValue)) {
              valueToSet = previousValue;
          }
     }

     batchSelect.value = valueToSet;
     selectedBatchId = valueToSet ? parseInt(valueToSet, 10) : null;
     updatePageCount();
     updateButtonStates();
}

function loadBatches(selectLast = false) {
     showStatus("Loading batches...", false, 0); // Show loading indefinitely until done
     chrome.runtime.sendMessage({ type: 'GET_BATCHES' }, (response) => {
          if (chrome.runtime.lastError) {
               console.error("Error loading batches:", chrome.runtime.lastError.message);
               showStatus(`Error loading batches: ${chrome.runtime.lastError.message}`, true);
               currentBatches = [];
          } else if (response && response.status === 'success') {
               currentBatches = response.batches || [];
               showStatus("", false, 1); // Clear loading message quickly
          } else {
               showStatus(response?.message || "Failed to load batches.", true);
               currentBatches = [];
          }
          populateBatchSelect(selectLast); // Populate dropdown even if loading failed (shows empty state)
     });
}

function updatePageCount() {
    if (selectedBatchId === null) {
        pageCountEl.textContent = 'N/A';
        updateButtonStates(); // Ensure export/delete are disabled
        return;
    }

    pageCountEl.textContent = 'Loading...';
    chrome.runtime.sendMessage({ type: 'GET_PAGE_COUNT', payload: { batchId: selectedBatchId } }, (response) => {
        if (isLoading) return; // Don't update if another operation is in progress

        if (chrome.runtime.lastError) {
            console.error("Error getting page count:", chrome.runtime.lastError.message);
            pageCountEl.textContent = 'Error';
            showStatus(`Error getting count: ${chrome.runtime.lastError.message}`, true);
        } else if (response && response.status === 'success') {
            const count = response.count ?? 0;
            pageCountEl.textContent = count;
             // Update button states based on count ONLY if not loading
            exportBtn.disabled = (count === 0);
            deleteBtn.disabled = (count === 0);
        } else {
            pageCountEl.textContent = 'Error';
            showStatus(response?.message || "Failed to get page count.", true);
             exportBtn.disabled = true;
             deleteBtn.disabled = true;
        }
    });
}


// --- Event Listeners ---

// Batch Selection Change
batchSelect.addEventListener('change', (event) => {
    selectedBatchId = event.target.value ? parseInt(event.target.value, 10) : null;
    console.log("Selected Batch ID:", selectedBatchId);
    updatePageCount();
    updateButtonStates();
     // Store selection for next time popup opens (optional, using session storage)
    if (selectedBatchId !== null) {
         chrome.storage.session.set({ lastSelectedBatchId: selectedBatchId });
    } else {
         chrome.storage.session.remove('lastSelectedBatchId');
    }

});

// Show/Hide New Batch Form
showNewBatchBtn.addEventListener('click', () => {
    newBatchSection.style.display = 'block';
    showNewBatchBtn.style.display = 'none'; // Hide the plus button
    newBatchNameInput.focus();
});

cancelNewBatchBtn.addEventListener('click', () => {
    newBatchSection.style.display = 'none';
    showNewBatchBtn.style.display = 'block'; // Show the plus button again
    newBatchNameInput.value = ''; // Clear input
    showStatus("", false, 1); // Clear any previous error message
});

// Create New Batch
createBatchBtn.addEventListener('click', () => {
    const name = newBatchNameInput.value.trim();
    if (!name) {
        showStatus("Please enter a batch name.", true);
        newBatchNameInput.focus();
        return;
    }
    if (isLoading) return;

    setLoading(createBatchBtn, true);
    showStatus(`Creating batch "${name}"...`, false, 0);

    chrome.runtime.sendMessage({ type: 'CREATE_BATCH', payload: { name: name } }, (response) => {
        setLoading(createBatchBtn, false);
        if (chrome.runtime.lastError) {
            console.error("Create batch failed:", chrome.runtime.lastError.message);
            showStatus(`Create failed: ${chrome.runtime.lastError.message}`, true);
        } else if (response && response.status === 'success') {
            showStatus(`Batch "${name}" created.`, false);
            newBatchNameInput.value = ''; // Clear input
            newBatchSection.style.display = 'none'; // Hide form
            showNewBatchBtn.style.display = 'block'; // Show plus button
            loadBatches(true); // Reload batches and select the newly created one
        } else {
            showStatus(response?.message || "Failed to create batch.", true);
            newBatchNameInput.focus(); // Keep focus if error
        }
    });
});

// Save Page to Selected Batch
saveBtn.addEventListener('click', () => {
    if (isLoading || selectedBatchId === null) return;
    setLoading(saveBtn, true);
    showStatus(`Saving page to batch "${batchSelect.options[batchSelect.selectedIndex].text}"...`, false, 0);

    chrome.runtime.sendMessage({ type: 'SAVE_CURRENT_PAGE', payload: { batchId: selectedBatchId } }, (response) => {
        setLoading(saveBtn, false);
        if (chrome.runtime.lastError) {
             console.error("Save failed:", chrome.runtime.lastError.message);
             showStatus(`Save failed: ${chrome.runtime.lastError.message}`, true);
        } else if (response && response.status === 'success') {
            showStatus(`Page saved!`, false);
            // updatePageCount(); // Handled by setLoading(false)
        } else {
            showStatus(response?.message || "Failed to save page.", true);
        }
    });
});

// Export Selected Batch
exportBtn.addEventListener('click', () => {
    if (isLoading || selectedBatchId === null) return;
    const selectedBatchName = batchSelect.options[batchSelect.selectedIndex].text;
    setLoading(exportBtn, true);
    showStatus(`Exporting batch "${selectedBatchName}"...`, false, 0);

    chrome.runtime.sendMessage({
        type: 'EXPORT_BATCH_JSONL',
        payload: { batchId: selectedBatchId, batchName: selectedBatchName }
     }, (response) => {
        setLoading(exportBtn, false);
         if (chrome.runtime.lastError) {
             console.error("Export failed:", chrome.runtime.lastError.message);
             showStatus(`Export failed: ${chrome.runtime.lastError.message}`, true);
         } else if (response && response.status === 'success') {
             if (response.message) { // Handle "empty batch" message
                  showStatus(response.message, false);
             } else {
                 showStatus("Batch export started (.jsonl).");
             }
        } else {
            showStatus(response?.message || "Failed to start export.", true);
        }
    });
});

// Delete Selected Batch
deleteBtn.addEventListener('click', () => {
    if (isLoading || selectedBatchId === null) return;
    const selectedBatchName = batchSelect.options[batchSelect.selectedIndex].text;

    if (confirm(`Are you sure you want to delete the batch "${selectedBatchName}" and all its pages? This cannot be undone.`)) {
        setLoading(deleteBtn, true);
        showStatus(`Deleting batch "${selectedBatchName}"...`, false, 0);

        chrome.runtime.sendMessage({ type: 'DELETE_BATCH', payload: { batchId: selectedBatchId } }, (response) => {
             setLoading(deleteBtn, false);
             if (chrome.runtime.lastError) {
                 console.error("Delete failed:", chrome.runtime.lastError.message);
                 showStatus(`Delete failed: ${chrome.runtime.lastError.message}`, true);
             } else if (response && response.status === 'success') {
                showStatus(`Batch "${selectedBatchName}" deleted.`, false);
                selectedBatchId = null; // Reset selection
                 chrome.storage.session.remove('lastSelectedBatchId'); // Clear stored selection
                loadBatches(); // Reload batches
                // page count and button states are updated by loadBatches -> populateBatchSelect
            } else {
                showStatus(response?.message || "Failed to delete batch.", true);
            }
        });
    }
});


// --- Initial Load ---
document.addEventListener('DOMContentLoaded', () => {
    // Attempt to restore last selected batch from session storage
    chrome.storage.session.get('lastSelectedBatchId', (result) => {
        const lastId = result.lastSelectedBatchId;
         if (lastId) {
             // Temporarily set the value, loadBatches will verify and update properly
             batchSelect.value = lastId.toString();
             selectedBatchId = lastId;
         }
         loadBatches(); // Load batches from DB, which will re-select if valid
    });
     updateButtonStates(); // Set initial button disabled states
     updatePageCount();
});

