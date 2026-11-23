#!/usr/bin/env node
/**
 * Worker-side check of the co-managed offer gate for one tenant.
 *
 * Uses the Temporal worker's own registration (`workerRegistration.ts`, the module worker.ts imports in
 * main()), never the web server's surfaceProbe, so it answers: "does the worker see the same
 * `admits('co-managed-seat')` as the web server, with the catalog only in the DB?" It reads the database
 * named by DB_* and (for the Stripe price/offer check) STRIPE_SECRET_KEY / the secret provider, plus
 * STRIPE_API_BASE_URL when a local emulator stands in for Stripe. It writes nothing.
 *
 *   npm run check:billing-catalog-loader -- --tenant <uuid>
 *
 * Run it with STRIPE_CO_MANAGED_USER_PRICE_ID and STRIPE_ACCOUNT_ID unset to prove the DB catalog alone
 * decides. Without PostHog the release flag needs tenant targeting
 * (FEATURE_FLAG_TENANTS__RELEASE_V2_0_FEATURE=<tenant>), otherwise the decision reads `flag-unavailable`.
 * Exit code: 0 when admitted, 1 when closed, 2 on a usage or runtime error.
 *
 * Example against a local review database and Stripe emulator:
 *   env -u STRIPE_CO_MANAGED_USER_PRICE_ID -u STRIPE_ACCOUNT_ID DB_HOST=127.0.0.1 DB_PORT=5826 \
 *     DB_NAME_SERVER=server DB_USER_ADMIN=postgres DB_PASSWORD_ADMIN=... \
 *     FEATURE_FLAG_TENANTS__RELEASE_V2_0_FEATURE=<tenant> STRIPE_SECRET_KEY=sk_test_... \
 *     STRIPE_API_BASE_URL=http://localhost:4826 \
 *     npm run check:billing-catalog-loader -- --tenant <tenant>
 */
import * as dotenv from 'dotenv';
import { destroyAdminConnection } from '@alga-psa/db/admin.js';

dotenv.config();

const USAGE = `Usage: npm run check:billing-catalog-loader -- --tenant <uuid>

Prints the worker loader's BillingCatalogContext and the admits('co-managed-seat') decision for the tenant.
`;

function tenantArg(argv: string[]): string | undefined {
  const at = argv.indexOf('--tenant');
  return at >= 0 ? argv[at + 1] : undefined;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const tenant = tenantArg(argv);
  if (argv.includes('-h') || argv.includes('--help') || !tenant) {
    process.stdout.write(USAGE);
    return tenant ? 0 : 2;
  }

  // Same registration the worker performs, then the same capability resolvers the worker's activities load.
  const { loadWorkerBillingCatalogContext } = await import('@ee/lib/stripe/offerCatalog/workerRegistration');
  await import('@alga-psa/co-managed/seatCapability');
  const { admits } = await import('@alga-psa/core/capability');
  const { isCoManagedPurchaseSurfaceOpen } = await import('@alga-psa/licensing');

  const env = {
    STRIPE_CO_MANAGED_USER_PRICE_ID: process.env.STRIPE_CO_MANAGED_USER_PRICE_ID ? 'set' : 'unset',
    STRIPE_ACCOUNT_ID: process.env.STRIPE_ACCOUNT_ID ? 'set' : 'unset',
  };
  const context = await loadWorkerBillingCatalogContext();
  const surfaceOpen = await isCoManagedPurchaseSurfaceOpen(tenant);
  const decision = await admits('co-managed-seat', tenant);
  process.stdout.write(`${JSON.stringify({ tenant, env, loader: context, surfaceOpen,
    admits: { admitted: decision.admitted, reasons: decision.reasons } }, null, 2)}\n`);
  return decision.admitted ? 0 : 1;
}

main()
  .then(async (code) => { await destroyAdminConnection().catch(() => undefined); process.exit(code); })
  .catch(async (error) => {
    process.stderr.write(`check-billing-catalog-loader failed: ${error instanceof Error ? error.message : String(error)}\n`);
    await destroyAdminConnection().catch(() => undefined);
    process.exit(2);
  });
