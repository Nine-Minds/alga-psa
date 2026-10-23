import { createTenantKnex, tenantDb, type TenantDb } from '@alga-psa/db';
import { enqueueImmediateJob } from '@alga-psa/core';
import { normalizeToE164, resolveTenantPhoneCountryCode } from '@alga-psa/telephony';
import type { CanonicalCallRecord } from '@alga-psa/telephony/types';
import { userForExtension } from './extensions';
import { createThreecxPbxClient, odataPageAll, type ThreecxPbxClient } from './pbx/client';
import {
  getThreecxProviderConfig,
  getThreecxProviderState,
  THREECX_PROVIDER,
  updateThreecxConfig,
  type ThreecxExtensionMapping,
  type ThreecxProviderState,
} from './providerState';
import { threecxDirection, threecxProviderCallId, type ThreecxCallType } from './reportCall';

export const THREECX_CANONICAL_CALL_JOB = 'process-telephony-canonical-call';
export const THREECX_CDR_PAGE_SIZE = 200;
/** Seconds either side of `started_at` inside which a same-agent, same-number row counts as the same call. */
export const THREECX_CDR_DUPLICATE_WINDOW_SECONDS = 60;
/** How far behind the last processed segment the watermark is left, to cover late-written segments. */
export const THREECX_CDR_WATERMARK_LAG_MS = 5 * 60 * 1000;

/** The subset of Pbx.CallHistoryView the backfill reads. */
export interface ThreecxCallHistorySegment {
  SegmentId?: number | string;
  SegmentType?: string | null;
  SegmentStartTime: string;
  SegmentEndTime?: string | null;
  /** ISO 8601 duration (PT1M35S); some builds emit HH:MM:SS. */
  CallTime?: string | null;
  CallAnswered?: boolean | null;
  SrcDn?: string | null;
  SrcCallerNumber?: string | null;
  SrcDisplayName?: string | null;
  SrcDnType?: string | null;
  SrcExternal?: boolean | null;
  SrcInternal?: boolean | null;
  DstDn?: string | null;
  DstCallerNumber?: string | null;
  DstDisplayName?: string | null;
  DstDnType?: string | null;
  DstExternal?: boolean | null;
  DstInternal?: boolean | null;
  [key: string]: unknown;
}

const ISO_DURATION = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i;
const CLOCK_DURATION = /^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/;

export function parseIsoDurationSeconds(value: string | null | undefined): number {
  if (typeof value !== 'string') return 0;
  const text = value.trim();
  const iso = ISO_DURATION.exec(text);
  if (iso) {
    const [, d, h, m, s] = iso;
    const total = Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0);
    return Number.isFinite(total) ? Math.round(total) : 0;
  }
  const clock = CLOCK_DURATION.exec(text);
  if (clock) {
    const total = Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
    return Number.isFinite(total) ? Math.round(total) : 0;
  }
  return 0;
}

