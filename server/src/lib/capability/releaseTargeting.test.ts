import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flagTargetingEnvName, isFeatureFlagEnabled, registerFeatureFlagChecker, resolveFlagTargeting } from '@alga-psa/core/features';
import {
  evaluateCapability,
  registerCapabilityEligibility,
  registerCapabilityParticipation,
} from '@alga-psa/core/capability';
import { resetCapabilityRegistry } from '@alga-psa/core/capability/testing';
import { FeatureFlags } from '@alga-psa/core/server';
import { resolveCapabilityBootstrap } from './bootstrap';

const OZ = '00000000-0000-4000-8000-000000000001';
const EMERALD = '00000000-0000-4000-8000-000000000002';
const KANSAS = '00000000-0000-4000-8000-000000000003';
const checker = vi.fn(async () => false);

describe('production release tenant targeting (co-managed)', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('FEATURE_FLAG_TENANTS__RELEASE_V2_0_FEATURE', `${OZ}, ${EMERALD}`);
    vi.stubEnv('FORCE_CAPABILITIES', '');
    vi.stubEnv('DISABLE_FEATURE_FLAGS', 'false');
    vi.stubEnv('NEXT_PUBLIC_DISABLE_FEATURE_FLAGS', 'false');
    resetCapabilityRegistry();
    checker.mockReset().mockResolvedValue(false);
    registerFeatureFlagChecker(checker);
    registerCapabilityEligibility('co-managed', async ({ tenantId }) => tenantId === OZ);
    registerCapabilityParticipation('co-managed', async ({ tenantIds }) => new Set(tenantIds.filter((id) => id === OZ)));
  });

  afterEach(() => {
    resetCapabilityRegistry();
    delete (globalThis as Record<symbol, unknown>)[Symbol.for('alga.core.featureFlagChecker')];
    vi.unstubAllEnvs();
  });

  it.each([
    [OZ, true, true, true],
    [EMERALD, true, false, false],
    [KANSAS, false, false, false],
  ])('keeps server and browser bootstrap aligned for %s', async (tenantId, flag, admitted, served) => {
    expect(await evaluateCapability('co-managed', tenantId)).toMatchObject({ admitted, served, forced: null });
    expect(await resolveCapabilityBootstrap(tenantId)).toEqual({
      'release-v2-0-feature': flag,
      'capability:co-managed': served,
      'capability:co-managed:admit': admitted,
    });
    expect(checker).not.toHaveBeenCalled();
  });

  it('keeps the kill switch above the release override and participation', async () => {
    vi.stubEnv('FORCE_CAPABILITIES', 'co-managed:off');
    expect(await evaluateCapability('co-managed', OZ)).toMatchObject({ admitted: false, served: false, forced: 'off' });
    expect(await resolveCapabilityBootstrap(OZ)).toEqual({
      'release-v2-0-feature': true,
      'capability:co-managed': false,
      'capability:co-managed:admit': false,
    });
  });

  it('leaves other flags with their existing evaluator', async () => {
    checker.mockResolvedValue(true);
    expect(await isFeatureFlagEnabled('knowledge-base', { tenantId: KANSAS })).toBe(true);
    expect(checker).toHaveBeenCalledWith('knowledge-base', { tenantId: KANSAS });
  });

  it('defers to PostHog when no override is configured', async () => {
    vi.stubEnv('FEATURE_FLAG_TENANTS__RELEASE_V2_0_FEATURE', undefined);
    expect(await isFeatureFlagEnabled('release-v2-0-feature', { tenantId: OZ })).toBe(false);
    checker.mockResolvedValue(true);
    expect(await isFeatureFlagEnabled('release-v2-0-feature', { tenantId: OZ })).toBe(true);
  });

  it.each(['', '*', `${OZ},*`, `${OZ},`, 'true', 'not-a-tenant'])('fails closed for empty or invalid targeting %j', async (raw) => {
    vi.stubEnv('FEATURE_FLAG_TENANTS__RELEASE_V2_0_FEATURE', raw);
    checker.mockResolvedValue(true);
    expect(await isFeatureFlagEnabled('release-v2-0-feature', { tenantId: OZ })).toBe(false);
    expect(checker).not.toHaveBeenCalled();
  });

  it('requires tenant context and never uses the user id as a tenant', async () => {
    expect(await isFeatureFlagEnabled('release-v2-0-feature', { userId: OZ })).toBe(false);
    expect(await resolveCapabilityBootstrap(null)).toEqual({});
  });

  it('preserves the configured control even with the global development override', async () => {
    vi.stubEnv('NEXT_PUBLIC_DISABLE_FEATURE_FLAGS', undefined);
    vi.stubEnv('DISABLE_FEATURE_FLAGS', 'true');
    expect(await isFeatureFlagEnabled('release-v2-0-feature', { tenantId: KANSAS })).toBe(false);
    expect(await isFeatureFlagEnabled('knowledge-base', { tenantId: KANSAS })).toBe(true);
  });
});

