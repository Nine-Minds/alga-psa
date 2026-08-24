/**
 * Tenant-scoped durable store for the inbound email pipeline.
 *
 * All state changes are token/version-fenced single conditional
 * `UPDATE ... RETURNING` statements. A zero-row update means ownership was
 * lost and the worker must stop without publishing or ACKing as success.
 *
 * The inbox is the authoritative core state machine; ingress/artifact/outbox
 * rows use the analogous received/pending -> processing -> terminal-or-retryable
 * rules. Nothing here deletes durable records to force a retry.
 */

import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type {
  InboundEmailDurableMode,
  InboundEmailInboxOutcomeKind,
  InboundEmailInboxRecord,
  InboundProviderType,
} from '../../interfaces/inbound-email.interfaces';

export type DurableDb = Knex | Knex.Transaction;

export interface LeaseFields {
  lease_owner: string;
  lease_token: string;
  lease_version: number;
  lease_expires_at: Date;
}

export type InboundClaimResult<T> = { claimed: true; row: T } | { claimed: false; reason: 'not_due' | 'already_claimed' | 'terminal' | 'missing' };

function makeLeaseFields(owner: string, leaseTtlMs: number): LeaseFields {
  return {
    lease_owner: owner,
    lease_token: randomUUID(),
    lease_version: 0,
    lease_expires_at: new Date(Date.now() + leaseTtlMs),
  };
}

// ---------------------------------------------------------------------------
// Mode / configuration
// ---------------------------------------------------------------------------

export function getInboundDurableMode(): InboundEmailDurableMode {
  const mode = (process.env.UNIFIED_INBOUND_EMAIL_DURABLE_MODE || 'off').trim();
  if (mode === 'shadow' || mode === 'enforce') return mode;
  return 'off';
}

export function isInboundDurableEnabled(): boolean {
  return getInboundDurableMode() !== 'off';
}

