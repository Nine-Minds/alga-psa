/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DefaultLayout from '../../../components/layout/DefaultLayout';
import { isExperimentalFeatureEnabled } from '@alga-psa/tenancy/actions';

const routerPush = vi.fn();
const mockCancelHandler = vi.fn();
let sidebarIsInterruptible = false;
const translations: Record<string, string> = {
  'dialogs.aiInterrupt.navigate.title': 'Quitter la page et annuler la reponse IA ?',
  'dialogs.aiInterrupt.navigate.message':
    'Une reponse IA ou une action d outil est toujours en cours. Quitter cette page va l annuler.',
  'dialogs.aiInterrupt.navigate.confirm': 'Quitter la page',
  'dialogs.aiInterrupt.navigate.cancel': 'Rester sur la page',
  'dialogs.aiInterrupt.closeChat.title': 'Fermer le chat et annuler la reponse IA ?',
  'dialogs.aiInterrupt.closeChat.message':
    'Une reponse IA ou une action d outil est toujours en cours. Fermer le chat va l annuler.',
  'dialogs.aiInterrupt.closeChat.confirm': 'Fermer le chat',
  'dialogs.aiInterrupt.closeChat.cancel': 'Garder le chat ouvert',
};

vi.mock('next/navigation', () => ({
  usePathname: () => '/msp/dashboard',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    push: routerPush,
  }),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | { defaultValue?: string }) => {
      if (translations[key]) {
        return translations[key];
      }
      if (typeof options === 'string') {
        return options;
      }
      return options?.defaultValue ?? key;
    },
  }),
}));

vi.mock('../../../components/layout/SidebarWithFeatureFlags', () => ({ default: () => null }));
vi.mock('../../../components/layout/Header', () => ({
  default: ({
    setRightSidebarOpen,
  }: {
    setRightSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  }) => (
    <button type="button" onClick={() => setRightSidebarOpen(true)}>
      Open sidebar
    </button>
  ),
}));
vi.mock('../../../components/layout/Body', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../../components/layout/RightSidebar', () => ({
  default: function MockRightSidebar({
    isOpen,
    onRequestClose,
    onInterruptibleStateChange,
    onRegisterCancelHandler,
  }: {
    isOpen: boolean;
    onRequestClose?: () => void;
    onInterruptibleStateChange?: (isInterruptible: boolean) => void;
    onRegisterCancelHandler?: (cancelHandler: (() => void) | null) => void;
  }) {
    React.useEffect(() => {
      onInterruptibleStateChange?.(isOpen && sidebarIsInterruptible);
      onRegisterCancelHandler?.(isOpen ? mockCancelHandler : null);
      return () => {
        onInterruptibleStateChange?.(false);
        onRegisterCancelHandler?.(null);
      };
    }, [isOpen, onInterruptibleStateChange, onRegisterCancelHandler]);

    return (
      <div data-testid="right-sidebar" data-open={isOpen ? 'true' : 'false'}>
        <button type="button" onClick={onRequestClose}>
          Request close
        </button>
      </div>
    );
  },
}));

vi.mock('server/src/components/chat/QuickAskOverlay', () => ({
  default: () => null,
}));

vi.mock('@alga-psa/workflows/components', () => ({
  ActivityDrawerProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@alga-psa/scheduling/providers/SchedulingProviderWithCallbacks', () => ({
  SchedulingProviderWithCallbacks: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@alga-psa/msp-composition/scheduling/MspSchedulingCrossFeatureProvider', () => ({
  MspSchedulingCrossFeatureProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: ({
    isOpen,
    title,
    message,
    onConfirm,
    onClose,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
  }: {
    isOpen: boolean;
    title: string;
    message: React.ReactNode;
    onConfirm: () => void | Promise<void>;
    onClose: () => void;
    confirmLabel?: string;
    cancelLabel?: string;
  }) =>
    isOpen ? (
      <div data-testid="interrupt-confirmation">
        <h1>{title}</h1>
        <p>{message}</p>
        <button type="button" onClick={() => void onConfirm()}>
          {confirmLabel}
        </button>
        <button type="button" onClick={onClose}>
          {cancelLabel}
        </button>
      </div>
    ) : null,
}));

vi.mock('@alga-psa/ui/components/Drawer', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@alga-psa/ui/lib', () => ({
  savePreference: vi.fn(),
}));

vi.mock('@alga-psa/tenancy/actions', () => ({
  isExperimentalFeatureEnabled: vi.fn().mockResolvedValue(true),
}));

describe('DefaultLayout AI interrupt guard', () => {
  beforeEach(() => {
    sidebarIsInterruptible = false;
    routerPush.mockReset();
    mockCancelHandler.mockReset();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({}),
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('warns before closing the sidebar with Cmd+L while AI work is interruptible', async () => {
    sidebarIsInterruptible = true;

    render(
      <DefaultLayout>
        <div>content</div>
      </DefaultLayout>
    );

    await waitFor(() => {
      expect(isExperimentalFeatureEnabled).toHaveBeenCalledWith('aiAssistant');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open sidebar' }));

    await waitFor(() => {
      expect(screen.getByTestId('right-sidebar')).toHaveAttribute('data-open', 'true');
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', metaKey: true }));
    });

    expect(await screen.findByTestId('interrupt-confirmation')).toBeInTheDocument();
    expect(screen.getByText('Fermer le chat et annuler la reponse IA ?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Garder le chat ouvert' })).toBeInTheDocument();
    expect(screen.getByTestId('right-sidebar')).toHaveAttribute('data-open', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Fermer le chat' }));

    await waitFor(() => {
      expect(mockCancelHandler).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('right-sidebar')).toHaveAttribute('data-open', 'false');
    });
  });

  it('warns before in-app navigation while AI work is interruptible', async () => {
    sidebarIsInterruptible = true;

    render(
      <DefaultLayout>
        <a href="/msp/tickets">Go to tickets</a>
      </DefaultLayout>
    );

    await waitFor(() => {
      expect(isExperimentalFeatureEnabled).toHaveBeenCalledWith('aiAssistant');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open sidebar' }));

    await waitFor(() => {
      expect(screen.getByTestId('right-sidebar')).toHaveAttribute('data-open', 'true');
    });

    fireEvent.click(screen.getByText('Go to tickets'));

    expect(await screen.findByTestId('interrupt-confirmation')).toBeInTheDocument();
    expect(screen.getByText('Quitter la page et annuler la reponse IA ?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rester sur la page' })).toBeInTheDocument();
    expect(routerPush).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Quitter la page' }));

    await waitFor(() => {
      expect(mockCancelHandler).toHaveBeenCalledTimes(1);
      expect(routerPush).toHaveBeenCalledWith('/msp/tickets');
    });
  });

  it('blocks browser unload while AI work is interruptible', async () => {
    sidebarIsInterruptible = true;

    render(
      <DefaultLayout>
        <div>content</div>
      </DefaultLayout>
    );

    await waitFor(() => {
      expect(isExperimentalFeatureEnabled).toHaveBeenCalledWith('aiAssistant');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open sidebar' }));

    await waitFor(() => {
      expect(screen.getByTestId('right-sidebar')).toHaveAttribute('data-open', 'true');
    });

    const beforeUnloadEvent = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    Object.defineProperty(beforeUnloadEvent, 'returnValue', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    act(() => {
      window.dispatchEvent(beforeUnloadEvent);
    });

    expect(beforeUnloadEvent.defaultPrevented).toBe(true);
    expect(beforeUnloadEvent.returnValue).toBe('');
  });
});
