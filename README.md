Of course. Here is the README file written in Markdown format.

# Webgrab Extension (IndexedDB with Batches)

**Version: 1.2**

***

## 1. Goal

This Chrome extension, **Webgrab**, allows users to save the complete HTML source code of web pages they visit into organized **batches**. Each batch typically corresponds to a specific search or task (e.g., "Avvo Detroit PI Lawyers", "YellowPages Chicago Plumbers"). It uses the browser's IndexedDB for efficient storage and allows exporting individual batches as JSON Lines (`.jsonl`) files.

***

## 2. How it Works

* **IndexedDB Storage:** Uses two stores:
    * `batches`: Stores metadata for each batch (ID, name, creation date, page count, etc.).
    * `pages`: Stores the actual page HTML content, linked to a batch via `batchId`. The page URL is the unique key.
* **Batch Management:**
    * Users can create new batches with unique names via the popup.
    * A dropdown allows selecting the currently active batch.
* **Saving:** Clicking "Save Current Page" saves the current tab's HTML and metadata to the *selected batch* in IndexedDB. If the page URL already exists in the `pages` store, its HTML content and timestamp are updated, but the batch's page count *is not* incremented again.
* **Exporting:** Clicking "Export Selected Batch" reads all pages linked to the *currently selected batch* from IndexedDB and generates a downloadable `.jsonl` file (e.g., `batch_Avvo_Detroit_PI_Lawyers_1_export.jsonl`). Each line is a JSON object representing one page.
* **Deleting:** Clicking "Delete Selected Batch" removes the batch record *and* all associated page records from IndexedDB after confirmation.

***

## 3. How to Install and Use

1.  **Save the Files**: Save all provided files (`manifest.json`, `background.js`, `popup.html`, `popup.js`, `README.md`) into a single folder.
2.  **Create `icons` Folder**: Inside the main folder, create `icons/`.
3.  **Add Icons**: Add `icon16.png`, `icon48.png`, `icon128.png` to the `icons/` folder.
4.  **Open Chrome Extensions**: Navigate to `chrome://extensions`.
5.  **Enable Developer Mode**: Toggle on "Developer mode" (usually top-right).
6.  **Load Unpacked**: Click "Load unpacked" (usually top-left).
7.  **Select Folder**: Select the main folder containing all the extension files.
8.  **Ready to Use**: The **Webgrab** extension icon will appear. Pin it for easy access.
9.  **Usage:**
    * Click the extension icon.
    * If no batches exist, you'll be prompted implicitly. Click the "+" button, enter a name (e.g., "YP Detroit Attorneys"), and click "Create Batch".
    * Select the desired batch from the dropdown.
    * Navigate to a web page you want to archive.
    * Open the popup again (the batch should still be selected).
    * Click "Save Current Page to Batch". The page count for that batch will update.
    * Repeat saving pages to the selected batch as needed.
    * To export, ensure the correct batch is selected and click "Export Selected Batch (.jsonl)".
    * To delete, ensure the correct batch is selected, click "Delete Selected Batch", and confirm.

***

## 4. Processing Exported Data (JSON Lines to SQLite)

See [script in gist](https://gist.github.com/thedatadavis/38331377b1910c85435d922d3dcbde74).

**How to use the Python script:**

1.  Save the Python code as `jsonl_converter.py`.
2.  Run it from your terminal, replacing the filenames:
    `python jsonl_converter.py batch_YP_Detroit_Attorneys_1_export.jsonl my_archive.sqlite`

***

## 5. Technical Notes

* **Storage:** IndexedDB provides ample storage for many batches and pages.
* **Performance:** Saving individual pages is efficient. Exporting or deleting very large batches (thousands of pages) might take noticeable time; the UI provides basic feedback.
* **Batch Naming:** Batch names must be unique. The extension prevents creating duplicate names.
* **Error Handling:** Basic error handling is included. If major IndexedDB issues occur, clearing the extension's storage via Chrome's developer tools might be necessary (`Application` -> `Storage` -> `IndexedDB`).
