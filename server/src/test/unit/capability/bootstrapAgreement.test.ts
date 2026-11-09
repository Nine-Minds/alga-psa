import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: <T,>(fn: T) => fn }));
vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { registerFeatureFlagChecker, type FeatureFlagEvaluation } from '@alga-psa/core/features';
import {
  admits,
  registerCapabilityEligibility,
  registerCapabilityParticipation,
  CAPABILITY_KEYS,
  resolveClientCapability,
  serves,
} from '@alga-psa/core/capability';
import { clearCapabilityCache, resetCapabilityRegistry } from '@alga-psa/core/capability/testing';
import { resolveCapabilityBootstrap } from '../../../lib/capability/bootstrap';

const flag = vi.fn<(name?: string) => Promise<boolean | FeatureFlagEvaluation>>();

describe('server/client agreement through the bootstrap', () => {
  afterEach(() => {
    delete (globalThis as Record<symbol, unknown>)[Symbol.for('alga.core.featureFlagChecker')];
    resetCapabilityRegistry();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.stubEnv('FORCE_CAPABILITIES', '');
    vi.stubEnv('FEATURE_FLAG_TENANTS__RELEASE_V2_0_FEATURE', undefined);
    vi.stubEnv('NEXT_PUBLIC_DISABLE_FEATURE_FLAGS', 'false');
    vi.stubEnv('DISABLE_FEATURE_FLAGS', 'false');
    flag.mockReset();
    registerFeatureFlagChecker(flag);
    registerCapabilityEligibility('co-managed', async ({ tenantId }) => tenantId === 'internal');
    registerCapabilityParticipation('co-managed', async ({ tenantIds }) => tenantIds.filter((t) => t === 'internal'));
    clearCapabilityCache();
  });

  it.each([
    ['internal', true],
    ['control', false],
  ])('tenant %s: the client decision equals the server decision', async (tenant, expected) => {
    flag.mockResolvedValue(true);
    const bootstrap = await resolveCapabilityBootstrap(tenant);
    const client = resolveClientCapability({ capability: 'co-managed', bootstrap });
    expect(client).toMatchObject({ enabled: expected, admitted: expected, resolved: true });
    expect(client.enabled).toBe((await serves('co-managed', tenant)).served);
    expect(client.admitted).toBe((await admits('co-managed', tenant)).admitted);
    expect(bootstrap['release-v2-0-feature']).toBe(true);
  });

  it('forced off closes both sides while the Timeline flag value is untouched', async () => {
    flag.mockResolvedValue(true);
    vi.stubEnv('FORCE_CAPABILITIES', 'co-managed:off');
    const bootstrap = await resolveCapabilityBootstrap('internal');
    expect(resolveClientCapability({ capability: 'co-managed', bootstrap })).toMatchObject({ enabled: false, admitted: false });
    expect(bootstrap['release-v2-0-feature']).toBe(true);
  });

  it('a throwing flag omits the raw value and fails admission closed; serves has no flag term', async () => {
    flag.mockRejectedValue(new Error('down'));
    const bootstrap = await resolveCapabilityBootstrap('internal');
    expect('release-v2-0-feature' in bootstrap).toBe(false);
    const client = resolveClientCapability({ capability: 'co-managed', bootstrap });
    expect(client.admitted).toBe(false);
    expect(client.enabled).toBe(true); // participation only, by design
  });

  it('an evaluated false is bootstrapped while existing participation stays served', async () => {
    flag.mockResolvedValue({ status: 'evaluated', enabled: false });
    const bootstrap = await resolveCapabilityBootstrap('internal');
    expect(bootstrap['release-v2-0-feature']).toBe(false);
    expect(resolveClientCapability({ capability: 'co-managed', bootstrap })).toMatchObject({
      enabled: true, admitted: false, resolved: true,
    });
    expect((await admits('co-managed', 'internal')).reasons.admitted).toBe('flag-off');
  });

  it.each([false, true])('omits an unavailable evaluation with fallback %s and recovers without a cached denial', async (enabled) => {
    flag.mockResolvedValue({ status: 'unavailable', enabled });
    const unavailable = await resolveCapabilityBootstrap('internal');
    expect(unavailable).not.toHaveProperty('release-v2-0-feature');
    expect(resolveClientCapability({ capability: 'co-managed', bootstrap: unavailable })).toMatchObject({
      enabled: true, admitted: false, resolved: true,
    });
    expect((await admits('co-managed', 'internal')).reasons.admitted).toBe('flag-unavailable');

    flag.mockResolvedValue({ status: 'evaluated', enabled: true });
    const recovered = await resolveCapabilityBootstrap('internal');
    expect(recovered['release-v2-0-feature']).toBe(true);
    expect(resolveClientCapability({ capability: 'co-managed', bootstrap: recovered })).toMatchObject({
      enabled: true, admitted: true, resolved: true,
    });
  });

  it('no tenant yields an empty bootstrap and an unresolved, closed client', async () => {
    const bootstrap = await resolveCapabilityBootstrap(null);
    expect(bootstrap).toEqual({});
    expect(resolveClientCapability({ capability: 'co-managed', bootstrap })).toMatchObject({ enabled: false, resolved: false });
  });

  describe('ticket-conversations', () => {
    const TC = 'ticket-conversations' as const;

    it('every capability key and the flag come from one flag (one bootstrap evaluation; the flag layer dedupes the rest)', async () => {
      flag.mockResolvedValue(true);
      const bootstrap = await resolveCapabilityBootstrap('control');
      expect(Object.keys(bootstrap).sort()).toEqual(
        [
          'release-v2-0-feature',
          ...CAPABILITY_KEYS.flatMap((key) => [`capability:${key}`, `capability:${key}:admit`]),
        ].sort(),
      );
      expect(Object.keys(bootstrap)).toContain('capability:ticket-conversations:admit');
      // The bootstrap evaluates the shared flag once itself; each capability's admission asks the flag layer
      // (which caches it: see capabilityNeutrality, one PostHog call). Nothing but the shared flag is asked.
      expect(flag.mock.calls.every(([name]) => name === 'release-v2-0-feature')).toBe(true);
      expect(flag.mock.calls.length).toBeLessThanOrEqual(1 + CAPABILITY_KEYS.length);
    });

    it.each([
      ['flag on', true, { admitted: true, served: false }],
      ['flag off', false, { admitted: false, served: false }],
    ])('%s: the client decision equals the server decision', async (_label, on, expected) => {
      flag.mockResolvedValue(on);
      const bootstrap = await resolveCapabilityBootstrap('control');
      const client = resolveClientCapability({ capability: TC, bootstrap });
      expect(client).toMatchObject({ enabled: expected.served, admitted: expected.admitted, resolved: true });
      expect(client.enabled).toBe((await serves(TC, 'control')).served);
      expect(client.admitted).toBe((await admits(TC, 'control')).admitted);
    });

    it('ticket-conversations:off closes only that key', async () => {
      flag.mockResolvedValue(true);
      vi.stubEnv('FORCE_CAPABILITIES', 'ticket-conversations:off');
      const bootstrap = await resolveCapabilityBootstrap('internal');
      expect(resolveClientCapability({ capability: TC, bootstrap })).toMatchObject({ enabled: false, admitted: false });
      expect(resolveClientCapability({ capability: 'co-managed', bootstrap })).toMatchObject({ enabled: true, admitted: true });
      expect(bootstrap['release-v2-0-feature']).toBe(true);
    });

    it('one failing key never drops the other', async () => {
      flag.mockResolvedValue(true);
      registerCapabilityParticipation(TC, async () => {
        throw new Error('db down');
      });
      const bootstrap = await resolveCapabilityBootstrap('internal');
      expect(bootstrap['capability:co-managed:admit']).toBe(true);
      expect(bootstrap['capability:ticket-conversations:admit']).toBe(true);
      expect(bootstrap['capability:ticket-conversations']).toBe(false); // participation error fails closed
    });
  });
});
