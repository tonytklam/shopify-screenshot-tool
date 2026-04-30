import { chromium } from 'playwright';
import fs from 'fs';
import readline from 'readline';

const COOKIE_FILE = '.shopify_session.json';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function main() {
  console.log(`Launching browser for manual login to Shopify...`);
  const browser = await chromium.launch({ 
    headless: false,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled']
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  await page.goto(`https://admin.shopify.com/`);
  
  await new Promise(resolve => {
    rl.question('\nPlease complete the login (including any 2FA or Captchas). Press Enter here in the terminal when you are fully logged into the dashboard...', resolve);
  });

  const cookies = await context.cookies();
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2));
  console.log(`Session saved successfully to ${COOKIE_FILE}`);
  
  await browser.close();
  rl.close();
}

main().catch(console.error);
