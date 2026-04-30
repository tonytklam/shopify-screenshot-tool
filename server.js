import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { capture } from './screenshot.js';

// Holds an in-progress auth browser session between /start and /complete
let pendingAuth = null;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3333;

app.use(express.json());

// Serve static UI files
app.use(express.static(path.join(__dirname, 'ui')));

// Serve screenshots as static files
app.use('/screenshots', express.static(path.join(__dirname, 'screenshots')));

// --- Auth status check ---
app.get('/api/auth-status', (req, res) => {
  const cookieFile = path.join(__dirname, '.shopify_session.json');
  if (!fs.existsSync(cookieFile)) {
    return res.json({ authenticated: false });
  }
  try {
    const cookies = JSON.parse(fs.readFileSync(cookieFile));
    // Check if any session cookies exist and aren't obviously expired
    const sessionCookies = cookies.filter(c =>
      c.name.includes('session') || c.name.includes('_shopify')
    );
    const hasValid = sessionCookies.some(c => {
      if (!c.expires || c.expires === -1) return true; // session cookie
      return c.expires > Date.now() / 1000;
    });
    res.json({ authenticated: hasValid, cookieCount: cookies.length });
  } catch {
    res.json({ authenticated: false });
  }
});

// --- Auth: start login flow ---
// Launches a visible browser window for the user to log in manually.
app.post('/api/auth/start', async (req, res) => {
  if (pendingAuth) {
    // Already a browser open — just confirm it
    return res.json({ ok: true, message: 'Browser already open.' });
  }

  try {
    const browser = await chromium.launch({
      headless: false,
      channel: 'chrome',
      args: ['--disable-blink-features=AutomationControlled']
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`https://admin.shopify.com/`);

    pendingAuth = { browser, context };
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Auth: complete login flow ---
// Saves cookies from the open browser and closes it.
app.post('/api/auth/complete', async (req, res) => {
  if (!pendingAuth) {
    return res.status(400).json({ error: 'No pending auth session. Start login first.' });
  }

  try {
    const { browser, context } = pendingAuth;
    const cookies = await context.cookies();
    const cookieFile = path.join(__dirname, '.shopify_session.json');
    fs.writeFileSync(cookieFile, JSON.stringify(cookies, null, 2));
    console.log(`Session saved to ${cookieFile} (${cookies.length} cookies)`);
    await browser.close();
    pendingAuth = null;
    res.json({ ok: true, cookieCount: cookies.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Take screenshot ---
app.post('/api/screenshot', async (req, res) => {
  const { url, asPdf, mobile } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  // Pass mobile flag via argv trick that screenshot.js reads
  if (mobile) process.argv.push('--mobile');

  try {
    const file = await capture(url, asPdf === true);
    // Return the web-accessible path
    const webPath = '/' + file.replace(/^\.\//, '');
    res.json({ file: webPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    // Clean up mobile flag
    const idx = process.argv.indexOf('--mobile');
    if (idx !== -1) process.argv.splice(idx, 1);
  }
});

// --- List recent screenshots ---
app.get('/api/screenshots', (req, res) => {
  const dir = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(dir)) return res.json([]);

  const files = fs.readdirSync(dir)
    .filter(f => f.match(/\.(png|pdf)$/))
    .map(f => {
      const stat = fs.statSync(path.join(dir, f));
      return { name: f, url: `/screenshots/${f}`, mtime: stat.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 20);

  res.json(files);
});

app.listen(PORT, () => {
  console.log(`\n🚀 Screenshot UI running at http://localhost:${PORT}\n`);
});
