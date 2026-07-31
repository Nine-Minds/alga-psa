const { launch, saveState, shot, BASE } = require('./common.cjs');
(async () => {
  const { browser, context, page } = await launch();
  try {
    await page.goto(BASE + '/msp/settings?tab=integrations&category=accounting', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    // The QBO integration stays selected? If connect button absent, reselect card.
    if (!(await page.locator('#qbo-connect-button').count())) {
      const buttons = page.locator('button:has-text("Configure Integration")');
      const n = await buttons.count();
      for (let i = 0; i < n; i++) {
        const b = buttons.nth(i);
        const cardText = await b.evaluate((el) => el.closest('div[class*="border"], div[class*="card"], div[class*="rounded"]')?.innerText || '');
        if (/QuickBooks Online/.test(cardText) && !/CSV/.test(cardText)) { await b.click(); break; }
      }
      await page.waitForTimeout(3000);
    }
    page.on('request', (r) => {
      const u = r.url();
      if (u.includes('4020') || u.includes('/api/integrations/qbo')) console.log('REQ', r.method(), u);
    });
    await page.locator('#qbo-connect-button').click();
    await page.waitForTimeout(8000);
    console.log('url after connect:', page.url());
    await shot(page, '04-after-oauth-connect.png');
    // Check for connected company + wizard
    for (const id of ['qbo-onboarding-wizard', 'qbo-disconnect-button']) {
      const el = page.locator('#' + id);
      const c = await el.count();
      console.log(id, 'count=', c);
    }
    const bodyText = await page.locator('body').innerText();
    const m = bodyText.match(/Realm ID: [^\n]*/);
    console.log('realm line:', m ? m[0] : '(none)');
    await saveState(context);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
