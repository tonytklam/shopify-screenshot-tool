import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const COOKIE_FILE = '.shopify_session.json';
const OUTPUT_DIR = './screenshots';

// Parse CLI args: node screenshot.js [url] [--pdf]
const [,, targetUrlArg, ...flags] = process.argv;
const asPdf = flags.includes('--pdf');

async function loadCookies(context) {
  if (!fs.existsSync(COOKIE_FILE)) return false;
  const cookies = JSON.parse(fs.readFileSync(COOKIE_FILE));
  await context.addCookies(cookies);
  return true;
}

export async function capture(targetUrl, saveAsPdf = false) {
  if (!targetUrl) {
    throw new Error("Please provide a target URL.");
  }

  let isMobile = process.argv.includes('--mobile');

  // Convert heavy Editor URLs back to direct Preview URLs safely
  try {
    const parsed = new URL(targetUrl);
    
    if (parsed.searchParams.get('previewMode') === 'mobile') {
      isMobile = true;
    }

    if (parsed.hostname === 'admin.shopify.com' && parsed.pathname.includes('/editor')) {
      const parts = parsed.pathname.split('/');
      // Format: /store/[storeName]/themes/[themeId]/editor
      if (parts[1] === 'store' && parts[3] === 'themes' && parts[5] === 'editor') {
        const storeName = parts[2];
        const themeId = parts[4];
        const previewPath = parsed.searchParams.get('previewPath') || '/';
        
        targetUrl = `https://${storeName}.myshopify.com${previewPath}`;
        const newParsed = new URL(targetUrl);
        newParsed.searchParams.set('preview_theme_id', themeId);
        targetUrl = newParsed.toString();
        console.log(`Auto-converted Editor URL to direct Preview URL: ${targetUrl}`);
      }
    }
  } catch (e) {
    // Ignore URL parse errors here, playright will catch them
  }

  const browser = await chromium.launch({ 
    headless: true,
    channel: 'chrome'
  });
  
  const contextOptions = isMobile ? {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
  } : {
    viewport: { width: 1440, height: 900 }
  };

  const context = await browser.newContext(contextOptions);
  
  const hasCookies = await loadCookies(context);
  if (!hasCookies) {
    console.warn("No session found. If the page is password protected or a preview, it might redirect to login. Run `node auth.js` first.");
  }

  const page = await context.newPage();
  
  console.log(`Navigating to ${targetUrl}...`);
  await page.goto(targetUrl, { waitUntil: 'load', timeout: 60000 });

  // If redirected to login, alert the user
  if (page.url().includes('/account/login') || page.url().includes('/admin/auth/login')) {
    console.error('Redirected to login page. Session may be invalid or expired. Please run `node auth.js` to log in.');
    await browser.close();
    process.exit(1);
  }

  // Wait for fonts + lazy images
  await page.waitForTimeout(1500);

  // Close any popups, side carts (like "MY CART"), or newsletters
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500); // Wait for drawer closing animations

  // Inject CSS to firmly hide common modal/popup overlays
  await page.addStyleTag({ content: `
    [id*="modal"], [class*="modal"], [id*="popup"], [class*="popup"], [role="dialog"] {
      display: none !important;
      opacity: 0 !important;
      visibility: hidden !important;
      pointer-events: none !important;
    }
  `});

  // Smoothly scroll down the page to trigger all lazy-loaded images!
  console.log('Scrolling down to trigger lazy images...');
  
  // Spam Escape key during scrolling to kill any javascript popups that appear
  const escapeInterval = setInterval(() => {
    page.keyboard.press('Escape').catch(() => {});
  }, 400);

  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 400; // scroll amount per tick
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        // Dismiss any preview bar that Shopify injects
        document.querySelectorAll(
          '#preview-bar-iframe, .shopify-preview-bar, iframe[name="preview-bar-iframe"], iframe[id*="admin-bar"], iframe[id*="preview-bar"]'
        ).forEach(bar => bar.remove());

        if (totalHeight >= scrollHeight - window.innerHeight) {
          clearInterval(timer);
          // Scroll back up to the top occasionally required for sticky headers
          window.scrollTo(0, 0);
          resolve();
        }
      }, 150); // scrolled every 150ms
    });
  });

  clearInterval(escapeInterval);

  // Give it one final moment to finish downloading the network images
  await page.waitForTimeout(1500);

  // Final cleanup pass right before capture — the Shopify preview bar can
  // re-inject itself after the scroll loop ends and causes a black bar in the image.
  await page.evaluate(() => {
    // Remove Shopify preview/admin bar iframes entirely
    document.querySelectorAll(
      '#preview-bar-iframe, iframe[name="preview-bar-iframe"], iframe[id*="preview-bar"], iframe[id*="admin-bar"], .shopify-preview-bar, #shopify-preview-bar'
    ).forEach(el => el.remove());

    // Hide any remaining fixed/sticky elements (announcement bars, cookie banners,
    // sticky headers) that would otherwise float over the image at scroll position 0
    document.querySelectorAll('*').forEach(el => {
      const style = window.getComputedStyle(el);
      if (style.position === 'fixed' || style.position === 'sticky') {
        el.style.setProperty('display', 'none', 'important');
      }
    });
  });

  // One more tick to let any CSS transitions from the above settle
  await page.waitForTimeout(300);

  // Output path
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  
  // Create a safe slug from the URL
  let urlObj;
  try {
    urlObj = new URL(targetUrl);
  } catch (e) {
    // Basic fallback if invalid URL passed, though goto would have failed
    targetUrl = `https://${targetUrl}`;
    urlObj = new URL(targetUrl);
  }
  
  let slug = urlObj.pathname.replace(/\//g, '_').replace(/^_/, '') || 'home';
  if (urlObj.searchParams.has('preview_theme_id')) {
     slug = `theme_${urlObj.searchParams.get('preview_theme_id')}_${slug}`;
  }
  if (isMobile) {
    slug += '_mobile';
  }
  
  const timestamp = new Date().toISOString().slice(0, 16).replace(':', '-');
  const ext = saveAsPdf ? 'pdf' : 'png';
  const filename = path.join(OUTPUT_DIR, `${slug}_${timestamp}.${ext}`);

  if (saveAsPdf) {
    await page.pdf({ path: filename, format: 'A4', printBackground: true });
  } else {
    await page.screenshot({ path: filename, fullPage: true });
  }

  console.log(`Saved: ${filename}`);
  await browser.close();
  return filename;
}

// Only run capture if this script is executed directly (not imported)
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1].endsWith('screenshot.js')) {
  capture(targetUrlArg, asPdf).catch(console.error);
}
