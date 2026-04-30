# Shopify Full-Page Screenshot Tool

A robust tool built with Playwright to capture clean, full-page screenshots of Shopify themes, specifically designed to bypass Shopify's lazy-loading, sticky elements, and preview bars. 

It comes with a **Web UI** for easy capturing and device switching, as well as a CLI.

## Why this exists
Capturing full-page screenshots of Shopify preview themes is notoriously difficult because:
1. Images are lazy-loaded and won't render until scrolled into view.
2. The sticky Shopify admin "Preview Bar" gets baked into the middle of full-page screenshots.
3. Preview links are often password-protected and require an authenticated session.

This tool solves all of these issues by maintaining an authenticated session, smoothly scrolling the page to trigger lazy loads, and stripping out the preview bar and sticky elements just before capture.

## Prerequisites
- Node.js (v18+)
- A Shopify store

## Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd shopify-screenshot-tool
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

## Usage

### 1. Start the Web UI
```bash
bash screenshot.sh ui
```
This starts a local server at `http://localhost:3333` and opens your browser automatically.

### 2. Authenticate (First Run)
If you haven't logged in before (or your session has expired), the UI will show a warning banner. Click **🔑 Login to Shopify** — a visible browser window will open. Complete any 2FA/Captcha prompts, then click **Save Session** back in the UI. Your session is saved locally to `.shopify_session.json`.

You can also click the session status badge in the top-right corner of the UI to trigger this flow.

### 3. Take a Screenshot
- Paste any Shopify Editor URL or preview URL into the input field
- Select **Desktop** or **Mobile**
- Click **Capture Screenshot**

The result appears instantly in the preview panel and is saved to `./screenshots/`.

### CLI Usage (Alternative)
If you prefer the terminal:
```bash
# Authenticate
bash screenshot.sh auth

# Take a screenshot
bash screenshot.sh screenshot "https://admin.shopify.com/store/your-store/themes/12345/editor"
```
*(Always wrap URLs containing `&` in quotes to prevent terminal truncation.)*

## Output
Screenshots are automatically saved to the `./screenshots/` directory as high-quality PNGs.

## How it Works
1. Re-uses the authenticated session from `.shopify_session.json`.
2. Converts heavy Editor URLs (`/admin/store/.../editor`) into direct preview URLs for faster loading.
3. Smoothly scrolls the page to the bottom to trigger all lazy-loaded network images.
4. Uses DOM manipulation to hide sticky headers, cookie banners, and the Shopify Preview Bar to ensure a clean capture.

## License
MIT
