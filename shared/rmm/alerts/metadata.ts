import type { NormalizedRmmAlertEvent } from './contracts';

/** Persistence envelope for normalized-only fields not represented by columns. */
export function persistRmmAlertMetadata(event: Pick<NormalizedRmmAlertEvent, 'raw' | 'details'>): Record<string, unknown> {
  return { ...event.raw, _algaNormalized: { details: event.details ?? null } };
}

/** Recover the normalized provider detail body written by the alert pipeline. */
export function readPersistedRmmAlertDetails(metadata: Record<string, unknown> | null): string | null {
  const normalized = metadata?._algaNormalized && typeof metadata._algaNormalized === 'object'
    ? metadata._algaNormalized as Record<string, unknown> : null;
  return typeof normalized?.details === 'string' ? normalized.details : null;
}
