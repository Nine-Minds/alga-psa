import type { IncomingCallEntry } from '@alga-psa/telephony/types';

export type { IncomingCallEntry };

/** A ring older than this on reconnect is stale: the phone stopped ringing long ago. */
export const INCOMING_CALL_MAX_AGE_MS = 60_000;

/**
 * Folds one `incomingCall` map entry into the card state: a fresh ring shows
 * (replacing whatever was up), `connected`/`ended` clear only the same call.
 */
export function reduceIncomingCall(
  current: IncomingCallEntry | null,
  entry: unknown,
  now: number = Date.now(),
): IncomingCallEntry | null {
  if (!isIncomingCallEntry(entry)) {
    return current;
  }
  if (entry.event === 'ringing') {
    const receivedAt = Date.parse(entry.receivedAt);
    if (Number.isFinite(receivedAt) && now - receivedAt > INCOMING_CALL_MAX_AGE_MS) {
      return current;
    }
    return entry;
  }
  if (current && current.call.callId === entry.call.callId) {
    return null;
  }
  return current;
}

function isIncomingCallEntry(value: unknown): value is IncomingCallEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<IncomingCallEntry>;
  return (
    (entry.event === 'ringing' || entry.event === 'connected' || entry.event === 'ended') &&
    !!entry.call &&
    typeof entry.call === 'object' &&
    typeof entry.call.callId === 'string' &&
    typeof entry.receivedAt === 'string'
  );
}
