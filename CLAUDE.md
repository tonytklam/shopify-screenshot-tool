# Shopify Screenshot Tool

1. **Authentication:** If you run into authorization issues or haven't logged in recently, run `node auth.js` and login using the browser window.
2. **Screenshot:** `node agent-runner.js '{"url":"https://yourstore.myshopify.com/?preview_theme_id=123"}'`
Output is always a PNG/PDF saved to ./screenshots/.
