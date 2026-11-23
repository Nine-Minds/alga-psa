/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientPortalSidebar } from './ClientPortalSidebar';

vi.mock('next/link', () => ({ default: ({ href, children, ...p }: any) => <a href={href} {...p}>{children}</a> }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('next/navigation', () => ({ usePathname: () => '/client-portal/dashboard' }));
vi.mock('@alga-psa/tenancy/components', () => ({ useBranding: () => ({ branding: null }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (k: string, f?: string) => (typeof f === 'string' ? f : k) }),
}));
vi.mock('@alga-psa/ui/components/CollapseToggleButton', () => ({ CollapseToggleButton: () => null }));
vi.mock('@alga-psa/ui/components/Skeleton', () => ({ Skeleton: () => null }));
vi.mock('@alga-psa/ui/hooks/useSurfaceIsLight', () => ({ useSurfaceIsLight: () => true }));
vi.mock('@alga-psa/ui/lib/surfaceColor', () => ({ pickLogoForSurface: () => null }));
vi.mock('@alga-psa/ui/lib/cookies', () => ({
  getPreferenceWithFallback: (_k: string, d: string) => d,
  savePreference: () => {},
}));
vi.mock('./ClientPortalExtensionsNav', () => ({ ClientPortalExtensionsNav: () => null }));

const base = {
  hasClientReadAccess: false,
  hasBillingAccess: false,
  hasUserManagementAccess: false,
  hasVisibilityGroupAccess: false,
  isHosted: false,
  hasProjectAccess: false,
  hasDocumentAccess: false,
  isLicenseDistributor: false,
};
const link = (c: HTMLElement) => c.querySelector('a[href="/client-portal/client-settings"]');

describe('ClientPortalSidebar Client Settings link (rendered)', () => {
  afterEach(cleanup);

  it('is absent when no settings tab is permitted', () => {
    const { container } = render(<ClientPortalSidebar permissions={base} permissionsLoaded />);
    expect(link(container)).toBeNull();
  });

  it('is present when a settings tab is permitted', () => {
    const { container } = render(
      <ClientPortalSidebar permissions={{ ...base, hasClientReadAccess: true }} permissionsLoaded />,
    );
    expect(link(container)).not.toBeNull();
  });
});
