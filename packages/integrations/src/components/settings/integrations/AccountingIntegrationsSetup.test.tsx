/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

const useSearchParamsMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useSearchParams: useSearchParamsMock
}));

vi.mock('./CSVIntegrationSettings', () => ({
  __esModule: true,
  default: () => <div data-testid="quickbooks-csv-settings-stub">QuickBooks CSV Settings</div>
}));

vi.mock('./XeroCsvIntegrationSettings', () => ({
  __esModule: true,
  default: () => <div data-testid="xero-csv-settings-stub">Xero CSV Settings</div>
}));

vi.mock('./XeroIntegrationSettings', () => ({
  __esModule: true,
  default: () => <div data-testid="xero-settings-stub">Live Xero Settings</div>
}));

describe('AccountingIntegrationsSetup live Xero contracts', () => {
  const originalEdition = process.env.NEXT_PUBLIC_EDITION;

  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';
    useSearchParamsMock.mockReturnValue(new URLSearchParams());
  });

  afterEach(() => {
    if (originalEdition === undefined) {
      delete process.env.NEXT_PUBLIC_EDITION;
    } else {
      process.env.NEXT_PUBLIC_EDITION = originalEdition;
    }
    cleanup();
    vi.clearAllMocks();
  });

  it('T001: enterprise mode renders live Xero beside Xero CSV as active options', async () => {
    const { default: AccountingIntegrationsSetup } = await import('./AccountingIntegrationsSetup');

    render(<AccountingIntegrationsSetup />);

    const xeroCard = screen.getByText('Xero').closest('#accounting-integration-card-xero');
    const xeroCsvCard = screen
      .getAllByText('Xero CSV')[0]
      ?.closest('#accounting-integration-card-xero_csv');

    expect(xeroCard).toBeTruthy();
    expect(screen.getAllByText('Xero CSV').length).toBeGreaterThan(0);
    expect(xeroCsvCard).toBeTruthy();
    expect(
      within(xeroCard as HTMLElement).getByRole('button', { name: 'Configure Integration' })
    ).not.toBeDisabled();
    expect(
      within(xeroCsvCard as HTMLElement).getByRole('button', { name: 'Configure Integration' })
    ).not.toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Coming Soon' })).toBeInTheDocument();
    expect(screen.getByText('Enterprise')).toBeInTheDocument();
  });

  it('T002: non-enterprise mode hides the live Xero option', async () => {
    process.env.NEXT_PUBLIC_EDITION = 'community';
    const { default: AccountingIntegrationsSetup } = await import('./AccountingIntegrationsSetup');

    render(<AccountingIntegrationsSetup />);

    expect(screen.queryByText(/^Xero$/)).not.toBeInTheDocument();
    expect(screen.getByText('Xero CSV')).toBeInTheDocument();
  });

  it('T003: selecting Xero loads the dedicated accounting-scoped Xero settings panel', async () => {
    const user = userEvent.setup();
    const { default: AccountingIntegrationsSetup } = await import('./AccountingIntegrationsSetup');

    render(<AccountingIntegrationsSetup />);

    const xeroCard = screen.getByText('Xero').closest('#accounting-integration-card-xero');
    const xeroButton = xeroCard
      ? within(xeroCard as HTMLElement).getByRole('button', { name: 'Configure Integration' })
      : null;
    expect(xeroButton).toBeTruthy();
    await user.click(xeroButton as HTMLElement);

    expect(screen.getByTestId('xero-settings-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('xero-csv-settings-stub')).not.toBeInTheDocument();
  });
});
