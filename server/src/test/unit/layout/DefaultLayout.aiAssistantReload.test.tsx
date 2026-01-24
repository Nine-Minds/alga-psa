/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';

import DefaultLayout from '../../../components/layout/DefaultLayout';
import { isExperimentalFeatureEnabled } from '@alga-psa/tenancy/actions';

let aiAssistantEnabled = false;

vi.mock('next/navigation', () => ({
  usePathname: () => '/msp/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('../../../components/layout/SidebarWithFeatureFlags', () => ({ default: () => null }));
vi.mock('../../../components/layout/Header', () => ({ default: () => null }));
vi.mock('../../../components/layout/Body', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../components/layout/RightSidebar', () => ({ default: () => null }));

vi.mock('server/src/components/chat/QuickAskOverlay', () => ({
  default: ({ isOpen }: { isOpen: boolean }) => (
    <div data-testid="quick-ask-overlay" data-open={isOpen ? 'true' : 'false'} />
  ),
}));

vi.mock('@alga-psa/workflows/components', () => ({
  ActivityDrawerProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@alga-psa/ui', () => ({
  DrawerProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@alga-psa/ui/components/Drawer', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@alga-psa/ui/lib', () => ({
  savePreference: vi.fn(),
}));

vi.mock('@alga-psa/tenancy/actions', () => ({
  isExperimentalFeatureEnabled: vi.fn(() => Promise.resolve(aiAssistantEnabled)),
}));

describe('DefaultLayout AI Assistant gating (reload semantics)', () => {
  it('allows Quick Ask usage after enabling AI Assistant and reloading', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({}),
      }),
    );

    aiAssistantEnabled = false;

    const first = render(
      <DefaultLayout>
        <div>content</div>
      </DefaultLayout>,
    );

    await waitFor(() => {
      expect(isExperimentalFeatureEnabled).toHaveBeenCalledWith('aiAssistant');
    });

    const disabledEvent = new KeyboardEvent('keydown', { key: 'ArrowUp', metaKey: true });
    const disabledPrevent = vi.spyOn(disabledEvent, 'preventDefault');
    act(() => {
      window.dispatchEvent(disabledEvent);
    });
    expect(disabledPrevent).not.toHaveBeenCalled();
    expect(screen.queryByTestId('quick-ask-overlay')).not.toBeInTheDocument();

    first.unmount();

    aiAssistantEnabled = true;

    render(
      <DefaultLayout>
        <div>content</div>
      </DefaultLayout>,
    );

    await waitFor(() => {
      expect(isExperimentalFeatureEnabled).toHaveBeenCalledWith('aiAssistant');
    });

    await waitFor(() => {
      expect(screen.getByTestId('quick-ask-overlay')).toHaveAttribute('data-open', 'false');
    });

    const enabledEvent = new KeyboardEvent('keydown', { key: 'ArrowUp', metaKey: true });
    const enabledPrevent = vi.spyOn(enabledEvent, 'preventDefault');
    act(() => {
      window.dispatchEvent(enabledEvent);
    });

    expect(enabledPrevent).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByTestId('quick-ask-overlay')).toHaveAttribute('data-open', 'true');
    });
  });

  it('prevents Quick Ask usage after disabling AI Assistant and reloading', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({}),
      }),
    );

    aiAssistantEnabled = true;

    const first = render(
      <DefaultLayout>
        <div>content</div>
      </DefaultLayout>,
    );

    await waitFor(() => {
      expect(isExperimentalFeatureEnabled).toHaveBeenCalledWith('aiAssistant');
    });

    await waitFor(() => {
      expect(screen.getByTestId('quick-ask-overlay')).toHaveAttribute('data-open', 'false');
    });

    const enabledEvent = new KeyboardEvent('keydown', { key: 'ArrowUp', metaKey: true });
    const enabledPrevent = vi.spyOn(enabledEvent, 'preventDefault');
    act(() => {
      window.dispatchEvent(enabledEvent);
    });

    expect(enabledPrevent).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByTestId('quick-ask-overlay')).toHaveAttribute('data-open', 'true');
    });

    first.unmount();

    aiAssistantEnabled = false;

    render(
      <DefaultLayout>
        <div>content</div>
      </DefaultLayout>,
    );

    await waitFor(() => {
      expect(isExperimentalFeatureEnabled).toHaveBeenCalledWith('aiAssistant');
    });

    expect(screen.queryByTestId('quick-ask-overlay')).not.toBeInTheDocument();

    const disabledEvent = new KeyboardEvent('keydown', { key: 'ArrowUp', metaKey: true });
    const disabledPrevent = vi.spyOn(disabledEvent, 'preventDefault');
    act(() => {
      window.dispatchEvent(disabledEvent);
    });

    expect(disabledPrevent).not.toHaveBeenCalled();
    expect(screen.queryByTestId('quick-ask-overlay')).not.toBeInTheDocument();
  });
});
