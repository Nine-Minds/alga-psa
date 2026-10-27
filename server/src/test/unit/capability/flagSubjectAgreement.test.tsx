// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Server and client agree on `release-v2-0-feature` and on the capability,
 * through the real evaluator and the real client hooks.
 *
 * Server: `featureFlags.isEnabled` (registered as initializeApp does) against a
 * posthog-node fake. Client: `useFeatureFlag` / `useCapability` against a
 * posthog-js fake that answers for the PERSON subject
 * (`anonymous_<tenant>_<user>`, no group) — deliberately the opposite of the
 * tenant-group answer, which is what a group-targeted, person-targeted or
 * percentage rule can do. The bootstrapped value must win on first paint and
 * after PostHog delivers its own flags.
 */

const posthogNode = vi.hoisted(() => ({ onTenants: new Set<string>(), isFeatureEnabled: vi.fn() }));
const posthogJs = vi.hoisted(() => ({
  isFeatureEnabled: vi.fn(),
  deliver: [] as Array<() => void>,
  onFeatureFlags: vi.fn(),
}));

vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: <T,>(fn: T) => fn }));
vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('server/src/lib/analytics/posthog', () => ({
  analytics: { isEnabled: true, getClient: () => posthogNode, capture: vi.fn() },
}));
vi.mock('server/src/lib/db', () => ({ createTenantKnex: vi.fn(async () => ({ knex: {} })) }));
vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({ table: () => ({ first: async () => ({ created_at: 'x', status: 'active' }) }) }),
}));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'u1', tenant: 'internal' } } }) }));
vi.mock('posthog-js/react', () => ({ usePostHog: () => posthogJs }));

import { registerFeatureFlagChecker } from '@alga-psa/core/features';
import {
  admits,
  registerCapabilityEligibility,
  registerCapabilityParticipation,
  serves,
} from '@alga-psa/core/capability';
import { clearCapabilityCache, resetCapabilityRegistry } from '@alga-psa/core/capability/testing';
import { FeatureFlagBootstrapProvider, useCapability, useFeatureFlag } from '@alga-psa/ui/hooks';
import { clearTenantFlagPropertiesCache, featureFlags } from '../../../lib/feature-flags/featureFlags';
import { resolveCapabilityBootstrap } from '../../../lib/capability/bootstrap';

const FLAG = 'release-v2-0-feature';

function renderClient(bootstrap: Record<string, boolean>) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <FeatureFlagBootstrapProvider initialFeatureFlags={bootstrap}>{children}</FeatureFlagBootstrapProvider>
  );
  return renderHook(
    () => ({ flag: useFeatureFlag(FLAG, { defaultValue: false }), capability: useCapability('co-managed') }),
    { wrapper },
  );
}

describe('server/client agreement through the real evaluator', () => {
  afterEach(() => {
    resetCapabilityRegistry();
    (globalThis as any)[Symbol.for('alga.core.featureFlagChecker')] = undefined;
  });

  beforeEach(() => {
    delete process.env.FORCE_CAPABILITIES;
    delete process.env.DISABLE_FEATURE_FLAGS;
    delete process.env.NEXT_PUBLIC_DISABLE_FEATURE_FLAGS;
    // Tenant-group targeting: on for the internal tenant only.
    posthogNode.onTenants = new Set(['internal']);
    posthogNode.isFeatureEnabled.mockReset();
    posthogNode.isFeatureEnabled.mockImplementation(
      async (_f: string, _id: string, opts?: { groups?: { tenant?: string } }) =>
        posthogNode.onTenants.has(opts?.groups?.tenant ?? ''),
    );
    registerFeatureFlagChecker((flag, ctx) => featureFlags.isEnabled(flag, ctx));
    featureFlags.clearCache();
    clearTenantFlagPropertiesCache();
    registerCapabilityEligibility('co-managed', async ({ tenantId }) => tenantId === 'internal');
    registerCapabilityParticipation('co-managed', async ({ tenantIds }) => tenantIds.filter((t) => t === 'internal'));
    clearCapabilityCache();
    posthogJs.deliver = [];
    posthogJs.onFeatureFlags.mockReset();
    posthogJs.onFeatureFlags.mockImplementation((cb: () => void) => {
      posthogJs.deliver.push(cb);
      return () => {};
    });
  });

  it.each([
    ['internal', true],
    ['control', false],
  ])('tenant %s: client flag and capability equal the server, even when the person-subject answer disagrees', async (tenant, expected) => {
    const bootstrap = await resolveCapabilityBootstrap(tenant);
    expect(bootstrap[FLAG]).toBe(expected);

    // posthog-js (person subject) answers the opposite.
    posthogJs.isFeatureEnabled.mockReset();
    posthogJs.isFeatureEnabled.mockReturnValue(!expected);
    const { result } = renderClient(bootstrap);
    expect(result.current.flag).toMatchObject({ enabled: expected, resolved: true });

    await act(async () => {
      for (const deliver of posthogJs.deliver) deliver();
      await new Promise((r) => setTimeout(r, 250));
    });

    expect(result.current.flag.enabled).toBe(expected);
    expect(result.current.capability).toMatchObject({
      enabled: (await serves('co-managed', tenant)).served,
      admitted: (await admits('co-managed', tenant)).admitted,
      resolved: true,
    });
    expect(result.current.capability.admitted).toBe(expected);
    // The server evaluated the tenant subject, never a user.
    for (const [, distinctId, opts] of posthogNode.isFeatureEnabled.mock.calls) {
      expect(distinctId).toBe(`tenant_${tenant}`);
      expect(opts.groups).toEqual({ tenant });
    }
  });
});
