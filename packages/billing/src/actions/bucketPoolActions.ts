'use server';

import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth/withAuth';
import { hasPermission } from '@alga-psa/auth/rbac';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

/**
 * Flag-on pool editor actions for the weighted-burn bucket model.
 *
 * A bucket is a line-owned pool (`contract_line_buckets` + member rows in
 * `contract_line_bucket_services`). These actions provide CRUD for pools,
 * scope selection (member-scoped vs catch-all), member attach/remove with a
 * per-service burn multiplier, and the optional after-hours rule.
 *
 * Invariants enforced here (and by the schema):
 *   - a service belongs to at most one pool per line
 *     (UNIQUE (tenant, contract_line_id, service_id));
 *   - at most one catch-all pool per line (partial unique index);
 *   - member-scoped pools require ≥1 member at creation;
 *   - an after-hours rule requires an explicit schedule (preselected tenant
 *     default when one exists).
 */

export type BucketPoolInput = {
  bucket_id?: string;
  bucket_name?: string | null;
  total_minutes: number;
  overage_rate: number;
  allow_rollover: boolean;
  billing_period?: string;
  covers_all_services?: boolean;
  after_hours_multiplier?: number | null;
  business_hours_schedule_id?: string | null;
};

export type BucketPoolMemberInput = {
  service_id: string;
  burn_multiplier: number;
};

export type BucketPoolActionError = ActionMessageError | ActionPermissionError;

export type BucketBusinessHoursScheduleSummary = {
  schedule_id: string;
  schedule_name: string;
  is_default: boolean;
};

export type BucketPoolSnapshot = {
  bucket_id: string;
  contract_line_id: string;
  bucket_name: string | null;
  total_minutes: number;
  overage_rate: number;
  allow_rollover: boolean;
  billing_period: string;
  covers_all_services: boolean;
  after_hours_multiplier: number | null;
  business_hours_schedule_id: string | null;
  members: Array<{
    service_id: string;
    service_name: string;
    burn_multiplier: number;
  }>;
  dormant: boolean;
};

function bucketPoolActionErrorFrom(error: unknown): BucketPoolActionError | null {
  if (error instanceof Error) {
    if (error.message.startsWith('Permission denied') || error.message === 'user is not logged in') {
      return permissionError(error.message);
    }
    if (error.message.startsWith('Cannot')) {
      return actionError(error.message);
    }
  }

  const dbError = error as { code?: string; column?: string };
  if (dbError?.code === '23505') {
    return actionError('A bucket pool or member already exists with this configuration. Please refresh and try again.');
  }
  if (dbError?.code === '23503') {
    return actionError('One of the selected bucket pool records is no longer valid. Please refresh and try again.');
  }
  if (dbError?.code === '23514') {
    return actionError('One of the bucket pool values is not allowed. Please review the form and try again.');
  }
  return null;
}

