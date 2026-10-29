/**
 * Registers the `co-managed` capability resolvers with the release gate.
 *
 * Registration is a side effect of importing this module; the server entry and the Temporal
 * worker boot both import it. It is Next-free and registers nothing that opens a connection
 * at import time. A missing registration fails closed (`admits`/`serves` are false).
 *
 *   admits(tenant)  = release flag AND a durable entitlement row (the flag lives in the gate;
 *                     eligibility here is flag-independent).
 *   serves(tenant)  = participation: a relationship row (as customer or sponsor), an
 *                     entitlement row, or `tenants.product_code = 'co_managed'`.
 *
 * The same import registers the relationship-backed lifecycle provider and the
 * operational-write admission provider (see @alga-psa/licensing).
 */
import type { Knex } from 'knex';
import {
  registerCapabilityEligibility,
  registerCapabilityParticipation,
  type EligibilityResolver,
  type ParticipationResolver,
} from '@alga-psa/core/capability';
import { getAdminConnection, registerWriteAdmissionProvider, tenantDb } from '@alga-psa/db';
import {
  CO_MANAGED_OPERATIONAL_WRITE,
  coManagedLifecycleProvider,
  registerCoManagedLifecycleProvider,
} from '@alga-psa/licensing/lifecycle';
import { CoManagedLifecycleError } from '@alga-psa/licensing/lifecycle-error';
import { CO_MANAGED_CAPABILITY } from './permissionsCapability';

const READ_REASON = 'co-managed capability resolver: pre-tenant-context participation read, filtered by tenant ids';

/** Eligibility: has this tenant a durable (flag-independent) co-managed entitlement? */
export async function hasCoManagedEntitlement(tenantId: string, db?: Knex): Promise<boolean> {
  const conn = db ?? await getAdminConnection();
  const row = await tenantDb(conn, tenantId).table('co_managed_entitlements').first('tenant');
  return Boolean(row);
}

/** Participation for a batch of tenants in at most four statements, never one per tenant.
 * Throws on any database error so the gate fails closed (`participation-error`). */
export async function coManagedParticipants(tenantIds: readonly string[], db?: Knex): Promise<Set<string>> {
  const ids = [...new Set(tenantIds.filter(Boolean))];
  if (ids.length === 0) return new Set();
  const conn = db ?? await getAdminConnection();
  const discovery = tenantDb(conn, '__co_managed_capability__');
  const [asCustomer, asSponsor, entitled, products] = await Promise.all([
    discovery.unscoped('co_management_relationships', READ_REASON).whereIn('tenant', ids).distinct('tenant'),
    discovery.unscoped('co_management_relationships', READ_REASON).whereIn('sponsor_tenant', ids).distinct('sponsor_tenant'),
    discovery.unscoped('co_managed_entitlements', READ_REASON).whereIn('tenant', ids).select('tenant'),
    discovery.unscoped('tenants', READ_REASON).whereIn('tenant', ids).where('product_code', 'co_managed').select('tenant'),
  ]);
  return new Set<string>([
    ...asCustomer.map((row: { tenant: string }) => row.tenant),
    ...asSponsor.map((row: { sponsor_tenant: string }) => row.sponsor_tenant),
    ...entitled.map((row: { tenant: string }) => row.tenant),
    ...products.map((row: { tenant: string }) => row.tenant),
  ]);
}

const eligibility: EligibilityResolver = ({ tenantId }) => hasCoManagedEntitlement(tenantId);
const participation: ParticipationResolver = ({ tenantIds }) => coManagedParticipants(tenantIds);

/** Idempotent; exported for tests and for hosts that must register after a registry reset. */
export function registerCoManagedCapability(): void {
  registerCapabilityEligibility(CO_MANAGED_CAPABILITY, eligibility);
  registerCapabilityParticipation(CO_MANAGED_CAPABILITY, participation);
  registerCoManagedLifecycleProvider(coManagedLifecycleProvider);
  // Only the operational-write operation is governed here; other native write sites adopt
  // admission explicitly, so a plain PSA tenant pays no extra statement on its write path.
  registerWriteAdmissionProvider(async (trx, context) => {
    if (context.operation !== CO_MANAGED_OPERATIONAL_WRITE) return;
    const state = await coManagedLifecycleProvider.readState(trx, context.tenant);
    if (!state.canWrite) throw new CoManagedLifecycleError(state);
  });
}

registerCoManagedCapability();
