/**
 * One-off, re-runnable backfill of on-wire Message-IDs for `provider_type = 'resend'` log rows that
 * were written before the send path / `email.sent` webhook recorded them (alga0002306).
 *
 * - Tenant-scoped: every query names the tenant; rows of other tenants are never read or written.
 * - Per-id `GET /emails/:id` retrieve (exact; `GET /emails` list only reaches recent mail and cannot be
 *   targeted at a row). 404 / null `message_id` => the row is left as it is.
 * - Rate-limit aware: requests are spaced, and HTTP 429 backs off (Retry-After, else exponential).
 * - Stop/resume: rows already holding an on-wire id are excluded by the candidate query, so simply
 *   re-running resumes; `afterId` additionally skips rows an earlier run already passed over.
 * - Every write goes through `reconcileOnWireMessageId` (idempotent, first on-wire id wins), so a
 *   second run changes nothing.
 *
 * Operator entry point: server/scripts/backfill-resend-on-wire-message-ids.ts
 */

import axios from 'axios';
import logger from '@alga-psa/core/logger';
import { tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';
import { reconcileOnWireMessageId, type ReconcileOnWireMessageIdStatus } from './reconcileOnWireMessageId';

export type ResendRetrieveResult =
  | { kind: 'found'; messageId: string | null }
  | { kind: 'not_found' }
  | { kind: 'rate_limited'; retryAfterMs?: number }
  | { kind: 'error'; message: string };

export type ResendRetrieve = (emailId: string) => Promise<ResendRetrieveResult>;

export function createResendRetrieve(apiKey: string, baseUrl = 'https://api.resend.com'): ResendRetrieve {
  const client = axios.create({
    baseURL: baseUrl,
    headers: { Authorization: `Bearer ${apiKey}` },
    timeout: 30000,
    validateStatus: () => true,
  });
  return async (emailId) => {
    try {
      const res = await client.get<{ message_id?: string | null }>(`/emails/${encodeURIComponent(emailId)}`);
      if (res.status === 404) return { kind: 'not_found' };
      if (res.status === 429) {
        const header = Number(res.headers?.['retry-after']);
        return { kind: 'rate_limited', retryAfterMs: Number.isFinite(header) && header > 0 ? header * 1000 : undefined };
      }
      if (res.status >= 200 && res.status < 300) {
        const id = res.data?.message_id;
        return { kind: 'found', messageId: typeof id === 'string' && id.trim() ? id : null };
      }
      return { kind: 'error', message: `HTTP ${res.status}` };
    } catch (error) {
      return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
    }
  };
}

export interface BackfillOptions {
  tenant: string;
  retrieve: ResendRetrieve;
  dryRun?: boolean;
  /** Rows per candidate page. */
  batchSize?: number;
  /** Resume cursor: only rows with id greater than this are considered. */
  afterId?: string | number | null;
  /** Stop after this many candidate rows (useful for a first, small run). */
  limit?: number;
  /** Minimum spacing between Resend requests. Resend's default limit is a few requests per second. */
  minIntervalMs?: number;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (line: string) => void;
}

export interface BackfillSummary {
  candidates: number;
  recorded: number;
  wouldRecord: number;
  unchanged: number;
  conflicts: number;
  notReturnedByResend: number;
  noMessageIdYet: number;
  errors: number;
  /** Highest row id examined; pass as `afterId` to continue a stopped run. */
  lastId: string | number | null;
}

export async function backfillResendOnWireMessageIds(
  knex: Knex,
  options: BackfillOptions
): Promise<BackfillSummary> {
  const tenant = options.tenant?.trim();
  if (!tenant) throw new Error('backfill requires a tenant');

  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const minInterval = options.minIntervalMs ?? 250;
  const maxRetries = options.maxRetries ?? 6;
  const batchSize = options.batchSize ?? 100;
  const say = options.onProgress ?? (() => undefined);
  const summary: BackfillSummary = {
    candidates: 0,
    recorded: 0,
    wouldRecord: 0,
    unchanged: 0,
    conflicts: 0,
    notReturnedByResend: 0,
    noMessageIdYet: 0,
    errors: 0,
    lastId: options.afterId ?? null,
  };

  const retrieveWithBackoff = async (emailId: string): Promise<ResendRetrieveResult> => {
    for (let attempt = 0; ; attempt++) {
      await sleep(minInterval);
      const result = await options.retrieve(emailId);
      if (result.kind !== 'rate_limited') return result;
      if (attempt >= maxRetries) return { kind: 'error', message: 'rate limited; retries exhausted' };
      const delay = result.retryAfterMs ?? Math.min(1000 * 2 ** attempt, 60000);
      say(`rate limited; backing off ${delay}ms`);
      await sleep(delay);
    }
  };

  let cursor: string | number | null = options.afterId ?? null;
  for (;;) {
    const remaining = options.limit != null ? options.limit - summary.candidates : batchSize;
    if (remaining <= 0) break;

    let query = tenantDb(knex, tenant)
      .table('email_sending_logs')
      .where({ provider_type: 'resend', status: 'sent' })
      .whereNotNull('provider_message_id')
      // Skip rows that already carry a recorded on-wire id (see hasRecordedOnWireId).
      .whereRaw(
        "COALESCE(metadata->>'onWireMessageId', '') = '' AND COALESCE(metadata->>'generatedRfcMessageId', '') = '' AND COALESCE(metadata->>'sesMessageId', '') = ''"
      );
    if (cursor !== null) query = query.where('id', '>', cursor);
    const rows: Array<{ id: string | number; provider_message_id: string }> = await query
      .orderBy('id', 'asc')
      .limit(Math.min(batchSize, remaining))
      .select('id', 'provider_message_id');
    if (rows.length === 0) break;

    for (const row of rows) {
      summary.candidates += 1;
      cursor = row.id;
      summary.lastId = row.id;

      const fetched = await retrieveWithBackoff(row.provider_message_id);
      if (fetched.kind === 'not_found') {
        summary.notReturnedByResend += 1;
        continue;
      }
      if (fetched.kind === 'error') {
        summary.errors += 1;
        logger.warn('[backfillResendOnWireMessageIds] retrieve failed', { tenant, logId: row.id, error: fetched.message });
        continue;
      }
      if (fetched.kind !== 'found' || !fetched.messageId) {
        summary.noMessageIdYet += 1;
        continue;
      }
      if (options.dryRun) {
        summary.wouldRecord += 1;
        continue;
      }
      const outcome = await reconcileOnWireMessageId(knex, {
        tenant,
        providerMessageId: row.provider_message_id,
        onWireMessageId: fetched.messageId,
      });
      const bucket: Record<ReconcileOnWireMessageIdStatus, () => void> = {
        recorded: () => (summary.recorded += 1),
        unchanged: () => (summary.unchanged += 1),
        conflict: () => (summary.conflicts += 1),
        not_found: () => (summary.errors += 1),
        invalid: () => (summary.errors += 1),
      };
      bucket[outcome.status]();
    }
    say(`processed=${summary.candidates} recorded=${summary.recorded} lastId=${String(summary.lastId)}`);
  }

  return summary;
}