async function withBucketPoolActionErrors<T>(work: () => Promise<T>): Promise<T | BucketPoolActionError> {
  try {
    return await work();
  } catch (error) {
    const expected = bucketPoolActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
}

async function loadPoolSnapshot(
  trx: Knex.Transaction,
  tenant: string,
  contractLineId: string,
): Promise<BucketPoolSnapshot[]> {
  const db = tenantDb(trx, tenant);

  const pools = await db.table('contract_line_buckets')
    .where({ tenant, contract_line_id: contractLineId })
    .orderBy('created_at', 'asc');

  const snapshots: BucketPoolSnapshot[] = [];
  for (const pool of pools) {
    // The predicates MUST be qualified: `service_catalog as sc` also carries a
    // `tenant` column, so an unqualified `where({ tenant, ... })` is an
    // ambiguous column reference in Postgres and the pool list 500s.
    const members = await db.table('contract_line_bucket_services as clbs')
      .where({ 'clbs.tenant': tenant, 'clbs.bucket_id': pool.bucket_id })
      .select('clbs.service_id', 'clbs.burn_multiplier', 'sc.service_name')
      .leftJoin('service_catalog as sc', function (this: any) {
        this.on('sc.service_id', '=', 'clbs.service_id')
          .andOn('sc.tenant', '=', 'clbs.tenant');
      });

    snapshots.push({
      bucket_id: pool.bucket_id,
      contract_line_id: pool.contract_line_id,
      bucket_name: pool.bucket_name ?? null,
      total_minutes: Number(pool.total_minutes ?? 0),
      overage_rate: Number(pool.overage_rate ?? 0),
      allow_rollover: Boolean(pool.allow_rollover),
      billing_period: pool.billing_period ?? 'monthly',
      covers_all_services: Boolean(pool.covers_all_services),
      after_hours_multiplier: pool.after_hours_multiplier == null ? null : Number(pool.after_hours_multiplier),
      business_hours_schedule_id: pool.business_hours_schedule_id ?? null,
      members: members.map((member) => ({
        service_id: member.service_id,
        service_name: member.service_name ?? member.service_id,
        burn_multiplier: Number(member.burn_multiplier ?? 1),
      })),
      dormant: !pool.covers_all_services && members.length === 0,
    });
  }
  return snapshots;
}

/**
 * List the bucket pools (with members) for a contract line.
 */
export const listBucketPoolsForLine = withAuth(async (
  user,
  { tenant },
  contractLineId: string
): Promise<BucketPoolSnapshot[] | BucketPoolActionError> => {
  return withBucketPoolActionErrors(async () => {
    const { knex } = await createTenantKnex();
    return withTransaction(knex, async (trx) => {
      if (!await hasPermission(user, 'billing', 'read')) {
        throw new Error('Permission denied: Cannot read bucket pools');
      }
      return loadPoolSnapshot(trx, tenant, contractLineId);
    });
  });
});

/**
 * List the schedule choices used by the billing-owned bucket editors.
 *
 * This query intentionally lives in billing instead of importing the SLA
 * feature package into billing UI code. The schedule table is shared tenant
 * data; the bucket editor only needs this small read-only projection.
 */
export const listBucketBusinessHoursSchedules = withAuth(async (
  user,
  { tenant },
): Promise<BucketBusinessHoursScheduleSummary[]> => {
  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx) => {
    if (!await hasPermission(user, 'billing', 'read')) {
      throw new Error('Permission denied: Cannot read bucket pool schedules');
    }

    const schedules = await tenantDb(trx, tenant).table('business_hours_schedules')
      .select('schedule_id', 'schedule_name', 'is_default')
      .orderBy('schedule_name', 'asc');

    return schedules.map((schedule) => ({
      schedule_id: schedule.schedule_id,
      schedule_name: schedule.schedule_name,
      is_default: Boolean(schedule.is_default),
    }));
  });
});

/**
 * Create a bucket pool inside an existing transaction (used by the wizard's
 * submission path and other transaction-aware writers).
 *
 * @returns the created pool's bucket_id
 */
export async function createBucketPoolInTransaction(
  trx: Knex.Transaction,
  tenant: string,
  contractLineId: string,
  pool: BucketPoolInput,
  members: BucketPoolMemberInput[],
): Promise<string> {
  const coversAllServices = pool.covers_all_services ?? false;
  if (!coversAllServices && members.length === 0) {
    throw new Error('Cannot create a member-scoped bucket pool without at least one service.');
  }

  const bucketId = pool.bucket_id ?? uuidv4();
  await insertBucketPool(trx, tenant, contractLineId, bucketId, pool, coversAllServices);

  for (const member of members) {
    await insertBucketPoolMember(trx, tenant, contractLineId, bucketId, member);
  }

  return bucketId;
}

/**
 * Create a bucket pool on a line. Member-scoped pools require at least one
 * member; catch-all pools are limited to one per line.
 */
export const createBucketPool = withAuth(async (
  user,
  { tenant },
  contractLineId: string,
  pool: BucketPoolInput,
  members: BucketPoolMemberInput[]
): Promise<BucketPoolSnapshot | BucketPoolActionError> => {
  return withBucketPoolActionErrors(async () => {
    const { knex } = await createTenantKnex();
    return withTransaction(knex, async (trx) => {
      if (!await hasPermission(user, 'billing', 'update')) {
        throw new Error('Permission denied: Cannot create bucket pools');
      }

      const bucketId = await createBucketPoolInTransaction(trx, tenant, contractLineId, pool, members);
      const snapshots = await loadPoolSnapshot(trx, tenant, contractLineId);
      return snapshots.find((s) => s.bucket_id === bucketId)!;
    });
  });
});

async function insertBucketPool(
  trx: Knex.Transaction,
  tenant: string,
  contractLineId: string,
  bucketId: string,
  pool: BucketPoolInput,
  coversAllServices: boolean,
): Promise<void> {
  const db = tenantDb(trx, tenant);

  // At most one catch-all per line is enforced by the schema; surface a clear
  // message here too.
  if (coversAllServices) {
    const existingCatchAll = await db.table('contract_line_buckets')
      .where({ tenant, contract_line_id: contractLineId, covers_all_services: true })
      .first('bucket_id');
    if (existingCatchAll && existingCatchAll.bucket_id !== bucketId) {
      throw new Error('Cannot create a second catch-all bucket pool for this line.');
    }
  }

  await db.table('contract_line_buckets').insert({
    tenant,
    bucket_id: bucketId,
    contract_line_id: contractLineId,
    bucket_name: pool.bucket_name ?? null,
    total_minutes: Math.max(0, Math.round(pool.total_minutes)),
    overage_rate: Math.max(0, Math.round(pool.overage_rate)),
    allow_rollover: pool.allow_rollover,
    billing_period: pool.billing_period ?? 'monthly',
    after_hours_multiplier: pool.after_hours_multiplier ?? null,
    business_hours_schedule_id: pool.business_hours_schedule_id ?? null,
    covers_all_services: coversAllServices,
  });
}

