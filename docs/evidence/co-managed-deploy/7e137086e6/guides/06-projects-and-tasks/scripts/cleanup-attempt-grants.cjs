// Removes the customer project grants left by failed guide-06 attempts (real customer UI).
const L = require('./lib.cjs'), path = require('path');
const ids = (process.env.CM_PROJECTS || '').split(',').filter(Boolean);
(async () => { await L.scenario(path.join(path.dirname(__dirname), 'attempts'), 'cleanup-attempt-grants', async ({ page, actor, go, check, shot }) => {
  await actor(L.alice()); await go('/msp/co-management');
  for (const id of ids) { const rm = page.locator('#co-policy-project-remove-' + id); await rm.waitFor(); await rm.click(); }
  await shot('before-save'); await page.locator('#co-policy-save').click(); await page.getByText('Access settings saved.', { exact: true }).waitFor();
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('#co-policy-project-title').waitFor(); await page.waitForTimeout(1500);
  for (const id of ids) await check('grant-removed-' + id, await page.locator('#co-policy-project-access-' + id).count() === 0);
  await shot('after-reload'); return { status: 'cleanup' }; }); })();
