import crypto from 'node:crypto';
import type { CanonicalChatRecord } from '@alga-psa/telephony/types';
import { threecxHashTime } from './reportCall';

/** The JSON body 3CX posts to report-chat (see THREECX_REPORT_CHAT_POST_KEYS). */
export interface ThreecxReportChatBody {
  number?: string;
  email?: string;
  name?: string;
  agentEmail?: string;
  queueExtension?: string;
  durationSeconds: number;
  startTimeUtc: string;
  endTimeUtc?: string;
  messages: string;
  /** Alga id echoed back from the lookup outputs ([EntityId]/[EntityType]). */
  entityId?: string;
  entityType?: string;
}

export type ThreecxChatValidationResult =
  | { ok: true; value: ThreecxReportChatBody }
  | { ok: false; error: 'invalid_request' };

const OPTIONAL_STRING_FIELDS = ['number', 'email', 'name', 'agentEmail', 'queueExtension', 'entityId', 'entityType'] as const;

const ISO_8601_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;

function isIsoUtc(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_8601_UTC.test(value)) return false;
  return !Number.isNaN(new Date(value).getTime());
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/**
 * Body-shape validation. `messages` and `startTimeUtc` are required; times
 * must be ISO-8601; durationSeconds is numeric >= 0 and defaults to 0.
 */
export function validateThreecxReportChatBody(body: unknown): ThreecxChatValidationResult {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'invalid_request' };
  }
  const b = body as Record<string, unknown>;

  if (typeof b.messages !== 'string' || b.messages.trim() === '') {
    return { ok: false, error: 'invalid_request' };
  }
  if (!isIsoUtc(b.startTimeUtc)) {
    return { ok: false, error: 'invalid_request' };
  }
  if (b.endTimeUtc !== undefined && b.endTimeUtc !== null && b.endTimeUtc !== '' && !isIsoUtc(b.endTimeUtc)) {
    return { ok: false, error: 'invalid_request' };
  }
  const duration = b.durationSeconds === undefined || b.durationSeconds === null || b.durationSeconds === ''
    ? 0
    : Number(b.durationSeconds);
  if (!Number.isFinite(duration) || duration < 0) {
    return { ok: false, error: 'invalid_request' };
  }
  for (const field of OPTIONAL_STRING_FIELDS) {
    const value = b[field];
    if (value !== undefined && value !== null && typeof value !== 'string') {
      return { ok: false, error: 'invalid_request' };
    }
  }

  return {
    ok: true,
    value: {
      number: optionalString(b.number),
      email: optionalString(b.email),
      name: optionalString(b.name),
      agentEmail: optionalString(b.agentEmail),
      queueExtension: optionalString(b.queueExtension),
      durationSeconds: duration,
      startTimeUtc: b.startTimeUtc,
      endTimeUtc: typeof b.endTimeUtc === 'string' && b.endTimeUtc !== '' ? b.endTimeUtc : undefined,
      messages: b.messages,
      entityId: optionalString(b.entityId),
      entityType: optionalString(b.entityType),
    },
  };
}

/**
 * Stable idempotency key: same agent + visitor number + visitor email + start
 * (to the second) yields the same providerChatId, so a re-delivered ReportChat
 * never journals twice.
 */
export function threecxProviderChatId(input: {
  agentEmail?: string | null;
  number?: string | null;
  email?: string | null;
  startTimeUtc: string;
}): string {
  const material = [
    (input.agentEmail ?? '').trim().toLowerCase(),
    (input.number ?? '').trim(),
    (input.email ?? '').trim().toLowerCase(),
    threecxHashTime(input.startTimeUtc),
  ].join('|');
  return crypto.createHash('sha256').update(material).digest('hex');
}

/** Maps a validated body to the vendor-neutral CanonicalChatRecord. */
export function buildThreecxCanonicalChat(body: ThreecxReportChatBody): CanonicalChatRecord {
  return {
    provider: '3cx',
    providerChatId: threecxProviderChatId({
      agentEmail: body.agentEmail,
      number: body.number,
      email: body.email,
      startTimeUtc: body.startTimeUtc,
    }),
    agentEmail: body.agentEmail ?? '',
    number: body.number,
    email: body.email,
    name: body.name,
    queueExtension: body.queueExtension,
    startedAt: new Date(body.startTimeUtc).toISOString(),
    endedAt: body.endTimeUtc ? new Date(body.endTimeUtc).toISOString() : undefined,
    durationSeconds: Math.round(body.durationSeconds),
    messages: body.messages,
    entityId: body.entityId,
    entityType: body.entityType,
    raw: { ...body },
  };
}