async function insertBucketPoolMember(
  trx: Knex.Transaction,
  tenant: string,
  contractLineId: string,
  bucketId: string,
  member: BucketPoolMemberInput,
): Promise<void> {
  const db = tenantDb(trx, tenant);

  // One bucket per (line, service) is enforced by the schema; surface a clear
  // message here too.
  const existingMember = await db.table('contract_line_bucket_services')
    .where({ tenant, contract_line_id: contractLineId, service_id: member.service_id })
    .first('bucket_id');
  if (existingMember && existingMember.bucket_id !== bucketId) {
    throw new Error(`Cannot attach service to this pool: it already belongs to another pool on this line.`);
  }

  await db.table('contract_line_bucket_services')
    .insert({
      tenant,
      bucket_id: bucketId,
      service_id: member.service_id,
      contract_line_id: contractLineId,
      burn_multiplier: member.burn_multiplier > 0 ? member.burn_multiplier : 1,
    })
    .onConflict(['tenant', 'bucket_id', 'service_id'])
    .merge({ burn_multiplier: member.burn_multiplier > 0 ? member.burn_multiplier : 1 });
}

/**
 * Update a pool's fields (totals, name, scope, rollover, after-hours rule).
 */
export const updateBucketPool = withAuth(async (
  user,
  { tenant },
  bucketId: string,
  pool: BucketPoolInput
): Promise<BucketPoolSnapshot | BucketPoolActionError> => {
  return withBucketPoolActionErrors(async () => {
    const { knex } = await createTenantKnex();
    return withTransaction(knex, async (trx) => {
      if (!await hasPermission(user, 'billing', 'update')) {
        throw new Error('Permission denied: Cannot update bucket pools');
      }
      const db = tenantDb(trx, tenant);

      const existing = await db.table('contract_line_buckets')
        .where({ tenant, bucket_id: bucketId })
        .first<{ contract_line_id: string }>('contract_line_id');
      if (!existing) {
        throw new Error('Cannot update bucket pool: pool not found.');
      }

      const coversAllServices = pool.covers_all_services ?? false;
      if (coversAllServices && existing.contract_line_id) {
        const otherCatchAll = await db.table('contract_line_buckets')
          .where({ tenant, contract_line_id: existing.contract_line_id, covers_all_services: true })
          .whereNot({ bucket_id: bucketId })
          .first('bucket_id');
        if (otherCatchAll) {
          throw new Error('Cannot set this pool to cover all services: the line already has a catch-all pool.');
        }
      }

      await db.table('contract_line_buckets')
        .where({ tenant, bucket_id: bucketId })
        .update({
          bucket_name: pool.bucket_name ?? null,
          total_minutes: Math.max(0, Math.round(pool.total_minutes)),
          overage_rate: Math.max(0, Math.round(pool.overage_rate)),
          allow_rollover: pool.allow_rollover,
          billing_period: pool.billing_period ?? 'monthly',
          after_hours_multiplier: pool.after_hours_multiplier ?? null,
          business_hours_schedule_id: pool.business_hours_schedule_id ?? null,
          covers_all_services: coversAllServices,
          updated_at: trx.fn.now(),
        });

      const snapshots = await loadPoolSnapshot(trx, tenant, existing.contract_line_id);
      return snapshots.find((s) => s.bucket_id === bucketId)!;
    });
  });
});

/**
 * Add a member service to a pool (with its burn multiplier).
 */
