const { launch, saveState, shot, BASE } = require('./common.cjs');
(async () => {
  const { browser, context, page } = await launch();
  try {
    await page.goto(BASE + '/msp/settings?tab=integrations&category=accounting', { waitUntil: 'networkidle' });
    await page.waitForTimeout(4000);

    // Select the QuickBooks Online integration card
    const qboCard = page.locator('div', { has: page.locator('text=QuickBooks Online') }).locator('button:has-text("Configure Integration")').first();
    // More robust: find the card containing the "QuickBooks Online" heading
    const card = page.locator('text=Connect your realm to sync').locator('xpath=ancestor::div[contains(@class,"rounded") or contains(@class,"card")][1]');
    let clicked = false;
    const buttons = page.locator('button:has-text("Configure Integration")');
    const n = await buttons.count();
    for (let i = 0; i < n; i++) {
      const b = buttons.nth(i);
      const cardText = await b.evaluate((el) => el.closest('div[class*="border"], div[class*="card"], div[class*="rounded"]')?.innerText || '');
      if (/QuickBooks Online/.test(cardText) && !/CSV/.test(cardText)) {
        await b.click();
        clicked = true;
        console.log('clicked QuickBooks Online configure card (index', i, ')');
        break;
      }
    }
    if (!clicked) console.log('WARN: did not find QBO card button; buttons:', n);
    await page.waitForTimeout(4000);
    for (const id of ['qbo-integration-settings', 'qbo-connect-button', 'qbo-onboarding-wizard']) {
      const el = page.locator('#' + id);
      const c = await el.count();
      console.log(id, 'count=', c, c ? 'visible=' + (await el.first().isVisible()) : '');
    }
    const btn = page.locator('#qbo-connect-button');
    if (await btn.count()) {
      await btn.first().scrollIntoViewIfNeeded();
      console.log('connect disabled =', await btn.first().isDisabled());
      console.log('connect text =', (await btn.first().innerText()).trim());
    }
    await shot(page, '03-qbo-settings-selected.png');
    await saveState(context);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
