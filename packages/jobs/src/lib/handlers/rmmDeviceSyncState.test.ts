import { describe, expect, it, vi } from 'vitest';
import { parseRmmDeviceSyncState } from './rmmAlertPollingHandlers';

// rmmAlertPollingHandlers pulls in the whole alert pipeline (Redis publishers,
// provider fetchers) that these pure-function tests never exercise. Stubbing
// the heavy specifiers keeps the suite independent of built dist artifacts,
// matching rmmDeviceSyncHandler.test.ts in this directory.
vi.mock('@alga-psa/shared/rmm/alerts', () => ({
  getRmmAlertFetcher: () => undefined,
  registerRmmAlertFetcher: vi.fn(),
  runRmmAlertReconciliation: vi.fn(),
}));
vi.mock('@alga-psa/integrations/lib/rmm/alerts/pipelineDeps', () => ({ buildRmmAlertPipelineDeps: vi.fn() }));
vi.mock('@alga-psa/integrations/lib/rmm/tacticalrmm/alertFetcher', () => ({ tacticalRmmAlertFetcher: {} }));


/**
 * Desired-state parsing for the recurring device sync.
 *
 * The default matters more than it looks: an integration that has never been
 * configured must NOT acquire a schedule on upgrade, because that would put a
 * recurring provider API load on every existing tenant without anyone asking
 * for it. `enabled` is therefore opt-in — only an explicit `true` counts.
 */
describe('parseRmmDeviceSyncState', () => {
  const active = { is_active: true };

  it('defaults to 60 minutes when deviceSync is absent', () => {
    expect(parseRmmDeviceSyncState({ ...active, settings: {} }).intervalMinutes).toBe(60);
  });

  it('is disabled when deviceSync is absent', () => {
    expect(parseRmmDeviceSyncState({ ...active, settings: {} }).pollingEnabled).toBe(false);
  });

  it('is disabled when enabled is merely truthy rather than true', () => {
    // Guards against a settings write storing "true" or 1 and silently
    // switching on a recurring API load.
    for (const enabled of ['true', 1, {}, []]) {
      const state = parseRmmDeviceSyncState({ ...active, settings: { deviceSync: { enabled } } });
      expect(state.pollingEnabled, `enabled=${JSON.stringify(enabled)}`).toBe(false);
    }
  });

  it('is enabled only for an explicit true', () => {
    const state = parseRmmDeviceSyncState({ ...active, settings: { deviceSync: { enabled: true } } });
    expect(state.pollingEnabled).toBe(true);
  });

  it('clamps an interval below the floor up to 15', () => {
    const state = parseRmmDeviceSyncState({ ...active, settings: { deviceSync: { intervalMinutes: 5 } } });
    expect(state.intervalMinutes).toBe(15);
  });

  it('clamps an interval above the ceiling down to 1440', () => {
    const state = parseRmmDeviceSyncState({ ...active, settings: { deviceSync: { intervalMinutes: 5000 } } });
    expect(state.intervalMinutes).toBe(1440);
  });

  it('rounds a fractional interval', () => {
    const state = parseRmmDeviceSyncState({ ...active, settings: { deviceSync: { intervalMinutes: 42.6 } } });
    expect(state.intervalMinutes).toBe(43);
  });

  it('falls back to the default for a non-numeric interval', () => {
    const state = parseRmmDeviceSyncState({ ...active, settings: { deviceSync: { intervalMinutes: 'hourly' } } });
    expect(state.intervalMinutes).toBe(60);
  });

  it('accepts settings stored as a JSON string', () => {
    const state = parseRmmDeviceSyncState({
      ...active,
      settings: JSON.stringify({ deviceSync: { enabled: true, intervalMinutes: 120 } }),
    });
    expect(state).toMatchObject({ active: true, pollingEnabled: true, intervalMinutes: 120 });
  });

  it('survives unparseable settings without throwing', () => {
    const state = parseRmmDeviceSyncState({ ...active, settings: '{not json' });
    expect(state).toMatchObject({ active: true, pollingEnabled: false, intervalMinutes: 60 });
  });

  it('survives null settings', () => {
    const state = parseRmmDeviceSyncState({ ...active, settings: null });
    expect(state.pollingEnabled).toBe(false);
  });

  it('reports the integration inactive when is_active is false', () => {
    // Eligibility is active AND enabled; the reconciler cancels on either.
    const state = parseRmmDeviceSyncState({
      is_active: false,
      settings: { deviceSync: { enabled: true, intervalMinutes: 30 } },
    });
    expect(state.active).toBe(false);
    expect(state.pollingEnabled).toBe(true);
  });

  it('does not read the alertPolling interval', () => {
    // The two capabilities have separate cadences; sharing a key would make an
    // alert-poll change silently retune the device sync.
    const state = parseRmmDeviceSyncState({
      ...active,
      settings: { alertPolling: { enabled: true, intervalMinutes: 5 } },
    });
    expect(state.pollingEnabled).toBe(false);
    expect(state.intervalMinutes).toBe(60);
  });
});
