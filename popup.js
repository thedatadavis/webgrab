// popup.js - Logic for the extension's popup user interface

document.addEventListener('DOMContentLoaded', () => {
  // UI Element References
  const directorySelector = document.getElementById('directory-selector');
  const scrapeBtn = document.getElementById('scrape-btn');
  const exportJsonBtn = document.getElementById('export-json-btn');
  const clearBtn = document.getElementById('clear-btn');
  const statusBar = document.getElementById('status-bar');
  const tableBody = document.getElementById('preview-table-body');

  // 1. Populate the Directory Selector from the global SERP_CONFIG object
  // (This works because config.js is loaded before this script in popup.html)
  for (const key in SERP_CONFIG) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = SERP_CONFIG[key].name;
    directorySelector.appendChild(option);
  }

  // 2. Main UI Update Function
  function updateUI(prospects = []) {
    const prospectCount = prospects.length;
    // Update status bar text
    statusBar.textContent = `Prospects collected: ${prospectCount}`;

    // Enable/disable the export button based on whether there's data
    exportJsonBtn.disabled = prospectCount === 0;

    // Clear and re-populate the preview table
    tableBody.innerHTML = ''; // Clear existing rows
    if (prospectCount === 0) {
        tableBody.innerHTML = '<tr class="bg-white"><td colspan="3" class="text-center p-4 text-slate-400">No prospects collected yet.</td></tr>';
    } else {
        prospects.forEach(prospect => {
          const row = document.createElement('tr');
          row.className = 'bg-white border-b hover:bg-slate-50';
          row.innerHTML = `
            <td class="px-4 py-2 font-medium text-gray-900 whitespace-nowrap">${prospect.businessName || 'N/A'}</td>
            <td class="px-4 py-2">${prospect.locationSnippet || 'N/A'}</td>
            <td class="px-4 py-2">${prospect.rating || 'N/A'}</td>
          `;
          tableBody.appendChild(row);
        });
    }
  }

  // 3. Event Listeners for Buttons
  scrapeBtn.addEventListener('click', () => {
    const selectedDirectory = directorySelector.value;
    // Send message to background script to initiate scraping on the active tab
    chrome.runtime.sendMessage({
      type: 'SCRAPE_PAGE',
      payload: { directory: selectedDirectory }
    });
    // Provide user feedback
    scrapeBtn.disabled = true;
    scrapeBtn.textContent = 'Scraping...';
    setTimeout(() => { 
        scrapeBtn.disabled = false;
        scrapeBtn.textContent = 'Scrape This Page'; 
    }, 1500); // Re-enable button after 1.5 seconds
  });

  clearBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear the entire prospect list?')) {
      chrome.storage.local.set({ prospects: [] }, () => {
        console.log('Prospect list has been cleared.');
        updateUI([]); // Immediately update UI
      });
    }
  });

  exportJsonBtn.addEventListener('click', () => {
    chrome.storage.local.get('prospects', (data) => {
      if (!data.prospects || data.prospects.length === 0) return;
      
      const jsonContent = JSON.stringify(data.prospects, null, 2);
      const blob = new Blob([jsonContent], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      chrome.downloads.download({
        url: url,
        filename: 'siteperf_prospects_export.json',
        saveAs: true
      });
    });
  });

  // 4. Listen for storage changes to keep the UI automatically in sync
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.prospects) {
      updateUI(changes.prospects.newValue || []);
    }
  });

  // 5. Initial UI load when popup is opened
  chrome.storage.local.get('prospects', (data) => {
    updateUI(data.prospects || []);
  });
});

