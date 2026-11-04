/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const searchParamsRef = vi.hoisted(() => ({ current: '' }));
const routerReplaceMock = vi.hoisted(() => vi.fn());
const getMicrosoftIntegrationStatusMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  usePathname: () => '/msp/settings/integrations',
  useSearchParams: () => new URLSearchParams(searchParamsRef.current),
  useRouter: () => ({ push: vi.fn(), replace: routerReplaceMock }),
}));

vi.mock('./GoogleIntegrationSettings', () => ({
  GoogleIntegrationSettings: () => <div data-testid="google-settings" />,
}));

vi.mock('../../../actions/integrations/microsoftActions', () => ({
  getMicrosoftIntegrationStatus: (...args: unknown[]) => getMicrosoftIntegrationStatusMock(...args),
  listMicrosoftConsumerBindings: vi.fn().mockResolvedValue([]),
  runMicrosoftEmailIssuerBackfill: vi.fn(),
  setMicrosoftConsumerBinding: vi.fn(),
  createMicrosoftProfile: vi.fn(),
  updateMicrosoftProfile: vi.fn(),
  archiveMicrosoftProfile: vi.fn(),
  setDefaultMicrosoftProfile: vi.fn(),
  resetMicrosoftProvidersToDisconnected: vi.fn(),
}));
vi.mock('@alga-psa/integrations/actions', () => ({
  getMicrosoftIntegrationStatus: (...args: unknown[]) => getMicrosoftIntegrationStatusMock(...args),
  listMicrosoftConsumerBindings: vi.fn().mockResolvedValue([]),
  runMicrosoftEmailIssuerBackfill: vi.fn(),
  setMicrosoftConsumerBinding: vi.fn(),
  createMicrosoftProfile: vi.fn(),
  updateMicrosoftProfile: vi.fn(),
  archiveMicrosoftProfile: vi.fn(),
  setDefaultMicrosoftProfile: vi.fn(),
  resetMicrosoftProvidersToDisconnected: vi.fn(),
}));
vi.mock('../../../actions/integrations/microsoftEmailSetupActions', () => ({
  getMicrosoftEmailSetupOptions: vi.fn(),
  configureMicrosoftEmailPlatformApplication: vi.fn(),
  createMicrosoftEmailApplication: vi.fn(),
  configureMicrosoftEmailManualApplication: vi.fn(),
  getMicrosoftEmailAdminConsentUrl: vi.fn(),
}));
vi.mock('@alga-psa/ui/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: () => ({ enabled: true }) }));

import { ProviderCredentialsWorkbench } from './ProviderCredentialsWorkbench';

const CORRELATION_ID = '123e4567-e89b-12d3-a456-426614174000';
const base = 'category=providers';

describe('ProviderCredentialsWorkbench setup outcome landing', () => {
  beforeEach(() => {
    routerReplaceMock.mockReset();
    getMicrosoftIntegrationStatusMock.mockReset();
    getMicrosoftIntegrationStatusMock.mockResolvedValue({ success: false, error: 'unavailable' });
  });

  it('opens the Microsoft tab and shows the policy-blocked failure for a no-opener error landing', async () => {
    searchParamsRef.current = `${base}&microsoft_email_setup=error&error_code=policy_blocked&aadsts=50097&correlation_id=${CORRELATION_ID}`;
    render(<ProviderCredentialsWorkbench />);

    expect(document.getElementById('provider-credentials-microsoft-tab')).toHaveAttribute('aria-selected', 'true');
    const panel = document.getElementById('provider-credentials-microsoft-panel')!;
    expect(panel).not.toHaveAttribute('hidden');

    const alert = await waitFor(() => {
      const el = document.getElementById('microsoft-email-setup-failure');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(alert).toBeVisible();
    expect(alert.textContent).toMatch(/blocked|policy/i);
    expect(alert.textContent).toContain(CORRELATION_ID);
    expect(routerReplaceMock).toHaveBeenCalledWith('/msp/settings/integrations?category=providers');
    // Still on Microsoft after the child stripped the params.
    expect(document.getElementById('provider-credentials-microsoft-tab')).toHaveAttribute('aria-selected', 'true');
  });

  it('selects Google when there is no outcome param', () => {
    searchParamsRef.current = base;
    render(<ProviderCredentialsWorkbench />);
    expect(document.getElementById('provider-credentials-google-tab')).toHaveAttribute('aria-selected', 'true');
    expect(document.getElementById('provider-credentials-microsoft-panel')).toHaveAttribute('hidden');
  });

  it('selects the Microsoft tab for an ok outcome', () => {
    searchParamsRef.current = `${base}&microsoft_email_setup=ok`;
    render(<ProviderCredentialsWorkbench />);
    expect(document.getElementById('provider-credentials-microsoft-tab')).toHaveAttribute('aria-selected', 'true');
    expect(document.getElementById('provider-credentials-microsoft-panel')).not.toHaveAttribute('hidden');
  });
});
