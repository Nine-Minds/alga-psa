/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UIStateProvider } from '@alga-psa/ui/ui-reflection/UIStateContext';

import ExperimentalFeaturesSettings from '../../../components/settings/general/ExperimentalFeaturesSettings';
import { getExperimentalFeatures } from '@alga-psa/tenancy/actions';

vi.mock('@alga-psa/tenancy/actions', () => ({
  getExperimentalFeatures: vi.fn().mockResolvedValue({ aiAssistant: false }),
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

  it('loads current settings on mount', async () => {
    vi.mocked(getExperimentalFeatures).mockResolvedValueOnce({ aiAssistant: true });

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
    expect(screen.getAllByRole('switch')).toHaveLength(1);
  });
});
