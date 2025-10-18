SitePerf.pro Bulk Scraper Extension

Version: 1.1

1. Vision & Goal

The SitePerf.pro Bulk Scraper Extension is an internal tool designed to accelerate the creation of initial prospect lists by scraping directory search result pages (SERPs) in bulk. The goal is to enable a SitePerf.pro admin to quickly build a large JSON file of potential prospects from a directory search.

2. Core User Flow

The user wants to build a list of all Personal Injury lawyers in Chicago from Avvo.

Initiation: The admin navigates to the first page of search results on Avvo.

Configuration: They open the extension popup and select "Avvo" from the directory dropdown.

Scrape & Append Loop:

The admin clicks the "Scrape This Page" button.

The extension extracts data from all listings and adds them to the list shown in the popup.

The admin manually clicks to the next page of search results on the website.

The admin clicks "Scrape This Page" again. The new results are added to the list, and duplicates are ignored.

This "navigate, click scrape" loop is repeated for as many pages as needed.

Export: Once finished, the admin clicks "Export as JSON" to download a single file containing all the aggregated data. The "Clear List" button resets the session.

3. How to Install and Use

Save the Files: Save all the provided files (manifest.json, config.js, background.js, content.js, popup.html, popup.js, README.md) into a single folder on your computer.

Create icons Folder: Inside that main folder, create a new sub-folder named icons.

Add Icons: Create or find three PNG images and save them inside the icons folder with the exact names: icon16.png, icon48.png, and icon128.png.

Open Chrome Extensions: Open Google Chrome and navigate to chrome://extensions.

Enable Developer Mode: In the top-right corner, toggle on "Developer mode".

Load Unpacked: Click the "Load unpacked" button that appears on the top-left.

Select Folder: In the file dialog, select the main folder where you saved all the extension files and click "Select Folder".

Ready to Use: The "SitePerf.pro Bulk Scraper" extension will now appear in your browser's toolbar. Pin it for easy access.

4. How to Extend (Add a New Directory)

The extension is designed to be easily configurable. To add support for a new site (e.g., YellowPages):

Update config.js: Open the config.js file. Add a new entry to the SERP_CONFIG object. You will need to inspect the new website's HTML to find the correct CSS selectors.

"YellowPages": {
  "name": "YellowPages",
  "listingContainer": ".result-item", // Find the main container for each business
  "fields": {
    "businessName": { "selector": ".business-name" },
    "directoryProfileUrl": { "selector": "a.business-name", "attribute": "href", "prefix": "[https://www.yellowpages.com](https://www.yellowpages.com)" },
    // ... add other field selectors
  }
}


Update manifest.json: Add the new website's URL pattern to the host_permissions and content_scripts.matches arrays.

"host_permissions": [
  "*://*[.avvo.com/](https://.avvo.com/)*",
  "*://*[.findlaw.com/](https://.findlaw.com/)*",
  "*://*[.yellowpages.com/](https://.yellowpages.com/)*"
],
"content_scripts": [
  {
    "matches": ["*://*[.avvo.com/](https://.avvo.com/)*", "*://*[.findlaw.com/](https://.findlaw.com/)*", "*://*[.yellowpages.com/](https://.yellowpages.com/)*"],
    "js": ["config.js", "content.js"]
  }
]


Reload the Extension: Go back to chrome://extensions and click the reload button on the SitePerf.pro extension card. Your changes are now live, and the "YellowPages" option will appear in the dropdown.
