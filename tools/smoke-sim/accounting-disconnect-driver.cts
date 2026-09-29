// Runs the real provider-disconnect service against the local app database,
// mirroring the UI's Disconnect / Retry Disconnect action (same code path the
// scheduled retry job uses). Lets a smoke tester drive pending -> retry ->
// finalized / force-finalize transitions without waiting for backoff, while the
// accounting-provider-simulator.cjs fakes the provider side.
//
// Usage (from the repo root, with server/.env.local loaded):
//   export $(grep -v '^#' server/.env.local | grep -E '^[A-Z_]+=' | xargs)
//   npx tsx tools/smoke-sim/accounting-disconnect-driver.cts <tenantId> <quickbooks_online|xero> [pass|force] [reason]
//
//   pass  -> run one revocation pass (new or resuming disconnect)
//   force -> operator force-finalize (requires no pending targets)

import { createTenantKnex } from '@alga-psa/db';
import {
  disconnectProvider,
  forceFinalizeProviderDisconnect,
} from '@alga-psa/integrations/lib/providerDisconnect';

const [, , tenantId, provider, mode, ...rest] = process.argv;

async function main() {
  if (!tenantId || !provider) {
    throw new Error('usage: accounting-disconnect-driver.cts <tenantId> <quickbooks_online|xero> [pass|force] [reason]');
  }
  const { knex } = await createTenantKnex(tenantId);
  if (mode === 'force') {
    const result = await forceFinalizeProviderDisconnect(knex, tenantId, provider, {
      userId: 'system',
      reason: rest.join(' ') || 'smoke driver force-finalize',
    });
    console.log(JSON.stringify(result));
    return;
  }
  const result = await disconnectProvider(knex, tenantId, provider, {
    userId: 'system',
    fromRetry: true,
  });
  console.log(JSON.stringify(result));
}

main().catch((error) => {
  console.error('disconnect driver failed:', error);
  process.exit(1);
});
