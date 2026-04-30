// Note: Target.getTargets and Chrome Debugger API used here.

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'capture_full_page') {
        handleCapture(request.tabId)
            .then(() => sendResponse({ success: true }))
            .catch(err => {
                console.error("Capture Error:", err);
                sendResponse({ success: false, error: err.message });
            });
        return true; // Keep the message channel open for async response
    }
});

async function handleCapture(tabId) {
    // 1. Inject content script into all frames to prepare them
    await chrome.scripting.executeScript({
        target: { tabId: tabId, allFrames: true },
        files: ['content.js']
    });

    // Short delay to ensure scripts are initialized
    await new Promise(resolve => setTimeout(resolve, 200));

    // 2. We need to handle cross-origin iframes (like Shopify).
    // The tricky part: If the main content is in an iframe, `captureBeyondViewport` on the top-level tab
    // will only capture what is visible OF that iframe, unless the iframe's DOM element on the parent
    // is resized. But cross-origin parents can't easily resize the iframe to match the child's scrollHeight
    // without explicit messaging.

    // Let's implement a mechanism: ask all frames for their sizes, and if we detect an iframe that
    // might be the main content (e.g., occupies most of the viewport), we could message the parent to resize it.
    // For simplicity right now, we will rely on the content script's attempt to resize same-origin iframes,
    // AND we will use the debugger API to get the layout metrics of the top frame.

    let metrics;

    try {
        // 3. send PREPARE_CAPTURE to all frames
        const results = await chrome.tabs.sendMessage(tabId, { action: 'PREPARE_CAPTURE' });
        // Note: sendMessage without frameId only reaches the top frame by default if we use the promise version
        // Wait, chrome.tabs.sendMessage sends to all frames if we don't specify frameId? No, it targets the main frame.
        // Let's send to all frames if needed, but for now we just prepare the main frame.
        // Actually, to get dimensions of the document, we ask the top frame.
        metrics = results.dimensions;
    } catch (e) {
        console.warn("Could not prepare content script, falling back to basic metrics.");
        metrics = { width: 1920, height: 1080 }; // Fallback
    }

    // 4. Attach debugger
    const target = { tabId: tabId };
    await chrome.debugger.attach(target, '1.3');

    try {
        // 5. Explicitly clear device metrics and then set them to the full layout size
        await chrome.debugger.sendCommand(target, 'Emulation.clearDeviceMetricsOverride');

        const layoutMetrics = await chrome.debugger.sendCommand(target, 'Page.getLayoutMetrics');

        // Use the larger of the content size or our injected scripts measured size
        const width = Math.max(Math.ceil(layoutMetrics.contentSize.width), metrics ? metrics.width : 0);
        const height = Math.max(Math.ceil(layoutMetrics.contentSize.height), metrics ? metrics.height : 0);

        // Force the browser to render the page at the target full dimensions
        // This is the critical fix for the repeating 4x image bug (often caused by fixed/absolute backgrounds)
        await chrome.debugger.sendCommand(target, 'Emulation.setDeviceMetricsOverride', {
            width: width,
            height: height,
            deviceScaleFactor: 1,
            mobile: false,
            fitWindow: false
        });

        // Small delay to allow the browser to repaint at the new huge dimensions
        await new Promise(resolve => setTimeout(resolve, 500));

        // 6. Capture screenshot
        const captureResult = await chrome.debugger.sendCommand(target, 'Page.captureScreenshot', {
            format: 'png',
            captureBeyondViewport: true,
            fromSurface: true, // often helps with composited layers
            clip: {
                x: 0,
                y: 0,
                width: width,
                height: height,
                scale: 1
            }
        });

        if (!captureResult || !captureResult.data) {
            throw new Error("Screenshot data is empty");
        }

        // 7. Download the captured image
        const base64Data = captureResult.data;
        // In Manifest V3 service workers, we can't use URL.createObjectURL.
        // We can pass the data URI directly to chrome.downloads.download.
        const dataUrl = `data:image/png;base64,${base64Data}`;

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        await chrome.downloads.download({
            url: dataUrl,
            filename: `full_page_capture_${timestamp}.png`,
            saveAs: false
        });

    } finally {
        // 8. Detach debugger and restore page state
        await chrome.debugger.detach(target);

        try {
            await chrome.tabs.sendMessage(tabId, { action: 'RESTORE_CAPTURE' });
        } catch (e) {
            // Ignore errors on restore
        }
    }
}
