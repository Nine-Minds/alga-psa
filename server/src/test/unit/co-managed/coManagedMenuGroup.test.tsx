// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => ({
  served: true,
  admitted: true,
  product: 'psa' as string,
  permissions: ['co_management:read'] as string[],
  sections: [] as any[],
}));

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: (_k: string, o?: { defaultValue?: boolean }) => o?.defaultValue ?? false,
  useCapability: (cap: string) => ({ enabled: cap === 'co-managed' && state.served, admitted: state.served && state.admitted, resolved: true }),
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (_k: string, o?: any) => o?.defaultValue ?? _k }) }));
vi.mock('@alga-psa/user-composition/actions/userQueryActions', () => ({
  getCurrentUserPermissions: () => Promise.resolve(state.permissions),
}));
vi.mock('@/context/TierContext', () => ({ useTier: () => ({ hasFeature: () => true }) }));
vi.mock('@/context/ProductContext', () => ({ useProduct: () => ({ productCode: state.product, edition: 'ee' }) }));
vi.mock('@/lib/actions/licenseManagementActions', () => ({ getLicenseStatus: () => Promise.resolve({ selfHostMode: false }) }));
vi.mock('@/components/layout/Sidebar', () => ({
  default: (p: any) => { state.sections = p.menuSections; return null; },
}));

import SidebarWithFeatureFlags from '@/components/layout/SidebarWithFeatureFlags';

const hrefs = () => state.sections.flatMap((s) => s.items.map((i: any) => i.href));

async function mount() {
  render(<SidebarWithFeatureFlags {...({} as any)} />);
  // permissions resolve asynchronously; the final render carries them
  await waitFor(() => expect(state.sections.length).toBeGreaterThan(0));
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => { state.served = true; state.admitted = true; state.product = 'psa'; state.permissions = ['co_management:read']; state.sections = []; });
afterEach(cleanup);

describe('Co-managed IT menu group (msp.navigation.group slot)', () => {
  it('psa with the capability served and co_management:read: one group, one item, /msp/co-managed', async () => {
    await mount();
    expect(hrefs().filter((h) => h === '/msp/co-managed')).toHaveLength(1);
  });

  it('co_managed with the capability and permission also gets the one item', async () => {
    state.product = 'co_managed';
    await mount();
    expect(hrefs().filter((h) => h === '/msp/co-managed')).toHaveLength(1);
  });

  it('served but not admitted: the group is still contributed (the page it targets renders read-only)', async () => {
    state.admitted = false;
    await mount();
    expect(hrefs().filter((h) => h === '/msp/co-managed')).toHaveLength(1);
  });

  it('not served: no group', async () => {
    state.served = false;
    state.admitted = false;
    await mount();
    expect(state.sections.some((s) => s.id === 'co-managed')).toBe(false);
    expect(hrefs()).not.toContain('/msp/co-managed');
  });

  it('sections carry unique React keys (the main group and the co-managed group are both untitled)', async () => {
    await mount();
    const keys = state.sections.map((s, i) => s.id ?? (s.title || `nav-section-${i}`));
    expect(state.sections.some((s) => s.id === 'co-managed')).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('capability off: absent', async () => {
    state.served = false;
    await mount();
    expect(hrefs()).not.toContain('/msp/co-managed');
  });

  it('missing co_management:read: the contribution cannot bypass the permission filter', async () => {
    state.permissions = ['ticket:read'];
    await mount();
    expect(hrefs()).not.toContain('/msp/co-managed');
  });

  it('algadesk: the contribution cannot bypass the product filter', async () => {
    state.product = 'algadesk';
    await mount();
    expect(hrefs()).not.toContain('/msp/co-managed');
  });

  it('is not a static menuConfig row', async () => {
    const { navigationSections } = await import('@/config/menuConfig');
    const all = navigationSections.flatMap((s) => s.items.flatMap((i) => [i.href, ...(i.subItems ?? []).map((x) => x.href)]));
    expect(all).not.toContain('/msp/co-managed');
  });
});
