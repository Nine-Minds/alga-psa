'use server';

import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTenantKnex, tenantDb } from '@alga-psa/db';

import { withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

/**
 * Compat layer for the legacy per-(line, service) bucket overlay.
 *
 * Under the weighted-burn model a bucket is a line-owned POOL
 * (`contract_line_buckets` + `contract_line_bucket_services`). The old UI
 * surface (flag off) still speaks in single-service overlays, so these actions
 * reimplement the legacy shapes as "the single-member 1x member-scoped pool
 * for this (line, service)":
 *   - getBucketOverlay returns the pool's totals when exactly one member row
 *     carries this service (or the pool is a single-member catch-all);
 *   - upsertBucketOverlay ensures such a pool exists and updates its totals;
 *   - deleteBucketOverlay removes the member (and the pool when it is left
 *     empty — the old "remove overlay" semantics).
 *
 * Refusal path: upserting an overlay for a service that is already a member of
 * a MULTI-member pool would silently split the pool if we merely created a new
 * single-member pool, so it errors instead (only reachable flag-on→flag-off).
 */

// Bucket overlay input type - matches the structure used in wizard
export type BucketOverlayInput = {
  total_minutes?: number;
  overage_rate?: number;
  allow_rollover?: boolean;
  billing_period?: 'weekly' | 'monthly';
};

type BucketOverlayConfigRow = {
  total_minutes: number;
  overage_rate: number;
  allow_rollover: boolean | null;
  billing_period: 'weekly' | 'monthly';
};

export type BucketOverlayActionError = ActionMessageError | ActionPermissionError;

function bucketOverlayActionErrorFrom(error: unknown): BucketOverlayActionError | null {
  if (error instanceof Error) {
    if (error.message.startsWith('Permission denied') || error.message === 'user is not logged in') {
      return permissionError(error.message);
    }
    if (error.message.startsWith('Cannot edit bucket overlay')) {
      return actionError(error.message);
    }
  }

  const dbError = error as { code?: string; column?: string };
  if (dbError?.code === '22P02') {
    return actionError('One of the selected bucket overlay values is invalid. Please refresh and try again.', 'msp/billing:errors.bucketOverlay.invalidValue');
  }
  if (dbError?.code === '23502') {
    return dbError.column
      ? actionError(
          `Missing required bucket overlay field: ${dbError.column}.`,
          'msp/billing:errors.bucketOverlay.missingFieldNamed',
          { field: dbError.column },
        )
      : actionError('Missing required bucket overlay field.', 'msp/billing:errors.bucketOverlay.missingField');
  }
  if (dbError?.code === '23503') {
    return actionError('One of the selected bucket overlay records is no longer valid. Please refresh and try again.', 'msp/billing:errors.bucketOverlay.recordInvalid');
  }
  if (dbError?.code === '23505') {
    return actionError('A bucket overlay for this service already exists.', 'msp/billing:errors.bucketOverlay.duplicate');
  }
  if (dbError?.code === '23514') {
    return actionError('One of the bucket overlay values is not allowed. Please review the form and try again.', 'msp/billing:errors.bucketOverlay.notAllowed');
  }

  return null;
}

async function withBucketOverlayActionErrors<T>(work: () => Promise<T>): Promise<T | BucketOverlayActionError> {
  try {
    return await work();
  } catch (error) {
    const expected = bucketOverlayActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
}

interface ResolvedOverlayPool {
  bucketId: string;
  memberCount: number;
  pool: BucketOverlayConfigRow;
}

/**
 * Resolve the single-member pool that serves a legacy (line, service) overlay:
 * a member-scoped pool whose ONLY member is this service, or a catch-all pool
 * with exactly one member (the multiplier-override case). Returns null when the
 * service draws from no pool.
 */
async function resolveSingleMemberOverlayPool(
  trx: Knex.Transaction,
  tenant: string,
  contractLineId: string,
  serviceId: string,
): Promise<ResolvedOverlayPool | null> {
  const db = tenantDb(trx, tenant);

  const member = await db.table('contract_line_bucket_services')
    .where({ tenant, contract_line_id: contractLineId, service_id: serviceId })
    .first<{ bucket_id: string }>('bucket_id');

  if (member?.bucket_id) {
    const memberCountRow = await db.table('contract_line_bucket_services')
      .where({ tenant, bucket_id: member.bucket_id })
      .count<{ count: string }>('* as count')
      .first();
    const memberCount = Number(memberCountRow?.count ?? 0);
    const pool = await db.table('contract_line_buckets')
      .where({ tenant, bucket_id: member.bucket_id })
      .select('total_minutes', 'overage_rate', 'allow_rollover', 'billing_period')
      .first<BucketOverlayConfigRow | undefined>();
    if (!pool) {
      return null;
    }
    return { bucketId: member.bucket_id, memberCount, pool };
  }

  // Line catch-all pool with exactly one member: that member is the service.
  const catchAll = await db.table('contract_line_buckets')
    .where({ tenant, contract_line_id: contractLineId, covers_all_services: true })
    .select('bucket_id', 'total_minutes', 'overage_rate', 'allow_rollover', 'billing_period')
    .first<BucketOverlayConfigRow & { bucket_id: string } | undefined>();

  if (!catchAll) {
    return null;
  }

  const members = await db.table('contract_line_bucket_services')
    .where({ tenant, bucket_id: catchAll.bucket_id })
    .select('service_id');
  if (members.length === 1 && members[0].service_id === serviceId) {
    return {
      bucketId: catchAll.bucket_id,
      memberCount: 1,
      pool: {
        total_minutes: catchAll.total_minutes,
        overage_rate: catchAll.overage_rate,
        allow_rollover: catchAll.allow_rollover,
        billing_period: catchAll.billing_period,
      },
    };
  }

  return null;
}

/**
 * Upsert a bucket overlay configuration for a service on a contract line.
 * Reimplemented as "the single-member 1x member-scoped pool for this
 * (line, service)": creates the pool when none exists, updates its totals
 * when it does. Refuses when the service is already a member of a
 * multi-member pool (would split the pool).
 *
 * @param contractLineId - The contract line ID
 * @param serviceId - The service ID
 * @param overlay - The bucket overlay configuration
 * @param quantity - Optional quantity for the service
 * @param customRate - Optional custom rate for the service
 */
export const upsertBucketOverlay = withAuth(async (
  user,
  { tenant },
  contractLineId: string,
  serviceId: string,
  overlay: BucketOverlayInput,
  quantity?: number | null,
  customRate?: number | null
): Promise<void | BucketOverlayActionError> => {
  return withBucketOverlayActionErrors(async () => {
  const { knex } = await createTenantKnex();

  await withTransaction(knex, async (trx) => {
    if (!await hasPermission(user, 'billing', 'update')) {
      throw new Error('Permission denied: Cannot update bucket overlays');
    }

    await upsertBucketOverlayInTransaction(
      trx,
      tenant,
      contractLineId,
      serviceId,
      overlay,
      quantity,
      customRate
    );
  });
  });
});

/**
 * Internal function to upsert bucket overlay within a transaction.
 * Can be called from other transaction-aware code.
 *
 * @returns the pool's bucket_id that now serves this (line, service) overlay —
 *          the pool identity is the successor of the legacy per-service
 *          bucket config_id.
 */
export async function upsertBucketOverlayInTransaction(
  trx: Knex.Transaction,
  tenant: string,
  contractLineId: string,
  serviceId: string,
  overlay: BucketOverlayInput,
  quantity?: number | null,
  customRate?: number | null
): Promise<string> {
  if (overlay.total_minutes == null || overlay.overage_rate == null) {
    throw new Error('Cannot upsert bucket overlay without total_minutes and overage_rate.');
  }

  const normalizedTotal = Math.max(0, Math.round(overlay.total_minutes));
  const normalizedOverage = Math.max(0, Math.round(overlay.overage_rate));
  const billingPeriod = overlay.billing_period ?? 'monthly';

  const db = tenantDb(trx, tenant);

  // Refusal path: if this service already belongs to a multi-member pool,
  // writing an overlay here would silently split the pool.
  const member = await db.table('contract_line_bucket_services')
    .where({ tenant, contract_line_id: contractLineId, service_id: serviceId })
    .first<{ bucket_id: string }>('bucket_id');

  if (member?.bucket_id) {
    const memberCountRow = await db.table('contract_line_bucket_services')
      .where({ tenant, bucket_id: member.bucket_id })
      .count<{ count: string }>('* as count')
      .first();
    const memberCount = Number(memberCountRow?.count ?? 0);
    if (memberCount > 1) {
      throw new Error('Cannot edit bucket overlay: this service is part of a shared bucket pool with other services. Edit the pool instead.');
    }

    // Single-member pool: update its totals.
    await db.table('contract_line_buckets')
      .where({ tenant, bucket_id: member.bucket_id })
      .update({
        total_minutes: normalizedTotal,
        overage_rate: normalizedOverage,
        allow_rollover: overlay.allow_rollover ?? false,
        billing_period: billingPeriod,
        updated_at: trx.fn.now(),
      });
    return member.bucket_id;
  }

  // No pool yet: create a member-scoped single-member 1x pool.
  const bucketId = uuidv4();
  await db.table('contract_line_buckets').insert({
    tenant,
    bucket_id: bucketId,
    contract_line_id: contractLineId,
    bucket_name: null,
    total_minutes: normalizedTotal,
    overage_rate: normalizedOverage,
    allow_rollover: overlay.allow_rollover ?? false,
    billing_period: billingPeriod,
    after_hours_multiplier: null,
    business_hours_schedule_id: null,
    covers_all_services: false,
  });
  await db.table('contract_line_bucket_services').insert({
    tenant,
    bucket_id: bucketId,
    service_id: serviceId,
    contract_line_id: contractLineId,
    burn_multiplier: 1,
  });

  // Keep the legacy service record in sync so hourly/usage configs on the
  // (line, service) pair keep their quantity/custom_rate.
  await db.table('contract_line_services')
    .insert({
      tenant,
      contract_line_id: contractLineId,
      service_id: serviceId,
      quantity: quantity ?? null,
      custom_rate: customRate ?? null,
    })
    .onConflict(['tenant', 'contract_line_id', 'service_id'])
    .merge({
      quantity: quantity ?? null,
      custom_rate: customRate ?? null,
    });

  return bucketId;
}

/**
 * Delete a bucket overlay configuration for a service on a contract line.
 * Removes the service from its pool; a pool left with no members is deleted
 * (the old "remove overlay" semantics).
 *
 * @param contractLineId - The contract line ID
 * @param serviceId - The service ID
 */
export const deleteBucketOverlay = withAuth(async (
  user,
  { tenant },
  contractLineId: string,
  serviceId: string
): Promise<void | BucketOverlayActionError> => {
  return withBucketOverlayActionErrors(async () => {
  const { knex } = await createTenantKnex();

  await withTransaction(knex, async (trx) => {
    if (!await hasPermission(user, 'billing', 'delete')) {
      throw new Error('Permission denied: Cannot delete bucket overlays');
    }

    await deleteBucketOverlayInTransaction(trx, tenant, contractLineId, serviceId);
  });
  });
});

/**
 * Internal function to delete bucket overlay within a transaction.
 */
export async function deleteBucketOverlayInTransaction(
  trx: Knex.Transaction,
  tenant: string,
  contractLineId: string,
  serviceId: string
): Promise<void> {
  const db = tenantDb(trx, tenant);

  const member = await db.table('contract_line_bucket_services')
    .where({ tenant, contract_line_id: contractLineId, service_id: serviceId })
    .first<{ bucket_id: string }>('bucket_id');

  if (!member?.bucket_id) {
    return; // No pool membership to remove
  }

  // Remove this member.
  await db.table('contract_line_bucket_services')
    .where({ tenant, bucket_id: member.bucket_id, service_id: serviceId })
    .delete();

  // If the pool has no members left, delete it too — unless it has usage
  // history, in which case the bucket_usage RESTRICT FK would abort (a legacy
  // flag-off regression: deleting an overlay always succeeded). Keep the pool
  // row dormant instead; its history stays intact.
  const memberCountRow = await db.table('contract_line_bucket_services')
    .where({ tenant, bucket_id: member.bucket_id })
    .count<{ count: string }>('* as count')
    .first();
  const memberCount = Number(memberCountRow?.count ?? 0);
  if (memberCount === 0) {
    const usageCountRow = await db.table('bucket_usage')
      .where({ tenant, bucket_id: member.bucket_id })
      .count<{ count: string }>('* as count')
      .first();
    if (Number(usageCountRow?.count ?? 0) === 0) {
      await db.table('contract_line_buckets')
        .where({ tenant, bucket_id: member.bucket_id })
        .delete();
    }
  }
}

/**
 * Get bucket overlay configuration for a service on a contract line.
 * Returns null if no bucket overlay exists.
 *
 * @param contractLineId - The contract line ID
 * @param serviceId - The service ID
 * @returns The bucket overlay configuration or null
 */
export const getBucketOverlay = withAuth(async (
  user,
  { tenant },
  contractLineId: string,
  serviceId: string
): Promise<BucketOverlayInput | null | BucketOverlayActionError> => {
  return withBucketOverlayActionErrors(async () => {
  const { knex } = await createTenantKnex();

  return await withTransaction(knex, async (trx) => {
    if (!await hasPermission(user, 'billing', 'read')) {
      throw new Error('Permission denied: Cannot read bucket overlays');
    }

    const resolved = await resolveSingleMemberOverlayPool(trx, tenant, contractLineId, serviceId);
    if (!resolved) {
      return null;
    }

    const { pool } = resolved;
    return {
      total_minutes: pool.total_minutes,
      overage_rate: pool.overage_rate,
      allow_rollover: pool.allow_rollover ?? false,
      billing_period: pool.billing_period as 'weekly' | 'monthly',
    };
  });
  });
});
