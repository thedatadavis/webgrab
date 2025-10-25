// popup.js - Logic for the HTML Archiver popup window (IndexedDB with Batches)

// --- DOM Elements ---
const batchSelect = document.getElementById('batch-select');
const showNewBatchBtn = document.getElementById('show-new-batch-btn');
const newBatchSection = document.getElementById('new-batch-section');
const newBatchNameInput = document.getElementById('new-batch-name');
const createBatchBtn = document.getElementById('create-batch-btn');
const cancelNewBatchBtn = document.getElementById('cancel-new-batch-btn');
const pageCountDisplay = document.getElementById('page-count');
const savePageBtn = document.getElementById('save-page-btn');
const exportDataBtn = document.getElementById('export-data-btn');
const deleteBatchBtn = document.getElementById('delete-batch-btn');
const statusMessage = document.getElementById('status-message');

let currentBatches = []; // To hold the list of batches { id, name, pageCount }
const LAST_SELECTED_BATCH_KEY = 'lastSelectedBatchId';

// --- Batch Management UI ---

showNewBatchBtn.addEventListener('click', () => {
    newBatchSection.style.display = 'block';
    showNewBatchBtn.style.display = 'none'; // Hide plus button
    newBatchNameInput.focus();
});

cancelNewBatchBtn.addEventListener('click', () => {
    newBatchSection.style.display = 'none';
    showNewBatchBtn.style.display = 'inline-flex'; // Show plus button again
    newBatchNameInput.value = ''; // Clear input
});

createBatchBtn.addEventListener('click', () => {
    const name = newBatchNameInput.value.trim();
    if (name) {
        // Basic check for duplicate name (client-side)
        if (currentBatches.some(batch => batch.name.toLowerCase() === name.toLowerCase())) {
            showStatus('Error: Batch name already exists.', true);
            return;
        }
        chrome.runtime.sendMessage({ action: 'createBatch', name: name }, (response) => {
            if (response.success) {
                newBatchNameInput.value = '';
                newBatchSection.style.display = 'none';
                showNewBatchBtn.style.display = 'inline-flex';
                loadBatches(); // Reload batch list
                showStatus(`Batch "${name}" created.`, false);
                // Optionally auto-select the new batch (requires ID in response)
                 if (response.newBatch) {
                     // Save immediately as the last selected
                     chrome.storage.local.set({ [LAST_SELECTED_BATCH_KEY]: response.newBatch.id }, () => {
                          loadBatches(response.newBatch.id); // Reload and select the new one
                     });
                 } else {
                     loadBatches(); // Fallback if ID wasn't returned
                 }
            } else {
                showStatus(response.error || 'Failed to create batch.', true);
            }
        });
    } else {
         showStatus('Please enter a batch name.', true);
    }
});

// --- Populate Batch List & Handle Sticky Selection ---

function populateBatchList(batches, selectBatchId = null) {
    currentBatches = batches; // Update global list
    batchSelect.innerHTML = '<option value="">-- No Batch Selected --</option>'; // Reset dropdown

    batches.forEach(batch => {
        const option = document.createElement('option');
        option.value = batch.id;
        option.textContent = `${batch.name} (${batch.pageCount || 0})`;
        batchSelect.appendChild(option);
    });

    if (selectBatchId && batches.some(b => b.id === selectBatchId)) {
        batchSelect.value = selectBatchId;
         // Manually trigger change event to update UI based on pre-selection
        batchSelect.dispatchEvent(new Event('change'));
    } else {
        // If no specific ID to select, try loading the sticky one
        chrome.storage.local.get(LAST_SELECTED_BATCH_KEY, (result) => {
            const lastSelectedId = result[LAST_SELECTED_BATCH_KEY];
            if (lastSelectedId && batches.some(batch => batch.id === lastSelectedId)) {
                batchSelect.value = lastSelectedId;
            } else {
                // If sticky ID not found or invalid, default to no selection
                batchSelect.value = "";
                 // Ensure UI updates if defaulting to no selection
                 updateButtonStates();
                 pageCountDisplay.textContent = 'N/A';
            }
            // Manually trigger change event to update UI based on restored selection or default
            batchSelect.dispatchEvent(new Event('change'));
        });
    }
}


function loadBatches(selectBatchId = null) {
    chrome.runtime.sendMessage({ action: 'getBatches' }, (response) => {
        if (response.success) {
            populateBatchList(response.batches, selectBatchId);
        } else {
            showStatus(response.error || 'Failed to load batches.', true);
            // Still populate with empty list and try sticky selection
             populateBatchList([], selectBatchId);
        }
    });
}

// --- Button States & Actions ---

function updateButtonStates() {
    const selectedBatchId = batchSelect.value;
    const batchIsSelected = !!selectedBatchId;

    savePageBtn.disabled = !batchIsSelected;
    exportDataBtn.disabled = !batchIsSelected;
    deleteBatchBtn.disabled = !batchIsSelected;

    // Update page count display
    if (batchIsSelected) {
        const selectedBatch = currentBatches.find(b => b.id === selectedBatchId);
        pageCountDisplay.textContent = selectedBatch ? (selectedBatch.pageCount || 0) : 0;
    } else {
        pageCountDisplay.textContent = 'N/A';
    }
}

