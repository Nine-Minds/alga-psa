// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The card's one production wire: the root layout evaluates the bootstrap for
 * the request's tenant and hands it to `<PostHogProvider initialFeatureFlags>`.
 * Without it `useCapability` is permanently `resolved: false` (which looks like
 * a disabled feature, not a bug) and the Timeline loses its server value.
 *
 * This renders the real `RootLayout`, takes the `PostHogProvider` element it
 * produced (with exactly the props the layout gave it), and mounts it — the
 * real provider, the real bootstrap and gate, the real hooks — around a probe
 * that reads `useCapability('co-managed')` and `useFeatureFlag(release flag)`.
 * Only the request environment and unrelated tenant lookups are stubbed.
 */

const env = vi.hoisted(() => ({ tenant: 'internal' as string | null }));
const flagChecker = vi.hoisted(() => vi.fn(async () => true));

vi.mock('next/font/local', () => ({ default: () => ({ className: 'font', variable: '--font' }) }));
vi.mock('next/headers.js', () => ({
  headers: async () => new Headers({ host: 'localhost:3000', 'x-pathname': '/msp/projects' }),
  cookies: async () => ({ get: () => undefined, getAll: () => [] }),
}));
vi.mock('@alga-psa/tenancy/actions/coreTenantActions', () => ({ getCurrentTenant: async () => env.tenant }));
vi.mock('@alga-psa/tenancy/actions/tenant-actions/getTenantBrandingByDomain', () => ({
  getTenantBrandingByDomain: async () => null,
  getTenantPortalConfigBySlug: async () => ({ branding: null, theme: {} }),
  getTenantThemeByDomain: async () => ({}),
}));
vi.mock('@alga-psa/tenancy/actions/tenant-actions/tenantThemeActions', () => ({
  getTenantThemeByTenantId: async () => ({ pairId: 'default' }),
}));
vi.mock('@alga-psa/tenancy/actions/locale-actions/getHierarchicalLocale', () => ({ getHierarchicalLocaleAction: async () => 'en' }));
vi.mock('@alga-psa/tenancy', () => ({ generateBrandingStyles: () => '' }));
vi.mock('@alga-psa/ui/lib/i18n/serverOnly', () => ({
  getServerLocale: async () => 'en',
  getServerTranslation: async () => ({ t: (k: string) => k }),
  registerServerLocaleResolver: () => {},
}));
vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: <T,>(fn: T) => fn }));
vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
// Client side of the provider: PostHog itself is off (usage stats disabled), as when posthog-js is blocked.
vi.mock('@alga-psa/analytics/client', () => ({ isPostHogEnabled: () => false, posthogConfig: { features: {}, defaultConfig: {} } }));
vi.mock('posthog-js', () => ({ default: { init: vi.fn() } }));
vi.mock('posthog-js/react', () => ({
  PostHogProvider: ({ children }: { children: ReactNode }) => children,
  usePostHog: () => null,
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/msp/projects', useSearchParams: () => new URLSearchParams() }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null }) }));

import RootLayout from '../../../app/layout';
import { PostHogProvider } from '../../../components/providers/PostHogProvider';
import { registerFeatureFlagChecker } from '@alga-psa/core/features';
import { useCapability, useFeatureFlag } from '@alga-psa/ui/hooks';
import { clearCapabilityCache, resetCapabilityRegistry } from '@alga-psa/core/capability/testing';

function Probe() {
  const capability = useCapability('co-managed');
  const flag = useFeatureFlag('release-v2-0-feature', { defaultValue: false });
  return (
    <output data-testid="probe">
      {JSON.stringify({ capability, flag: { enabled: flag.enabled, resolved: flag.resolved } })}
    </output>
  );
}

function findElement(node: ReactNode, type: unknown): ReactElement | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findElement(child, type);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (node.type === type) return node;
  return findElement((node.props as { children?: ReactNode }).children, type);
}

async function renderLayoutProvider(): Promise<{ capability: Record<string, boolean>; flag: Record<string, boolean> }> {
  const tree = await RootLayout({ children: null });
  const provider = findElement(tree, PostHogProvider);
  expect(provider, 'RootLayout must render PostHogProvider').not.toBeNull();
  const { children: _layoutChildren, ...props } = provider!.props as { children?: ReactNode };
  render(createElement(PostHogProvider, props as any, <Probe />));
  return JSON.parse(screen.getByTestId('probe').textContent!);
}

describe('root layout -> PostHogProvider bootstrap wiring', () => {
  beforeEach(() => {
    env.tenant = 'internal';
    delete process.env.FORCE_CAPABILITIES;
    delete process.env.DISABLE_FEATURE_FLAGS;
    delete process.env.NEXT_PUBLIC_DISABLE_FEATURE_FLAGS;
    flagChecker.mockClear();
    registerFeatureFlagChecker(flagChecker);
    resetCapabilityRegistry();
    clearCapabilityCache();
  });
  afterEach(() => {
    delete process.env.FORCE_CAPABILITIES;
    (globalThis as any)[Symbol.for('alga.core.featureFlagChecker')] = undefined;
    resetCapabilityRegistry();
  });

  it('a signed-in tenant: the capability is resolved (closed today) and the Timeline flag carries the server value, with PostHog off', async () => {
    const state = await renderLayoutProvider();
    expect(state.capability).toEqual({ enabled: false, admitted: false, resolved: true });
    expect(state.flag).toEqual({ enabled: true, resolved: true });
    expect(flagChecker).toHaveBeenCalledWith('release-v2-0-feature', { tenantId: 'internal' });
  });

  it('FORCE_CAPABILITIES=co-managed:on reaches the client hook through the layout', async () => {
    process.env.FORCE_CAPABILITIES = 'co-managed:on';
    const state = await renderLayoutProvider();
    expect(state.capability).toEqual({ enabled: true, admitted: true, resolved: true });
  });

  it('no tenant (signed out): empty bootstrap, the capability is unresolved and closed', async () => {
    env.tenant = null;
    const state = await renderLayoutProvider();
    expect(state.capability).toEqual({ enabled: false, admitted: false, resolved: false });
    expect(flagChecker).not.toHaveBeenCalled();
  });
});
