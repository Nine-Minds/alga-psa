/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DefaultLayout from '../../../components/layout/DefaultLayout';
import { isExperimentalFeatureEnabled } from '@alga-psa/tenancy/actions';
import { KeyboardShortcutsProvider } from '@alga-psa/ui/keyboard-shortcuts';

// DefaultLayout now binds its AI shortcuts through the keyboard-shortcuts catalog
// (useCatalogShortcut), which requires a KeyboardShortcutsProvider in the tree
// (supplied by MspLayoutClient in production). Force the 'other' platform so the
// `mod` modifier resolves to Ctrl, and the catalog keydown listener lives on
// `document`, so events must be dispatched there with a `code` (e.g. KeyL).
const renderLayout = (children: React.ReactNode = <div>content</div>) =>
  render(
    <KeyboardShortcutsProvider platform="other">
      <DefaultLayout>{children}</DefaultLayout>
    </KeyboardShortcutsProvider>,
  );

const dispatchToggleChatShortcut = () => {
  const event = new KeyboardEvent('keydown', {
    key: 'l',
    code: 'KeyL',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
  act(() => {
    document.dispatchEvent(event);
  });
  return preventDefaultSpy;
};

vi.mock('next/navigation', () => ({
  usePathname: () => '/msp/dashboard',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

vi.mock('../../../components/layout/SidebarWithFeatureFlags', () => ({ default: () => null }));
vi.mock('../../../components/layout/Header', () => ({ default: () => null }));
vi.mock('../../../components/layout/Body', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../../components/layout/RightSidebar', () => ({
  default: ({ isOpen }: { isOpen: boolean }) => (
    <div data-testid="right-sidebar" data-open={isOpen ? 'true' : 'false'} />
  ),
}));

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

vi.mock('@alga-psa/tenancy/actions', () => ({
  isExperimentalFeatureEnabled: vi.fn().mockResolvedValue(false),
}));

vi.mock('server/src/context/TierContext', () => ({
  useTier: () => ({
    hasAddOn: () => true,
  }),
}));

describe('DefaultLayout sidebar chat shortcut gating', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('ignores the Sidebar Chat shortcut (⌘L/Ctrl+L) when aiAssistant is disabled', async () => {
    vi.mocked(isExperimentalFeatureEnabled).mockResolvedValueOnce(false);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({}),
      })
    );

    renderLayout();

    await waitFor(() => {
      expect(isExperimentalFeatureEnabled).toHaveBeenCalledWith('aiAssistant');
    });

    // With the AI Assistant disabled the catalog handler returns false, so the
    // event is not consumed.
    const preventDefaultSpy = dispatchToggleChatShortcut();
    expect(preventDefaultSpy).not.toHaveBeenCalled();
  });

  it('does not render the RightSidebar when aiAssistant is disabled', async () => {
    vi.mocked(isExperimentalFeatureEnabled).mockResolvedValueOnce(false);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({}),
      })
    );

    renderLayout();

    await waitFor(() => {
      expect(isExperimentalFeatureEnabled).toHaveBeenCalledWith('aiAssistant');
    });

    expect(screen.queryByTestId('right-sidebar')).not.toBeInTheDocument();
  });

  it('toggles the RightSidebar via the Sidebar Chat shortcut (⌘L/Ctrl+L) when aiAssistant is enabled', async () => {
    vi.mocked(isExperimentalFeatureEnabled).mockResolvedValueOnce(true);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({}),
      })
    );

    renderLayout();

    await waitFor(() => {
      expect(isExperimentalFeatureEnabled).toHaveBeenCalledWith('aiAssistant');
    });

    const sidebar = await screen.findByTestId('right-sidebar');
    expect(sidebar).toHaveAttribute('data-open', 'false');

    // First Ctrl+L opens the sidebar...
    const openSpy = dispatchToggleChatShortcut();
    expect(openSpy).toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByTestId('right-sidebar')).toHaveAttribute('data-open', 'true');
    });

    // ...and a second Ctrl+L toggles it closed.
    const closeSpy = dispatchToggleChatShortcut();
    expect(closeSpy).toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByTestId('right-sidebar')).toHaveAttribute('data-open', 'false');
    });
  });
});