function toIso(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export interface MapCallHistoryContext {
  extensions: ThreecxExtensionMapping[];
  usersById: Map<string, { email: string | null }>;
  defaultCountryCode: string | null;
}

/** Hash identity for an extension nobody has mapped, so its calls still dedupe against themselves. */
export function threecxUnmappedAgentEmail(dn: string): string {
  return `ext-${dn}@pbx.local`;
}

/**
 * Pure mapping from a call-log segment to the canonical record. Returns null
 * for segments with no external party (internal calls) or no usable start.
 */
export function mapCallHistorySegment(
  segment: ThreecxCallHistorySegment,
  ctx: MapCallHistoryContext,
): CanonicalCallRecord | null {
  const srcExternal = segment.SrcExternal === true;
  const dstExternal = segment.DstExternal === true;
  if (srcExternal === dstExternal) return null;

  const startedAt = toIso(segment.SegmentStartTime);
  if (!startedAt) return null;

  const inbound = srcExternal;
  const rawNumber = inbound
    ? str(segment.SrcCallerNumber) || str(segment.SrcDn)
    : str(segment.DstCallerNumber) || str(segment.DstDn);
  if (!rawNumber) return null;
  const dn = inbound ? str(segment.DstDn) : str(segment.SrcDn);

  const callType: ThreecxCallType = inbound ? (segment.CallAnswered === true ? 'Inbound' : 'Missed') : 'Outbound';
  const direction = threecxDirection(callType);

  const e164 = normalizeToE164(rawNumber, { defaultCountryCode: ctx.defaultCountryCode });
  const party = { raw: rawNumber, e164: e164 ?? null };

  const userId = userForExtension(ctx, dn);
  const mappedEmail = userId ? ctx.usersById.get(userId)?.email?.trim() : null;
  const agentEmail = mappedEmail || threecxUnmappedAgentEmail(dn);

  return {
    provider: THREECX_PROVIDER,
    providerCallId: threecxProviderCallId({
      agentEmail,
      numberForHash: e164 ?? rawNumber,
      callType,
      startTimeUtc: segment.SegmentStartTime,
    }),
    direction,
    callerNumber: inbound ? party : undefined,
    calleeNumber: inbound ? undefined : party,
    organizerUserId: userId ?? null,
    startedAt,
    endedAt: toIso(segment.SegmentEndTime),
    durationSeconds: direction === 'missed' ? 0 : parseIsoDurationSeconds(segment.CallTime),
    modality: 'audio',
    raw: { ...segment },
  };
}

function externalE164(record: CanonicalCallRecord): string | null {
  const party = record.direction === 'outbound' ? record.calleeNumber : record.callerNumber;
  return party?.e164 ?? null;
}

/**
 * True when the ledger already holds this call: same hash, or the same agent
 * talking to the same number within the duplicate window (the template's
 * ReportCall and the PBX log can disagree on the exact start).
 */
export async function isDuplicateThreecxCall(
  db: Pick<TenantDb, 'table'>,
  record: CanonicalCallRecord,
): Promise<boolean> {
  const byHash = await db
    .table('telephony_call_records')
    .where({ provider: THREECX_PROVIDER, provider_call_id: record.providerCallId })
    .first('call_record_id');
  if (byHash) return true;

  const e164 = externalE164(record);
  const startedMs = record.startedAt ? new Date(record.startedAt).getTime() : NaN;
  if (!record.organizerUserId || !e164 || Number.isNaN(startedMs)) return false;

  const windowMs = THREECX_CDR_DUPLICATE_WINDOW_SECONDS * 1000;
  const near = await db
    .table('telephony_call_records')
    .where({ provider: THREECX_PROVIDER, organizer_user_id: record.organizerUserId })
    .where((builder: any) =>
      builder.where('caller_number_e164', e164).orWhere('callee_number_e164', e164),
    )
    .whereBetween('started_at', [
      new Date(startedMs - windowMs).toISOString(),
      new Date(startedMs + windowMs).toISOString(),
    ])
    .first('call_record_id');
  return Boolean(near);
}

export interface ThreecxCdrBackfillResult {
  scanned: number;
  added: number;
  skipped: number;
  watermark: string | null;
}

export type ThreecxCdrEnqueue = (
  jobName: string,
  data: { tenantId: string; record: CanonicalCallRecord },
) => Promise<unknown>;

export interface BackfillThreecxCdrOptions {
  client?: ThreecxPbxClient;
  now?: Date;
  enqueue?: ThreecxCdrEnqueue;
}

/**
 * One scheduled pass over the PBX call log: page CallHistoryView from the
 * watermark (or the lookback window on the first run), map each external
 * segment, skip what the ledger already has, enqueue the rest, then advance
 * the watermark. Ingestion itself happens in the canonical-call job.
 */
export async function backfillThreecxCdr(
  tenantId: string,
  options: BackfillThreecxCdrOptions = {},
): Promise<ThreecxCdrBackfillResult> {
  const { knex } = await createTenantKnex(tenantId);
  const loaded = await getThreecxProviderConfig(tenantId, knex);
  const config = loaded?.config;
  const watermark = config?.cdr.watermark ?? null;
  const idle: ThreecxCdrBackfillResult = { scanned: 0, added: 0, skipped: 0, watermark };
  if (!config || !config.cdr.enabled || config.pbx.status !== 'connected' || !config.pbx.capabilities.xapi) {
    return idle;
  }

  const now = options.now ?? new Date();
  const from = watermark ?? new Date(now.getTime() - config.cdr.lookbackDays * 86_400_000).toISOString();
  const client = options.client ?? (await createThreecxPbxClient(tenantId));
  const enqueue: ThreecxCdrEnqueue =
    options.enqueue ?? ((jobName, data) => enqueueImmediateJob(jobName, data));

  const segments = await odataPageAll<ThreecxCallHistorySegment>(
    client,
    '/CallHistoryView',
    { $filter: `SegmentStartTime ge ${from}`, $orderby: 'SegmentStartTime asc' },
    THREECX_CDR_PAGE_SIZE,
  );
  if (segments.length === 0) return idle;

  const db = tenantDb(knex, tenantId);
  const users: Array<{ user_id: string; email: string | null }> = await db
    .table('users')
    .where({ user_type: 'internal' })
    .select('user_id', 'email');
  const ctx: MapCallHistoryContext = {
    extensions: config.extensions,
    usersById: new Map(users.map((user) => [user.user_id, { email: user.email }])),
    defaultCountryCode: await resolveTenantPhoneCountryCode(knex, tenantId),
  };

  let added = 0;
  let skipped = 0;
  let lastStartMs = Number.NaN;
  for (const segment of segments) {
    const startMs = new Date(segment.SegmentStartTime).getTime();
    if (!Number.isNaN(startMs) && (Number.isNaN(lastStartMs) || startMs > lastStartMs)) lastStartMs = startMs;
    const record = mapCallHistorySegment(segment, ctx);
    if (!record || (await isDuplicateThreecxCall(db, record))) {
      skipped += 1;
      continue;
    }
    await enqueue(THREECX_CANONICAL_CALL_JOB, { tenantId, record });
    added += 1;
  }

  const lagged = Number.isNaN(lastStartMs) ? null : new Date(lastStartMs - THREECX_CDR_WATERMARK_LAG_MS).toISOString();
  const nextWatermark = lagged && (!watermark || lagged > watermark) ? lagged : watermark;
  await updateThreecxConfig(
    tenantId,
    (current) => ({
      ...current,
      cdr: { ...current.cdr, lastRunAt: now.toISOString(), lastRunAdded: added, watermark: nextWatermark },
    }),
    knex,
  );

  return { scanned: segments.length, added, skipped, watermark: nextWatermark };
}

export interface SetThreecxCallHistoryImportInput {
  enabled: boolean;
  lookbackDays?: number;
}

/** Turns the scheduled backfill on or off; enabling restarts from the lookback window. */
export async function setThreecxCallHistoryImport(
  tenantId: string,
  input: SetThreecxCallHistoryImportInput,
): Promise<ThreecxProviderState> {
  const lookbackDays = input.lookbackDays;
  if (lookbackDays !== undefined && (!Number.isInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > 365)) {
    throw new Error('lookbackDays must be a whole number between 1 and 365.');
  }
  await updateThreecxConfig(tenantId, (config) => ({
    ...config,
    cdr: {
      ...config.cdr,
      enabled: input.enabled,
      lookbackDays: lookbackDays ?? config.cdr.lookbackDays,
      watermark: input.enabled ? null : config.cdr.watermark,
    },
  }));
  return getThreecxProviderState(tenantId);
}
