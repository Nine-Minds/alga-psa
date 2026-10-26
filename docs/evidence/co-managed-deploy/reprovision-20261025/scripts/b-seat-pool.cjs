// Stage B: QA buys a co-managed seat pool through Co-managed IT > seat pool. The embedded Stripe.js
// checkout cannot complete against the local simulator, so payment completion uses the simulator's
// control action complete-session, which emits the signed checkout.session.completed webhook.
const { scenario, credential, sql, until, fixtures, saveFixtures } = require('./runtime.cjs');
const root = process.env.CM_ROOT, want = Number(process.env.CM_SEATS || 3);
const control = (p, body) => fetch('http://127.0.0.1:9175/control/' + p, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
(async () => {
  const r = await scenario(root, 'b-seat-pool', async ({ page, actor, go, check, shot, mark }) => {
    const { oz } = fixtures();
    const capacity = () => Number(sql(`select coalesce(max(capacity),0) from co_managed_entitlements where tenant='${oz}'`) || 0);
    await actor({ name: 'qa', email: 'qa@emeraldcity.oz', password: credential('continuation-test-login.json').password });
    await go('/msp/co-managed'); await page.locator('#co-managed-seat-quantity').waitFor({ timeout: 90000 }); await shot('b1-pool-before');
    if (capacity() < want) {
      await page.locator('#co-managed-seat-quantity').fill(String(want));
      await page.locator('#co-managed-review-purchase').click(); await shot('b2-review-purchase');
      await page.locator('#co-managed-confirm-purchase').click();
      const session = await until(async () => {
        const s = (await control('stripe/state/checkout-sessions')).result || [];
        return (Array.isArray(s) ? s : Object.values(s)).filter((x) => x.metadata?.tenant_id === oz && x.status === 'open').at(-1);
      }, 'open co-managed checkout session', 60000);
      await mark('checkout-session-created', { sessionId: session.id, quantity: session.line_items?.[0]?.quantity ?? want });
      const done = await control('stripe/actions/complete-session', { sessionId: session.id });
      await mark('simulator-complete-session', done.result || done);
      await until(() => capacity() === want, 'capacity reconciled to ' + want, 90000);
    }
    await go('/msp/co-managed'); await page.getByText(String(want)).first().waitFor(); await shot('b3-pool-after');
    saveFixtures({ seatPool: want, entitlement: JSON.parse(sql(`select row_to_json(e) from (select source, capacity, source_reference from co_managed_entitlements where tenant='${oz}') e`)) });
    await check('seat-pool-purchased', capacity() === want, { capacity: capacity() });
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
