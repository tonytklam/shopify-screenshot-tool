import { chromium } from 'playwright';

const store = process.argv[2];
if (!store) {
  console.error("Please provide your store URL as an argument, e.g. node list-themes.js your-store.myshopify.com");
  process.exit(1);
}

const browser = await chromium.launch({ headless: false }); // visible so you can log in manually
const page = await browser.newPage();
await page.goto(`https://${store}/admin/themes`);
await page.waitForTimeout(30000); // you log in manually, then it scrapes

const themes = await page.$$eval('[data-theme-id]', els =>
  els.map(el => ({ id: el.dataset.themeId, name: el.textContent.trim() }))
);
console.table(themes);
await browser.close();
