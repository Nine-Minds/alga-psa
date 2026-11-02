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
} else if (operation === 'seed') {
  await call('/control/stripe/seed/config', { secretKey: 'sk_test_algasim', accountId: 'acct_review_4089' });
  for (const [email, name, id] of [
    ['legacy-4089@example.invalid', 'Legacy review customer', 'cus_review_4089_legacy'],
    ['conflict-4089@example.invalid', 'Ownership conflict customer', 'cus_review_4089_conflict'],
  ]) await call('/control/stripe/seed/customer', { email, name, id });
  console.log('PR 4089 account and customer fixtures are ready on the dedicated Stripe emulator.');
} else {
  throw new Error('Usage: node packages/emulators/stripe/scripts/prepare-tenant-binding-review.mjs [seed|reset]');
}
