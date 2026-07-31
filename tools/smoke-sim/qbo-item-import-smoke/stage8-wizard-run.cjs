const { launch, saveState, shot, BASE } = require('./common.cjs');
(async () => {
  const { browser, context, page } = await launch();
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 300)));
  try {
    await page.goto(BASE + '/msp/settings?tab=integrations&category=accounting', { waitUntil: 'networkidle' });
    await page.waitForTimeout(4000);

    // Select the QuickBooks Online card (fresh selection each page load)
    const buttons = page.locator('button:has-text("Configure Integration")');
    const n = await buttons.count();
    for (let i = 0; i < n; i++) {
      const b = buttons.nth(i);
      const cardText = await b.evaluate((el) => el.closest('div[class*="border"], div[class*="card"], div[class*="rounded"]')?.innerText || '');
      if (/QuickBooks Online/.test(cardText) && !/CSV/.test(cardText)) {
        await b.click();
        console.log('selected QuickBooks Online card');
        break;
      }
    }
    await page.waitForSelector('#qbo-integration-settings', { timeout: 20000 });

    // Wizard entry CTA
    await page.waitForSelector('#qbo-wizard-entry-run, #qbo-wizard-entry-rerun', { timeout: 20000 });
    const runBtn = page.locator('#qbo-wizard-entry-run, #qbo-wizard-entry-rerun').first();
    await runBtn.scrollIntoViewIfNeeded();
    await shot(page, '10-wizard-entry-rerun.png');
    await runBtn.click();
    await page.waitForSelector('#qbo-onboarding-wizard', { timeout: 20000 });

    // Assert stepper labels
    const wizardText = await page.locator('#qbo-onboarding-wizard').innerText();
    for (const label of ['Customers', 'History', 'Products & Services', 'Go-live']) {
      console.log('step label', JSON.stringify(label), wizardText.includes(label) ? 'PRESENT' : 'MISSING');
    }
    await page.locator('#qbo-onboarding-wizard').scrollIntoViewIfNeeded();
    await shot(page, '11-wizard-four-steps-rerun.png');

    // Navigate: Customers -> History -> Products & Services
    await page.locator('#qbo-wizard-next').click();
    await page.waitForTimeout(1500);
    await page.locator('#qbo-wizard-next').click();
    await page.waitForSelector('#qbo-item-import-step', { timeout: 15000 });
    console.log('items step reached');
    await page.locator('#qbo-item-import-step').scrollIntoViewIfNeeded();
    await shot(page, '12-items-step-rerun.png');

    // Preview should be disabled until service type picked
    console.log('preview disabled before type =', await page.locator('#qbo-item-import-preview').isDisabled());

    // Pick a service type via CustomSelect
    await page.locator('#qbo-item-import-service-type').click();
    await page.waitForTimeout(800);
    const opts = page.locator('[role="option"]');
    const oc = await opts.count();
    const names = [];
    for (let i = 0; i < Math.min(oc, 10); i++) names.push((await opts.nth(i).innerText()).trim());
    console.log('service type options:', JSON.stringify(names));
    await page.locator('[role="option"]:not([aria-disabled="true"])', { hasText: 'Managed Services' }).first().click();
    await page.waitForTimeout(500);
    console.log('preview disabled after type =', await page.locator('#qbo-item-import-preview').isDisabled());

    // Preview
    await page.locator('#qbo-item-import-preview').click();
    await page.waitForSelector('#qbo-item-import-preview-panel, #qbo-item-import-preview-error', { timeout: 60000 });
    if (await page.locator('#qbo-item-import-preview-error').count()) {
      console.log('PREVIEW ERROR:', await page.locator('#qbo-item-import-preview-error').innerText());
      await shot(page, '13-preview-error-rerun.png');
      return;
    }
    const panelText = await page.locator('#qbo-item-import-preview-panel').innerText();
    console.log('--- preview panel ---');
    console.log(panelText.slice(0, 2500));
    await page.locator('#qbo-item-import-preview-panel').scrollIntoViewIfNeeded();
    await shot(page, '13-preview-panel-rerun.png');

    // Execute
    await page.locator('#qbo-item-import-execute').click();
    await page.waitForSelector('#qbo-item-import-result, #qbo-item-import-execute-error', { timeout: 120000 });
    if (await page.locator('#qbo-item-import-execute-error').count()) {
      console.log('EXECUTE ERROR:', await page.locator('#qbo-item-import-execute-error').innerText());
      await shot(page, '14-execute-error-rerun.png');
      return;
    }
    const resultText = await page.locator('#qbo-item-import-result').innerText();
    console.log('--- import result ---');
    console.log(resultText);
    await page.locator('#qbo-item-import-result').scrollIntoViewIfNeeded();
    await shot(page, '14-import-result-rerun.png');

    await saveState(context);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