export const addBucketPoolMember = withAuth(async (
  user,
  { tenant },
  bucketId: string,
  member: BucketPoolMemberInput
): Promise<BucketPoolSnapshot | BucketPoolActionError> => {
  return withBucketPoolActionErrors(async () => {
    const { knex } = await createTenantKnex();
    return withTransaction(knex, async (trx) => {
      if (!await hasPermission(user, 'billing', 'update')) {
        throw new Error('Permission denied: Cannot update bucket pools');
      }
      const db = tenantDb(trx, tenant);
      const pool = await db.table('contract_line_buckets')
        .where({ tenant, bucket_id: bucketId })
        .first<{ contract_line_id: string }>('contract_line_id');
      if (!pool) {
        throw new Error('Cannot add member: pool not found.');
      }
      await insertBucketPoolMember(trx, tenant, pool.contract_line_id, bucketId, member);
      const snapshots = await loadPoolSnapshot(trx, tenant, pool.contract_line_id);
      return snapshots.find((s) => s.bucket_id === bucketId)!;
    });
  });
});

/**
 * Remove a member service from a pool. Removing the last member leaves the
 * pool in place (dormant) — the pool and its history are never cascade-deleted.
 */
export const removeBucketPoolMember = withAuth(async (
  user,
  { tenant },
  bucketId: string,
  serviceId: string
): Promise<BucketPoolSnapshot | BucketPoolActionError> => {
  return withBucketPoolActionErrors(async () => {
    const { knex } = await createTenantKnex();
    return withTransaction(knex, async (trx) => {
      if (!await hasPermission(user, 'billing', 'update')) {
        throw new Error('Permission denied: Cannot update bucket pools');
      }
      const db = tenantDb(trx, tenant);
      const pool = await db.table('contract_line_buckets')
        .where({ tenant, bucket_id: bucketId })
        .first<{ contract_line_id: string }>('contract_line_id');
      if (!pool) {
        throw new Error('Cannot remove member: pool not found.');
      }

      await db.table('contract_line_bucket_services')
        .where({ tenant, bucket_id: bucketId, service_id: serviceId })
        .delete();

      const snapshots = await loadPoolSnapshot(trx, tenant, pool.contract_line_id);
      return snapshots.find((s) => s.bucket_id === bucketId)!;
    });
  });
});

/**
 * Delete a pool. Buckets with usage history cannot be deleted (the FK is
 * RESTRICT) — surface that as a clear error rather than losing history.
 */
export const deleteBucketPool = withAuth(async (
  user,
  { tenant },
  bucketId: string
): Promise<void | BucketPoolActionError> => {
  return withBucketPoolActionErrors(async () => {
    const { knex } = await createTenantKnex();
    return withTransaction(knex, async (trx) => {
      if (!await hasPermission(user, 'billing', 'delete')) {
        throw new Error('Permission denied: Cannot delete bucket pools');
      }
      const db = tenantDb(trx, tenant);
      const usageCount = await db.table('bucket_usage')
        .where({ tenant, bucket_id: bucketId })
        .count<{ count: string }>('* as count')
        .first();
      if (Number(usageCount?.count ?? 0) > 0) {
        throw new Error('Cannot delete bucket pool: it has usage history. Remove its members to make it dormant instead.');
      }

      await db.table('contract_line_bucket_services').where({ tenant, bucket_id: bucketId }).delete();
      await db.table('contract_line_buckets').where({ tenant, bucket_id: bucketId }).delete();
    });
  });
});

/**
 * Set the after-hours rule on a pool. The rule requires an explicit schedule;
 * pass null to clear the rule.
 */
export const setBucketPoolAfterHoursRule = withAuth(async (
  user,
  { tenant },
  bucketId: string,
  multiplier: number | null,
  businessHoursScheduleId: string | null
): Promise<BucketPoolSnapshot | BucketPoolActionError> => {
  return withBucketPoolActionErrors(async () => {
    const { knex } = await createTenantKnex();
    return withTransaction(knex, async (trx) => {
      if (!await hasPermission(user, 'billing', 'update')) {
        throw new Error('Permission denied: Cannot update bucket pools');
      }
      const db = tenantDb(trx, tenant);
      const pool = await db.table('contract_line_buckets')
        .where({ tenant, bucket_id: bucketId })
        .first<{ contract_line_id: string }>('contract_line_id');
      if (!pool) {
        throw new Error('Cannot set after-hours rule: pool not found.');
      }

      if (multiplier != null && multiplier > 0 && !businessHoursScheduleId) {
        throw new Error('Cannot enable an after-hours rule without a business hours schedule.');
      }

      await db.table('contract_line_buckets')
        .where({ tenant, bucket_id: bucketId })
        .update({
          after_hours_multiplier: multiplier != null && multiplier > 0 ? multiplier : null,
          business_hours_schedule_id: multiplier != null && multiplier > 0 ? businessHoursScheduleId : null,
          updated_at: trx.fn.now(),
        });

      const snapshots = await loadPoolSnapshot(trx, tenant, pool.contract_line_id);
      return snapshots.find((s) => s.bucket_id === bucketId)!;
    });
  });
});
