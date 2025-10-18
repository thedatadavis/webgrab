// config.js - Configuration for SERP Scraping

// This object defines the CSS selectors and data extraction rules for each
// supported directory. To add a new directory, simply add a new key-value
// pair with the required selector information.

const SERP_CONFIG = {
  "Avvo": {
    "name": "Avvo",
    // The selector for the main container of a single lawyer listing on the SERP
    "listingContainer": ".organic-card",
    "fields": {
      // Selectors are relative to the listingContainer
      "businessName": {
        "selector": "a.search-result-lawyer-name",
      },
      "directoryProfileUrl": {
        "selector": "a.search-result-lawyer-name",
        "attribute": "href", // We need the href attribute, not the text
      },
      "rating": {
        "selector": ".review-score",
        "defaultValue": "N/A"
      },
       "reviewCount": {
        "selector": ".review-count",
        "defaultValue": "0"
      },
      "locationSnippet": {
        "selector": ".address",
        "defaultValue": "N/A"
      }
    }
  },
  "FindLaw": {
    "name": "FindLaw",
    "listingContainer": ".lawyer-card", // Example selector - needs to be verified
    "fields": {
      "businessName": {
        "selector": ".name a"
      },
      "directoryProfileUrl": {
        "selector": ".name a",
        "attribute": "href"
      },
       "rating": {
        "selector": ".rating-value",
        "defaultValue": "N/A"
      },
      "reviewCount": {
        "selector": ".review-count",
        "defaultValue": "0"
      },
      "locationSnippet": {
        "selector": ".location-text",
        "defaultValue": "N/A"
      }
    }
  }
  // To add another directory like "Google Business", you would add a new entry here.
};

