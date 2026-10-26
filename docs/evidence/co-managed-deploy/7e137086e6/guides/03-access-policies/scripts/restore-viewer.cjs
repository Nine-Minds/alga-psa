// Recovery after failed attempt a2: remove the review viewer's staff assignment through the MSP client view.
const { scenario } = require('../../scripts/runtime.cjs');
const L = require('./lib.cjs');
(async () => {
  await scenario(require('path').resolve(__dirname, '..'), 'attempts/restore-viewer-' + Date.now(), async ({ page, actor, go, mark, check, shot }) => {
    const h = L.helpers(page, { mark, check, shot });
    const viewerId = L.sql(`select user_id from users where tenant='${L.ids.msp}' and email='cm-review-20261026-03-viewer@emeraldcity.oz'`);
    await actor(L.qa); await go('/msp/clients/' + L.ids.client + '?tab=co-managed'); await page.locator(`#co-policy-user-remove-${viewerId}`).click(); await h.savePolicy();
    await check('viewer-assignment-removed', !L.policyReceipt().staff.some((s) => s.principal_id === viewerId), L.policyReceipt().staff);
  });
})();
