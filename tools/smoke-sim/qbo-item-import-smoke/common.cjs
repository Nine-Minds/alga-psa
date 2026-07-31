const path = require('path');
const fs = require('fs');
const { chromium } = require('/home/robert/alga-copies/feature-qbo-import-products-services/node_modules/playwright/index.js');

const EVD = '/tmp/alga-smoke-evidence/qbo-item-import-20260729-003734';
const STATE = path.join(EVD, 'driver-state.json');
const BASE = 'http://localhost:3642';
const EMAIL = 'glinda@emeraldcity.oz';
const PASSWORD = 'VVVbiTMGKYX2UEcM';

async function launch() {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox']
  });
  const context = await browser.newContext({
    viewport: { width: 1512, height: 950 },
    storageState: fs.existsSync(STATE) ? STATE : undefined
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  return { browser, context, page };
}

async function saveState(context) {
  await context.storageState({ path: STATE });
}

async function shot(page, name) {
  const file = path.join(EVD, name);
  await page.screenshot({ path: file, fullPage: true });
  console.log('SHOT', file);
}

async function login(page) {
  await page.goto(BASE + '/auth/msp/signin', { waitUntil: 'networkidle' });
  if (!page.url().includes('signin')) { console.log('already logged in:', page.url()); return; }
  const email = page.locator('input[type="email"], input[name="email"], #email').first();
  const pass = page.locator('input[type="password"]').first();
  await email.fill(EMAIL);
  await pass.fill(PASSWORD);
  await Promise.all([
    page.waitForURL(/msp/, { timeout: 30000 }),
    page.locator('button[type="submit"], #signin-button, button:has-text("Sign in")').first().click()
  ]);
  console.log('logged in, at', page.url());
}

module.exports = { launch, saveState, shot, login, EVD, BASE };
