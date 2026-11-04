import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./logger-universal', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import logger from './logger-universal';
import { registerFeatureFlagChecker } from './features';
import {
  activityServesCapability,
  admits,
  evaluateCapability,
  filterServed,
  forcedValue,
  invalidateCapability,
  parseForcedCapabilities,
  capabilityFeatureFlag,
  capabilityResolverStatus,
  registerCapabilityEligibility,
  registerCapabilityGate,
  registerCapabilityParticipation,
  resolveClientCapability,
  serves,
  UnknownCapabilityError,
  type CapabilityKey,
} from './capability';
import { clearCapabilityCache, resetCapabilityRegistry } from '../capability/testing';

const CAP: CapabilityKey = 'co-managed';
const FLAG = 'release-v2-0-feature';

const flagChecker = vi.fn<(flag: string, ctx: Record<string, unknown>) => Promise<boolean>>();
const eligibility = vi.fn<(ctx: { tenantId: string }) => Promise<boolean>>();
const participation = vi.fn<(ctx: { tenantIds: readonly string[] }) => Promise<ReadonlySet<string>>>();

function wire(opts: { flag?: boolean | Error | null; eligible?: boolean | Error | null; participating?: string[] | Error | null }) {
  flagChecker.mockReset();
  eligibility.mockReset();
  participation.mockReset();

  if (opts.flag === null || opts.flag === undefined) {
    // "no PostHog client": nothing registered. isFeatureFlagEnabled -> false.
    (globalThis as any)[Symbol.for('alga.core.featureFlagChecker')] = null;
  } else {
    flagChecker.mockImplementation(async () => {
      if (opts.flag instanceof Error) throw opts.flag;
      return opts.flag as boolean;
    });
    registerFeatureFlagChecker(flagChecker);
  }

  if (opts.eligible === null || opts.eligible === undefined) {
    registerCapabilityEligibility(CAP, null);
  } else {
    eligibility.mockImplementation(async () => {
      if (opts.eligible instanceof Error) throw opts.eligible;
      return opts.eligible as boolean;
    });
    registerCapabilityEligibility(CAP, eligibility);
  }

  if (opts.participating === null || opts.participating === undefined) {
    registerCapabilityParticipation(CAP, null);
  } else {
    participation.mockImplementation(async ({ tenantIds }) => {
      if (opts.participating instanceof Error) throw opts.participating;
      return new Set((opts.participating as string[]).filter((t) => tenantIds.includes(t)));
    });
    registerCapabilityParticipation(CAP, participation);
  }
}

