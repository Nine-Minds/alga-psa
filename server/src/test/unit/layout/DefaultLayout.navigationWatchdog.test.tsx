/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DefaultLayout from '../../../components/layout/DefaultLayout';
import { KeyboardShortcutsProvider } from '@alga-psa/ui/keyboard-shortcuts';

const { pushMock, navState } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  navState: { pathname: '/msp/dashboard' },
}));

vi.mock('next/navigation', () => ({
  usePathname: () => navState.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: pushMock }),
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
vi.mock('../../../components/layout/Header', () => ({ default: () => null }));
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

const renderLayout = () =>
  render(
    <KeyboardShortcutsProvider platform="other">
      <DefaultLayout>
        <div>content</div>
      </DefaultLayout>
    </KeyboardShortcutsProvider>,
  );

describe('DefaultLayout navigation commit watchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    navState.pathname = '/msp/dashboard';
    window.history.replaceState({}, '', '/');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    pushMock.mockClear();
  });

  it('re-pushes a cross-path menu navigation that never commits', async () => {
    renderLayout();
    await act(async () => {});

    fireEvent.click(screen.getByTestId('nav-schedule'));
    expect(pushMock).not.toHaveBeenCalled();

    // window.location never moves, so the watchdog retries the push.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith('/msp/schedule');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(pushMock).toHaveBeenCalledTimes(2);
  });

  it('cancels pending retries once the pathname commits', async () => {
    const view = renderLayout();
    await act(async () => {});

    fireEvent.click(screen.getByTestId('nav-schedule'));

    navState.pathname = '/msp/schedule';
    view.rerender(
      <KeyboardShortcutsProvider platform="other">
        <DefaultLayout>
          <div>content</div>
        </DefaultLayout>
      </KeyboardShortcutsProvider>,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('does not arm the watchdog for same-path menu clicks', async () => {
    renderLayout();
    await act(async () => {});

    fireEvent.click(screen.getByTestId('nav-dashboard'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(pushMock).not.toHaveBeenCalled();
  });
});
