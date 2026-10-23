/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), restore: vi.fn(), refresh: vi.fn(), capture: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('posthog-js/react', () => ({ usePostHog: () => ({ capture: mocks.capture }) }));
vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn() } }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (_key: string, options: Record<string, unknown>) => options.defaultValue }) }));
vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({ useAutomationIdAndRegister: () => ({ automationIdProps: {} }) }));
vi.mock('@alga-psa/onboarding/actions', () => ({
  getDashboardOnboardingSectionDismissedAction: mocks.get,
  restoreDashboardOnboardingSectionAction: mocks.restore,
}));

import DashboardOnboardingSectionPreference from '../../../../../packages/onboarding/src/components/dashboard/DashboardOnboardingSectionPreference';

describe('DashboardOnboardingSectionPreference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockResolvedValue({ success: true, data: { dismissed: true } });
    mocks.restore.mockResolvedValue({ success: true, data: { dismissed: false } });
  });
  afterEach(cleanup);

  it('shows a restore control in profile settings for a dismissed section', async () => {
    render(<DashboardOnboardingSectionPreference />);
    expect(await screen.findByRole('button', { name: 'Restore onboarding section' })).toBeInTheDocument();
  });

  it('restores the section from profile settings', async () => {
    render(<DashboardOnboardingSectionPreference />);
    const button = await screen.findByRole('button', { name: 'Restore onboarding section' });
    await act(async () => { fireEvent.click(button); });
    await waitFor(() => expect(mocks.restore).toHaveBeenCalled());
    expect(mocks.refresh).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Restore onboarding section' })).not.toBeInTheDocument();
  });
});
