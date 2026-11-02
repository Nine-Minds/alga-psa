#!/usr/bin/env node
// Prepare/reset the dedicated PR 4089 Stripe emulator scenario. Never targets tenant DB state.
const control = (process.env.STRIPE_EMULATOR_CONTROL_URL || '').replace(/\/$/, '');
if (!control) throw new Error('Set STRIPE_EMULATOR_CONTROL_URL to the dedicated emulator control origin.');

async function call(path, body) {
  const response = await fetch(`${control}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok || result.ok === false) throw new Error(`${path} failed: ${JSON.stringify(result)}`);
  return result.result;
}

const operation = process.argv[2] || 'seed';
if (operation === 'reset') {
  await call('/control/stripe/reset', {});
  console.log('Dedicated Stripe emulator reset to repository defaults.');
} else if (operation === 'mismatch') {
  await call('/control/stripe/seed/config', { accountId: 'acct_review_other' });
  console.log('Emulator account changed to acct_review_other. Run the normal seed command to restore acct_review_4089.');
} else if (operation === 'seed') {
  await call('/control/stripe/seed/config', { secretKey: 'sk_test_algasim', accountId: 'acct_review_4089' });
  await call('/control/stripe/seed/customer', { email: 'legacy-4089@example.invalid', name: 'Legacy review customer', id: 'cus_review4089legacy' });
  await call('/control/stripe/seed/payment-method', { id: 'pm_review4089legacy', customer: 'cus_review4089legacy', isDefault: true, offSession: true, last4: '4242', brand: 'visa' });
  await call('/control/stripe/seed/customer', {
    email: 'conflict-4089@example.invalid', name: 'Ownership conflict customer', id: 'cus_review4089conflict',
    metadata: { tenant_id: 'tenant_other_4089', stripe_account_id: 'acct_review_4089' },
  });
  await call('/control/stripe/seed/payment-method', {
    id: 'pm_review4089conflict', customer: 'cus_review4089conflict', isDefault: true, offSession: true, last4: '0005', brand: 'visa',
  });
  console.log('PR 4089 emulator fixtures ready: one legacy customer with a default off-session card and one customer owned by another tenant.');
} else {
  throw new Error('Usage: node packages/emulators/stripe/scripts/prepare-tenant-binding-review.mjs [seed|mismatch|reset]');
}
