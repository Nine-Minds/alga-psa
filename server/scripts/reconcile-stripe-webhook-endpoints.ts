#!/usr/bin/env tsx
/**
 * One-time migration: point every enabled tenant's Stripe webhook endpoint at
 * /api/webhooks/stripe/payments/<tenantId> (and bring enabled_events up to date).
 * Never creates endpoints or rotates signing secrets; idempotent.
 *
 * Run inside a server pod so it uses that pod's secret-provider configuration:
 *   npx tsx scripts/reconcile-stripe-webhook-endpoints.ts [--tenant <id>]
 *
 * Output is counts and tenant ids only.
 */
import { reconcileAllStripeWebhookEndpoints } from '../../ee/server/src/lib/payments/stripeWebhookEvents';

async function main() {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--tenant');
  if (i >= 0 && (!argv[i + 1] || argv[i + 1].startsWith('--'))) throw new Error('--tenant requires a tenant id');
  const result = await reconcileAllStripeWebhookEndpoints(i >= 0 ? { tenants: [argv[i + 1]] } : {});
  console.log(JSON.stringify(result));
  process.exit(result.failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
