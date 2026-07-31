const { launch, saveState, shot, BASE } = require('./common.cjs');
(async () => {
  const { browser, context, page } = await launch();
  try {
    await page.goto(BASE + '/msp/settings?tab=integrations&category=accounting', { waitUntil: 'networkidle' });
    await page.waitForTimeout(5000);
    console.log('url:', page.url());
    for (const id of ['qbo-integration-settings', 'qbo-connect-button', 'qbo-onboarding-wizard', 'qbo-integration-connection-card']) {
      const el = page.locator('#' + id);
      const n = await el.count();
      console.log(id, 'count=', n, n ? 'visible=' + (await el.first().isVisible()) : '');
    }
    const btn = page.locator('#qbo-connect-button');
    if (await btn.count()) {
      console.log('connect disabled =', await btn.first().isDisabled());
      console.log('connect text =', (await btn.first().innerText()).trim());
    }
    await shot(page, '02-qbo-settings-before-connect.png');
    await saveState(context);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
