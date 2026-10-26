// Guide 02 — Licensing and seats (hosted review build, configured Stripe simulator).
// Pool purchase target = current capacity + 1 (adds headroom for guide 01). White Rabbit allocation +1 then restored.
const path = require('path');
const C = require('./common.cjs');
const { scenario, sql, until, OZ, WR, pool, allocations, purchases, qa, stripe, actionId, statValue, receipt, origin } = C;
const root = path.resolve(__dirname, '..');
const name = process.env.CM_NAME || 'licensing-recording';

(async () => {
  const r = await scenario(root, name, async ({ page, ctx, actor, go, mark, check, shot, inspect, chapter, dir }) => {
    const wrSeats = () => Number(sql(`select seats from co_managed_allocations where tenant='${OZ}' and customer_tenant='${WR.customer}' and state<>'released'`));
    const before = { pool: pool(), allocations: allocations(), purchases: purchases(),
      subscriptions: (await stripe('subscriptions')).filter((s) => s.metadata?.tenant_id === OZ).map((s) => ({ id: s.id, kind: s.metadata?.subscription_kind, quantity: s.items.data[0].quantity, unit: s.items.data[0].price.unit_amount, currency: s.items.data[0].price.currency })),
      events: (await stripe('events')).length };
    receipt(dir, 'db-before', before);
    await actor(qa());

    await chapter('1. Reconcile the pool with customer allocations');
    await go('/msp/co-managed'); await page.locator('#co-managed-seat-quantity').waitFor({ timeout: 90000 });
    const ui = async () => ({ capacity: await statValue(page, 'Purchased seats'), allocated: await statValue(page, 'Allocated to customers'), available: await statValue(page, 'Available seats') });
    let shown = await until(async () => { const v = await ui(); return v.capacity != null ? v : null; }, 'pool stats');
    await shot('02-1-overview-pool'); await page.reload(); await page.locator('#co-managed-seat-quantity').waitFor();
    shown = await ui();
    await check('pool-stats-match-entitlement-after-reload', shown.capacity === before.pool.capacity && shown.allocated === before.pool.allocated && shown.available === before.pool.capacity - before.pool.allocated, { shown, db: before.pool });
    await check('customer-allocations-fit-inside-verified-capacity', before.pool.allocated <= before.pool.capacity, before.pool);
    await go(`/msp/clients/${WR.clientId}?tab=co-managed`);
    const seatsOpen = page.locator('[id$="-seats-seats-open"]').first(); await seatsOpen.waitFor({ timeout: 90000 });
    await page.getByText('Capacity', { exact: true }).first().scrollIntoViewIfNeeded(); await shot('02-1-white-rabbit-capacity');
    await page.reload(); await seatsOpen.waitFor({ timeout: 90000 });
    await seatsOpen.click(); const input = page.locator('[id$="-seats-seats-input"]').first(); await input.waitFor();
    const poolHint = await until(async () => { const t = await page.getByRole('dialog').first().innerText(); return /Pool: \d+ purchased/.test(t) ? t : null; }, 'pool hint');
    const inputSeats = Number(await input.inputValue());
    await check('client-allocation-matches-db-and-pool-hint', inputSeats === wrSeats() && poolHint.includes(`Pool: ${before.pool.capacity} purchased, ${before.pool.allocated} allocated, ${before.pool.capacity - before.pool.allocated} available`), { inputSeats, dbSeats: wrSeats(), poolHint: poolHint.match(/Pool:[^\n]*/)[0] });
    await shot('02-1-white-rabbit-seat-dialog'); await page.locator('[id$="-seats-cancel"]').first().click();

    await chapter('2. Review a hosted pool purchase (configured simulator)');
    await go('/msp/co-managed'); const qty = page.locator('#co-managed-seat-quantity'); await qty.waitFor();
    const existing = Number(await qty.inputValue()), target = existing + 1;
    await mark('purchase-baseline', { existingQuantity: existing, proposedTotal: target });
    await qty.fill(String(target)); await page.locator('#co-managed-review-purchase').click();
    const dialog = page.getByRole('dialog').first(); await page.locator('#co-managed-confirm-purchase').waitFor();
    const reviewText = await dialog.innerText(); await shot('02-2-review-purchase');
    await check('review-shows-quantity-monthly-total-and-amount-due', reviewText.includes(`${target} seats`) && /per month/.test(reviewText) && /Estimated amount due now/.test(reviewText), { reviewText: reviewText.replace(/\s+/g, ' ').trim() });
    await check('capacity-unchanged-while-only-reviewed', pool().capacity === existing, { capacity: pool().capacity });
    const purchaseAction = actionId('purchaseCoManagedSeatsAction'); let request = null;
    page.on('request', (req) => { if (!request && purchaseAction.includes(req.headers()['next-action'])) request = req.postData(); });
    await page.locator('#co-managed-confirm-purchase').click();
    await until(() => pool().capacity === target, 'simulator purchase verified to target', 120000);
    await until(() => request, 'purchase request captured');
    const intent = JSON.parse(request)[0];
    await page.reload(); await qty.waitFor(); await until(async () => (await ui()).capacity === target, 'reloaded capacity');
    shown = await ui(); await shot('02-2-pool-after-purchase');
    const afterPurchase = { pool: pool(), purchases: purchases(), subscriptions: (await stripe('subscriptions')).filter((s) => s.metadata?.tenant_id === OZ).map((s) => ({ id: s.id, kind: s.metadata?.subscription_kind, quantity: s.items.data[0].quantity })), events: (await stripe('events')).slice(before.events).map((e) => ({ id: e.id, type: e.type })) };
    const op = afterPurchase.purchases.find((p) => p.operation_id === intent.operationId);
    await check('capacity-increases-after-verification-and-reconciles-on-reload', shown.capacity === target && afterPurchase.pool.capacity === target && shown.available === target - afterPurchase.pool.allocated, { shown, db: afterPurchase.pool });
    await check('provider-subscription-quantity-matches-pool', afterPurchase.subscriptions.find((s) => s.kind === 'co_managed')?.quantity === target, { subscriptions: afterPurchase.subscriptions, operation: op });
    await check('purchase-recorded-as-one-operation', Boolean(op) && afterPurchase.purchases.length === before.purchases.length + 1, { operation: op, count: afterPurchase.purchases.length });
    await check('no-pending-purchase-left-to-resume', await page.locator('#co-managed-resume-purchase').count() === 0);
    // Labelled negative probe (not a UI flow): resubmit the SAME operation id the UI sent, as a lost-response retry would.
    const replay = await ctx.request.post(origin + '/msp/co-managed', { headers: { 'Next-Action': purchaseAction[0], 'Content-Type': 'text/plain;charset=UTF-8', Origin: origin }, data: request });
    await page.waitForTimeout(3000);
    const afterReplay = { pool: pool(), purchases: purchases(), subscriptions: (await stripe('subscriptions')).filter((s) => s.metadata?.tenant_id === OZ && s.metadata?.subscription_kind === 'co_managed').map((s) => s.items.data[0].quantity), events: (await stripe('events')).length };
    await check('probe-same-operation-replay-creates-no-second-charge', replay.status() === 200 && afterReplay.pool.capacity === target && afterReplay.purchases.length === afterPurchase.purchases.length && JSON.stringify(afterReplay.subscriptions) === JSON.stringify([target]) && afterReplay.events === before.events + afterPurchase.events.length, { status: replay.status(), afterReplay });
    receipt(dir, 'purchase-receipt', { intent: { operationId: intent.operationId, quantity: intent.quantity }, existing, target, afterPurchase, afterReplay, provider: 'configured Stripe simulator (127.0.0.1:9175); not real Stripe' });

    await chapter('3. Change a customer allocation (White Rabbit, reversible +1)');
    const wrBefore = wrSeats(), poolBefore = pool();
    await go(`/msp/clients/${WR.clientId}?tab=co-managed`); await seatsOpen.waitFor({ timeout: 90000 }); await seatsOpen.click(); await input.waitFor();
    await input.fill(String(wrBefore + 1)); await shot('02-3-allocation-plus-one');
    await page.locator('[id$="-seats-seats-save"]').first().click();
    await until(() => wrSeats() === wrBefore + 1, 'allocation persisted +1');
    await page.reload(); await seatsOpen.waitFor({ timeout: 90000 }); await seatsOpen.click(); await input.waitFor();
    const reloadedHint = await until(async () => { const t = await page.getByRole('dialog').first().innerText(); return /Pool: \d+ purchased/.test(t) ? t.match(/Pool:[^\n]*/)[0] : null; }, 'pool hint after save');
    await check('allocation-changes-by-requested-amount-availability-by-opposite', Number(await input.inputValue()) === wrBefore + 1 && pool().allocated === poolBefore.allocated + 1 && pool().capacity === poolBefore.capacity && reloadedHint === `Pool: ${poolBefore.capacity} purchased, ${poolBefore.allocated + 1} allocated, ${poolBefore.capacity - poolBefore.allocated - 1} available`, { reloadedHint, seats: wrSeats() });
    await input.fill('0'); await shot('02-3-below-minimum');
    const minAttr = await input.getAttribute('min');
    await check('reduction-below-usage-minimum-cannot-be-saved', await page.locator('[id$="-seats-seats-save"]').first().isDisabled() && wrSeats() === wrBefore + 1, { min: minAttr });
    // Shortfall: ask for one more than available → review proposes an absolute new pool total; do not confirm.
    // Section-3 runs after the section-2 purchase, so the purchase target is current capacity.
    const avail = poolBefore.capacity - poolBefore.allocated - 1, over = wrBefore + 1 + avail + 1;
    await input.fill(String(over)); await page.locator('[id$="-seats-seats-save"]').first().click();
    const shortfall = page.getByText(/new total \d+/).first(); await shortfall.waitFor();
    const shortText = (await shortfall.innerText()).replace(/\s+/g, ' ').trim(); await shot('02-3-shortfall-review');
    await check('shortfall-reviews-new-pool-total-without-charging', shortText.includes(`new total ${poolBefore.capacity + 1}`) && pool().capacity === poolBefore.capacity && wrSeats() === wrBefore + 1, { shortText });
    await page.keyboard.press('Escape'); await page.waitForTimeout(800);
    if (await page.locator('[id$="-seats-cancel"]').first().isVisible()) await page.locator('[id$="-seats-cancel"]').first().click();
    await page.reload(); await seatsOpen.waitFor({ timeout: 90000 }); await seatsOpen.click(); await input.waitFor();
    await input.fill(String(wrBefore)); await page.locator('[id$="-seats-seats-save"]').first().click();
    await until(() => wrSeats() === wrBefore, 'White Rabbit allocation restored');
    await page.reload(); await seatsOpen.waitFor({ timeout: 90000 });
    await check('white-rabbit-allocation-restored-and-pool-unchanged', wrSeats() === wrBefore && pool().capacity === target && pool().allocated === poolBefore.allocated, { seats: wrSeats(), pool: pool() });
    await shot('02-3-allocation-restored');

    await chapter('4. Self-hosted branch (License Management link only)');
    await go('/msp/co-managed'); await page.locator('#co-managed-review-purchase').waitFor();
    await check('hosted-deployment-offers-purchase-not-manage-license', await page.locator('#co-managed-manage-license').count() === 0 && await page.locator('#co-managed-review-purchase').count() === 1);
    await go('/msp/licenses'); await page.waitForTimeout(3000);
    const lic = await inspect('02-4-license-management'); await shot('02-4-license-management');
    await mark('license-management-direct-visit', { url: lic.url, excerpt: lic.text.replace(/\s+/g, ' ').slice(0, 600) });
    await chapter('Retained state: return the pool to its pre-recording quantity');
    const original = before.pool.capacity;
    await go('/msp/co-managed'); await qty.waitFor(); await qty.fill(String(original)); await page.locator('#co-managed-review-purchase').click();
    await page.locator('#co-managed-confirm-purchase').waitFor(); await shot('02-r-review-reduction');
    await page.locator('#co-managed-confirm-purchase').click(); await until(() => pool().capacity === original, 'pool returned to ' + original, 120000);
    await page.reload(); await qty.waitFor(); await until(async () => (await ui()).capacity === original, 'reloaded original');
    await check('pool-returned-to-pre-recording-quantity-with-receipts-retained', pool().capacity === original && purchases().length === before.purchases.length + 2 && (await stripe('subscriptions')).find((s) => s.id === before.pool.source_reference)?.items.data[0].quantity === original, { pool: pool(), purchases: purchases() });
    await shot('02-r-pool-restored');
    receipt(dir, 'db-after', { pool: pool(), allocations: allocations(), purchases: purchases() });
    return { status: 'partial',
      limitations: [
        'Hosted purchase used the configured Stripe simulator (existing co-managed subscription quantity update, no hosted checkout page). It is not real Stripe and certifies no live SKU or price.',
        'Allocation change exercised on the active White Rabbit relationship (+1 then restored) because the guide-01 disposable client did not exist yet in the dependency order.',
        'Shortfall purchase was reviewed but not confirmed; capacity was not purchased through the client shortfall path.',
        'Self-hosted signed licence install, lapse and renewal not exercised: hosted review deployment, no operator-supplied signed test licence.',
        'Same-operation replay is a labelled direct server-action probe, not a UI flow.'],
      missingResources: ['Real Stripe test account with the co-managed seat price (release-owner acceptance)', 'Operator-supplied signed self-host test licence and an isolated self-hosted installation with a lapse/renewal lifecycle fixture'] };
  });
  if (r.scenarioStatus === 'failed') process.exitCode = 1;
})();
