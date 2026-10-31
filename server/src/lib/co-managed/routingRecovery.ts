import { defineJob, registerJobCapabilityFilter, type JobDescriptorTenantSelector } from '@alga-psa/jobs/fanout';
import { filterServed, forcedValue } from '@alga-psa/core/capability';
import { coManagedDeliverySeam } from '@shared/lib/coManagedDelivery';
import { deliverRouting } from '../notifications/coManagedRoutingDelivery';

/** A `sending` row older than this lost its worker between claim and finish. */
export const ROUTING_STALE_SENDING_MS = 15 * 60 * 1000;
export const ROUTING_RECOVERY_BATCH = 100;

/**
 * Recovery for routing deliveries (one handler, registered as a job descriptor).
 *
 *  - Tenants: those holding waiting rows, wrapped in `filterServed`. While `FORCE_CAPABILITIES=co-managed:off`
 *    (or the tenant is not served) the selector is empty, so the rows simply wait and drain exactly once
 *    when the switch is lifted.
 *  - Retries `pending`/`failed` rows only. A `sending` row's provider outcome is unknown: it is flagged
 *    `requires_reconciliation` and never re-sent.
 */
export async function recoverRoutingForTenant(tenantId: string) {
  const provider = await coManagedDeliverySeam.resolve(tenantId);
  if (!provider) return { sent: 0, skipped: 0, failed: 0, flagged: 0 };
  const flagged = await provider.flagStaleRoutingSending(tenantId, ROUTING_STALE_SENDING_MS);
  return { ...(await deliverRouting(provider, tenantId, { limit: ROUTING_RECOVERY_BATCH })), flagged };
}

export const CO_MANAGED_ROUTING_RECOVERY_JOB = 'co-managed-routing-recovery';

export const coManagedRoutingTenants: JobDescriptorTenantSelector = async (db) => {
  // Kill switch (forced off, or an unusable value, which also forces off): nothing is served, so
  // do not scan the delivery table across the estate just to filter every tenant out.
  const forced = forcedValue(process.env.FORCE_CAPABILITIES, 'co-managed');
  if (forced === 'off' || forced === 'malformed') return [];
  const waiting = await db.unscoped<{ tenant: string }>('co_management_deliveries', 'routing recovery enumerates tenants holding waiting rows')
    .whereIn('delivery_kind', ['routing_in_app', 'routing_email']).whereIn('state', ['pending', 'failed', 'sending']).distinct('tenant');
  return (await filterServed('co-managed', waiting.map((r) => String(r.tenant)))).map((tenant) => ({ tenant }));
};

let defined = false;
export function defineCoManagedRoutingRecoveryJob(): void {
  if (defined) return;
  defined = true;
  registerJobCapabilityFilter((capability, tenantIds) => filterServed(capability as Parameters<typeof filterServed>[0], tenantIds));
  defineJob({
    name: CO_MANAGED_ROUTING_RECOVERY_JOB,
    scope: 'tenant',
    capability: 'co-managed',
    schedule: { cron: '*/5 * * * *' },
    tenants: coManagedRoutingTenants,
    run: recoverRoutingForTenant,
  });
}
