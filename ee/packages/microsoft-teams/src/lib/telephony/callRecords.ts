import logger from '@alga-psa/core/logger';
import { fetchMicrosoftGraphAppToken } from '../graphAuth';
import { getMicrosoftGraphBaseUrl } from '../teams/microsoftEndpoints';
import { resolveTeamsMeetingGraphConfig } from '../meetings/meetingConfig';
import { TEAMS_PHONE_PROVIDER } from './callSubscriptions';

/**
 * Teams Phone CDR fetch and mapping.
 *
 * Graph's callRecord arrives after the call ends (sometimes minutes later) —
 * this is journaling, never a ring-time screen pop. The PSTN leg lives on the
 * session endpoints' `identity.phone.id`; `organizer`/`participants` only carry
 * Entra identities, which is why direction is derived from the endpoints.
 */

export interface GraphCallRecordIdentity {
  phone?: { id?: string | null } | null;
  user?: { id?: string | null; displayName?: string | null } | null;
  acsUser?: { id?: string | null } | null;
  [key: string]: unknown;
}

export interface GraphCallRecordEndpoint {
  identity?: GraphCallRecordIdentity | null;
  [key: string]: unknown;
}

export interface GraphCallRecordSession {
  id?: string;
  caller?: GraphCallRecordEndpoint | null;
  callee?: GraphCallRecordEndpoint | null;
  startDateTime?: string | null;
  endDateTime?: string | null;
  modalities?: string[] | null;
  failureInfo?: { reason?: string | null; stage?: string | null } | null;
  [key: string]: unknown;
}

export interface GraphCallRecord {
  id?: string;
  type?: string;
  modalities?: string[] | null;
  startDateTime?: string | null;
  endDateTime?: string | null;
  organizer?: { user?: { id?: string | null } | null } | null;
  sessions?: GraphCallRecordSession[] | null;
  [key: string]: unknown;
}

export async function fetchTeamsCallRecord(params: {
  tenantId: string;
  callRecordId: string;
}): Promise<GraphCallRecord | null> {
  const config = await resolveTeamsMeetingGraphConfig(params.tenantId);
  if (!config) {
    logger.info('[Telephony] Cannot fetch call record: Teams is not configured', { tenantId: params.tenantId });
    return null;
  }

  const accessToken = await fetchMicrosoftGraphAppToken({
    tenantAuthority: config.microsoftTenantId,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  });

  // The gated base URL is what points at the emulator under TEAMS_EMULATOR_MODE.
  const url = `${getMicrosoftGraphBaseUrl()}/communications/callRecords/${encodeURIComponent(params.callRecordId)}?$expand=sessions`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const body = await response.text();
    logger.warn('[Telephony] Failed to fetch Teams call record', {
      tenantId: params.tenantId,
      callRecordId: params.callRecordId,
      status: response.status,
      body: body.slice(0, 500),
    });
    return null;
  }

  return (await response.json()) as GraphCallRecord;
}

function phoneOf(endpoint: GraphCallRecordEndpoint | null | undefined): string | null {
  const id = endpoint?.identity?.phone?.id;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

function userIdOf(endpoint: GraphCallRecordEndpoint | null | undefined): string | null {
  const id = endpoint?.identity?.user?.id;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

export interface MappedCallRecord {
  provider: string;
  providerCallId: string;
  direction: 'inbound' | 'outbound' | 'missed';
  callerNumber?: { raw: string | null; e164: string | null };
  calleeNumber?: { raw: string | null; e164: string | null };
  organizerUserId?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  durationSeconds?: number | null;
  modality?: 'audio' | 'video' | null;
  raw?: Record<string, unknown>;
}

/**
 * Map a Graph callRecord onto the canonical model. Anything without an id is
 * unusable (the id is the dedupe key), so the mapper returns null rather than
 * inventing one.
 */
export function mapTeamsCallRecordToCanonical(record: GraphCallRecord | null): MappedCallRecord | null {
  if (!record?.id) {
    return null;
  }

  const sessions = Array.isArray(record.sessions) ? record.sessions : [];
  const pstnSession = sessions.find((session) => phoneOf(session.caller) || phoneOf(session.callee)) ?? sessions[0];

  const callerPhone = phoneOf(pstnSession?.caller);
  const calleePhone = phoneOf(pstnSession?.callee);

  // The PSTN leg tells us which way the call went: a phone on the caller side is
  // someone ringing us, a phone on the callee side is us ringing out.
  let direction: MappedCallRecord['direction'] = callerPhone && !calleePhone
    ? 'inbound'
    : calleePhone && !callerPhone
      ? 'outbound'
      : 'inbound';

  // Unanswered: every session failed during setup, or the call never lasted.
  const answered = sessions.some((session) => !session.failureInfo && durationOf(session.startDateTime, session.endDateTime) > 0);
  const durationSeconds = durationOf(record.startDateTime, record.endDateTime);
  if (direction === 'inbound' && sessions.length > 0 && !answered) {
    direction = 'missed';
  }

  const modalities = (record.modalities ?? pstnSession?.modalities ?? []) as string[];
  const modality = modalities.includes('video') ? 'video' : modalities.includes('audio') ? 'audio' : null;

  return {
    provider: TEAMS_PHONE_PROVIDER,
    providerCallId: record.id,
    direction,
    callerNumber: { raw: callerPhone, e164: callerPhone },
    calleeNumber: { raw: calleePhone, e164: calleePhone },
    organizerUserId: record.organizer?.user?.id ?? userIdOf(pstnSession?.callee) ?? null,
    startedAt: record.startDateTime ?? null,
    endedAt: record.endDateTime ?? null,
    durationSeconds,
    modality,
    raw: record as Record<string, unknown>,
  };
}

function durationOf(start: string | null | undefined, end: string | null | undefined): number {
  if (!start || !end) {
    return 0;
  }
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
    return 0;
  }
  return Math.round((endMs - startMs) / 1000);
}
