const { launch, saveState, shot, BASE } = require('./common.cjs');
(async () => {
  const { browser, context, page } = await launch();
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.type() + ': ' + msg.text().slice(0, 400));
  });
  page.on('pageerror', (err) => errors.push('pageerror: ' + String(err).slice(0, 600)));
  try {
    await page.goto(BASE + '/msp/settings?tab=integrations&category=accounting', { waitUntil: 'networkidle' });
    await page.waitForTimeout(10000);
    const hasSettings = await page.locator('#qbo-integration-settings').count();
    console.log('qbo-integration-settings count:', hasSettings);
    console.log('--- console/page errors ---');
    for (const e of errors.slice(0, 30)) console.log(e);
    await saveState(context);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
