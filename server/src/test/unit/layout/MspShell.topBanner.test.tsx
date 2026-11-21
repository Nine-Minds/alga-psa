/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DefaultLayout from '../../../components/layout/DefaultLayout';
import AlgaDeskMspShell from '../../../components/layout/AlgaDeskMspShell';
import { KeyboardShortcutsProvider } from '@alga-psa/ui/keyboard-shortcuts';

const { navState } = vi.hoisted(() => ({ navState: { pathname: '/msp/dashboard' } }));

vi.mock('next/navigation', () => ({
  usePathname: () => navState.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('server/src/context/TierContext', () => ({
  useTier: () => ({ hasAddOn: () => true }),
}));

// Expose the sidebar's onMenuItemClick wiring so tests can simulate menu clicks.
vi.mock('../../../components/layout/SidebarWithFeatureFlags', () => ({
  default: ({ onMenuItemClick }: { onMenuItemClick?: (href?: string) => void }) => (
    <div>
      <button data-testid="nav-schedule" onClick={() => onMenuItemClick?.('/msp/schedule')}>Schedule</button>
      <button data-testid="nav-dashboard" onClick={() => onMenuItemClick?.('/msp/dashboard')}>Home</button>
    </div>
  ),
}));
vi.mock('../../../components/layout/Header', () => ({ default: () => <header data-testid="header" /> }));
vi.mock('../../../components/layout/Body', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../../components/layout/RightSidebar', () => ({ default: () => null }));

vi.mock('server/src/components/chat/QuickAskOverlay', () => ({
  default: () => null,
}));

vi.mock('@alga-psa/msp-composition/user-activities', () => ({
  ActivityDrawerProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@alga-psa/scheduling/providers/SchedulingProviderWithCallbacks', () => ({
  SchedulingProviderWithCallbacks: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@alga-psa/scheduling/providers/StopwatchProvider', () => ({
  StopwatchProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@alga-psa/msp-composition/projects', () => ({
  MspTicketIntegrationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  MspClientIntegrationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@alga-psa/msp-composition/clients', () => ({
  MspClientDrawerProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  MspClientCrossFeatureProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@alga-psa/clients/providers/QuickAddClientProviderWithCallbacks', () => ({
  QuickAddClientProviderWithCallbacks: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@alga-psa/msp-composition/assets', () => ({
  MspAssetCrossFeatureProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@alga-psa/msp-composition/documents', () => ({
  MspDocumentsCrossFeatureProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@alga-psa/ui', () => ({
  DrawerProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DrawerOutlet: () => null,
}));

vi.mock('@alga-psa/ui/components/Drawer', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@alga-psa/ui/lib', () => ({
  savePreference: vi.fn(),
}));

vi.mock('@alga-psa/tenancy/actions/tenant-settings-actions/tenantSettingsActions', () => ({
  isExperimentalFeatureEnabled: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../../components/layout/PlatformNotificationBanner', () => ({ PlatformNotificationBanner: () => null }));
vi.mock('@alga-psa/ui/components/StaleActionBanner', () => ({ StaleActionBanner: () => null }));
vi.mock('../../../components/layout/GlobalShortcutLayer', () => ({ default: () => null }));
vi.mock('@alga-psa/msp-composition/documents/MspDocumentsCrossFeatureProvider', () => ({
  MspDocumentsCrossFeatureProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@alga-psa/msp-composition/clients/AlgaDeskClientCrossFeatureProvider', () => ({
  AlgaDeskClientCrossFeatureProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@alga-psa/msp-composition/clients/MspClientTagsProvider', () => ({
  MspClientTagsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const banner = <div data-testid="top-banner">banner</div>;

const shells: Array<[string, (topBanner?: React.ReactNode) => React.ReactElement]> = [
  ['DefaultLayout', (topBanner) => (
    <KeyboardShortcutsProvider platform="other">
      <DefaultLayout topBanner={topBanner}><div>content</div></DefaultLayout>
    </KeyboardShortcutsProvider>
  )],
  ['AlgaDeskMspShell', (topBanner) => (
    <KeyboardShortcutsProvider platform="other">
      <AlgaDeskMspShell topBanner={topBanner}><div>content</div></AlgaDeskMspShell>
    </KeyboardShortcutsProvider>
  )],
];

describe.each(shells)('%s topBanner slot', (_name, renderShell) => {
  afterEach(() => cleanup());

  it('renders the banner inside the content column, before the header, not beside the fixed root', () => {
    render(renderShell(banner));
    const el = screen.getByTestId('top-banner');
    const header = screen.getByTestId('header');
    const column = header.parentElement as HTMLElement;

    expect(column).toHaveClass('flex-1', 'flex-col');
    expect(column.contains(el)).toBe(true);
    expect(el.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const root = column.parentElement as HTMLElement;
    expect(root).toHaveClass('fixed', 'inset-0');
    expect(el.parentElement).not.toBe(root.parentElement);
    expect(root.parentElement?.contains(el)).toBe(true);
    expect(Array.from(root.parentElement!.children)).not.toContain(el);
  });

  it('leaves the column unchanged when no banner is passed', () => {
    render(renderShell());
    const column = screen.getByTestId('header').parentElement as HTMLElement;
    expect(column.firstElementChild).toBe(screen.getByTestId('header'));
  });
});