/** Claim lease TTL for Postgres durable rows (independent of the Redis claim). */
export function getDurableLeaseTtlMs(): number {
  const raw = Number(process.env.UNIFIED_INBOUND_EMAIL_DURABLE_LEASE_TTL_MS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 30_000;
}

/**
 * Terminal attempt limit for Postgres durable rows. Mirrors the V2 Redis
 * transport maxAttempts (UNIFIED_INBOUND_EMAIL_QUEUE_V2_MAX_ATTEMPTS) so an
 * exhausted row lands in a queryable terminal-failure state instead of looping
 * forever through the sweeper/claim cycle.
 */
export function getDurableMaxAttempts(): number {
  const raw = Number(process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_MAX_ATTEMPTS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 5;
}

function isDue(nextAttemptAt: Date | string | null | undefined, now: Date): boolean {
  if (!nextAttemptAt) return true;
  const at = new Date(nextAttemptAt).getTime();
  if (Number.isNaN(at)) return true;
  return at <= now.getTime();
}

// ---------------------------------------------------------------------------
// Ingress
// ---------------------------------------------------------------------------

/**
 * True when the provider's inbound ingestion is paused (any reason). Durable
 * work that requires provider source access must wait out the pause instead of
 * burning attempts against dead credentials: a message that arrived during an
 * auth pause must survive, non-terminal, until the resume reconciliation and
 * the recovery sweep hand it off. Ingestion gating here is the durable-mode
 * equivalent of the `inbound_paused_at` filters in the queue/maintenance
 * loaders.
 */
export async function isInboundProviderPaused(db: DurableDb, tenant: string, providerId: string): Promise<boolean> {
  const row = await tenantDb(db, tenant).table('email_providers')
    .where({ tenant, id: providerId })
    .first('inbound_paused_at');
  return Boolean(row?.inbound_paused_at);
}

export interface InboundIngressInsert {
  tenant: string;
  provider_id: string;
  provider_type: InboundProviderType;
  ingress_key: string;
  provider_pointer: Record<string, unknown>;
}

export interface InboundIngressRecord {
  tenant: string;
  ingress_id: string;
  provider_id: string;
  provider_type: InboundProviderType;
  ingress_key: string;
  provider_pointer: Record<string, unknown>;
  status: string;
  attempt_count: number;
  lease_owner: string | null;
  lease_token: string | null;
  lease_version: number;
  lease_expires_at: Date | string | null;
  next_attempt_at: Date | string | null;
  last_error: string | null;
  error_details: Record<string, unknown> | null;
  received_at: Date | string;
  completed_at: Date | string | null;
}

/**
 * Persist a provider pointer before Redis handoff. Returns the existing row
 * when the deterministic ingress key is already present (idempotent).
 */
export async function upsertIngress(db: DurableDb, input: InboundIngressInsert): Promise<InboundIngressRecord> {
  const scoped = tenantDb(db, input.tenant);
  const now = db.fn.now();
  const inserted = await scoped.table('inbound_email_ingress')
    .insert({
      tenant: input.tenant,
      provider_id: input.provider_id,
      provider_type: input.provider_type,
      ingress_key: input.ingress_key,
      provider_pointer: JSON.stringify(input.provider_pointer),
      status: 'received',
      attempt_count: 0,
      lease_version: 0,
      received_at: now,
      created_at: now,
      updated_at: now,
    })
    .onConflict(['tenant', 'provider_id', 'ingress_key'])
    .ignore()
    .returning('*');
  if (Array.isArray(inserted) && inserted.length > 0) {
    return inserted[0];
  }
  const existing = await scoped.table('inbound_email_ingress')
    .where({ tenant: input.tenant, provider_id: input.provider_id, ingress_key: input.ingress_key })
    .first();
  return existing as InboundIngressRecord;
}

export async function claimIngress(db: DurableDb, params: {
  tenant: string;
  ingress_id: string;
  owner: string;
  leaseTtlMs: number;
  allowRetryable?: boolean;
}): Promise<InboundClaimResult<InboundIngressRecord>> {
  const lease = makeLeaseFields(params.owner, params.leaseTtlMs);
  const maxAttempts = getDurableMaxAttempts();
  const patch = {
    status: 'staging',
    attempt_count: db.raw('attempt_count + 1'),
    lease_owner: lease.lease_owner,
    lease_token: lease.lease_token,
    lease_version: db.raw('lease_version + 1'),
    lease_expires_at: lease.lease_expires_at,
    next_attempt_at: null,
    updated_at: db.fn.now(),
  };
  const now = new Date();

  let updated = await tenantDb(db, params.tenant).table('inbound_email_ingress')
    .where({ tenant: params.tenant, ingress_id: params.ingress_id, status: 'received' })
    .update(patch)
    .returning('*');
  if (updated.length === 0 && params.allowRetryable) {
    updated = await tenantDb(db, params.tenant).table('inbound_email_ingress')
      .where({ tenant: params.tenant, ingress_id: params.ingress_id, status: 'retryable_failed' })
      .andWhere('attempt_count', '<', maxAttempts)
      .andWhere((qb: any) => qb.whereNull('next_attempt_at').orWhere('next_attempt_at', '<=', db.fn.now()))
      .update(patch)
      .returning('*');
  }
  if (updated.length > 0) return { claimed: true, row: updated[0] };

  const current = await getIngress(db, params.tenant, params.ingress_id);
  if (!current) return { claimed: false, reason: 'missing' };
  if (current.status === 'staged' || current.status === 'terminal_failed') {
    return { claimed: false, reason: 'terminal' };
  }
  if (current.status === 'retryable_failed') {
    // Over-cap due retryable rows are dead-lettered into a queryable terminal
    // failure state rather than looping forever — unless the provider is
    // ingestion-paused: attempts that accrued while the credential was dead
    // must not terminalize a paused-interval message. The early pause read
    // leaves an already-paused provider's row untouched, and deadletterIngress
    // re-checks the pause state atomically with the terminal write itself, so
    // a pause landing between the two still cannot terminalize the row (it is
    // parked there instead).
    if (isDue(current.next_attempt_at, now) && current.attempt_count >= maxAttempts) {
      if (await isInboundProviderPaused(db, params.tenant, current.provider_id)) {
        return { claimed: false, reason: 'not_due' };
      }
      const outcome = await deadletterIngress(db, current);
      if (outcome === 'deadlettered') {
        return { claimed: false, reason: 'terminal' };
      }
      // The pause raced this decision and the row was parked (or a
      // concurrent transition won): not due now; the recovery sweep re-drives
      // the row after the pause clears.
      return { claimed: false, reason: 'not_due' };
    }
    return { claimed: false, reason: 'not_due' };
  }
  return { claimed: false, reason: 'already_claimed' };
}

/**
 * Park a claimed ingress row whose provider is ingestion-paused: fenced
 * transition to `retryable_failed` with the attempt budget VOIDED. The pause
 * owns the delay — the row's attempts were burned against a dead credential,
 * not an unhealthy message — so after the pause clears the row gets a full
 * retry budget and the recovery sweep re-drives it. Never terminal.
 */
export async function parkIngressWhilePaused(db: DurableDb, params: {
  tenant: string;
  ingress_id: string;
  owner: string;
  token: string;
  version: number;
  backoffMs: number;
  error?: string | null;
}): Promise<boolean> {
  const updated = await tenantDb(db, params.tenant).table('inbound_email_ingress')
    .where({
      tenant: params.tenant,
      ingress_id: params.ingress_id,
      status: 'staging',
      lease_owner: params.owner,
      lease_token: params.token,
      lease_version: params.version,
    })
    .update({
      status: 'retryable_failed',
      attempt_count: 0,
      lease_owner: null,
      lease_token: null,
      lease_expires_at: null,
      next_attempt_at: db.raw("now() + (? || ' milliseconds')::interval", [params.backoffMs]),
      ...(params.error !== undefined ? { last_error: params.error } : {}),
      error_details: JSON.stringify({ phase: 'staging', parkedWhilePaused: true }),
      updated_at: db.fn.now(),
    });
  return updated > 0;
}

/**
 * Revive a `terminal_failed` ingress row back to `received` with a fresh
 * attempt budget. Used by the auth-pause recovery reconciliation when it
 * re-hands-off a paused-interval message whose prior ingress terminalized
 * (e.g. attempts burned against the dead credential): a terminal row is NOT a
 * durable hand-off, and an explicit new hand-off must result in processing.
 * Conditional on the still-terminal status so concurrent revives are safe.
 */
export async function reviveTerminalIngress(db: DurableDb, tenant: string, ingressId: string): Promise<boolean> {
  const updated = await tenantDb(db, tenant).table('inbound_email_ingress')
    .where({ tenant, ingress_id: ingressId, status: 'terminal_failed' })
    .update({
      status: 'received',
      attempt_count: 0,
      lease_owner: null,
      lease_token: null,
      lease_expires_at: null,
      next_attempt_at: null,
      completed_at: null,
      error_details: JSON.stringify({ revivedBy: 'auth-pause-reconcile' }),
      updated_at: db.fn.now(),
    });
  return updated > 0;
}

/**
 * Atomically reclaim an expired-lease `staging` ingress row. `staging ->
 * staging` installs a new token/version (fencing the old worker out) without
 * incrementing the attempt count, mirroring reclaimInbox. A crash after the
 * ingress claim but before transition must be recoverable by the sweeper.
 */
export async function reclaimIngress(db: DurableDb, params: {
  tenant: string;
  ingress_id: string;
  owner: string;
  leaseTtlMs: number;
}): Promise<InboundClaimResult<InboundIngressRecord>> {
  const lease = makeLeaseFields(params.owner, params.leaseTtlMs);
  const updated = await tenantDb(db, params.tenant).table('inbound_email_ingress')
    .where({ tenant: params.tenant, ingress_id: params.ingress_id, status: 'staging' })
    .andWhere('lease_expires_at', '<=', db.fn.now())
    .update({
      lease_owner: lease.lease_owner,
      lease_token: lease.lease_token,
      lease_version: db.raw('lease_version + 1'),
      lease_expires_at: lease.lease_expires_at,
      next_attempt_at: null,
      updated_at: db.fn.now(),
    })
    .returning('*');
  if (updated.length > 0) return { claimed: true, row: updated[0] };

  const current = await getIngress(db, params.tenant, params.ingress_id);
  if (!current) return { claimed: false, reason: 'missing' };
  if (current.status === 'staged' || current.status === 'terminal_failed') {
    return { claimed: false, reason: 'terminal' };
  }
  return { claimed: false, reason: 'already_claimed' };
}

export type IngressDeadletterOutcome = 'deadlettered' | 'parked_while_paused' | 'noop';

/** Backoff for a dead-letter attempt parked because the provider is paused.
 * Short on purpose: the pause gate (not the backoff) suppresses re-drives
 * while paused, matching parkIngressWhilePaused. */
const PAUSED_DEADLETTER_PARK_BACKOFF_MS = 30_000;

/**
 * Dead-letter an over-cap due retryable ingress row into `terminal_failed`.
 *
 * The terminal transition is guarded at the WRITE ITSELF by the provider's
 * live pause state (a NOT EXISTS subquery over the paused provider row in the
 * same single UPDATE statement), so a provider that becomes paused between
 * any earlier pause check/snapshot and this decision can never have an
 * over-cap row terminalized: single-statement Postgres semantics make the
 * guard and the write one atomic act. When the guard blocks the write because
 * the provider is paused at decision time, the row is PARKED instead — the
 * same non-terminal semantics as the staging-worker park (`retryable_failed`,
 * attempt budget voided, short backoff) — so the recovery sweep re-drives it
 * with a full retry budget once the pause clears.
 */
export async function deadletterIngress(
  db: DurableDb,
  row: InboundIngressRecord
): Promise<IngressDeadletterOutcome> {
  const notPausedWhileTerminal = db.raw(
    'NOT EXISTS (SELECT 1 FROM email_providers ep WHERE ep.tenant = ? AND ep.id = ? AND ep.inbound_paused_at IS NOT NULL)',
    [row.tenant, row.provider_id]
  );
  const updated = await tenantDb(db, row.tenant).table('inbound_email_ingress')
    .where({ tenant: row.tenant, ingress_id: row.ingress_id, status: 'retryable_failed' })
    .where(notPausedWhileTerminal)
    .update({
      status: 'terminal_failed',
      completed_at: db.fn.now(),
      lease_owner: null,
      lease_token: null,
      lease_expires_at: null,
      next_attempt_at: null,
      last_error: row.last_error ?? 'max_attempts_exhausted',
      updated_at: db.fn.now(),
    });
  if (updated > 0) return 'deadlettered';

  // Zero rows: either the row was transitioned concurrently (noop) or the
  // pause guard blocked the terminal write. Park only when the provider is
  // paused at this decision point — a fresh read, not a sweep-time snapshot.
  if (!(await isInboundProviderPaused(db, row.tenant, row.provider_id))) {
    return 'noop';
  }
  const parked = await tenantDb(db, row.tenant).table('inbound_email_ingress')
    .where({ tenant: row.tenant, ingress_id: row.ingress_id, status: 'retryable_failed' })
    .update({
      attempt_count: 0,
      lease_owner: null,
      lease_token: null,
      lease_expires_at: null,
      next_attempt_at: db.raw("now() + (? || ' milliseconds')::interval", [PAUSED_DEADLETTER_PARK_BACKOFF_MS]),
      last_error: row.last_error ?? 'max_attempts_exhausted',
      error_details: JSON.stringify({ phase: 'deadletter', parkedWhilePaused: true }),
      updated_at: db.fn.now(),
    });
  return parked > 0 ? 'parked_while_paused' : 'noop';
}

export async function getIngress(db: DurableDb, tenant: string, ingressId: string): Promise<InboundIngressRecord | null> {
  const row = await tenantDb(db, tenant).table('inbound_email_ingress')
    .where({ tenant, ingress_id: ingressId })
    .first();
  return (row as InboundIngressRecord) ?? null;
}

export async function renewIngress(db: DurableDb, params: {
  tenant: string;
  ingress_id: string;
  token: string;
  version: number;
  owner: string;
  leaseTtlMs: number;
}): Promise<boolean> {
  const expiresAt = new Date(Date.now() + params.leaseTtlMs);
  const updated = await tenantDb(db, params.tenant).table('inbound_email_ingress')
    .where({
      tenant: params.tenant,
      ingress_id: params.ingress_id,
      status: 'staging',
      lease_owner: params.owner,
      lease_token: params.token,
      lease_version: params.version,
    })
    .update({ lease_expires_at: expiresAt, updated_at: db.fn.now() });
  return updated > 0;
}

export async function transitionIngress(db: DurableDb, params: {
  tenant: string;
  ingress_id: string;
  owner: string;
  token: string;
  version: number;
  status: 'staged' | 'retryable_failed' | 'terminal_failed';
  nextAttemptAt?: Date | null;
  error?: string | null;
  errorDetails?: Record<string, unknown> | null;
  result?: Record<string, unknown>;
}): Promise<boolean> {
  const patch: Record<string, unknown> = {
    status: params.status,
    updated_at: db.fn.now(),
  };
  if (params.status === 'staged' || params.status === 'terminal_failed') {
    patch.completed_at = db.fn.now();
    patch.lease_owner = null;
    patch.lease_token = null;
    patch.lease_expires_at = null;
  }
  if (params.status === 'retryable_failed') {
    patch.next_attempt_at = params.nextAttemptAt ?? db.fn.now();
  }
  if (params.error !== undefined) patch.last_error = params.error;
  if (params.errorDetails !== undefined) patch.error_details = params.errorDetails ? JSON.stringify(params.errorDetails) : null;

  const updated = await tenantDb(db, params.tenant).table('inbound_email_ingress')
    .where({
      tenant: params.tenant,
      ingress_id: params.ingress_id,
      status: 'staging',
      lease_owner: params.owner,
      lease_token: params.token,
      lease_version: params.version,
    })
    .update(patch);
  return updated > 0;
}

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

export interface InboundInboxInsert {
  tenant: string;
  ingress_id: string | null;
  provider_id: string;
  provider_type: InboundProviderType;
  normalized_message_id: string;
  provider_message_id: string | null;
  rfc_message_id: string | null;
  source_object_key: string;
  source_sha256: string | null;
  source_size_bytes: number;
  source_staged_at: Date | string;
  envelope: Record<string, unknown>;
  legacy_imported?: boolean;
  /**
   * Terminal state to insert directly. Legacy imports have no real source, so
   * the `source_required_check` only permits them in a terminal state
   * (`legacy_imported = true` + terminal status). The backfill inserts them
   * straight into their final terminal status instead of via received ->
   * transition, which the check would reject.
   */
  status?: 'succeeded' | 'skipped' | 'terminal_failed';
  outcome_kind?: InboundEmailInboxOutcomeKind | null;
  outcome_reason?: string | null;
  ticket_id?: string | null;
  comment_id?: string | null;
  last_error?: string | null;
}

export async function upsertInbox(db: DurableDb, input: InboundInboxInsert): Promise<InboundEmailInboxRecord> {
  const scoped = tenantDb(db, input.tenant);
  const now = db.fn.now();
  const terminal = input.status !== undefined;
  const inserted = await scoped.table('inbound_email_inbox')
    .insert({
      tenant: input.tenant,
      ingress_id: input.ingress_id,
      provider_id: input.provider_id,
      provider_type: input.provider_type,
      normalized_message_id: input.normalized_message_id,
      provider_message_id: input.provider_message_id,
      rfc_message_id: input.rfc_message_id,
      source_object_key: input.source_object_key,
      source_sha256: input.source_sha256,
      source_size_bytes: input.source_size_bytes,
      source_staged_at: input.source_staged_at,
      envelope: JSON.stringify(input.envelope),
      legacy_imported: input.legacy_imported ?? false,
      status: input.status ?? 'received',
      attempt_count: 0,
      lease_version: 0,
      outcome_kind: input.outcome_kind ?? null,
      outcome_reason: input.outcome_reason ?? null,
      ticket_id: input.ticket_id ?? null,
      comment_id: input.comment_id ?? null,
      last_error: input.last_error ?? null,
      completed_at: terminal ? now : null,
      received_at: now,
      created_at: now,
      updated_at: now,
    })
    .onConflict(['tenant', 'provider_id', 'normalized_message_id'])
    .ignore()
    .returning('*');
  if (Array.isArray(inserted) && inserted.length > 0) {
    return inserted[0];
  }
  const existing = await scoped.table('inbound_email_inbox')
    .where({ tenant: input.tenant, provider_id: input.provider_id, normalized_message_id: input.normalized_message_id })
    .first();
  return existing as InboundEmailInboxRecord;
}

export async function getInbox(db: DurableDb, tenant: string, inboxId: string): Promise<InboundEmailInboxRecord | null> {
  const row = await tenantDb(db, tenant).table('inbound_email_inbox')
    .where({ tenant, inbox_id: inboxId })
    .first();
  return (row as InboundEmailInboxRecord) ?? null;
}

export async function getInboxByIdentity(db: DurableDb, params: {
  tenant: string;
  provider_id: string;
  normalized_message_id: string;
}): Promise<InboundEmailInboxRecord | null> {
  const row = await tenantDb(db, params.tenant).table('inbound_email_inbox')
    .where({
      tenant: params.tenant,
      provider_id: params.provider_id,
      normalized_message_id: params.normalized_message_id,
    })
    .first();
  return (row as InboundEmailInboxRecord) ?? null;
}

/**
 * Claim a `received` inbox row for processing. `received -> processing` and
 * `retryable_failed -> processing` (only when due). Returns not_due when the
 * retryable_failed row is not yet due.
 */
export async function claimInbox(db: DurableDb, params: {
  tenant: string;
  inbox_id: string;
  owner: string;
  leaseTtlMs: number;
  allowRetryable?: boolean;
}): Promise<InboundClaimResult<InboundEmailInboxRecord>> {
  const lease = makeLeaseFields(params.owner, params.leaseTtlMs);
  const maxAttempts = getDurableMaxAttempts();
  const now = new Date();
  const patch = {
    status: 'processing',
    attempt_count: db.raw('attempt_count + 1'),
    lease_owner: lease.lease_owner,
    lease_token: lease.lease_token,
    lease_version: db.raw('lease_version + 1'),
    lease_expires_at: lease.lease_expires_at,
    next_attempt_at: null,
    updated_at: db.fn.now(),
  };

  let updated = await tenantDb(db, params.tenant).table('inbound_email_inbox')
    .where({ tenant: params.tenant, inbox_id: params.inbox_id, status: 'received' })
    .update(patch)
    .returning('*');
  if (updated.length === 0 && params.allowRetryable) {
    updated = await tenantDb(db, params.tenant).table('inbound_email_inbox')
      .where({ tenant: params.tenant, inbox_id: params.inbox_id, status: 'retryable_failed' })
      .andWhere('attempt_count', '<', maxAttempts)
      .andWhere((qb: any) => qb.whereNull('next_attempt_at').orWhere('next_attempt_at', '<=', db.fn.now()))
      .update(patch)
      .returning('*');
  }

  if (updated.length > 0) return { claimed: true, row: updated[0] };

  const current = await getInbox(db, params.tenant, params.inbox_id);
  if (!current) return { claimed: false, reason: 'missing' };
  if (['succeeded', 'skipped', 'terminal_failed'].includes(current.status)) {
    return { claimed: false, reason: 'terminal' };
  }
  if (current.status === 'retryable_failed') {
    // Over-cap due retryable rows are dead-lettered into a queryable terminal
    // failure state rather than looping forever.
    if (isDue(current.next_attempt_at, now) && current.attempt_count >= maxAttempts) {
      await deadletterInbox(db, current);
      return { claimed: false, reason: 'terminal' };
    }
    return { claimed: false, reason: 'not_due' };
  }
  return { claimed: false, reason: 'already_claimed' };
}

/**
 * Dead-letter an over-cap due retryable inbox row into `terminal_failed`.
 * Preserves the latest error and clears the lease, satisfying the terminal
 * lease/check constraints. The row is never deleted.
 */
export async function deadletterInbox(db: DurableDb, row: InboundEmailInboxRecord): Promise<boolean> {
  const updated = await tenantDb(db, row.tenant).table('inbound_email_inbox')
    .where({ tenant: row.tenant, inbox_id: row.inbox_id, status: 'retryable_failed' })
    .update({
      status: 'terminal_failed',
      outcome_kind: null,
      outcome_reason: 'max_attempts_exhausted',
      completed_at: db.fn.now(),
      lease_owner: null,
      lease_token: null,
      lease_expires_at: null,
      next_attempt_at: null,
      last_error: row.last_error ?? 'max_attempts_exhausted',
      updated_at: db.fn.now(),
    });
  return updated > 0;
}

/**
 * Atomically reclaim a `processing` inbox row whose lease has expired.
 * `processing -> processing` installs a new token/version and preserves prior
 * errors and attempt count.
 */
export async function reclaimInbox(db: DurableDb, params: {
  tenant: string;
  inbox_id: string;
  owner: string;
  leaseTtlMs: number;
}): Promise<InboundClaimResult<InboundEmailInboxRecord>> {
  const lease = makeLeaseFields(params.owner, params.leaseTtlMs);
  const updated = await tenantDb(db, params.tenant).table('inbound_email_inbox')
    .where({ tenant: params.tenant, inbox_id: params.inbox_id, status: 'processing' })
    .andWhere('lease_expires_at', '<=', db.fn.now())
    .update({
      lease_owner: lease.lease_owner,
      lease_token: lease.lease_token,
      lease_version: db.raw('lease_version + 1'),
      lease_expires_at: lease.lease_expires_at,
      next_attempt_at: null,
      updated_at: db.fn.now(),
    })
    .returning('*');
  if (updated.length > 0) return { claimed: true, row: updated[0] };

  const current = await getInbox(db, params.tenant, params.inbox_id);
  if (!current) return { claimed: false, reason: 'missing' };
  if (['succeeded', 'skipped', 'terminal_failed'].includes(current.status)) {
    return { claimed: false, reason: 'terminal' };
  }
  return { claimed: false, reason: 'already_claimed' };
}

export async function renewInbox(db: DurableDb, params: {
  tenant: string;
  inbox_id: string;
  token: string;
  version: number;
  owner: string;
  leaseTtlMs: number;
}): Promise<boolean> {
  const expiresAt = new Date(Date.now() + params.leaseTtlMs);
  const updated = await tenantDb(db, params.tenant).table('inbound_email_inbox')
    .where({
      tenant: params.tenant,
      inbox_id: params.inbox_id,
      status: 'processing',
      lease_owner: params.owner,
      lease_token: params.token,
      lease_version: params.version,
    })
    .update({ lease_expires_at: expiresAt, updated_at: db.fn.now() });
  return updated > 0;
}

export async function getInboxLeaseExpiry(db: DurableDb, tenant: string, inboxId: string): Promise<Date | null> {
  const row = await tenantDb(db, tenant).table('inbound_email_inbox')
    .where({ tenant, inbox_id: inboxId })
    .first('lease_expires_at');
  if (!row?.lease_expires_at) return null;
  const d = new Date(row.lease_expires_at);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Fenced release of a `processing` claim back to `received`. Used by shadow
 * mode where the durable processor must NOT terminal-write or create entities:
 * it releases the claim and leaves the row non-terminal and reconciliation
 * eligible for later enforce-mode processing. A zero-row result means the fence
 * was superseded.
 */
export async function releaseInboxClaim(db: DurableDb, params: {
  tenant: string;
  inbox_id: string;
  owner: string;
  token: string;
  version: number;
}): Promise<boolean> {
  const updated = await tenantDb(db, params.tenant).table('inbound_email_inbox')
    .where({
      tenant: params.tenant,
      inbox_id: params.inbox_id,
      status: 'processing',
      lease_owner: params.owner,
      lease_token: params.token,
      lease_version: params.version,
    })
    .update({
      status: 'received',
      lease_owner: null,
      lease_token: null,
      lease_expires_at: null,
      next_attempt_at: null,
      updated_at: db.fn.now(),
    });
  return updated > 0;
}

/**
 * Terminal write for the current token/version. A zero-row result means the
 * fence was superseded and the caller must abort (inside a transaction this
 * throws and rolls back).
 */
export async function transitionInbox(db: DurableDb, params: {
  tenant: string;
  inbox_id: string;
  owner: string;
  token: string;
  version: number;
  status: 'succeeded' | 'skipped' | 'retryable_failed' | 'terminal_failed';
  outcome_kind?: InboundEmailInboxOutcomeKind | null;
  outcome_reason?: string | null;
  ticket_id?: string | null;
  comment_id?: string | null;
  nextAttemptAt?: Date | null;
  error?: string | null;
  errorDetails?: Record<string, unknown> | null;
}): Promise<boolean> {
  const patch: Record<string, unknown> = {
    status: params.status,
    updated_at: db.fn.now(),
  };
  if (params.outcome_kind !== undefined) patch.outcome_kind = params.outcome_kind;
  if (params.outcome_reason !== undefined) patch.outcome_reason = params.outcome_reason;
  if (params.ticket_id !== undefined) patch.ticket_id = params.ticket_id;
  if (params.comment_id !== undefined) patch.comment_id = params.comment_id;

  if (params.status === 'succeeded' || params.status === 'skipped' || params.status === 'terminal_failed') {
    patch.completed_at = db.fn.now();
    patch.lease_owner = null;
    patch.lease_token = null;
    patch.lease_expires_at = null;
    patch.next_attempt_at = null;
  }
  if (params.status === 'retryable_failed') {
    patch.next_attempt_at = params.nextAttemptAt ?? db.fn.now();
  }
  if (params.error !== undefined) patch.last_error = params.error;
  if (params.errorDetails !== undefined) patch.error_details = params.errorDetails ? JSON.stringify(params.errorDetails) : null;

  const updated = await tenantDb(db, params.tenant).table('inbound_email_inbox')
    .where({
      tenant: params.tenant,
      inbox_id: params.inbox_id,
      status: 'processing',
      lease_owner: params.owner,
      lease_token: params.token,
      lease_version: params.version,
    })
    .update(patch);
  return updated > 0;
}

/**
 * Lock the inbox row FOR UPDATE and verify the fencing token inside the core
 * transaction. Returns the row when the fence holds; null when superseded.
 */
export async function lockInboxForUpdate(db: Knex.Transaction, params: {
  tenant: string;
  inbox_id: string;
  token: string;
  version: number;
}): Promise<InboundEmailInboxRecord | null> {
  const row = await tenantDb(db, params.tenant).table('inbound_email_inbox')
    .where({ tenant: params.tenant, inbox_id: params.inbox_id })
    .forUpdate()
    .first();
  if (!row) return null;
  if (row.status !== 'processing') return null;
  if (String(row.lease_token) !== params.token) return null;
  if (Number(row.lease_version) !== Number(params.version)) return null;
  if (row.lease_expires_at && new Date(row.lease_expires_at).getTime() < Date.now()) return null;
  return row as InboundEmailInboxRecord;
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

export interface InboundEffectInsert {
  tenant: string;
  provider_id: string;
  normalized_message_id: string;
  source_sha256: string | null;
  effect_type: 'ticket' | 'comment';
  inbox_id: string;
  entity_id: string;
  ticket_id: string;
  reconciled?: boolean;
}

/**
 * Insert an effect row. The source-digest and legacy partial unique indexes
 * are the identity guards; the inbox-scoped primary key protects each
 * materialized effect. A uniqueness conflict is a transaction-level
 * reconciliation signal and MUST NOT be caught here.
 */
export async function insertEffect(db: DurableDb, input: InboundEffectInsert): Promise<void> {
  await tenantDb(db, input.tenant).table('inbound_email_effects').insert({
    tenant: input.tenant,
    provider_id: input.provider_id,
    normalized_message_id: input.normalized_message_id,
    source_sha256: input.source_sha256,
    effect_type: input.effect_type,
    inbox_id: input.inbox_id,
    entity_id: input.entity_id,
    ticket_id: input.ticket_id,
    reconciled: input.reconciled ?? false,
    created_at: db.fn.now(),
  });
}

export interface InboundEffectRow {
  tenant: string;
  provider_id: string;
  normalized_message_id: string;
  source_sha256: string | null;
  effect_type: 'ticket' | 'comment';
  inbox_id: string;
  entity_id: string;
  ticket_id: string;
  reconciled: boolean;
  created_at: Date | string;
}

export async function getEffectsForInbox(db: DurableDb, tenant: string, inboxId: string): Promise<InboundEffectRow[]> {
  return (await tenantDb(db, tenant).table('inbound_email_effects')
    .where({ tenant, inbox_id: inboxId })
    .orderBy('effect_type', 'asc')) as InboundEffectRow[];
}

export async function getEffectsByIdentity(db: DurableDb, params: {
  tenant: string;
  provider_id: string;
  normalized_message_id: string;
}): Promise<InboundEffectRow[]> {
  return (await tenantDb(db, params.tenant).table('inbound_email_effects')
    .where({
      tenant: params.tenant,
      provider_id: params.provider_id,
      normalized_message_id: params.normalized_message_id,
    })
    .orderBy('effect_type', 'asc')) as InboundEffectRow[];
}

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

export interface InboundArtifactInsert {
  tenant: string;
  inbox_id: string;
  artifact_key: string;
  artifact_type: 'attachment' | 'embedded_image' | 'original_email';
  source_attachment_id?: string | null;
  content_digest?: string | null;
  storage_key?: string | null;
}

export interface InboundArtifactRecord {
  tenant: string;
  inbox_id: string;
  artifact_key: string;
  artifact_type: string;
  source_attachment_id: string | null;
  content_digest: string | null;
  storage_key: string | null;
  status: string;
  attempt_count: number;
  lease_owner: string | null;
  lease_token: string | null;
  lease_version: number;
  lease_expires_at: Date | string | null;
  next_attempt_at: Date | string | null;
  file_id: string | null;
  document_id: string | null;
  last_error: string | null;
  completed_at: Date | string | null;
}

export async function insertArtifacts(db: DurableDb, tenant: string, rows: InboundArtifactInsert[]): Promise<void> {
  if (!rows.length) return;
  await tenantDb(db, tenant).table('inbound_email_artifacts')
    .insert(rows.map((row) => ({
      tenant,
      inbox_id: row.inbox_id,
      artifact_key: row.artifact_key,
      artifact_type: row.artifact_type,
      source_attachment_id: row.source_attachment_id ?? null,
      content_digest: row.content_digest ?? null,
      storage_key: row.storage_key ?? null,
      status: 'pending',
      attempt_count: 0,
      lease_version: 0,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })))
    .onConflict(['tenant', 'inbox_id', 'artifact_key'])
    .ignore();
}

export async function getArtifactsForInbox(db: DurableDb, tenant: string, inboxId: string): Promise<InboundArtifactRecord[]> {
  return (await tenantDb(db, tenant).table('inbound_email_artifacts')
    .where({ tenant, inbox_id: inboxId })
    .orderBy('artifact_key', 'asc')) as InboundArtifactRecord[];
}

export async function getArtifact(db: DurableDb, tenant: string, inboxId: string, artifactKey: string): Promise<InboundArtifactRecord | null> {
  const row = await tenantDb(db, tenant).table('inbound_email_artifacts')
    .where({ tenant, inbox_id: inboxId, artifact_key: artifactKey })
    .first();
  return (row as InboundArtifactRecord) ?? null;
}

export async function claimArtifact(db: DurableDb, params: {
  tenant: string;
  inbox_id: string;
  artifact_key: string;
  owner: string;
  leaseTtlMs: number;
}): Promise<InboundClaimResult<InboundArtifactRecord>> {
  const lease = makeLeaseFields(params.owner, params.leaseTtlMs);
  const maxAttempts = getDurableMaxAttempts();
  const now = new Date();
  const patch = {
    status: 'processing',
    attempt_count: db.raw('attempt_count + 1'),
    lease_owner: lease.lease_owner,
    lease_token: lease.lease_token,
    lease_version: db.raw('lease_version + 1'),
    lease_expires_at: lease.lease_expires_at,
    next_attempt_at: null,
    updated_at: db.fn.now(),
  };
  const updated = await tenantDb(db, params.tenant).table('inbound_email_artifacts')
    .where({ tenant: params.tenant, inbox_id: params.inbox_id, artifact_key: params.artifact_key, status: 'pending' })
    .update(patch)
    .returning('*');
  if (updated.length > 0) return { claimed: true, row: updated[0] };
  const retryable = await tenantDb(db, params.tenant).table('inbound_email_artifacts')
    .where({ tenant: params.tenant, inbox_id: params.inbox_id, artifact_key: params.artifact_key, status: 'retryable_failed' })
    .andWhere('attempt_count', '<', maxAttempts)
    .andWhere((qb: any) => qb.whereNull('next_attempt_at').orWhere('next_attempt_at', '<=', db.fn.now()))
    .update(patch)
    .returning('*');
  if (retryable.length > 0) return { claimed: true, row: retryable[0] };
  const current = await tenantDb(db, params.tenant).table('inbound_email_artifacts')
    .where({ tenant: params.tenant, inbox_id: params.inbox_id, artifact_key: params.artifact_key })
    .first();
  if (!current) return { claimed: false, reason: 'missing' };
  if (['succeeded', 'skipped', 'terminal_failed'].includes(current.status)) {
    return { claimed: false, reason: 'terminal' };
  }
  if (current.status === 'retryable_failed') {
    if (isDue(current.next_attempt_at, now) && current.attempt_count >= maxAttempts) {
      await deadletterArtifact(db, current as InboundArtifactRecord);
      return { claimed: false, reason: 'terminal' };
    }
    return { claimed: false, reason: 'not_due' };
  }
  return { claimed: false, reason: 'already_claimed' };
}

/** Dead-letter an over-cap due retryable artifact row into `terminal_failed`. */
export async function deadletterArtifact(db: DurableDb, row: InboundArtifactRecord): Promise<boolean> {
  const updated = await tenantDb(db, row.tenant).table('inbound_email_artifacts')
    .where({ tenant: row.tenant, inbox_id: row.inbox_id, artifact_key: row.artifact_key, status: 'retryable_failed' })
    .update({
      status: 'terminal_failed',
      completed_at: db.fn.now(),
      lease_owner: null,
      lease_token: null,
      lease_expires_at: null,
      next_attempt_at: null,
      last_error: row.last_error ?? 'max_attempts_exhausted',
      updated_at: db.fn.now(),
    });
  return updated > 0;
}

/**
 * Atomically reclaim a `processing` artifact row whose lease has expired.
 * `processing -> processing` installs a new token/version (fencing the crashed
 * worker out) without incrementing the attempt count, mirroring reclaimInbox. A
 * crash after the artifact claim but before transition must be recoverable by
 * the sweeper, never stranded.
 */
export async function reclaimArtifact(db: DurableDb, params: {
  tenant: string;
  inbox_id: string;
  artifact_key: string;
  owner: string;
  leaseTtlMs: number;
}): Promise<InboundClaimResult<InboundArtifactRecord>> {
  const lease = makeLeaseFields(params.owner, params.leaseTtlMs);
  const updated = await tenantDb(db, params.tenant).table('inbound_email_artifacts')
    .where({ tenant: params.tenant, inbox_id: params.inbox_id, artifact_key: params.artifact_key, status: 'processing' })
    .andWhere('lease_expires_at', '<=', db.fn.now())
    .update({
      lease_owner: lease.lease_owner,
      lease_token: lease.lease_token,
      lease_version: db.raw('lease_version + 1'),
      lease_expires_at: lease.lease_expires_at,
      next_attempt_at: null,
      updated_at: db.fn.now(),
    })
    .returning('*');
  if (updated.length > 0) return { claimed: true, row: updated[0] };

  const current = await getArtifact(db, params.tenant, params.inbox_id, params.artifact_key);
  if (!current) return { claimed: false, reason: 'missing' };
  if (['succeeded', 'skipped', 'terminal_failed'].includes(current.status)) {
    return { claimed: false, reason: 'terminal' };
  }
  return { claimed: false, reason: 'already_claimed' };
}

export async function transitionArtifact(db: DurableDb, params: {
  tenant: string;
  inbox_id: string;
  artifact_key: string;
  owner: string;
  token: string;
  version: number;
  status: 'succeeded' | 'skipped' | 'retryable_failed' | 'terminal_failed';
  file_id?: string | null;
  document_id?: string | null;
  storage_key?: string | null;
  nextAttemptAt?: Date | null;
  error?: string | null;
}): Promise<boolean> {
  const patch: Record<string, unknown> = {
    status: params.status,
    updated_at: db.fn.now(),
  };
  if (params.file_id !== undefined) patch.file_id = params.file_id;
  if (params.document_id !== undefined) patch.document_id = params.document_id;
  if (params.storage_key !== undefined) patch.storage_key = params.storage_key;
  if (['succeeded', 'skipped', 'terminal_failed'].includes(params.status)) {
    patch.completed_at = db.fn.now();
    patch.lease_owner = null;
    patch.lease_token = null;
    patch.lease_expires_at = null;
    patch.next_attempt_at = null;
  }
  if (params.status === 'retryable_failed') {
    patch.next_attempt_at = params.nextAttemptAt ?? db.fn.now();
  }
  if (params.error !== undefined) patch.last_error = params.error;

  const updated = await tenantDb(db, params.tenant).table('inbound_email_artifacts')
    .where({
      tenant: params.tenant,
      inbox_id: params.inbox_id,
      artifact_key: params.artifact_key,
      status: 'processing',
      lease_owner: params.owner,
      lease_token: params.token,
      lease_version: params.version,
    })
    .update(patch);
  return updated > 0;
}

// ---------------------------------------------------------------------------
// Outbox
// ---------------------------------------------------------------------------

export interface InboundOutboxInsert {
  tenant: string;
  inbox_id: string;
  outbox_id?: string;
  event_key: string;
  event_type: string;
  payload: Record<string, unknown>;
  publish_options?: Record<string, unknown> | null;
}

export interface InboundOutboxRecord {
  tenant: string;
  outbox_id: string;
  inbox_id: string;
  event_key: string;
  event_type: string;
  payload: Record<string, unknown>;
  publish_options: Record<string, unknown> | null;
  status: string;
  attempt_count: number;
  lease_owner: string | null;
  lease_token: string | null;
  lease_version: number;
  lease_expires_at: Date | string | null;
  next_attempt_at: Date | string | null;
  published_at: Date | string | null;
  last_error: string | null;
  created_at: Date | string;
}

/**
 * Insert an outbox row inside the core transaction. `(tenant, inbox_id,
 * event_key)` is unique so replay cannot create another logical notification;
 * a duplicate key is ignored.
 */
export async function insertOutboxRow(db: DurableDb, input: InboundOutboxInsert): Promise<{ inserted: boolean }> {
  const inserted = await tenantDb(db, input.tenant).table('inbound_email_outbox')
    .insert({
      tenant: input.tenant,
      inbox_id: input.inbox_id,
      outbox_id: input.outbox_id ?? db.raw('gen_random_uuid()'),
      event_key: input.event_key,
      event_type: input.event_type,
      payload: JSON.stringify(input.payload),
      publish_options: input.publish_options ? JSON.stringify(input.publish_options) : null,
      status: 'pending',
      attempt_count: 0,
      lease_version: 0,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .onConflict(['tenant', 'inbox_id', 'event_key'])
    .ignore()
    .returning('outbox_id');
  return { inserted: Array.isArray(inserted) && inserted.length > 0 };
}

export async function getOutboxRowsForInbox(db: DurableDb, tenant: string, inboxId: string): Promise<InboundOutboxRecord[]> {
  return (await tenantDb(db, tenant).table('inbound_email_outbox')
    .where({ tenant, inbox_id: inboxId })
    .orderBy('event_key', 'asc')) as InboundOutboxRecord[];
}

export async function getOutboxRow(db: DurableDb, tenant: string, outboxId: string): Promise<InboundOutboxRecord | null> {
  const row = await tenantDb(db, tenant).table('inbound_email_outbox')
    .where({ tenant, outbox_id: outboxId })
    .first();
  return (row as InboundOutboxRecord) ?? null;
}

export async function claimOutboxRow(db: DurableDb, params: {
  tenant: string;
  outbox_id: string;
  owner: string;
  leaseTtlMs: number;
}): Promise<InboundClaimResult<InboundOutboxRecord>> {
  const lease = makeLeaseFields(params.owner, params.leaseTtlMs);
  const maxAttempts = getDurableMaxAttempts();
  const now = new Date();
  const patch = {
    status: 'publishing',
    attempt_count: db.raw('attempt_count + 1'),
    lease_owner: lease.lease_owner,
    lease_token: lease.lease_token,
    lease_version: db.raw('lease_version + 1'),
    lease_expires_at: lease.lease_expires_at,
    next_attempt_at: null,
    updated_at: db.fn.now(),
  };
  const updated = await tenantDb(db, params.tenant).table('inbound_email_outbox')
    .where({ tenant: params.tenant, outbox_id: params.outbox_id, status: 'pending' })
    .update(patch)
    .returning('*');
  if (updated.length > 0) return { claimed: true, row: updated[0] };
  const retryable = await tenantDb(db, params.tenant).table('inbound_email_outbox')
    .where({ tenant: params.tenant, outbox_id: params.outbox_id, status: 'retryable_failed' })
    .andWhere('attempt_count', '<', maxAttempts)
    .andWhere((qb: any) => qb.whereNull('next_attempt_at').orWhere('next_attempt_at', '<=', db.fn.now()))
    .update(patch)
    .returning('*');
  if (retryable.length > 0) return { claimed: true, row: retryable[0] };
  const current = await tenantDb(db, params.tenant).table('inbound_email_outbox')
    .where({ tenant: params.tenant, outbox_id: params.outbox_id })
    .first();
  if (!current) return { claimed: false, reason: 'missing' };
  if (['published', 'terminal_failed'].includes(current.status)) {
    return { claimed: false, reason: 'terminal' };
  }
  if (current.status === 'retryable_failed') {
    if (isDue(current.next_attempt_at, now) && current.attempt_count >= maxAttempts) {
      await deadletterOutboxRow(db, current as InboundOutboxRecord);
      return { claimed: false, reason: 'terminal' };
    }
    return { claimed: false, reason: 'not_due' };
  }
  return { claimed: false, reason: 'already_claimed' };
}

/** Dead-letter an over-cap due retryable outbox row into `terminal_failed`. */
export async function deadletterOutboxRow(db: DurableDb, row: InboundOutboxRecord): Promise<boolean> {
  const updated = await tenantDb(db, row.tenant).table('inbound_email_outbox')
    .where({ tenant: row.tenant, outbox_id: row.outbox_id, status: 'retryable_failed' })
    .update({
      status: 'terminal_failed',
      lease_owner: null,
      lease_token: null,
      lease_expires_at: null,
      next_attempt_at: null,
      last_error: row.last_error ?? 'max_attempts_exhausted',
      updated_at: db.fn.now(),
    });
  return updated > 0;
}

/**
 * Atomically reclaim a `publishing` outbox row whose lease has expired.
 * `publishing -> publishing` installs a new token/version (fencing the crashed
 * dispatcher out) without incrementing the attempt count, mirroring
 * reclaimInbox. A crash after the outbox claim but before the `published`
 * transition must be recoverable by the sweeper, never stranded.
 */
export async function reclaimOutboxRow(db: DurableDb, params: {
  tenant: string;
  outbox_id: string;
  owner: string;
  leaseTtlMs: number;
}): Promise<InboundClaimResult<InboundOutboxRecord>> {
  const lease = makeLeaseFields(params.owner, params.leaseTtlMs);
  const updated = await tenantDb(db, params.tenant).table('inbound_email_outbox')
    .where({ tenant: params.tenant, outbox_id: params.outbox_id, status: 'publishing' })
    .andWhere('lease_expires_at', '<=', db.fn.now())
    .update({
      lease_owner: lease.lease_owner,
      lease_token: lease.lease_token,
      lease_version: db.raw('lease_version + 1'),
      lease_expires_at: lease.lease_expires_at,
      next_attempt_at: null,
      updated_at: db.fn.now(),
    })
    .returning('*');
  if (updated.length > 0) return { claimed: true, row: updated[0] };

  const current = await getOutboxRow(db, params.tenant, params.outbox_id);
  if (!current) return { claimed: false, reason: 'missing' };
  if (['published', 'terminal_failed'].includes(current.status)) {
    return { claimed: false, reason: 'terminal' };
  }
  return { claimed: false, reason: 'already_claimed' };
}

export async function transitionOutboxRow(db: DurableDb, params: {
  tenant: string;
  outbox_id: string;
  owner: string;
  token: string;
  version: number;
  status: 'published' | 'retryable_failed' | 'terminal_failed';
  nextAttemptAt?: Date | null;
  error?: string | null;
}): Promise<boolean> {
  const patch: Record<string, unknown> = {
    status: params.status,
    updated_at: db.fn.now(),
  };
  if (params.status === 'published') {
    patch.published_at = db.fn.now();
    patch.lease_owner = null;
    patch.lease_token = null;
    patch.lease_expires_at = null;
    patch.next_attempt_at = null;
  }
  if (params.status === 'terminal_failed') {
    patch.lease_owner = null;
    patch.lease_token = null;
    patch.lease_expires_at = null;
    patch.next_attempt_at = null;
  }
  if (params.status === 'retryable_failed') {
    patch.next_attempt_at = params.nextAttemptAt ?? db.fn.now();
  }
  if (params.error !== undefined) patch.last_error = params.error;

  const updated = await tenantDb(db, params.tenant).table('inbound_email_outbox')
    .where({
      tenant: params.tenant,
      outbox_id: params.outbox_id,
      status: 'publishing',
      lease_owner: params.owner,
      lease_token: params.token,
      lease_version: params.version,
    })
    .update(patch);
  return updated > 0;
}

// ---------------------------------------------------------------------------
// Consumer delivery ledger — recoverable reservation state machine
// ---------------------------------------------------------------------------
//
// A delivery row is a RESERVATION, not a terminal claim. Statuses:
//   - `delivering`: a worker reserved the (tenant, outbox event, consumer)
//     effect and holds a fencing lease (`lease_owner/token/version`). A crash
//     between reservation and effect leaves an expired lease that the sweeper
//     or a redelivery reclaims — nothing is permanently lost.
//   - `delivered`: the effect completed (transactional consumers mark this in
//     the SAME Postgres transaction as the effect; lease/fenced consumers mark
//     it after the effect with a fencing predicate). Terminal.
//   - `retryable_failed`: the effect threw; backoff via `next_attempt_at`.
//     Reclaimed when due and under `getDurableMaxAttempts()`.
//   - `terminal_failed`: dead-lettered after exhausting attempts. Terminal.
//
// Every key is tenant-first for Citus distribution. The PK
// `(tenant, outbox_id, consumer)` is the database-enforced dedupe.

export interface InboundEventDeliveryRecord {
  tenant: string;
  outbox_id: string;
  consumer: string;
  status: string;
  attempt_count: number;
  lease_owner: string | null;
  lease_token: string | null;
  lease_version: number;
  lease_expires_at: Date | string | null;
  next_attempt_at: Date | string | null;
  last_error: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  completed_at: Date | string | null;
}

export type InboundEventDeliveryClaimResult =
  | { claimed: true; row: InboundEventDeliveryRecord }
  | { claimed: false; reason: 'already_delivered' | 'in_progress' | 'not_due' | 'terminal' | 'missing' };

function isLeaseActive(expiresAt: Date | string | null, now: Date): boolean {
  if (!expiresAt) return false;
  const at = new Date(expiresAt).getTime();
  return Number.isFinite(at) && at > now.getTime();
}

/**
 * Reserve a consumer delivery. First touch inserts a `delivering` row; a
 * duplicate PK is refused unless the existing reservation is reclaimable
 * (expired `delivering` lease, or due under-cap `retryable_failed`).
 *
 * Reclaims install a fresh token/version (fencing the crashed worker out) and,
 * for retryable retries, increment `attempt_count`; crash reclaims do NOT
 * increment, mirroring reclaimInbox/reclaimOutboxRow. Over-cap due retryable
 * rows dead-letter to `terminal_failed`.
 */
export async function reserveInboundOutboxEventDelivery(db: DurableDb, params: {
  tenant: string;
  outbox_id: string;
  consumer: string;
  owner: string;
  leaseTtlMs: number;
}): Promise<InboundEventDeliveryClaimResult> {
  const lease = makeLeaseFields(params.owner, params.leaseTtlMs);
  const maxAttempts = getDurableMaxAttempts();
  const now = new Date();

  const inserted = await tenantDb(db, params.tenant).table('inbound_email_event_deliveries')
    .insert({
      tenant: params.tenant,
      outbox_id: params.outbox_id,
      consumer: params.consumer,
      status: 'delivering',
      attempt_count: 0,
      lease_owner: lease.lease_owner,
      lease_token: lease.lease_token,
      lease_version: 0,
      lease_expires_at: lease.lease_expires_at,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .onConflict(['tenant', 'outbox_id', 'consumer'])
    .ignore()
    .returning('*');
  if (Array.isArray(inserted) && inserted.length > 0) {
    return { claimed: true, row: inserted[0] as InboundEventDeliveryRecord };
  }

  const current = (await tenantDb(db, params.tenant).table('inbound_email_event_deliveries')
    .where({ tenant: params.tenant, outbox_id: params.outbox_id, consumer: params.consumer })
    .first()) as InboundEventDeliveryRecord | undefined;
  if (!current) return { claimed: false, reason: 'missing' };

  if (current.status === 'delivered') return { claimed: false, reason: 'already_delivered' };
  if (current.status === 'terminal_failed') return { claimed: false, reason: 'terminal' };

  if (current.status === 'delivering') {
    if (isLeaseActive(current.lease_expires_at, now)) return { claimed: false, reason: 'in_progress' };
    const reclaimed = await tenantDb(db, params.tenant).table('inbound_email_event_deliveries')
      .where({ tenant: params.tenant, outbox_id: params.outbox_id, consumer: params.consumer, status: 'delivering' })
      .andWhere('lease_expires_at', '<=', db.fn.now())
      .update({
        lease_owner: lease.lease_owner,
        lease_token: lease.lease_token,
        lease_version: db.raw('lease_version + 1'),
        lease_expires_at: lease.lease_expires_at,
        next_attempt_at: null,
        updated_at: db.fn.now(),
      })
      .returning('*');
    if (reclaimed.length > 0) return { claimed: true, row: reclaimed[0] as InboundEventDeliveryRecord };
    return { claimed: false, reason: 'in_progress' };
  }

  // retryable_failed
  if (current.attempt_count >= maxAttempts) {
    await deadletterInboundEventDelivery(db, current);
    return { claimed: false, reason: 'terminal' };
  }
  if (!isDue(current.next_attempt_at, now)) return { claimed: false, reason: 'not_due' };
  const reclaimed = await tenantDb(db, params.tenant).table('inbound_email_event_deliveries')
    .where({ tenant: params.tenant, outbox_id: params.outbox_id, consumer: params.consumer, status: 'retryable_failed' })
    .andWhere('attempt_count', '<', maxAttempts)
    .andWhere((qb: any) => qb.whereNull('next_attempt_at').orWhere('next_attempt_at', '<=', db.fn.now()))
    .update({
      status: 'delivering',
      attempt_count: db.raw('attempt_count + 1'),
      lease_owner: lease.lease_owner,
      lease_token: lease.lease_token,
      lease_version: db.raw('lease_version + 1'),
      lease_expires_at: lease.lease_expires_at,
      next_attempt_at: null,
      last_error: null,
      updated_at: db.fn.now(),
    })
    .returning('*');
  if (reclaimed.length > 0) return { claimed: true, row: reclaimed[0] as InboundEventDeliveryRecord };
  return { claimed: false, reason: 'in_progress' };
}

/**
 * Mark a reservation `delivered` with a fencing predicate. Returns false when
 * the token/version no longer match (stale worker, superseded claim) or the row
 * is no longer `delivering` — a stale worker must never write completion.
 */
export async function completeInboundOutboxEventDelivery(db: DurableDb, params: {
  tenant: string;
  outbox_id: string;
  consumer: string;
  owner: string;
  token: string;
  version: number;
}): Promise<boolean> {
  const updated = await tenantDb(db, params.tenant).table('inbound_email_event_deliveries')
    .where({
      tenant: params.tenant,
      outbox_id: params.outbox_id,
      consumer: params.consumer,
      status: 'delivering',
      lease_owner: params.owner,
      lease_token: params.token,
      lease_version: params.version,
    })
    .update({
      status: 'delivered',
      lease_owner: null,
      lease_token: null,
      lease_expires_at: null,
      next_attempt_at: null,
      completed_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
  return updated > 0;
}

export type InboundEventDeliveryFailureMark = 'retryable' | 'terminal' | 'noop';

/**
 * Record a fenced failure for a `delivering` reservation. Increments
 * `attempt_count`; when the attempt cap is reached the row dead-letters to
 * `terminal_failed` (a poisoned effect stops looping). A `noop` result means
 * the fencing predicate matched nothing (stale worker — the current owner is
 * someone else), so nothing is recorded.
 */
export async function failInboundOutboxEventDelivery(db: DurableDb, params: {
  tenant: string;
  outbox_id: string;
  consumer: string;
  owner: string;
  token: string;
  version: number;
  error: string;
}): Promise<InboundEventDeliveryFailureMark> {
  const maxAttempts = getDurableMaxAttempts();
  const backoffMs = boundedBackoffMsForDelivery(
    await getDeliveryAttemptCount(db, params.tenant, params.outbox_id, params.consumer)
  );
  const updated = await tenantDb(db, params.tenant).table('inbound_email_event_deliveries')
    .where({
      tenant: params.tenant,
      outbox_id: params.outbox_id,
      consumer: params.consumer,
      status: 'delivering',
      lease_owner: params.owner,
      lease_token: params.token,
      lease_version: params.version,
    })
    .update({
      status: db.raw('CASE WHEN attempt_count + 1 >= ? THEN ? ELSE ? END', [maxAttempts, 'terminal_failed', 'retryable_failed']),
      attempt_count: db.raw('attempt_count + 1'),
      lease_owner: null,
      lease_token: null,
      lease_expires_at: null,
      next_attempt_at: db.raw('CASE WHEN attempt_count + 1 >= ? THEN NULL ELSE now() + (? || \' milliseconds\')::interval END', [maxAttempts, backoffMs]),
      last_error: params.error,
      completed_at: db.raw('CASE WHEN attempt_count + 1 >= ? THEN now() ELSE NULL END', [maxAttempts]),
      updated_at: db.fn.now(),
    });
  if (updated === 0) return 'noop';
  const row = (await tenantDb(db, params.tenant).table('inbound_email_event_deliveries')
    .where({ tenant: params.tenant, outbox_id: params.outbox_id, consumer: params.consumer })
    .first()) as InboundEventDeliveryRecord | undefined;
  return row?.status === 'terminal_failed' ? 'terminal' : 'retryable';
}

async function getDeliveryAttemptCount(db: DurableDb, tenant: string, outboxId: string, consumer: string): Promise<number> {
  const row = (await tenantDb(db, tenant).table('inbound_email_event_deliveries')
    .where({ tenant, outbox_id: outboxId, consumer })
    .first('attempt_count')) as { attempt_count?: number } | undefined;
  return Number(row?.attempt_count ?? 0);
}

function boundedBackoffMsForDelivery(attemptCount: number): number {
  const base = 2 ** Math.min(attemptCount, 6) * 1000;
  const jitter = Math.floor(Math.random() * 1000);
  return Math.min(base + jitter, 5 * 60 * 1000);
}

/**
 * Record a failure without a fencing predicate. Used by the transactional
 * (internal-notification) protocol after its reservation was rolled back with
 * the effect — there is no committed row to fence, so this upserts a
 * `retryable_failed` row. It never downgrades a `delivered` row and never
 * touches a reservation held by a live worker.
 */
export async function recordInboundOutboxEventDeliveryFailure(db: DurableDb, params: {
  tenant: string;
  outbox_id: string;
  consumer: string;
  error: string;
}): Promise<InboundEventDeliveryFailureMark> {
  const maxAttempts = getDurableMaxAttempts();
  const backoffMs = boundedBackoffMsForDelivery(1);
  const now = db.fn.now();

  const inserted = await tenantDb(db, params.tenant).table('inbound_email_event_deliveries')
    .insert({
      tenant: params.tenant,
      outbox_id: params.outbox_id,
      consumer: params.consumer,
      status: maxAttempts > 1 ? 'retryable_failed' : 'terminal_failed',
      attempt_count: 1,
      lease_owner: null,
      lease_token: null,
      lease_expires_at: null,
      next_attempt_at: maxAttempts > 1 ? db.raw("now() + (? || ' milliseconds')::interval", [backoffMs]) : null,
      last_error: params.error,
      created_at: now,
      updated_at: now,
      completed_at: maxAttempts > 1 ? null : now,
    })
    .onConflict(['tenant', 'outbox_id', 'consumer'])
    .ignore()
    .returning('*');

  if (Array.isArray(inserted) && inserted.length > 0) {
    return maxAttempts > 1 ? 'retryable' : 'terminal';
  }

  const updated = await tenantDb(db, params.tenant).table('inbound_email_event_deliveries')
    .where({ tenant: params.tenant, outbox_id: params.outbox_id, consumer: params.consumer })
    .whereIn('status', ['retryable_failed', 'delivering'])
    .update({
      status: db.raw('CASE WHEN attempt_count + 1 >= ? THEN ? ELSE ? END', [maxAttempts, 'terminal_failed', 'retryable_failed']),
      attempt_count: db.raw('attempt_count + 1'),
      lease_owner: null,
      lease_token: null,
      lease_expires_at: null,
      next_attempt_at: db.raw('CASE WHEN attempt_count + 1 >= ? THEN NULL ELSE now() + (? || \' milliseconds\')::interval END', [maxAttempts, backoffMs]),
      last_error: params.error,
      completed_at: db.raw('CASE WHEN attempt_count + 1 >= ? THEN now() ELSE NULL END', [maxAttempts]),
      updated_at: now,
    });
  if (updated === 0) return 'noop';
  const row = (await tenantDb(db, params.tenant).table('inbound_email_event_deliveries')
    .where({ tenant: params.tenant, outbox_id: params.outbox_id, consumer: params.consumer })
    .first()) as InboundEventDeliveryRecord | undefined;
  return row?.status === 'terminal_failed' ? 'terminal' : 'retryable';
}

/** Dead-letter an over-cap due retryable delivery row into `terminal_failed`. */
export async function deadletterInboundEventDelivery(db: DurableDb, row: InboundEventDeliveryRecord): Promise<boolean> {
  const updated = await tenantDb(db, row.tenant).table('inbound_email_event_deliveries')
    .where({ tenant: row.tenant, outbox_id: row.outbox_id, consumer: row.consumer, status: 'retryable_failed' })
    .update({
      status: 'terminal_failed',
      lease_owner: null,
      lease_token: null,
      lease_expires_at: null,
      next_attempt_at: null,
      completed_at: db.fn.now(),
      last_error: row.last_error ?? 'max_attempts_exhausted',
      updated_at: db.fn.now(),
    });
  return updated > 0;
}

export async function getInboundEventDelivery(db: DurableDb, params: {
  tenant: string;
  outbox_id: string;
  consumer: string;
}): Promise<InboundEventDeliveryRecord | null> {
  const row = (await tenantDb(db, params.tenant).table('inbound_email_event_deliveries')
    .where({ tenant: params.tenant, outbox_id: params.outbox_id, consumer: params.consumer })
    .first()) as InboundEventDeliveryRecord | undefined;
  return row ?? null;
}

/**
 * Rows that need recovery action, most-recently-updated first:
 *   - `delivering` reservations whose lease expired (crash after reserve)
 *   - `retryable_failed` rows that are due for another attempt
 * The sweeper dead-letters over-cap rows and re-publishes the outbox event once
 * per distinct outbox_id (a single re-publish re-drives every incomplete
 * consumer through the per-consumer gate).
 */
export async function findRecoverableInboundEventDeliveries(db: DurableDb, options: DueScanOptions): Promise<InboundEventDeliveryRecord[]> {
  const limit = Math.max(1, options.limit ?? 20);
  const now = options.now ?? new Date();
  const rows = (await tenantDb(db, options.tenant).table('inbound_email_event_deliveries')
    .where({ tenant: options.tenant })
    .andWhere(function (this: any) {
      this.where((expired: any) => {
        expired.where({ status: 'delivering' })
          .where('lease_expires_at', '<=', now.toISOString());
      })
        .orWhere((due: any) => {
          due.where({ status: 'retryable_failed' })
            .where((next: any) => {
              next.whereNull('next_attempt_at').orWhere('next_attempt_at', '<=', now.toISOString());
            });
        });
    })
    .orderBy('updated_at', 'asc')
    .limit(limit)) as InboundEventDeliveryRecord[];
  return rows;
}

/**
 * True when an event id corresponds to a durable inbound outbox row (i.e. the
 * event was published by the inbound outbox dispatcher). Used by consumers to
 * decide whether the DB delivery ledger applies to an event.
 */
export async function isInboundOutboxEvent(db: DurableDb, params: {
  tenant: string;
  eventId: string;
}): Promise<boolean> {
  const row = await tenantDb(db, params.tenant).table('inbound_email_outbox')
    .where({ tenant: params.tenant, outbox_id: params.eventId })
    .first('outbox_id');
  return Boolean(row);
}

// ---------------------------------------------------------------------------
// Bounded due-row scans (per-tenant)
// ---------------------------------------------------------------------------

export interface DueScanOptions {
  tenant: string;
  limit?: number;
  now?: Date;
  /**
   * Provider ids to exclude from the row-selection predicate ITSELF, before
   * the cap is applied. Used by the recovery sweep for ingestion-paused
   * providers' ingress rows: a paused provider's due rows must never occupy
   * slots inside the cap window, or they would starve unpaused providers'
   * due work. Only ingress staging requires live credentials, so only
   * findDueIngress consumes this.
   */
  excludeProviderIds?: string[];
}

export async function findDueIngress(db: DurableDb, options: DueScanOptions): Promise<InboundIngressRecord[]> {
  const limit = Math.max(1, options.limit ?? 20);
  const now = options.now ?? new Date();
  const query = tenantDb(db, options.tenant).table('inbound_email_ingress')
    .where({ tenant: options.tenant });
  // The paused-provider filter is part of the selection predicate so the cap
  // only ever applies to eligible (unpaused) work.
  if (options.excludeProviderIds && options.excludeProviderIds.length > 0) {
    query.whereNotIn('provider_id', options.excludeProviderIds);
  }
  const rows = await query
    .andWhere(function (this: any) {
      this.where({ status: 'received' })
        .orWhere((inner: any) => {
          inner.where({ status: 'retryable_failed' })
            .where(function (due: any) {
              due.whereNull('next_attempt_at').orWhere('next_attempt_at', '<=', now.toISOString());
            });
        })
        .orWhere((expired: any) => {
          // Crash between ingress claim (status `staging`) and transition: the
          // lease expired and the row must be reclaimed, not stranded.
          expired.where({ status: 'staging' })
            .where('lease_expires_at', '<=', now.toISOString());
        });
    })
    .orderBy('received_at', 'asc')
    .limit(limit);
  return rows as InboundIngressRecord[];
}

export async function findDueInbox(db: DurableDb, options: DueScanOptions): Promise<InboundEmailInboxRecord[]> {
  const limit = Math.max(1, options.limit ?? 20);
  const now = options.now ?? new Date();
  const rows = await tenantDb(db, options.tenant).table('inbound_email_inbox')
    .where({ tenant: options.tenant })
    .andWhere(function (this: any) {
      this.where({ status: 'received' })
        .orWhere((inner: any) => {
          inner.where({ status: 'retryable_failed' })
            .where(function (due: any) {
              due.whereNull('next_attempt_at').orWhere('next_attempt_at', '<=', now.toISOString());
            });
        })
        .orWhere((expired: any) => {
          expired.where({ status: 'processing' })
            .where('lease_expires_at', '<=', now.toISOString());
        });
    })
    .orderBy('received_at', 'asc')
    .limit(limit);
  return rows as InboundEmailInboxRecord[];
}

export async function findDueArtifacts(db: DurableDb, options: DueScanOptions): Promise<InboundArtifactRecord[]> {
  const limit = Math.max(1, options.limit ?? 20);
  const now = options.now ?? new Date();
  const rows = await tenantDb(db, options.tenant).table('inbound_email_artifacts')
    .where({ tenant: options.tenant })
    .andWhere(function (this: any) {
      this.where({ status: 'pending' })
        .orWhere((inner: any) => {
          inner.where({ status: 'retryable_failed' })
            .where(function (due: any) {
              due.whereNull('next_attempt_at').orWhere('next_attempt_at', '<=', now.toISOString());
            });
        })
        .orWhere((expired: any) => {
          expired.where({ status: 'processing' })
            .where('lease_expires_at', '<=', now.toISOString());
        });
    })
    .orderBy('created_at', 'asc')
    .limit(limit);
  return rows as InboundArtifactRecord[];
}

export async function findDueOutbox(db: DurableDb, options: DueScanOptions): Promise<InboundOutboxRecord[]> {
  const limit = Math.max(1, options.limit ?? 20);
  const now = options.now ?? new Date();
  const rows = await tenantDb(db, options.tenant).table('inbound_email_outbox')
    .where({ tenant: options.tenant })
    .andWhere(function (this: any) {
      this.where({ status: 'pending' })
        .orWhere((inner: any) => {
          inner.where({ status: 'retryable_failed' })
            .where(function (due: any) {
              due.whereNull('next_attempt_at').orWhere('next_attempt_at', '<=', now.toISOString());
            });
        })
        .orWhere((expired: any) => {
          expired.where({ status: 'publishing' })
            .where('lease_expires_at', '<=', now.toISOString());
        });
    })
    .orderBy('created_at', 'asc')
    .limit(limit);
  return rows as InboundOutboxRecord[];
}
