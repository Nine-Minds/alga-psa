/**
 * Registers the `co-managed-seat` capability resolvers with the release gate.
 *
 * The seat shape is a second capability on the rollout flag `co-managed` uses, with its own
 * resolvers and its own `FORCE_CAPABILITIES` key: closing one never moves the other. Nothing
 * reads the raw flag; every seat surface resolves this capability.
 *
 * Registration is a side effect of importing this module, which `./capability` does, so the
 * server entry and the Temporal worker register it with `co-managed`. It is Next-free and opens
 * no connection at import time. A missing registration fails closed.
 *
 *   admits(tenant)  = release flag AND a PSA sponsor with operational pool entitlement or eligible hosted trial (the flag
 *                     lives in the gate; eligibility here is flag-independent).
 *   serves(tenant)  = participation: any seat arrangement row, live or ended, so ending an
 *                     arrangement or flipping the flag never strands its history.
 */
import type { Knex } from 'knex';
import {
  registerCapabilityEligibility,
  registerCapabilityParticipation,
  type CapabilityKey,
  type EligibilityResolver,
  type ParticipationResolver,
} from '@alga-psa/core/capability';
import { getAdminConnection, tenantDb } from '@alga-psa/db';
import { whereEntitlementOperational } from '@alga-psa/licensing/entitlement-operational';

export const CO_MANAGED_SEAT_CAPABILITY: CapabilityKey = 'co-managed-seat';

const READ_REASON = 'co-managed-seat capability resolver: pre-tenant-context participation read, filtered by tenant ids';

/** Paid sponsors qualify through the pool. Hosted Pro sponsors can also qualify for the trial before purchase. */
export async function isCoManagedSeatEligible(tenantId: string, db?: Knex): Promise<boolean> {
  const conn = db ?? await getAdminConnection();
  const scoped = tenantDb(conn, tenantId);
  const [entitlement, owner] = await Promise.all([
    whereEntitlementOperational(scoped.table('co_managed_entitlements')).first('tenant'),
    scoped.table('tenants').first('product_code'),
  ]);
  if (owner?.product_code !== 'psa') return false;
  if (entitlement) return true;
  const { isCoManagedPurchaseSurfaceOpen } = await import('@alga-psa/licensing');
  return await isCoManagedPurchaseSurfaceOpen(tenantId) &&
    Boolean(await scoped.table('co_managed_trial_sponsors').where('base_until', '>', conn.fn.now()).first('tenant'));
}

/** Participation for a batch of tenants in one statement, never one per tenant.
 * Throws on any database error so the gate fails closed (`participation-error`). */
export async function coManagedSeatParticipants(tenantIds: readonly string[], db?: Knex): Promise<Set<string>> {
  const ids = [...new Set(tenantIds.filter(Boolean))];
  if (ids.length === 0) return new Set();
  const conn = db ?? await getAdminConnection();
  const rows = await tenantDb(conn, '__co_managed_seat_capability__')
    .unscoped('co_managed_seat_arrangements', READ_REASON).whereIn('tenant', ids).distinct('tenant');
  return new Set<string>(rows.map((row: { tenant: string }) => row.tenant));
}

const eligibility: EligibilityResolver = ({ tenantId }) => isCoManagedSeatEligible(tenantId);
const participation: ParticipationResolver = ({ tenantIds }) => coManagedSeatParticipants(tenantIds);

/** Idempotent; exported for tests and for hosts that must register after a registry reset. */
export function registerCoManagedSeatCapability(): void {
  registerCapabilityEligibility(CO_MANAGED_SEAT_CAPABILITY, eligibility);
  registerCapabilityParticipation(CO_MANAGED_SEAT_CAPABILITY, participation);
}

registerCoManagedSeatCapability();
