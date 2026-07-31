const { launch, saveState, shot, BASE } = require('./common.cjs');
(async () => {
  const { browser, context, page } = await launch();
  try {
    await page.goto(BASE + '/msp/settings?tab=integrations&category=accounting', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    if (!(await page.locator('#qbo-integration-settings').count())) {
      const buttons = page.locator('button:has-text("Configure Integration")');
      const n = await buttons.count();
      for (let i = 0; i < n; i++) {
        const b = buttons.nth(i);
        const cardText = await b.evaluate((el) => el.closest('div[class*="border"], div[class*="card"], div[class*="rounded"]')?.innerText || '');
        if (/QuickBooks Online/.test(cardText) && !/CSV/.test(cardText)) { await b.click(); break; }
      }
      await page.waitForTimeout(4000);
    }
    const bodyText = await page.locator('body').innerText();
    console.log('has Reconciliation Wizard:', /Reconciliation Wizard/.test(bodyText));
    console.log('has Products & Services step label:', /Products & Services/.test(bodyText));
    console.log('has Customers step:', /Customers/.test(bodyText));
    console.log('has Go-live:', /Go-live/.test(bodyText));
    const wiz = page.locator('#qbo-onboarding-wizard');
    console.log('wizard id count:', await wiz.count());
    // scroll to wizard area
    const heading = page.locator('text=QuickBooks Reconciliation Wizard').first();
    if (await heading.count()) {
      await heading.scrollIntoViewIfNeeded();
      await page.waitForTimeout(1000);
    }
    await shot(page, '05-wizard-visible.png');
    await saveState(context);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
