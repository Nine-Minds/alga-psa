import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type {
  DisconnectRecordStatus,
  DisconnectTargetEntry,
  DisconnectTargetStatus,
  ProviderDisconnectRecord,
  ProviderType,
} from './types';

const TABLE = 'provider_disconnect_records';

interface DisconnectRecordRow {
  tenant: string;
  provider: ProviderType;
  status: DisconnectRecordStatus;
  targets: DisconnectTargetEntry[] | string | null;
  attempt_count: number;
  next_retry_at: string | null;
  last_error_class: string | null;
  correlation_id: string | null;
  started_at: string;
  finalized_at: string | null;
  finalize_reason: string | null;
  updated_at: string;
}

function parseTargets(raw: DisconnectTargetEntry[] | string | null): DisconnectTargetEntry[] {
  if (!raw) return [];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as DisconnectTargetEntry[]) : [];
    } catch {
      return [];
    }
  }
  return raw;
}

function mapRow(row: DisconnectRecordRow): ProviderDisconnectRecord {
  return {
    tenant: row.tenant,
    provider: row.provider,
    status: row.status,
    targets: parseTargets(row.targets),
    attemptCount: row.attempt_count,
    nextRetryAt: row.next_retry_at,
    lastErrorClass: row.last_error_class,
    correlationId: row.correlation_id,
    startedAt: row.started_at,
    finalizedAt: row.finalized_at,
    finalizeReason: row.finalize_reason,
    updatedAt: row.updated_at,
  };
}

export function recordRowToModel(row: DisconnectRecordRow): ProviderDisconnectRecord {
  return mapRow(row);
}

export async function getDisconnectRecord(
  knex: Knex,
  tenantId: string,
  provider: ProviderType,
): Promise<ProviderDisconnectRecord | null> {
  const row = await tenantDb(knex, tenantId)
    .table<DisconnectRecordRow>(TABLE)
    .where({ tenant: tenantId, provider })
    .first();
  return row ? mapRow(row) : null;
}

export interface CreateDisconnectRecordInput {
  tenantId: string;
  provider: ProviderType;
  targets: Array<{ targetId: string }>;
  correlationId?: string | null;
}

export async function createDisconnectRecord(
  knex: Knex,
  input: CreateDisconnectRecordInput,
): Promise<ProviderDisconnectRecord> {
  const now = new Date().toISOString();
  const targets: DisconnectTargetEntry[] = input.targets.map((target) => ({
    targetId: target.targetId,
    status: 'pending_revocation',
    updatedAt: now,
  }));

  await tenantDb(knex, input.tenantId)
    .table(TABLE)
    .insert({
      tenant: input.tenantId,
      provider: input.provider,
      status: 'pending_revocation',
      targets: JSON.stringify(targets),
      attempt_count: 0,
      next_retry_at: null,
      last_error_class: null,
      correlation_id: input.correlationId ?? null,
      updated_at: now,
    })
    .onConflict(['tenant', 'provider'])
    .merge(['targets', 'status', 'correlation_id', 'updated_at']);

  const created = await getDisconnectRecord(knex, input.tenantId, input.provider);
  if (!created) {
    throw new Error(`Failed to persist disconnect record for ${input.tenantId}/${input.provider}`);
  }
  return created;
}

/**
 * Replace the target list wholesale — used when a disconnect resumes with a
 * freshly tombstoned credential set whose target ids are authoritative.
 */
export async function replaceDisconnectTargets(
  knex: Knex,
  tenantId: string,
  provider: ProviderType,
  targets: DisconnectTargetEntry[],
): Promise<void> {
  await tenantDb(knex, tenantId)
    .table(TABLE)
    .where({ tenant: tenantId, provider })
    .update({
      targets: JSON.stringify(targets),
      updated_at: knex.fn.now(),
    });
}

export interface TargetOutcomeUpdate {
  status: DisconnectTargetStatus;
  errorClass?: string | null;
}

export async function updateTargetOutcome(
  knex: Knex,
  tenantId: string,
  provider: ProviderType,
  targetId: string,
  outcome: TargetOutcomeUpdate,
): Promise<ProviderDisconnectRecord | null> {
  const record = await getDisconnectRecord(knex, tenantId, provider);
  if (!record) return null;

  const now = new Date().toISOString();
  const targets = record.targets.map((target) =>
    target.targetId === targetId
      ? {
          ...target,
          status: outcome.status,
          errorClass: outcome.errorClass ?? target.errorClass,
          updatedAt: now,
        }
      : target,
  );

  await tenantDb(knex, tenantId)
    .table(TABLE)
    .where({ tenant: tenantId, provider })
    .update({
      targets: JSON.stringify(targets),
      updated_at: knex.fn.now(),
    });

  return getDisconnectRecord(knex, tenantId, provider);
}

export async function setRecordStatus(
  knex: Knex,
  tenantId: string,
  provider: ProviderType,
  status: DisconnectRecordStatus,
  patch: {
    attemptCount?: number;
    nextRetryAt?: string | null;
    lastErrorClass?: string | null;
    finalizedAt?: string | null;
    finalizeReason?: string | null;
  } = {},
): Promise<ProviderDisconnectRecord | null> {
  const update: Record<string, unknown> = {
    status,
    updated_at: knex.fn.now(),
  };
  if (patch.attemptCount !== undefined) update.attempt_count = patch.attemptCount;
  if (patch.nextRetryAt !== undefined) update.next_retry_at = patch.nextRetryAt;
  if (patch.lastErrorClass !== undefined) update.last_error_class = patch.lastErrorClass;
  if (patch.finalizedAt !== undefined) update.finalized_at = patch.finalizedAt;
  if (patch.finalizeReason !== undefined) update.finalize_reason = patch.finalizeReason;

  await tenantDb(knex, tenantId)
    .table(TABLE)
    .where({ tenant: tenantId, provider })
    .update(update);

  return getDisconnectRecord(knex, tenantId, provider);
}

/**
 * Records due for retry for one tenant: still pending and past their retry
 * window (or never scheduled one). Used by the per-tenant retry job.
 */
export async function listDueDisconnectRecords(
  knex: Knex,
  tenantId: string,
): Promise<ProviderDisconnectRecord[]> {
  const rows = await tenantDb(knex, tenantId)
    .table<DisconnectRecordRow>(TABLE)
    .where({ tenant: tenantId, status: 'pending_revocation' })
    .where((qb) => {
      qb.whereNull('next_retry_at').orWhere('next_retry_at', '<=', knex.fn.now());
    })
    .select();
  return rows.map(mapRow);
}

export async function deleteDisconnectRecord(
  knex: Knex,
  tenantId: string,
  provider: ProviderType,
): Promise<void> {
  await tenantDb(knex, tenantId).table(TABLE).where({ tenant: tenantId, provider }).delete();
}
