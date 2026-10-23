// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EntraIntegrationPage from '@ee/components/settings/integrations/entra/EntraIntegrationPage';
import { ConnectionMethodChooser } from '@ee/components/settings/integrations/entra/ConnectionMethodChooser';

const { getEntraIntegrationStatusMock, useFeatureFlagMock } = vi.hoisted(() => ({
  getEntraIntegrationStatusMock: vi.fn(),
  useFeatureFlagMock: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', async () => {
  const { createLocaleTranslationMock } = await import('../utils/localeTranslationMock');
  return createLocaleTranslationMock('msp/integrations');
});

vi.mock('@alga-psa/integrations/actions', () => ({
  getEntraIntegrationStatus: getEntraIntegrationStatusMock,
}));

// The page used to read the retired `entra-integration-cipp` flag through this
// hook. It is forced off here so a regression that reads it again hides CIPP
// from a Pro tenant and fails the test.
vi.mock('@alga-psa/ui/hooks', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, useFeatureFlag: useFeatureFlagMock };
});

// The wizard and console have their own suites. The page's job is to hand them
// the tier-derived `cippAvailable`, so the stubs expose that prop. The setup
// stub mounts the real chooser so the assertion covers the option users see.
vi.mock('@ee/components/settings/integrations/entra/EntraSetupWizard', () => ({
  EntraSetupWizard: ({ cippAvailable }: { cippAvailable: boolean }) => (
    <div id="entra-setup-wizard-stub">
      <ConnectionMethodChooser
        cippAvailable={cippAvailable}
        value="direct"
        onChange={vi.fn()}
        onContinue={vi.fn()}
      />
    </div>
  ),
}));

vi.mock('@ee/components/settings/integrations/entra/EntraConsole', () => ({
  EntraConsole: ({ cippAvailable }: { cippAvailable: boolean }) => (
    <div id="entra-console-stub" data-cipp-available={String(cippAvailable)} />
  ),
}));

function mockStatus(hasCompletedFirstSync: boolean) {
  getEntraIntegrationStatusMock.mockResolvedValue({
    data: {
      status: 'not_connected',
      connectionType: null,
      lastDiscoveryAt: null,
      mappedTenantCount: 0,
      nextSyncIntervalMinutes: null,
      availableConnectionTypes: ['direct', 'cipp'],
      lastValidatedAt: null,
      lastValidationError: null,
      hasCompletedFirstSync,
    },
  });
}

describe('EntraIntegrationPage CIPP gate', () => {
  beforeEach(() => {
    getEntraIntegrationStatusMock.mockReset();
    useFeatureFlagMock.mockReset();
    useFeatureFlagMock.mockReturnValue({ enabled: false, loading: false, error: null });
    mockStatus(false);
  });

  afterEach(() => {
    cleanup();
  });

  it('offers the CIPP option in setup when the tier includes CIPP, whatever the flag says', async () => {
    render(<EntraIntegrationPage canUseCipp />);

    await waitFor(() => {
      expect(document.getElementById('entra-connection-method-cipp')).not.toBeNull();
    });
    expect(document.getElementById('entra-connection-method-direct')).not.toBeNull();
    expect(
      useFeatureFlagMock.mock.calls.some(([key]) => key === 'entra-integration-cipp')
    ).toBe(false);
  });

  it('leaves CIPP out of setup when the tier does not include it', async () => {
    render(<EntraIntegrationPage canUseCipp={false} />);

    await waitFor(() => {
      expect(document.getElementById('entra-connection-method-direct')).not.toBeNull();
    });
    expect(document.getElementById('entra-connection-method-cipp')).toBeNull();
  });

  it('passes the tier value to the console once setup is complete', async () => {
    mockStatus(true);
    const { unmount } = render(<EntraIntegrationPage canUseCipp />);
    await waitFor(() => {
      expect(document.getElementById('entra-console-stub')?.getAttribute('data-cipp-available')).toBe('true');
    });
    unmount();

    render(<EntraIntegrationPage canUseCipp={false} />);
    await waitFor(() => {
      expect(document.getElementById('entra-console-stub')?.getAttribute('data-cipp-available')).toBe('false');
    });
  });
});
