import { describe, expect, it } from 'vitest';
import {
  backoffDelayMs,
  callControlSocketUrl,
  parseCallControlMessage,
  parseParticipantEntity,
  ThreecxParticipantTracker,
} from '../../lib/threecxCallControlEvents';

const mapped = new Set(['100', '101']);
const at = new Date('2026-09-15T10:00:00.000Z');

function tracker() {
  return new ThreecxParticipantTracker(() => at);
}

function upsert(t: ThreecxParticipantTracker, sequence: number, dn: string, status: string, extra: Record<string, unknown> = {}) {
  return t.applyUpsert({
    sequence,
    dn,
    participantId: 'p1',
    participant: { id: 1, status, dn, callid: 42, party_caller_id: '+15551234567', party_caller_name: 'Ada', party_did: '+15550000000', ...extra },
    mappedDns: mapped,
  });
}

describe('parseParticipantEntity', () => {
  it('reads dn and participant id from a participant entity', () => {
    expect(parseParticipantEntity('/callcontrol/100/participants/7')).toEqual({ dn: '100', participantId: '7' });
  });

  it('ignores entities that are not participants', () => {
    expect(parseParticipantEntity('/callcontrol/100')).toBeNull();
    expect(parseParticipantEntity('/callcontrol/100/devices/1')).toBeNull();
    expect(parseParticipantEntity(undefined)).toBeNull();
  });
});

describe('parseCallControlMessage', () => {
  it('parses the socket envelope', () => {
    expect(parseCallControlMessage('{"sequence":3,"event":{"event_type":0,"entity":"/callcontrol/100/participants/7"}}')).toEqual({
      sequence: 3,
      eventType: 0,
      entity: '/callcontrol/100/participants/7',
    });
  });

  it('returns null for malformed input', () => {
    expect(parseCallControlMessage('nope')).toBeNull();
    expect(parseCallControlMessage({ sequence: 1 })).toBeNull();
  });
});

describe('ThreecxParticipantTracker', () => {
  it('forwards ringing with the caller fields when a mapped DN starts ringing (T033)', () => {
    expect(upsert(tracker(), 1, '100', 'Ringing')).toEqual({
      kind: 'ringing',
      dn: '100',
      participantId: 'p1',
      callId: '42',
      partyCallerId: '+15551234567',
      partyCallerName: 'Ada',
      partyDid: '+15550000000',
      directControl: false,
      at: at.toISOString(),
    });
  });

  it('forwards connected for a ringing participant (T034)', () => {
    const t = tracker();
    upsert(t, 1, '100', 'Ringing');
    expect(upsert(t, 2, '100', 'Connected')).toEqual({ kind: 'connected', dn: '100', participantId: 'p1', callId: '42' });
  });

  it('forwards ended on Remove for a connected or ringing participant (T035)', () => {
    const t = tracker();
    upsert(t, 1, '100', 'Ringing');
    upsert(t, 2, '100', 'Connected');
    expect(t.applyRemove({ dn: '100', participantId: 'p1' })).toEqual({ kind: 'ended', dn: '100', participantId: 'p1', callId: '42' });
    expect(t.size).toBe(0);

    const ringingOnly = tracker();
    upsert(ringingOnly, 1, '101', 'Ringing');
    expect(ringingOnly.applyRemove({ dn: '101', participantId: 'p1' })?.kind).toBe('ended');
  });

  it('forwards nothing for a DN absent from the extension map (T036)', () => {
    const t = tracker();
    expect(upsert(t, 1, '999', 'Ringing')).toBeNull();
    expect(upsert(t, 2, '999', 'Connected')).toBeNull();
    expect(t.applyRemove({ dn: '999', participantId: 'p1' })).toBeNull();
    expect(t.size).toBe(0);
  });

  it('forwards nothing for a participant that goes straight to Dialing (T037)', () => {
    const t = tracker();
    expect(upsert(t, 1, '100', 'Dialing')).toBeNull();
    expect(upsert(t, 2, '100', 'Connected')).toBeNull();
    expect(t.applyRemove({ dn: '100', participantId: 'p1' })).toBeNull();
  });

  it('ignores a snapshot whose sequence is older than the latest seen (T032)', () => {
    const t = tracker();
    upsert(t, 5, '100', 'Ringing');
    expect(upsert(t, 4, '100', 'Connected')).toBeNull();
    expect(upsert(t, 5, '100', 'Connected')).toBeNull();
    expect(upsert(t, 6, '100', 'Connected')?.kind).toBe('connected');
  });

  it('does not repeat ringing or connected for the same participant', () => {
    const t = tracker();
    upsert(t, 1, '100', 'Ringing');
    expect(upsert(t, 2, '100', 'Ringing')).toBeNull();
    upsert(t, 3, '100', 'Connected');
    expect(upsert(t, 4, '100', 'Connected')).toBeNull();
    expect(upsert(t, 5, '100', 'Ringing')).toBeNull();
  });

  it('falls back to the participant id when the PBX sends no callid', () => {
    const event = tracker().applyUpsert({
      sequence: 1,
      dn: '100',
      participantId: 'p9',
      participant: { status: 'Ringing' },
      mappedDns: mapped,
    });
    expect(event).toMatchObject({ kind: 'ringing', callId: 'p9', partyCallerId: '', partyCallerName: '', partyDid: '' });
  });
});

describe('backoffDelayMs', () => {
  it('doubles from 5 s and caps at 120 s (T038)', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(backoffDelayMs)).toEqual([5000, 10000, 20000, 40000, 80000, 120000, 120000, 120000]);
    expect(backoffDelayMs(0)).toBe(5000);
  });
});

describe('callControlSocketUrl', () => {
  it('derives the websocket endpoint from the PBX base URL', () => {
    expect(callControlSocketUrl('https://pbx.example.com/')).toBe('wss://pbx.example.com/callcontrol/ws');
    expect(callControlSocketUrl('http://localhost:5000')).toBe('ws://localhost:5000/callcontrol/ws');
    expect(callControlSocketUrl('pbx.example.com')).toBe('wss://pbx.example.com/callcontrol/ws');
  });
});
