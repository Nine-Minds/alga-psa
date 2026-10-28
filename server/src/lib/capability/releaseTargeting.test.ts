import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isFeatureFlagEnabled, registerFeatureFlagChecker } from '@alga-psa/core/features';
import {
  evaluateCapability,
  registerCapabilityEligibility,
  registerCapabilityParticipation,
} from '@alga-psa/core/capability';
import { resetCapabilityRegistry } from '@alga-psa/core/capability/testing';
import { resolveCapabilityBootstrap } from './bootstrap';

const OZ = '00000000-0000-4000-8000-000000000001';
const EMERALD = '00000000-0000-4000-8000-000000000002';
const KANSAS = '00000000-0000-4000-8000-000000000003';
const checker = vi.fn(async () => false);

describe('production release tenant targeting', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RELEASE_V2_0_FEATURE_TENANTS', `${OZ}, ${EMERALD}`);
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
    vi.stubEnv('RELEASE_V2_0_FEATURE_TENANTS', undefined);
    expect(await isFeatureFlagEnabled('release-v2-0-feature', { tenantId: OZ })).toBe(false);
    checker.mockResolvedValue(true);
    expect(await isFeatureFlagEnabled('release-v2-0-feature', { tenantId: OZ })).toBe(true);
  });

  it.each(['', '*', `${OZ},*`, `${OZ},`, 'true', 'not-a-tenant'])('fails closed for empty or invalid targeting %j', async (raw) => {
    vi.stubEnv('RELEASE_V2_0_FEATURE_TENANTS', raw);
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