describe('capabilityGate', () => {
  const env = { ...process.env };

  beforeEach(() => {
    delete process.env.FORCE_CAPABILITIES;
    delete process.env.DISABLE_FEATURE_FLAGS;
    delete process.env.NEXT_PUBLIC_DISABLE_FEATURE_FLAGS;
    process.env.CAPABILITY_CACHE_TTL_MS = '0';
    clearCapabilityCache();
    vi.mocked(logger.warn).mockClear();
    wire({});
  });

  afterEach(() => {
    process.env = { ...env };
    vi.useRealTimers();
  });

  describe('forced values', () => {
    it('forced on bypasses flag, eligibility and participation', async () => {
      process.env.FORCE_CAPABILITIES = 'co-managed:on';
      wire({ flag: false, eligible: false, participating: [] });
      const d = await evaluateCapability(CAP, 't1');
      expect(d).toMatchObject({ admitted: true, served: true, forced: 'on', reasons: { admitted: 'forced-on', served: 'forced-on' } });
      expect(flagChecker).not.toHaveBeenCalled();
      expect(eligibility).not.toHaveBeenCalled();
      expect(participation).not.toHaveBeenCalled();
    });

    it('forced off closes even when flag, eligibility and participation are all true', async () => {
      process.env.FORCE_CAPABILITIES = 'co-managed:off';
      wire({ flag: true, eligible: true, participating: ['t1'] });
      const d = await evaluateCapability(CAP, 't1');
      expect(d).toMatchObject({ admitted: false, served: false, forced: 'off' });
      expect(flagChecker).not.toHaveBeenCalled();
      expect(participation).not.toHaveBeenCalled();
    });

    it('a malformed value on the configured key forces off and warns', async () => {
      process.env.FORCE_CAPABILITIES = 'co-managed:maybe';
      wire({ flag: true, eligible: true, participating: ['t1'] });
      const d = await evaluateCapability(CAP, 't1');
      expect(d).toMatchObject({ admitted: false, served: false, forced: 'off', reasons: { admitted: 'forced-malformed' } });
      expect(logger.warn).toHaveBeenCalled();
    });

    it('unknown keys are ignored silently', async () => {
      process.env.FORCE_CAPABILITIES = 'something-else:on,other:maybe';
      wire({ flag: true, eligible: true, participating: ['t1'] });
      const d = await evaluateCapability(CAP, 't1');
      expect(d).toMatchObject({ admitted: true, served: true, forced: null });
    });

    it('re-reads FORCE_CAPABILITIES when the raw string changes, even with a warm cache', async () => {
      process.env.CAPABILITY_CACHE_TTL_MS = '60000';
      wire({ flag: true, eligible: true, participating: ['t1'] });
      expect((await serves(CAP, 't1')).served).toBe(true);
      process.env.FORCE_CAPABILITIES = 'co-managed:off';
      expect((await serves(CAP, 't1')).served).toBe(false);
      delete process.env.FORCE_CAPABILITIES;
      expect((await serves(CAP, 't1')).served).toBe(true);
    });
  });

  describe('admits = flag AND eligibility', () => {
    it.each([
      // flag, eligible, admitted, reason
      [true, true, true, 'open'],
      [true, false, false, 'not-eligible'],
      [false, true, false, 'flag-off'],
      [false, false, false, 'flag-off'],
    ] as const)('flag=%s eligible=%s -> admitted=%s (%s)', async (flag, eligible, admitted, reason) => {
      wire({ flag, eligible });
      const d = await admits(CAP, 't1');
      expect(d.admitted).toBe(admitted);
      expect(d.reasons.admitted).toBe(reason);
    });

    it('flag true without an eligibility resolver is closed and never asks PostHog', async () => {
      wire({ flag: true });
      const d = await admits(CAP, 't1');
      expect(d).toMatchObject({ admitted: false, reasons: { admitted: 'resolver-unregistered' } });
      expect(flagChecker).not.toHaveBeenCalled();
    });

    it('flag off never runs the eligibility resolver (no SQL for flag-off tenants)', async () => {
      wire({ flag: false, eligible: true });
      await admits(CAP, 't1');
      expect(eligibility).not.toHaveBeenCalled();
    });

    it('a throwing flag checker fails closed with flag-unavailable and does not escape', async () => {
      wire({ flag: new Error('posthog down'), eligible: true });
      const d = await admits(CAP, 't1');
      expect(d).toMatchObject({ admitted: false, reasons: { admitted: 'flag-unavailable' } });
      expect(logger.warn).toHaveBeenCalledWith('capability_decision_failed', expect.objectContaining({ resolver: 'featureFlag', mode: 'admits' }));
    });

    it('no PostHog client (no checker registered) is flag-off', async () => {
      wire({ flag: null, eligible: true });
      const d = await admits(CAP, 't1');
      expect(d).toMatchObject({ admitted: false, reasons: { admitted: 'flag-off' } });
    });

    it('a throwing eligibility resolver fails closed with eligibility-error', async () => {
      wire({ flag: true, eligible: new Error('db down') });
      const d = await admits(CAP, 't1');
      expect(d).toMatchObject({ admitted: false, reasons: { admitted: 'eligibility-error' } });
    });

    it('DISABLE_FEATURE_FLAGS=true does not imply admitted (eligibility still decides)', async () => {
      process.env.DISABLE_FEATURE_FLAGS = 'true';
      wire({ flag: null, eligible: false });
      expect((await admits(CAP, 't1')).admitted).toBe(false);
      wire({ flag: null });
      expect((await admits(CAP, 't1')).admitted).toBe(false);
    });
  });

  describe('serves = participation, no flag term', () => {
    it.each([
      [['t1'], true, 'open'],
      [[], false, 'not-participating'],
    ] as const)('participating=%j -> served=%s', async (participating, served, reason) => {
      wire({ participating: [...participating] });
      const d = await serves(CAP, 't1');
      expect(d.served).toBe(served);
      expect(d.reasons.served).toBe(reason);
    });

    it('unregistered participation is closed', async () => {
      const d = await serves(CAP, 't1');
      expect(d).toMatchObject({ served: false, reasons: { served: 'resolver-unregistered' } });
    });

    it('a throwing participation resolver fails closed with participation-error', async () => {
      wire({ participating: new Error('db down') });
      const d = await serves(CAP, 't1');
      expect(d).toMatchObject({ served: false, reasons: { served: 'participation-error' } });
    });

    it('is independent of the flag: flag false / throws / absent does not change served', async () => {
      for (const flag of [true, false, new Error('boom'), null] as const) {
        wire({ flag, eligible: false, participating: ['t1'] });
        expect((await serves(CAP, 't1')).served).toBe(true);
        expect(flagChecker).not.toHaveBeenCalled();
      }
    });
  });

  describe('admits vs serves divergence', () => {
    it('admitted without participating, and participating without admission', async () => {
      wire({ flag: true, eligible: true, participating: [] });
      expect(await evaluateCapability(CAP, 't1')).toMatchObject({ admitted: true, served: false });
      wire({ flag: false, eligible: false, participating: ['t1'] });
      expect(await evaluateCapability(CAP, 't1')).toMatchObject({ admitted: false, served: true });
    });

    it('a single-mode decision does not claim the other half', async () => {
      wire({ flag: true, eligible: true, participating: ['t1'] });
      expect((await admits(CAP, 't1')).reasons.served).toBe('not-evaluated');
      expect((await serves(CAP, 't1')).reasons.admitted).toBe('not-evaluated');
    });
  });

  describe('distinctId is tenant-only', () => {
    it('passes exactly { tenantId } to the flag checker', async () => {
      wire({ flag: true, eligible: true });
      await admits(CAP, 'tenant-abc');
      expect(flagChecker).toHaveBeenCalledTimes(1);
      expect(flagChecker).toHaveBeenCalledWith(FLAG, { tenantId: 'tenant-abc' });
      const ctx = flagChecker.mock.calls[0][1];
      expect(Object.keys(ctx)).toEqual(['tenantId']);
    });

    it('FeatureFlags derives distinctId tenant_<id> from a tenant-only context', async () => {
      const { FeatureFlags } = await import('./featureFlagRuntime');
      const isFeatureEnabled = vi.fn().mockResolvedValue(true);
      const ff = new FeatureFlags({ clientResolver: () => ({ isFeatureEnabled }) as any });
      registerFeatureFlagChecker((flag, ctx) => ff.isEnabled(flag, ctx));
      registerCapabilityEligibility(CAP, async () => true);
      await admits(CAP, 'abc');
      expect(isFeatureEnabled).toHaveBeenCalledWith(FLAG, 'tenant_abc', expect.objectContaining({ groups: { tenant: 'abc' } }));
    });
  });

  describe('filterServed', () => {
    it('never calls PostHog: a throwing flag checker is never invoked', async () => {
      wire({ flag: new Error('must not be called'), participating: ['a', 'c'] });
      await expect(filterServed(CAP, ['a', 'b', 'c'])).resolves.toEqual(['a', 'c']);
      expect(flagChecker).not.toHaveBeenCalled();
    });

    it('preserves input order, de-duplicates, and makes one participation call', async () => {
      wire({ participating: ['c', 'a'] });
      expect(await filterServed(CAP, ['c', 'a', 'b', 'a'])).toEqual(['c', 'a']);
      expect(participation).toHaveBeenCalledTimes(1);
      expect(participation.mock.calls[0][0].tenantIds).toEqual(['c', 'a', 'b']);
    });

    it('intersects defensively: a resolver cannot serve a tenant it was not asked about', async () => {
      participation.mockReset();
      participation.mockResolvedValue(new Set(['a', 'intruder']));
      registerCapabilityParticipation(CAP, participation);
      expect(await filterServed(CAP, ['a', 'b'])).toEqual(['a']);
    });

    it('closes everything when the resolver throws, and when unregistered', async () => {
      wire({ participating: new Error('db') });
      expect(await filterServed(CAP, ['a', 'b'])).toEqual([]);
      wire({});
      expect(await filterServed(CAP, ['a'])).toEqual([]);
    });

    it('honours the forced value for the whole batch', async () => {
      process.env.FORCE_CAPABILITIES = 'co-managed:on';
      expect(await filterServed(CAP, ['a', 'b'])).toEqual(['a', 'b']);
      process.env.FORCE_CAPABILITIES = 'co-managed:off';
      expect(await filterServed(CAP, ['a', 'b'])).toEqual([]);
    });
  });

  describe('caching', () => {
    beforeEach(() => {
      process.env.CAPABILITY_CACHE_TTL_MS = '30000';
      vi.useFakeTimers();
    });

    it('caches within the TTL and re-resolves after it expires', async () => {
      wire({ flag: true, eligible: true, participating: ['t1'] });
      await admits(CAP, 't1');
      await admits(CAP, 't1');
      expect(eligibility).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(29_999);
      await admits(CAP, 't1');
      expect(eligibility).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(2);
      await admits(CAP, 't1');
      expect(eligibility).toHaveBeenCalledTimes(2);
    });

    it('TTL 0 disables caching', async () => {
      process.env.CAPABILITY_CACHE_TTL_MS = '0';
      wire({ participating: ['t1'] });
      await serves(CAP, 't1');
      await serves(CAP, 't1');
      expect(participation).toHaveBeenCalledTimes(2);
    });

    it('clamps the TTL to 300s', async () => {
      process.env.CAPABILITY_CACHE_TTL_MS = '99999999';
      wire({ participating: ['t1'] });
      await serves(CAP, 't1');
      vi.advanceTimersByTime(300_001);
      await serves(CAP, 't1');
      expect(participation).toHaveBeenCalledTimes(2);
    });

    it('two tenants with opposite decisions never share an entry', async () => {
      wire({ participating: ['a'] });
      expect((await serves(CAP, 'a')).served).toBe(true);
      expect((await serves(CAP, 'b')).served).toBe(false);
      expect((await serves(CAP, 'a')).served).toBe(true);
    });

    it('filterServed fills the same per-tenant entries serves reads', async () => {
      wire({ participating: ['a'] });
      await filterServed(CAP, ['a', 'b']);
      expect((await serves(CAP, 'a')).served).toBe(true);
      expect((await serves(CAP, 'b')).served).toBe(false);
      expect(participation).toHaveBeenCalledTimes(1);
    });

    it('invalidateCapability clears one tenant only', async () => {
      wire({ participating: ['a', 'b'] });
      await serves(CAP, 'a');
      await serves(CAP, 'b');
      invalidateCapability(CAP, 'a');
      await serves(CAP, 'a');
      await serves(CAP, 'b');
      expect(participation).toHaveBeenCalledTimes(3);
      invalidateCapability(CAP);
      await serves(CAP, 'b');
      expect(participation).toHaveBeenCalledTimes(4);
    });
  });

  it('an unknown capability is a programmer error and throws', async () => {
    await expect(admits('nope' as CapabilityKey, 't1')).rejects.toBeInstanceOf(UnknownCapabilityError);
  });

  describe('registerCapabilityGate merges, never replaces', () => {
    afterEach(() => {
      registerCapabilityGate({ capability: CAP, featureFlag: FLAG });
    });

    it('re-registering the gate keeps resolvers registered separately', async () => {
      wire({ flag: true, eligible: true, participating: ['t1'] });
      registerCapabilityGate({ capability: CAP, featureFlag: FLAG });
      expect(capabilityResolverStatus(CAP)).toEqual({ eligibility: 'registered', participation: 'registered' });
      expect((await evaluateCapability(CAP, 't1'))).toMatchObject({ admitted: true, served: true });
      expect(eligibility).toHaveBeenCalled();
      expect(participation).toHaveBeenCalled();
    });

    it('explicit undefined resolvers do not clear registered ones; a new flag replaces only the flag', async () => {
      wire({ flag: true, eligible: true, participating: ['t1'] });
      registerCapabilityGate({ capability: CAP, featureFlag: 'some-other-flag', eligibility: undefined, participation: undefined });
      expect(capabilityFeatureFlag(CAP)).toBe('some-other-flag');
      expect(capabilityResolverStatus(CAP)).toEqual({ eligibility: 'registered', participation: 'registered' });
      await admits(CAP, 't1');
      expect(flagChecker).toHaveBeenCalledWith('some-other-flag', { tenantId: 't1' });
    });

    it('a resolver passed to the gate replaces that resolver only', async () => {
      wire({ flag: true, eligible: false, participating: ['t1'] });
      const replacement = vi.fn(async () => true);
      registerCapabilityGate({ capability: CAP, featureFlag: FLAG, eligibility: replacement });
      expect((await admits(CAP, 't1')).admitted).toBe(true);
      expect(replacement).toHaveBeenCalledWith({ tenantId: 't1' });
      expect((await serves(CAP, 't1')).served).toBe(true);
    });

    it('removing a resolver stays explicit', () => {
      wire({ eligible: true, participating: ['t1'] });
      registerCapabilityEligibility(CAP, null);
      expect(capabilityResolverStatus(CAP)).toEqual({ eligibility: 'unregistered', participation: 'registered' });
    });
  });

  it('the test hatch resets the real registry (its key matches the gate module)', async () => {
    wire({ eligible: true, participating: ['t1'] });
    expect(capabilityResolverStatus(CAP)).toEqual({ eligibility: 'registered', participation: 'registered' });
    resetCapabilityRegistry();
    expect(capabilityResolverStatus(CAP)).toEqual({ eligibility: 'unregistered', participation: 'unregistered' });
    expect(capabilityFeatureFlag(CAP)).toBe(FLAG);
  });

  it('activityServesCapability returns the sentinel when closed and null when served', async () => {
    wire({});
    expect(await activityServesCapability(CAP, 't1')).toEqual({ skipped: true, capability: CAP });
    wire({ participating: ['t1'] });
    expect(await activityServesCapability(CAP, 't1')).toBeNull();
  });
});

