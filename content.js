// content.js - This script is injected into directory pages and waits for commands.

/**
 * Scrapes the current page based on the provided directory configuration.
 * @param {object} config - The configuration object for a specific directory (e.g., SERP_CONFIG.Avvo).
 * @returns {Array<Object>} An array of scraped prospect data.
 */
function scrapePageWithConfig(config) {
  const listings = document.querySelectorAll(config.listingContainer);
  const results = [];
  if (listings.length === 0) {
    console.warn(`No listings found with container selector: "${config.listingContainer}"`);
  }

  listings.forEach(listing => {
    const prospect = {
      directory: config.name,
    };

    // Iterate over the fields defined in the config (e.g., businessName, rating)
    for (const fieldName in config.fields) {
      const fieldConfig = config.fields[fieldName];
      const element = listing.querySelector(fieldConfig.selector);

      if (element) {
        let value;
        // Check if we need a specific attribute (like 'href') or just the text
        if (fieldConfig.attribute) {
          value = element.getAttribute(fieldConfig.attribute);
        } else {
          value = element.innerText;
        }
        
        // If a prefix is defined (for creating absolute URLs), prepend it
        if (fieldConfig.prefix && value) {
            value = fieldConfig.prefix + value;
        }
        prospect[fieldName] = value ? value.trim() : fieldConfig.defaultValue || null;
      } else {
        // If the element isn't found, use a default value if one is provided
        prospect[fieldName] = fieldConfig.defaultValue || null;
      }
    }
    results.push(prospect);
  });
  return results;
}


// This script is passive. It only acts when it receives a message from the background script.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'SCRAPE_THIS_PAGE') {
    const directoryKey = request.payload.directory;
    // Check if the config from config.js is available
    if (typeof SERP_CONFIG !== 'undefined' && SERP_CONFIG[directoryKey]) {
      console.log(`Scraping page using config for: ${directoryKey}`);
      const scrapedData = scrapePageWithConfig(SERP_CONFIG[directoryKey]);
      
      // Send the results back to the background script
      chrome.runtime.sendMessage({
        type: 'SCRAPED_DATA_SUCCESS',
        payload: scrapedData
      });

      sendResponse({ status: 'success', count: scrapedData.length });
    } else {
      console.error("Invalid or missing directory configuration:", directoryKey);
      sendResponse({ status: 'error', message: 'Configuration not found for ' + directoryKey });
    }
  }
  return true; // Keep the message channel open for an async response
});

