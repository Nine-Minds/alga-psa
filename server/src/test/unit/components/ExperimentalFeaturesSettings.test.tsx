/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';
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

