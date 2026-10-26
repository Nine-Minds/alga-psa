// Recovery after a failed attempt: re-add the baseline Service Desk board (Collaborate) through the customer's Co-managed access screen.
const { scenario } = require('../../scripts/runtime.cjs');
const L = require('./lib.cjs');
(async () => {
  await scenario(require('path').resolve(__dirname, '..'), 'attempts/restore-service-desk-' + Date.now(), async ({ page, actor, go, mark, check, shot }) => {
    const h = L.helpers(page, { mark, check, shot });
    await actor(L.alice); await go('/msp/co-management'); await page.locator('#co-policy-visibility').waitFor();
    await h.addEntry('board', '76cc335e-e600-4e0c-b964-bad0628c6958', 'Service Desk', 'Service Desk', 'Collaborate'); await h.savePolicy();
    const r = L.policyReceipt();
    await check('service-desk-restored', r.relationship.visibility_mode === 'board_scope' && r.boards.some((b) => b.board_name === 'Service Desk' && b.can_collaborate), r);
  });
})();
