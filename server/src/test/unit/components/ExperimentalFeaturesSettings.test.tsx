/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UIStateProvider } from '@alga-psa/ui/ui-reflection/UIStateContext';
import { toast } from 'react-hot-toast';

import ExperimentalFeaturesSettings from '../../../components/settings/general/ExperimentalFeaturesSettings';
import { getExperimentalFeatures, updateExperimentalFeatures } from '@alga-psa/tenancy/actions';

vi.mock('@alga-psa/tenancy/actions', () => ({
  getExperimentalFeatures: vi.fn().mockResolvedValue({ aiAssistant: false, workflowAutomation: false }),
  updateExperimentalFeatures: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('ExperimentalFeaturesSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows 'AI Assistant' name and description", async () => {
    vi.mocked(getExperimentalFeatures).mockResolvedValueOnce({ aiAssistant: false, workflowAutomation: false });

    render(
      <UIStateProvider
        initialPageState={{
          id: 'test-page',
          title: 'Test Page',
          components: [],
        }}
      >
        <ExperimentalFeaturesSettings />
      </UIStateProvider>
    );

    expect(await screen.findByText('AI Assistant')).toBeInTheDocument();
    expect(
      screen.getByText('Enable AI-powered Quick Ask and Chat sidebar.')
    ).toBeInTheDocument();
  });

  it('defaults AI Assistant toggle to off', async () => {
    vi.mocked(getExperimentalFeatures).mockResolvedValueOnce({} as any);

    render(
      <UIStateProvider
        initialPageState={{
          id: 'test-page',
          title: 'Test Page',
          components: [],
        }}
      >
        <ExperimentalFeaturesSettings />
      </UIStateProvider>
    );

    const toggle = await waitFor(() => {
      const el = document.querySelector(
        '[data-automation-id="experimental-feature-toggle-aiAssistant"]'
      ) as HTMLElement | null;
      expect(el).toBeTruthy();
      return el!;
    });

    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('renders experimental features warning banner', async () => {
    vi.mocked(getExperimentalFeatures).mockResolvedValueOnce({ aiAssistant: false, workflowAutomation: false });

    render(
      <UIStateProvider
        initialPageState={{
          id: 'test-page',
          title: 'Test Page',
          components: [],
        }}
      >
        <ExperimentalFeaturesSettings />
      </UIStateProvider>
    );

    expect(await screen.findByText('Experimental')).toBeInTheDocument();
    expect(
      screen.getByText('Experimental features may change or be removed without notice.')
    ).toBeInTheDocument();
  });

  it('calls updateExperimentalFeatures() with current toggle states on save', async () => {
    vi.mocked(getExperimentalFeatures).mockResolvedValueOnce({ aiAssistant: false, workflowAutomation: false });
    vi.mocked(updateExperimentalFeatures).mockResolvedValueOnce(undefined);

    render(
      <UIStateProvider
        initialPageState={{
          id: 'test-page',
          title: 'Test Page',
          components: [],
        }}
      >
        <ExperimentalFeaturesSettings />
      </UIStateProvider>
    );

    const toggle = await waitFor(() => {
      const el = document.querySelector(
        '[data-automation-id="experimental-feature-toggle-aiAssistant"]'
      ) as HTMLElement | null;
      expect(el).toBeTruthy();
      return el!;
    });

    fireEvent.click(toggle);

    const saveButton = await screen.findByRole('button', { name: 'Save' });
    await waitFor(() => {
      expect(saveButton).not.toBeDisabled();
    });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(updateExperimentalFeatures).toHaveBeenCalledWith({ aiAssistant: true, workflowAutomation: false });
    });
  });

  it('shows success feedback after saving', async () => {
    vi.mocked(getExperimentalFeatures).mockResolvedValueOnce({ aiAssistant: false, workflowAutomation: false });
    vi.mocked(updateExperimentalFeatures).mockResolvedValueOnce(undefined);

    render(
      <UIStateProvider
        initialPageState={{
          id: 'test-page',
          title: 'Test Page',
          components: [],
        }}
      >
        <ExperimentalFeaturesSettings />
      </UIStateProvider>
    );

    const toggle = await waitFor(() => {
      const el = document.querySelector(
        '[data-automation-id="experimental-feature-toggle-aiAssistant"]'
      ) as HTMLElement | null;
      expect(el).toBeTruthy();
      return el!;
    });

    fireEvent.click(toggle);

    const saveButton = await screen.findByRole('button', { name: 'Save' });
    await waitFor(() => {
      expect(saveButton).not.toBeDisabled();
    });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
        'Experimental feature settings saved. Reload the page to apply changes.'
      );
    });
  });

  it('updates local state when toggled', async () => {
    vi.mocked(getExperimentalFeatures).mockResolvedValueOnce({ aiAssistant: false, workflowAutomation: false });

    render(
      <UIStateProvider
        initialPageState={{
          id: 'test-page',
          title: 'Test Page',
          components: [],
        }}
      >
        <ExperimentalFeaturesSettings />
      </UIStateProvider>
    );

    const toggle = await waitFor(() => {
      const el = document.querySelector(
        '[data-automation-id="experimental-feature-toggle-aiAssistant"]'
      ) as HTMLElement | null;
      expect(el).toBeTruthy();
      return el!;
    });

    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('loads current settings on mount', async () => {
    vi.mocked(getExperimentalFeatures).mockResolvedValueOnce({ aiAssistant: true, workflowAutomation: false });

    render(
      <UIStateProvider
        initialPageState={{
          id: 'test-page',
          title: 'Test Page',
          components: [],
        }}
      >
        <ExperimentalFeaturesSettings />
      </UIStateProvider>
    );

    const toggle = await waitFor(() => {
      const el = document.querySelector(
        '[data-automation-id="experimental-feature-toggle-aiAssistant"]'
      ) as HTMLElement | null;
      expect(el).toBeTruthy();
      return el;
    });

    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('renders list of features with toggles', async () => {
    render(
      <UIStateProvider
        initialPageState={{
          id: 'test-page',
          title: 'Test Page',
          components: [],
        }}
      >
        <ExperimentalFeaturesSettings />
      </UIStateProvider>
    );

    await waitFor(() => {
      expect(getExperimentalFeatures).toHaveBeenCalledTimes(1);
    });

    const toggle = document.querySelector(
      '[data-automation-id="experimental-feature-toggle-aiAssistant"]'
    );
    expect(toggle).toBeTruthy();
    const workflowAutomationToggle = document.querySelector(
      '[data-automation-id="experimental-feature-toggle-workflowAutomation"]'
    );
    expect(workflowAutomationToggle).toBeTruthy();
    expect(screen.getAllByRole('switch')).toHaveLength(2);
  });
});
