import crypto from 'node:crypto';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { normalizeToE164, resolveTenantPhoneCountryCode } from '@alga-psa/telephony';
import type { CanonicalCallRecord, CallDirection } from '@alga-psa/telephony/types';

export const THREECX_CALL_TYPES = ['Inbound', 'Outbound', 'Missed', 'Notanswered'] as const;
export type ThreecxCallType = (typeof THREECX_CALL_TYPES)[number];

export interface ThreecxReportCallBody {
  callType: ThreecxCallType;
  number: string;
  agentExtension?: string;
  agentEmail: string;
  queueExtension?: string;
  durationSeconds: number;
  startTimeUtc: string;
  establishedTimeUtc?: string;
  endTimeUtc: string;
}

export type ThreecxValidationResult =
  | { ok: true; value: ThreecxReportCallBody }
  | { ok: false; error: 'invalid_request' };

const ISO_8601_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;

function isIsoUtc(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_8601_UTC.test(value)) return false;
  return !Number.isNaN(new Date(value).getTime());
}

/** Body-shape validation. Times must be ISO-8601, callType one of four. */
export function validateThreecxReportCallBody(body: unknown): ThreecxValidationResult {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'invalid_request' };
  }
  const b = body as Record<string, unknown>;

  if (!THREECX_CALL_TYPES.includes(b.callType as ThreecxCallType)) {
    return { ok: false, error: 'invalid_request' };
  }
  if (typeof b.number !== 'string' || b.number.trim() === '') {
    return { ok: false, error: 'invalid_request' };
  }
  if (typeof b.agentEmail !== 'string' || b.agentEmail.trim() === '') {
    return { ok: false, error: 'invalid_request' };
  }
  if (!isIsoUtc(b.startTimeUtc) || !isIsoUtc(b.endTimeUtc)) {
    return { ok: false, error: 'invalid_request' };
  }
  if (b.establishedTimeUtc !== undefined && b.establishedTimeUtc !== '' && !isIsoUtc(b.establishedTimeUtc)) {
    return { ok: false, error: 'invalid_request' };
  }
  const duration = Number(b.durationSeconds);
  if (!Number.isFinite(duration) || duration < 0) {
    return { ok: false, error: 'invalid_request' };
  }

  return {
    ok: true,
    value: {
      callType: b.callType as ThreecxCallType,
      number: b.number,
      agentExtension: typeof b.agentExtension === 'string' ? b.agentExtension : undefined,
      agentEmail: b.agentEmail,
      queueExtension: typeof b.queueExtension === 'string' ? b.queueExtension : undefined,
      durationSeconds: duration,
      startTimeUtc: b.startTimeUtc as string,
      establishedTimeUtc: typeof b.establishedTimeUtc === 'string' ? b.establishedTimeUtc : undefined,
      endTimeUtc: b.endTimeUtc as string,
    },
  };
}

export function threecxDirection(callType: ThreecxCallType): CallDirection {
  if (callType === 'Inbound') return 'inbound';
  if (callType === 'Outbound') return 'outbound';
  return 'missed';
}

/**
 * Stable idempotency key: same agent + number + callType + start yields the
 * same providerCallId, so a re-delivered ReportCall never journals twice.
 */
export function threecxProviderCallId(input: {
  agentEmail: string;
  numberForHash: string;
  callType: ThreecxCallType;
  startTimeUtc: string;
}): string {
  const material = [
    input.agentEmail.toLowerCase(),
    input.numberForHash,
    input.callType,
    input.startTimeUtc,
  ].join('|');
  return crypto.createHash('sha256').update(material).digest('hex');
}

export interface BuildThreecxCanonicalContext {
  tenantId: string;
  knex?: any;
  defaultCountryCode?: string | null;
}

/** Maps a validated body to the vendor-neutral CanonicalCallRecord. */
export async function buildThreecxCanonicalCall(
  ctx: BuildThreecxCanonicalContext,
  body: ThreecxReportCallBody,
): Promise<CanonicalCallRecord> {
  const knex = ctx.knex ?? (await createTenantKnex(ctx.tenantId)).knex;
  const db = tenantDb(knex, ctx.tenantId);
  const defaultCountryCode =
    ctx.defaultCountryCode ?? (await resolveTenantPhoneCountryCode(knex, ctx.tenantId));

  const e164 = normalizeToE164(body.number, { defaultCountryCode });
  const numberForHash = e164 ?? body.number;
  const direction = threecxDirection(body.callType);
  const isMissed = direction === 'missed';

  const party = { raw: body.number, e164: e164 ?? null };
  const onCallerSide = direction === 'inbound' || direction === 'missed';

  const userRow = await db
    .table('users')
    .whereRaw('lower(email) = ?', [body.agentEmail.trim().toLowerCase()])
    .first('user_id');

  const record: CanonicalCallRecord = {
    provider: '3cx',
    providerCallId: threecxProviderCallId({
      agentEmail: body.agentEmail,
      numberForHash,
      callType: body.callType,
      startTimeUtc: body.startTimeUtc,
    }),
    direction,
    callerNumber: onCallerSide ? party : undefined,
    calleeNumber: onCallerSide ? undefined : party,
    organizerUserId: userRow?.user_id ?? null,
    startedAt: body.startTimeUtc,
    endedAt: body.endTimeUtc,
    durationSeconds: isMissed ? 0 : body.durationSeconds,
    modality: 'audio',
    raw: { ...body },
  };

  return record;
}
