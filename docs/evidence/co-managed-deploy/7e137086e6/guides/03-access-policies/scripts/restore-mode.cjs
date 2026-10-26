// Recovery after a failed attempt: restore board oversight through the customer's Co-managed access screen.
const { scenario } = require('../../scripts/runtime.cjs');
const L = require('./lib.cjs');
(async () => {
  await scenario(require('path').resolve(__dirname, '..'), 'attempts/restore-mode-' + Date.now(), async ({ page, actor, go, mark, check, shot }) => {
    const h = L.helpers(page, { mark, check, shot });
    await actor(L.alice); await go('/msp/co-management'); await page.locator('#co-policy-visibility').waitFor();
    await h.choose('#co-policy-visibility', 'Oversight of the initial service desk board'); await h.savePolicy();
    await check('mode-restored', L.policyReceipt().relationship.visibility_mode === 'board_scope', L.policyReceipt());
  });
})();