describe('flag-agnostic tenant targeting', () => {
  const OTHER = 'some-other-flag';
  const OTHER_ENV = 'FEATURE_FLAG_TENANTS__SOME_OTHER_FLAG';

  beforeEach(() => {
    vi.stubEnv('DISABLE_FEATURE_FLAGS', 'false');
    vi.stubEnv('NEXT_PUBLIC_DISABLE_FEATURE_FLAGS', 'false');
    checker.mockReset().mockResolvedValue(false);
    registerFeatureFlagChecker(checker);
  });

  afterEach(() => {
    delete (globalThis as Record<symbol, unknown>)[Symbol.for('alga.core.featureFlagChecker')];
    vi.unstubAllEnvs();
  });

  it('derives the variable name from any flag key', () => {
    expect(flagTargetingEnvName('release-v2-0-feature')).toBe('FEATURE_FLAG_TENANTS__RELEASE_V2_0_FEATURE');
    expect(flagTargetingEnvName(OTHER)).toBe(OTHER_ENV);
  });

  it('is not configured by default, so the normal evaluator decides', async () => {
    expect(resolveFlagTargeting(OTHER, OZ)).toBeNull();
    checker.mockResolvedValue(true);
    expect(await isFeatureFlagEnabled(OTHER, { tenantId: OZ })).toBe(true);
  });

  it('is authoritative for the configured flag only, case- and space-insensitive', async () => {
    vi.stubEnv(OTHER_ENV, ` ${OZ.toUpperCase()} , ${EMERALD}`);
    checker.mockResolvedValue(true);
    expect(await isFeatureFlagEnabled(OTHER, { tenantId: OZ })).toBe(true);
    expect(await isFeatureFlagEnabled(OTHER, { tenantId: KANSAS })).toBe(false);
    expect(await isFeatureFlagEnabled('release-v2-0-feature', { tenantId: KANSAS })).toBe(true);
    expect(checker).toHaveBeenCalledTimes(1);
  });

  it.each(['', ' ', '*', `${OZ},*`, `${OZ},`, 'true', 'not-a-tenant'])('fails closed for %j', async (raw) => {
    vi.stubEnv(OTHER_ENV, raw);
    checker.mockResolvedValue(true);
    expect(await isFeatureFlagEnabled(OTHER, { tenantId: OZ })).toBe(false);
    expect(checker).not.toHaveBeenCalled();
  });

  it('does not accept a user id as the tenant', () => {
    vi.stubEnv(OTHER_ENV, OZ);
    expect(resolveFlagTargeting(OTHER, undefined)).toBe(false);
  });

  it('cannot be opened by DISABLE_FEATURE_FLAGS, which still opens untargeted flags', async () => {
    vi.stubEnv(OTHER_ENV, OZ);
    vi.stubEnv('NEXT_PUBLIC_DISABLE_FEATURE_FLAGS', undefined);
    vi.stubEnv('DISABLE_FEATURE_FLAGS', 'true');
    expect(await isFeatureFlagEnabled(OTHER, { tenantId: KANSAS })).toBe(false);
    expect(await isFeatureFlagEnabled('untargeted', { tenantId: KANSAS })).toBe(true);
  });

  it('is read at runtime on every evaluation', async () => {
    expect(await isFeatureFlagEnabled(OTHER, { tenantId: OZ })).toBe(false);
    vi.stubEnv(OTHER_ENV, OZ);
    expect(await isFeatureFlagEnabled(OTHER, { tenantId: OZ })).toBe(true);
  });

  it('applies identically on the FeatureFlags runtime used by direct callers and the flags route', async () => {
    vi.stubEnv(OTHER_ENV, OZ);
    vi.stubEnv('ALGA_USAGE_STATS', 'false');
    const flags = new FeatureFlags();
    expect(await flags.isEnabled(OTHER, { tenantId: OZ })).toBe(true);
    expect(await flags.isEnabled(OTHER, { tenantId: KANSAS })).toBe(false);
    vi.stubEnv('NEXT_PUBLIC_DISABLE_FEATURE_FLAGS', undefined);
    vi.stubEnv('DISABLE_FEATURE_FLAGS', 'true');
    expect(await flags.isEnabled(OTHER, { tenantId: KANSAS })).toBe(false);
    expect(await flags.isEnabled('untargeted', { tenantId: KANSAS })).toBe(true);
  });
});
