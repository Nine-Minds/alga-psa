// Recovery after a failed attempt: Alice removes the disposable board from scope; QA removes the review viewer's assignment.
const { scenario } = require('../../scripts/runtime.cjs');
const L = require('./lib.cjs');
(async () => {
  await scenario(require('path').resolve(__dirname, '..'), 'attempts/restore-after-attempt-' + Date.now(), async ({ page, actor, go, mark, check, shot }) => {
    const h = L.helpers(page, { mark, check, shot });
    const boardId = L.sql(`select board_id from boards where tenant='${L.ids.customer}' and board_name='CM-REVIEW-20261026-03 Access board'`);
    const viewerId = L.sql(`select user_id from users where tenant='${L.ids.msp}' and email='cm-review-20261026-03-viewer@emeraldcity.oz'`);
    if (L.policyReceipt().boards.some((b) => b.board_id === boardId)) { await actor(L.alice); await go('/msp/co-management'); await page.locator(`#co-policy-board-remove-${boardId}`).click(); await h.savePolicy(); }
    if (L.policyReceipt().staff.some((s) => s.principal_id === viewerId)) { await actor(L.qa); await go('/msp/clients/' + L.ids.client + '?tab=co-managed'); await page.locator(`#co-policy-user-remove-${viewerId}`).click(); await h.savePolicy(); }
    const r = L.policyReceipt();
    await check('attempt-state-removed', !r.boards.some((b) => b.board_id === boardId) && !r.staff.some((s) => s.principal_id === viewerId), r);
  });
})();
