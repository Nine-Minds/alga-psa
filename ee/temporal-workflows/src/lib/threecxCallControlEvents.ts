/**
 * Pure state machine for the 3CX Call Control feed. The activity owns the
 * socket and the token; this module turns participant snapshots into the
 * three PRD events (ringing / connected / ended) and nothing else.
 */

export const THREECX_UPSERT = 0;
export const THREECX_REMOVE = 1;
export const THREECX_DTMF = 2;
export const THREECX_RESPONSE = 4;

export interface ThreecxParticipant {
  id?: number | string;
  status?: string;
  dn?: string;
  party_caller_id?: string;
  party_caller_name?: string;
  party_did?: string;
  party_dn?: string;
  callid?: number | string;
  legid?: number | string;
}

export interface ThreecxRingingEvent {
  kind: 'ringing';
  dn: string;
  participantId: string;
  callId: string;
  partyCallerId: string;
  partyCallerName: string;
  partyDid: string;
  at: string;
}

export interface ThreecxConnectedEvent {
  kind: 'connected';
  dn: string;
  participantId: string;
  callId: string;
}

export interface ThreecxEndedEvent {
  kind: 'ended';
  dn: string;
  participantId: string;
  callId: string;
}

export type ThreecxCallEvent = ThreecxRingingEvent | ThreecxConnectedEvent | ThreecxEndedEvent;

const PARTICIPANT_ENTITY = /^\/callcontrol\/([^/]+)\/participants\/([^/]+)\/?$/;

/** `/callcontrol/<dn>/participants/<id>`; every other entity is ignored. */
export function parseParticipantEntity(entity: unknown): { dn: string; participantId: string } | null {
  if (typeof entity !== 'string') return null;
  const match = PARTICIPANT_ENTITY.exec(entity.trim());
  if (!match) return null;
  return { dn: match[1], participantId: match[2] };
}

type Phase = 'none' | 'ringing' | 'connected';

interface TrackedParticipant {
  phase: Phase;
  sequence: number;
  callId: string;
}

function key(dn: string, participantId: string): string {
  return `${dn}/${participantId}`;
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

export class ThreecxParticipantTracker {
  private readonly participants = new Map<string, TrackedParticipant>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  get size(): number {
    return this.participants.size;
  }

  applyUpsert(input: {
    sequence: number;
    dn: string;
    participantId: string;
    participant: ThreecxParticipant;
    mappedDns: Set<string>;
  }): ThreecxCallEvent | null {
    const { sequence, dn, participantId, participant, mappedDns } = input;
    if (!mappedDns.has(dn)) return null;

    const id = key(dn, participantId);
    const tracked = this.participants.get(id);
    if (tracked && sequence <= tracked.sequence) return null;

    const callId = text(participant.callid) || tracked?.callId || participantId;
    const status = text(participant.status);
    const phase: Phase = tracked?.phase ?? 'none';
    const next: TrackedParticipant = { phase, sequence, callId };
    this.participants.set(id, next);

    if (status === 'Ringing' && phase === 'none') {
      next.phase = 'ringing';
      return {
        kind: 'ringing',
        dn,
        participantId,
        callId,
        partyCallerId: text(participant.party_caller_id),
        partyCallerName: text(participant.party_caller_name),
        partyDid: text(participant.party_did),
        at: this.now().toISOString(),
      };
    }

    if (status === 'Connected' && phase === 'ringing') {
      next.phase = 'connected';
      return { kind: 'connected', dn, participantId, callId };
    }

    return null;
  }

  applyRemove(input: { dn: string; participantId: string }): ThreecxCallEvent | null {
    const { dn, participantId } = input;
    const id = key(dn, participantId);
    const tracked = this.participants.get(id);
    this.participants.delete(id);
    if (!tracked || tracked.phase === 'none') return null;
    return { kind: 'ended', dn, participantId, callId: tracked.callId };
  }
}

export interface ThreecxCallControlMessage {
  sequence: number;
  eventType: number;
  entity: string;
}

/** `{ sequence, event: { event_type, entity } }` from the socket; anything else is null. */
export function parseCallControlMessage(raw: unknown): ThreecxCallControlMessage | null {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const message = parsed as Record<string, unknown>;
  const event = message.event && typeof message.event === 'object' ? (message.event as Record<string, unknown>) : null;
  if (!event || typeof event.entity !== 'string' || typeof event.event_type !== 'number') return null;
  const sequence = typeof message.sequence === 'number' ? message.sequence : Number(message.sequence);
  if (!Number.isFinite(sequence)) return null;
  return { sequence, eventType: event.event_type, entity: event.entity };
}

export function trimBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** `wss://<pbx>/callcontrol/ws` (ws:// for a plain-http emulator). */
export function callControlSocketUrl(baseUrl: string): string {
  return `${trimBaseUrl(baseUrl).replace(/^http/i, 'ws')}/callcontrol/ws`;
}

export const RECONNECT_BASE_DELAY_MS = 5_000;
export const RECONNECT_MAX_DELAY_MS = 120_000;

/** 5 s doubling per attempt (1-based), capped at 120 s. */
export function backoffDelayMs(attempt: number): number {
  const exponent = Math.max(0, Math.floor(attempt) - 1);
  return Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** exponent);
}
