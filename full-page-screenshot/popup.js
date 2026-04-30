document.addEventListener('DOMContentLoaded', () => {
  const captureBtn = document.getElementById('captureBtn');
  const statusEl = document.getElementById('status');

  captureBtn.addEventListener('click', async () => {
    // Disable button and show status
    captureBtn.disabled = true;
    statusEl.textContent = 'Capturing...';
    statusEl.classList.remove('hidden');

    try {
      // Get the active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab) {
        throw new Error('No active tab found.');
      }

      // Send a message to the background script to start the capture process
      const response = await chrome.runtime.sendMessage({
        action: 'capture_full_page',
        tabId: tab.id
      });

      if (response && response.success) {
        statusEl.textContent = 'Capture successful!';
        statusEl.style.color = '#059669'; // Success green
      } else {
        throw new Error((response && response.error) || 'Unknown error occurred.');
      }

    } catch (error) {
      console.error('Capture failed:', error);
      statusEl.textContent = 'Capture failed: ' + error.message;
      statusEl.style.color = '#dc2626'; // Error red
    } finally {
      // Re-enable button after a short delay
      setTimeout(() => {
        captureBtn.disabled = false;
        setTimeout(() => {
          statusEl.classList.add('hidden');
          statusEl.style.color = ''; // Reset color
        }, 3000);
      }, 500);
    }
  });
});
