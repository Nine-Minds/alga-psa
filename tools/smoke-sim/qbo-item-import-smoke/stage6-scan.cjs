const { launch, saveState, shot, BASE } = require('./common.cjs');
(async () => {
  const { browser, context, page } = await launch();
  try {
    await page.goto(BASE + '/msp/settings?tab=integrations&category=accounting', { waitUntil: 'networkidle' });
    await page.waitForTimeout(8000);
    // scroll progressively to bottom to force lazy renders
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, 1200);
      await page.waitForTimeout(400);
    }
    await page.waitForTimeout(3000);
    const ids = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[id]'))
        .map((e) => e.id)
        .filter((id) => /qbo|wizard|onboarding/i.test(id))
    );
    console.log('qbo-ish ids:', JSON.stringify(ids, null, 1));
    const bodyText = await page.locator('body').innerText();
    console.log('has Reconciliation Wizard:', /Reconciliation Wizard/.test(bodyText));
    console.log('has Connected company:', /Connected company/.test(bodyText));
    console.log('has realm-sim:', /realm-sim/.test(bodyText));
    await shot(page, '06-full-scroll.png');
    await saveState(context);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
