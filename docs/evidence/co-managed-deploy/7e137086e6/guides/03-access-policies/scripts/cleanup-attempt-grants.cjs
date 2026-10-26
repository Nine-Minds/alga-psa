// Cleanup after failed attempts a3/a4: Alice revokes the individual ticket grants those attempts created, via Individual ticket access.
const { scenario } = require('../../scripts/runtime.cjs');
const L = require('./lib.cjs');
(async () => {
  await scenario(require('path').resolve(__dirname, '..'), 'attempts/cleanup-attempt-grants-' + Date.now(), async ({ page, actor, go, check, shot }) => {
    const ids = L.sql(`select w.ticket_id from co_management_ticket_work w join tickets t using(tenant,ticket_id) where t.title in ('CM-REVIEW-20261026-03 escalated board ticket','CM-REVIEW-20261026-03 r4 escalated board ticket') and w.grant_revoked_at is null`).split('\n').filter(Boolean);
    await actor(L.alice);
    for (const t of ids) {
      await go('/msp/co-management/ticket-access'); await page.locator(`#co-grant-revoke-${t}`).click();
      await page.locator('#co-handoff-note').fill('CM-REVIEW-20261026-03 cleanup: revoke grant left by a failed recording attempt'); await page.locator('#co-handoff-submit').click();
      await L.until(() => L.sql(`select grant_revoked_at is not null from co_management_ticket_work where ticket_id='${t}'`) === 't', 'revoked', 60000);
    }
    await go('/msp/co-management/ticket-access'); await shot('after-cleanup');
    await check('attempt-grants-revoked', ids.every((t) => L.sql(`select grant_revoked_at is not null from co_management_ticket_work where ticket_id='${t}'`) === 't'), { ids });
  });
})();