batchSelect.addEventListener('change', () => {
    updateButtonStates();
    const selectedId = batchSelect.value;
    // Save the selection to make it sticky
    if (selectedId) {
        chrome.storage.local.set({ [LAST_SELECTED_BATCH_KEY]: selectedId });
    } else {
        // If "-- No Batch --" is selected, clear the sticky preference
        chrome.storage.local.remove(LAST_SELECTED_BATCH_KEY);
    }
});


savePageBtn.addEventListener('click', () => {
    const selectedBatchId = batchSelect.value;
    if (!selectedBatchId) {
        showStatus('Please select a batch first.', true);
        return;
    }

    showStatus('Saving page...', false, true); // Indicate loading
    savePageBtn.disabled = true; // Disable while saving

    // Get current tab info
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0]) {
            const tab = tabs[0];
            // Send message to background to get HTML and save
            chrome.runtime.sendMessage({
                action: 'savePage',
                batchId: selectedBatchId,
                tabId: tab.id,
                url: tab.url // Pass URL for easier handling in background
            }, (response) => {
                 savePageBtn.disabled = false; // Re-enable button
                if (response.success) {
                    showStatus(`Page saved to batch.`, false);
                    // Reload batches to update count, keeping current selection sticky
                     chrome.storage.local.get(LAST_SELECTED_BATCH_KEY, (result) => {
                        loadBatches(result[LAST_SELECTED_BATCH_KEY]);
                    });
                } else {
                    showStatus(response.error || 'Failed to save page.', true);
                }
            });
        } else {
            savePageBtn.disabled = false; // Re-enable button
            showStatus('Could not get active tab information.', true);
        }
    });
});

exportDataBtn.addEventListener('click', () => {
    const selectedBatchId = batchSelect.value;
    const selectedBatch = currentBatches.find(b => b.id === selectedBatchId);
    if (!selectedBatch) {
        showStatus('Please select a valid batch to export.', true);
        return;
    }

    showStatus('Exporting data...', false, true);
    exportDataBtn.disabled = true; // Disable during export

    chrome.runtime.sendMessage({ action: 'exportBatch', batchId: selectedBatchId, batchName: selectedBatch.name }, (response) => {
        exportDataBtn.disabled = false; // Re-enable
        if (response.success) {
            showStatus(`Batch "${selectedBatch.name}" exported successfully.`, false);
        } else {
            showStatus(response.error || 'Failed to export data.', true);
        }
    });
});


deleteBatchBtn.addEventListener('click', () => {
    const selectedBatchId = batchSelect.value;
    const selectedBatch = currentBatches.find(b => b.id === selectedBatchId);
    if (!selectedBatch) {
        showStatus('Please select a batch to delete.', true);
        return;
    }

    // Confirmation dialog
    if (confirm(`Are you sure you want to delete the batch "${selectedBatch.name}" and all (${selectedBatch.pageCount || 0}) its saved pages? This cannot be undone.`)) {
        showStatus('Deleting batch...', false, true);
        deleteBatchBtn.disabled = true; // Disable during deletion

        chrome.runtime.sendMessage({ action: 'deleteBatch', batchId: selectedBatchId }, (response) => {
            deleteBatchBtn.disabled = false; // Re-enable button
            if (response.success) {
                 showStatus(`Batch "${selectedBatch.name}" deleted.`, false);
                 // Clear sticky preference if the deleted batch was the selected one
                 chrome.storage.local.get(LAST_SELECTED_BATCH_KEY, (result) => {
                     if (result[LAST_SELECTED_BATCH_KEY] === selectedBatchId) {
                         chrome.storage.local.remove(LAST_SELECTED_BATCH_KEY);
                     }
                     loadBatches(); // Reload batches (will default or load next sticky)
                 });

            } else {
                showStatus(response.error || 'Failed to delete batch.', true);
            }
        });
    }
});


// --- Status Message ---
let statusTimeout;
function showStatus(message, isError = false, isLoading = false) {
    clearTimeout(statusTimeout);
    statusMessage.textContent = message;
    statusMessage.className = 'help has-text-centered mt-3'; // Reset classes
    if (isError) {
        statusMessage.classList.add('is-danger');
    } else if (isLoading) {
         statusMessage.classList.add('is-info'); // Use info color for loading
    } else {
         statusMessage.classList.add('is-success');
    }

    // Clear message after a delay unless it's a loading message
    if (!isLoading) {
        statusTimeout = setTimeout(() => {
            statusMessage.textContent = '';
            statusMessage.className = 'help has-text-centered mt-3'; // Reset classes
        }, isError ? 5000 : 3000); // Longer display for errors
    }
}

// --- Initial Load ---
document.addEventListener('DOMContentLoaded', () => {
    loadBatches(); // Load batches when popup opens
});

window.addEventListener('unload', () => {
    clearTimeout(statusTimeout);
});
