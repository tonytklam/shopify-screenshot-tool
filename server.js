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
app.use('/trash', express.static(path.join(__dirname, 'trash')));

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

// --- Trash helpers ---
function getTrashDir() {
  const dir = path.join(__dirname, 'trash');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getScreenshotsDir() {
  const dir = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// --- List trashed screenshots ---
app.get('/api/trash', (req, res) => {
  const dir = getTrashDir();
  const files = fs.readdirSync(dir)
    .filter(f => f.match(/\.(png|pdf)$/))
    .map(f => {
      const stat = fs.statSync(path.join(dir, f));
      return { name: f, url: `/trash/${f}`, mtime: stat.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  res.json(files);
});

// --- Move single screenshot to trash ---
app.post('/api/screenshots/:name/trash', (req, res) => {
  const screenshotsDir = getScreenshotsDir();
  const trashDir = getTrashDir();
  const src = path.join(screenshotsDir, req.params.name);
  const dest = path.join(trashDir, req.params.name);

  if (!fs.existsSync(src)) {
    return res.status(404).json({ error: 'Screenshot not found' });
  }
  try {
    fs.renameSync(src, dest);
    res.json({ ok: true, name: req.params.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Move all screenshots to trash ---
app.post('/api/screenshots/trash', (req, res) => {
  const screenshotsDir = getScreenshotsDir();
  const trashDir = getTrashDir();
  const files = fs.readdirSync(screenshotsDir)
    .filter(f => f.match(/\.(png|pdf)$/));

  let moved = 0;
  for (const f of files) {
    try {
      fs.renameSync(path.join(screenshotsDir, f), path.join(trashDir, f));
      moved++;
    } catch (err) {
      console.error(`Failed to trash ${f}:`, err.message);
    }
  }
  res.json({ ok: true, moved });
});

// --- Restore from trash ---
app.post('/api/trash/:name/restore', (req, res) => {
  const screenshotsDir = getScreenshotsDir();
  const trashDir = getTrashDir();
  const src = path.join(trashDir, req.params.name);
  const dest = path.join(screenshotsDir, req.params.name);

  if (!fs.existsSync(src)) {
    return res.status(404).json({ error: 'File not found in trash' });
  }
  try {
    fs.renameSync(src, dest);
    res.json({ ok: true, name: req.params.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Permanently delete from trash ---
app.post('/api/trash/:name/delete', (req, res) => {
  const trashDir = getTrashDir();
  const target = path.join(trashDir, req.params.name);

  if (!fs.existsSync(target)) {
    return res.status(404).json({ error: 'File not found in trash' });
  }
  try {
    fs.unlinkSync(target);
    res.json({ ok: true, name: req.params.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Empty trash ---
app.post('/api/trash/empty', (req, res) => {
  const trashDir = getTrashDir();
  const files = fs.readdirSync(trashDir)
    .filter(f => f.match(/\.(png|pdf)$/));

  let deleted = 0;
  for (const f of files) {
    try {
      fs.unlinkSync(path.join(trashDir, f));
      deleted++;
    } catch (err) {
      console.error(`Failed to delete ${f}:`, err.message);
    }
  }
  res.json({ ok: true, deleted });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Screenshot UI running at http://localhost:${PORT}\n`);
});
