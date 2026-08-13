import { describe, expect, it } from 'vitest';
import { resolveDeviceSyncCursor } from './rmmAlertPollingHandlers';

/**
 * Where an incremental device sync starts reading from.
 *
 * This mirrors the cursor NinjaOne's manual incremental sync already computes
 * (`last_incremental_sync_at ?? last_full_sync_at ?? now-24h`). The scheduled
 * and manual paths must agree, or the same integration would read a different
 * window depending on how it was triggered.
 */
describe('resolveDeviceSyncCursor', () => {
  it('prefers last_incremental_sync_at when present', () => {
    const cursor = resolveDeviceSyncCursor({
      last_incremental_sync_at: '2026-08-12T10:00:00.000Z',
      last_full_sync_at: '2026-08-01T00:00:00.000Z',
    });
    expect(cursor.toISOString()).toBe('2026-08-12T10:00:00.000Z');
  });

  it('falls back to last_full_sync_at when no incremental has run', () => {
    // The common case on first schedule: every provider except Huntress has
    // an empty last_incremental_sync_at today.
    const cursor = resolveDeviceSyncCursor({
      last_incremental_sync_at: null,
      last_full_sync_at: '2026-08-11T18:39:52.000Z',
    });
    expect(cursor.toISOString()).toBe('2026-08-11T18:39:52.000Z');
  });

  it('falls back to a 24 hour look-back when neither timestamp exists', () => {
    const before = Date.now() - 24 * 60 * 60 * 1000;
    const cursor = resolveDeviceSyncCursor({});
    const after = Date.now() - 24 * 60 * 60 * 1000;
    expect(cursor.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(cursor.getTime()).toBeLessThanOrEqual(after + 1000);
  });

  it('does not attempt an unbounded first sync', () => {
    // A null cursor would mean "everything since the beginning of time" —
    // the bounded look-back is what stops a first scheduled run walking the
    // provider's entire history.
    const cursor = resolveDeviceSyncCursor({ last_incremental_sync_at: null, last_full_sync_at: null });
    expect(cursor.getTime()).toBeGreaterThan(Date.now() - 25 * 60 * 60 * 1000);
  });

  it('accepts a Date as well as an ISO string', () => {
    const when = new Date('2026-08-12T09:30:00.000Z');
    const cursor = resolveDeviceSyncCursor({ last_incremental_sync_at: when as unknown as string });
    expect(cursor.toISOString()).toBe('2026-08-12T09:30:00.000Z');
  });

  it('ignores an unparseable timestamp rather than producing an Invalid Date', () => {
    // An Invalid Date would be passed to the provider API and fail in a way
    // that looks like a provider outage rather than bad local state.
    const cursor = resolveDeviceSyncCursor({ last_incremental_sync_at: 'not a date' });
    expect(Number.isNaN(cursor.getTime())).toBe(false);
    expect(cursor.getTime()).toBeGreaterThan(Date.now() - 25 * 60 * 60 * 1000);
  });
});
