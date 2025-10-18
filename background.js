// background.js - Service Worker

// Listens for messages from the popup to initiate a scrape.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 1. Message from POPUP to start scraping
  if (request.type === 'SCRAPE_PAGE') {
    // Find the active tab and send it a message to start scraping,
    // passing along the selected directory's configuration key.
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0 && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'SCRAPE_THIS_PAGE',
          payload: { directory: request.payload.directory }
        });
      } else {
        console.error("Could not find active tab to send scrape command.");
      }
    });
  }

  // 2. Message from CONTENT SCRIPT with the scraped data
  if (request.type === 'SCRAPED_DATA_SUCCESS') {
    // Call the function to save the received prospects.
    saveProspects(request.payload);
  }
  
  // Return true to indicate you wish to send a response asynchronously
  return true;
});

/**
 * Saves new prospects to chrome.storage.local, ensuring no duplicates are added.
 * @param {Array<Object>} newProspects - An array of prospect objects scraped from the page.
 */
async function saveProspects(newProspects) {
  if (!newProspects || newProspects.length === 0) {
    console.log("Received empty or invalid prospect data.");
    return;
  }

  try {
    const data = await chrome.storage.local.get('prospects');
    let existingProspects = data.prospects || [];

    // Use the profile URL as a unique identifier to prevent duplicates.
    const existingUrls = new Set(existingProspects.map(p => p.directoryProfileUrl));

    const uniqueNewProspects = newProspects.filter(p => p.directoryProfileUrl && !existingUrls.has(p.directoryProfileUrl));

    if (uniqueNewProspects.length > 0) {
      const combinedProspects = [...existingProspects, ...uniqueNewProspects];
      await chrome.storage.local.set({ prospects: combinedProspects });
      console.log(`Saved ${uniqueNewProspects.length} new prospects. Total: ${combinedProspects.length}`);
    } else {
       console.log("No new unique prospects found on this page.");
    }
  } catch (error) {
    console.error("Error saving prospects:", error);
  }
}