describe('FORCE_CAPABILITIES parser and client/server forced-value parity', () => {
  const RAWS = [undefined, '', '   ', 'co-managed:on', 'co-managed:off', 'co-managed:ON', ' Co-Managed : Off ', 'co-managed:maybe', 'co-managed:', 'co-managed',
    'co-managed:on,co-managed:off', 'co-managed:on,co-managed:maybe', 'other:on', 'other:maybe', 'other:on,co-managed:off', ',,co-managed:on,,', '!!:on', 'co-managed:on:off'] as const;

  it('parses the grammar', () => {
    expect(parseForcedCapabilities('a:on, b:OFF ,,c:maybe,d')).toEqual({ values: { a: true, b: false }, malformed: ['c', 'd'] });
    expect(parseForcedCapabilities(undefined)).toEqual({ values: {}, malformed: [] });
    expect(parseForcedCapabilities('!!:on')).toEqual({ values: {}, malformed: [] });
  });

  it.each([
    ['co-managed:on', 'on'], ['co-managed:off', 'off'], ['CO-MANAGED:Off', 'off'],
    ['co-managed:maybe', 'malformed'], ['co-managed:', 'malformed'], ['co-managed', 'malformed'],
    ['other:on', null], ['', null], [undefined, null],
    ['co-managed:on,co-managed:maybe', 'malformed'], ['co-managed:on,co-managed:off', 'off'],
  ] as const)('forcedValue(%j) = %s', (raw, expected) => {
    expect(forcedValue(raw as string | undefined, 'co-managed')).toBe(expected);
  });

  /**
   * For every raw value, bootstrap presence, and resolver registration, the
   * server decision and the client state agree whenever the client can know
   * (forced or bootstrapped), and both close otherwise.
   */
  describe.each(RAWS)('raw=%j', (raw) => {
    describe.each([true, false])('gate resolvers registered=%s', (registered) => {
      describe.each([true, false])('bootstrap key present=%s', (bootstrapPresent) => {
        it('server decision == client state', async () => {
          clearCapabilityCache();
          process.env.CAPABILITY_CACHE_TTL_MS = '0';
          if (raw === undefined) delete process.env.FORCE_CAPABILITIES;
          else process.env.FORCE_CAPABILITIES = raw;
          // Resolvers that would admit/serve, to prove only a force can open when unregistered is false.
          if (registered) wire({ flag: true, eligible: true, participating: ['t1'] });
          else wire({});

          const server = await evaluateCapability(CAP, 't1');
          // The bootstrap is built from the server decision, exactly as bootstrap.ts does.
          const bootstrap = bootstrapPresent
            ? { 'capability:co-managed': server.served, 'capability:co-managed:admit': server.admitted }
            : {};
          const client = resolveClientCapability({ capability: CAP, bootstrap, publicForceRaw: raw, production: false });

          const forcedState = forcedValue(raw, CAP);
          if (bootstrapPresent || forcedState !== null) {
            expect(client.enabled).toBe(server.served);
            expect(client.admitted).toBe(server.admitted);
          } else {
            // Nothing forced and nothing bootstrapped: the client cannot know, so it fails closed.
            expect(client).toMatchObject({ enabled: false, admitted: false, resolved: false });
          }
          if (forcedState === 'malformed') {
            expect(server).toMatchObject({ admitted: false, served: false });
            expect(client.enabled).toBe(false);
          }
        });
      });
    });
  });

  it('a bootstrapped value always beats the build-time public force', () => {
    const c = resolveClientCapability({
      capability: CAP,
      bootstrap: { 'capability:co-managed': false, 'capability:co-managed:admit': false },
      publicForceRaw: 'co-managed:on',
      production: false,
    });
    expect(c).toMatchObject({ enabled: false, admitted: false, resolved: true });
  });

  it('ignores the public force in a production build and warns', () => {
    vi.mocked(logger.warn).mockClear();
    const c = resolveClientCapability({ capability: CAP, bootstrap: {}, publicForceRaw: 'co-managed:on', production: true });
    expect(c).toMatchObject({ enabled: false, resolved: false });
    expect(logger.warn).toHaveBeenCalled();
  });
});
