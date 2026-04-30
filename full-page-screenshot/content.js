// Run in all frames (all_frames: true config in manifest, or via executeScript)
// Since we didn't specify content_scripts in manifest, we'll inject this dynamically from background.js

function prepareForCapture() {
    return new Promise((resolve) => {
        const originalStyles = {
            overflow: document.documentElement.style.overflow,
            bodyOverflow: document.body ? document.body.style.overflow : '',
        };

        // Ensure no scrollbars interfere with the capture
        document.documentElement.style.overflow = 'hidden';
        if (document.body) {
            document.body.style.overflow = 'hidden';
        }

        // Handle iframes inside this document
        const iframes = document.querySelectorAll('iframe');
        const iframeRestoreData = [];

        // Let's explicitly try to expand shopify's target iframe
        // Usually, the shopify iframe is the one taking up most of the screen
        iframes.forEach((iframe) => {
            iframeRestoreData.push({
                element: iframe,
                originalHeight: iframe.style.height,
                originalTransition: iframe.style.transition
            });
            iframe.style.transition = 'none';
            // We force physical pixel height so it visually expands on the parent frame
            // Cross-origin iframes will message us their height
        });

        // We'll give it a slight delay to let any messages from child iframes arrive
        // OR we just measure ourselves. If we are an iframe, we post message to top.
        if (window !== window.top) {
            const height = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
            window.top.postMessage({ type: 'IFRAME_HEIGHT', height: height }, '*');
        }

        // Listen for iframe height messages from cross-origin children
        const messageListener = (event) => {
            if (event.data && event.data.type === 'IFRAME_HEIGHT') {
                // Find the iframe (tricky if cross-origin, we can just expand all full-width iframes or guess)
                // For Shopify, it's usually `id="storefront-iframe-1"` or `id="preview-iframe"` or class `_StaticIframe_...`
                const targetIframe = document.querySelector('iframe[id^="storefront-iframe-"], iframe#preview-iframe, iframe[title="Online store preview"]');
                if (targetIframe) {
                    targetIframe.style.height = `${event.data.height}px`;
                }
            }
        };

        window.addEventListener('message', messageListener);

        // Resolve after a timeout to let async height messages settle and layout flush
        setTimeout(() => {
            window.removeEventListener('message', messageListener);
            resolve({
                originalStyles,
                iframeRestoreData,
                width: Math.max(
                    document.documentElement.scrollWidth,
                    document.body ? document.body.scrollWidth : 0
                ),
                height: Math.max(
                    document.documentElement.scrollHeight,
                    document.body ? document.body.scrollHeight : 0
                )
            });
        }, 300);
    });
}

function restoreFromCapture(state) {
    if (!state) return;

    document.documentElement.style.overflow = state.originalStyles.overflow;
    if (document.body) {
        document.body.style.overflow = state.originalStyles.bodyOverflow;
    }

    if (state.iframeRestoreData) {
        state.iframeRestoreData.forEach(data => {
            if (data.element) {
                data.element.style.height = data.originalHeight;
                // Restore transition after a brief delay
                setTimeout(() => {
                    if (data.element) {
                        data.element.style.transition = data.originalTransition;
                    }
                }, 100);
            }
        });
    }
}

// Listen for messages from background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'PREPARE_CAPTURE') {
        prepareForCapture().then((state) => {
            // Save state globally so we can restore later
            window.__captureState = state;

            // We also need to check if we are inside an iframe (like Shopify's preview-iframe)
            const isIframe = window !== window.top;

            sendResponse({
                success: true,
                dimensions: { width: state.width, height: state.height },
                isIframe: isIframe
            });
        });
        return true; // Keep channel open for async response
    } else if (request.action === 'RESTORE_CAPTURE') {
        if (window.__captureState) {
            restoreFromCapture(window.__captureState);
            delete window.__captureState;
        }
        sendResponse({ success: true });
    }
});

// Since Safari/Chrome can have issues with sendResponse in async iframes, 
// returning true indicates we wish to send a response asynchronously, but here we don't strictly need it.
