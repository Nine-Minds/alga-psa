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

vi.mock('next/navigation', () => ({
  usePathname: () => '/msp/dashboard',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn() }),
}));

// AI Assistant availability is gated on both the experimental flag and the tier
// add-on; stub the tier hook so only the flag drives the tests.
vi.mock('server/src/context/TierContext', () => ({
  useTier: () => ({ hasAddOn: () => true }),
}));

vi.mock('../../../components/layout/SidebarWithFeatureFlags', () => ({ default: () => null }));
vi.mock('../../../components/layout/Header', () => ({ default: () => null }));
vi.mock('../../../components/layout/Body', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../../components/layout/RightSidebar', () => ({ default: () => null }));

vi.mock('server/src/components/chat/QuickAskOverlay', () => ({
  default: ({ isOpen }: { isOpen: boolean }) => (
    <div data-testid="quick-ask-overlay" data-open={isOpen ? 'true' : 'false'} />
  ),
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

// DefaultLayout's Quick Ask shortcut is registered through the keyboard-shortcuts
// catalog (ai.quickAsk -> `mod+ArrowUp`), which needs a KeyboardShortcutsProvider
// in the tree. Force the 'other' platform so `mod` resolves to Ctrl; the catalog
// keydown listener lives on `document` and matches on `code` (ArrowUp).
const renderLayout = () =>
  render(
    <KeyboardShortcutsProvider platform="other">
      <DefaultLayout>
        <div>content</div>
      </DefaultLayout>
    </KeyboardShortcutsProvider>,
  );

const dispatchQuickAskShortcut = () => {
  const event = new KeyboardEvent('keydown', {
    key: 'ArrowUp',
    code: 'ArrowUp',
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

describe('DefaultLayout AI Assistant gating', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('does not render QuickAskOverlay when aiAssistant is disabled', async () => {
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

    expect(screen.queryByTestId('quick-ask-overlay')).not.toBeInTheDocument();
  });

  it('renders QuickAskOverlay when aiAssistant is enabled', async () => {
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

    await waitFor(() => {
      expect(screen.getByTestId('quick-ask-overlay')).toHaveAttribute('data-open', 'false');
    });
  });

  it('ignores the Quick Ask shortcut when aiAssistant is disabled', async () => {
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

    const preventDefaultSpy = dispatchQuickAskShortcut();

    expect(preventDefaultSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('quick-ask-overlay')).not.toBeInTheDocument();
  });

  it('opens Quick Ask via shortcut when aiAssistant is enabled', async () => {
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

    await waitFor(() => {
      expect(screen.getByTestId('quick-ask-overlay')).toHaveAttribute('data-open', 'false');
    });

    const preventDefaultSpy = dispatchQuickAskShortcut();

    expect(preventDefaultSpy).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByTestId('quick-ask-overlay')).toHaveAttribute('data-open', 'true');
    });
  });
});
