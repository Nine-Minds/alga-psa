import { describe, expect, it } from 'vitest';
import { INCOMING_CALL_MAX_AGE_MS, reduceIncomingCall, type IncomingCallEntry } from './incomingCall';

const now = Date.parse('2026-09-15T10:00:30.000Z');

const ringing: IncomingCallEntry = {
  event: 'ringing',
  call: { callId: 'call-1', participantId: 'p-1', dn: '101', number: '+1 555', contact: null, client: null },
  receivedAt: '2026-09-15T10:00:00.000Z',
};

describe('reduceIncomingCall', () => {
  it('T055: a ringing entry becomes the current call', () => {
    expect(reduceIncomingCall(null, ringing, now)).toEqual(ringing);
  });

  it('T055: ended for the same call clears it', () => {
    const ended = { event: 'ended', call: { callId: 'call-1', participantId: 'p-1', dn: '101' }, receivedAt: '2026-09-15T10:00:20.000Z' };
    expect(reduceIncomingCall(ringing, ended, now)).toBeNull();
  });

  it('connected for the same call clears it', () => {
    const connected = { event: 'connected', call: { callId: 'call-1', participantId: 'p-1', dn: '101' }, receivedAt: '2026-09-15T10:00:20.000Z' };
    expect(reduceIncomingCall(ringing, connected, now)).toBeNull();
  });

  it('ended for a different call leaves the current one up', () => {
    const ended = { event: 'ended', call: { callId: 'call-other', participantId: 'p-9', dn: '101' }, receivedAt: '2026-09-15T10:00:20.000Z' };
    expect(reduceIncomingCall(ringing, ended, now)).toBe(ringing);
  });

  it('T062: a newer ringing replaces the current call', () => {
    const newer: IncomingCallEntry = { ...ringing, call: { ...ringing.call, callId: 'call-2' }, receivedAt: '2026-09-15T10:00:25.000Z' };
    expect(reduceIncomingCall(ringing, newer, now)).toEqual(newer);
  });

  it('ignores a stale ringing replayed from the shared document', () => {
    const stale = { ...ringing, receivedAt: new Date(now - INCOMING_CALL_MAX_AGE_MS - 1).toISOString() };
    expect(reduceIncomingCall(null, stale, now)).toBeNull();
  });

  it('ignores malformed entries', () => {
    expect(reduceIncomingCall(ringing, undefined, now)).toBe(ringing);
    expect(reduceIncomingCall(ringing, { event: 'ringing' }, now)).toBe(ringing);
    expect(reduceIncomingCall(null, 'nope', now)).toBeNull();
  });
});
