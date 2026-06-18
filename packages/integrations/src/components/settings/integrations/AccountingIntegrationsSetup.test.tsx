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
  default: () => (
    <div data-testid="quickbooks-csv-settings-stub">
      QuickBooks CSV Settings
    </div>
  )
}));

vi.mock('./XeroCsvIntegrationSettings', () => ({
  __esModule: true,
  default: () => (
    <div data-testid="xero-csv-settings-stub">Xero CSV Settings</div>
  )
}));

vi.mock('./XeroIntegrationSettings', () => ({
  __esModule: true,
  default: () => <div data-testid="xero-settings-stub">Live Xero Settings</div>
}));

vi.mock('./QboIntegrationSettings', () => ({
  __esModule: true,
  default: () => <div data-testid="qbo-settings-stub">Live QBO Settings</div>
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

  it('T001: enterprise mode renders live Xero and QBO beside Xero CSV as active options (no Coming Soon)', async () => {
    const { default: AccountingIntegrationsSetup } =
      await import('./AccountingIntegrationsSetup');

    render(<AccountingIntegrationsSetup />);

    const xeroCard = screen
      .getByText('Xero')
      .closest('#accounting-integration-card-xero');
    const xeroCsvCard = screen
      .getAllByText('Xero CSV')[0]
      ?.closest('#accounting-integration-card-xero_csv');
    const qboCard = screen
      .getByText('QuickBooks Online')
      .closest('#accounting-integration-card-quickbooks_online');

    expect(xeroCard).toBeTruthy();
    expect(screen.getAllByText('Xero CSV').length).toBeGreaterThan(0);
    expect(xeroCsvCard).toBeTruthy();
    expect(qboCard).toBeTruthy();
    expect(
      within(xeroCard as HTMLElement).getByRole('button', {
        name: 'Configure Integration'
      })
    ).not.toBeDisabled();
    expect(
      within(xeroCsvCard as HTMLElement).getByRole('button', {
        name: 'Configure Integration'
      })
    ).not.toBeDisabled();
    expect(
      within(qboCard as HTMLElement).getByRole('button', {
        name: 'Configure Integration'
      })
    ).not.toBeDisabled();
    // No Coming Soon button — QBO is now enabled in EE
    expect(
      screen.queryByRole('button', { name: 'Coming Soon' })
    ).not.toBeInTheDocument();
    expect(
      within(qboCard as HTMLElement).getByText('Live connection')
    ).toBeInTheDocument();
    expect(
      within(xeroCard as HTMLElement).getByText('Live connection')
    ).toBeInTheDocument();
  });

  it('T002: non-enterprise mode hides the live Xero option', async () => {
    process.env.NEXT_PUBLIC_EDITION = 'community';
    const { default: AccountingIntegrationsSetup } =
      await import('./AccountingIntegrationsSetup');

    render(<AccountingIntegrationsSetup />);

    expect(screen.queryByText(/^Xero$/)).not.toBeInTheDocument();
    expect(screen.getByText('Xero CSV')).toBeInTheDocument();
  });

  it('T003: selecting Xero loads the dedicated accounting-scoped Xero settings panel', async () => {
    const user = userEvent.setup();
    const { default: AccountingIntegrationsSetup } =
      await import('./AccountingIntegrationsSetup');

    render(<AccountingIntegrationsSetup />);

    const xeroCard = screen
      .getByText('Xero')
      .closest('#accounting-integration-card-xero');
    const xeroButton = xeroCard
      ? within(xeroCard as HTMLElement).getByRole('button', {
          name: 'Configure Integration'
        })
      : null;
    expect(xeroButton).toBeTruthy();
    await user.click(xeroButton as HTMLElement);

    expect(screen.getByTestId('xero-settings-stub')).toBeInTheDocument();
    expect(
      screen.queryByTestId('xero-csv-settings-stub')
    ).not.toBeInTheDocument();
  });

  it('T010: enterprise mode shows the QuickBooks Online option with live mode text and enabled button', async () => {
    const { default: AccountingIntegrationsSetup } =
      await import('./AccountingIntegrationsSetup');

    render(<AccountingIntegrationsSetup />);

    const qboCard = screen
      .getByText('QuickBooks Online')
      .closest('#accounting-integration-card-quickbooks_online');
    expect(qboCard).toBeTruthy();
    expect(
      within(qboCard as HTMLElement).getByRole('button', {
        name: 'Configure Integration'
      })
    ).not.toBeDisabled();
    expect(
      within(qboCard as HTMLElement).getByText('Live connection')
    ).toBeInTheDocument();
  });

  it('T011: non-enterprise mode hides the QuickBooks Online card', async () => {
    process.env.NEXT_PUBLIC_EDITION = 'community';
    const { default: AccountingIntegrationsSetup } =
      await import('./AccountingIntegrationsSetup');

    render(<AccountingIntegrationsSetup />);

    expect(
      document.getElementById('accounting-integration-card-quickbooks_online')
    ).not.toBeInTheDocument();
    // QuickBooks CSV is still available
    expect(screen.getByText('QuickBooks CSV')).toBeInTheDocument();
  });

  it('T012: selecting QuickBooks Online loads the QBO settings panel', async () => {
    const user = userEvent.setup();
    const { default: AccountingIntegrationsSetup } =
      await import('./AccountingIntegrationsSetup');

    render(<AccountingIntegrationsSetup />);

    const qboCard = screen
      .getByText('QuickBooks Online')
      .closest('#accounting-integration-card-quickbooks_online');
    const qboButton = qboCard
      ? within(qboCard as HTMLElement).getByRole('button', {
          name: 'Configure Integration'
        })
      : null;
    expect(qboButton).toBeTruthy();
    await user.click(qboButton as HTMLElement);

    expect(screen.getByTestId('qbo-settings-stub')).toBeInTheDocument();
    expect(
      screen.queryByTestId('quickbooks-csv-settings-stub')
    ).not.toBeInTheDocument();
  });

  it('T013: accounting_integration=quickbooks_online auto-selects the QBO panel in EE', async () => {
    useSearchParamsMock.mockReturnValue(
      new URLSearchParams('accounting_integration=quickbooks_online')
    );
    const { default: AccountingIntegrationsSetup } =
      await import('./AccountingIntegrationsSetup');

    render(<AccountingIntegrationsSetup />);

    expect(screen.getByTestId('qbo-settings-stub')).toBeInTheDocument();
  });

  it('T014: accounting_integration=qbo (shorthand) auto-selects the QBO panel in EE', async () => {
    useSearchParamsMock.mockReturnValue(
      new URLSearchParams('accounting_integration=qbo')
    );
    const { default: AccountingIntegrationsSetup } =
      await import('./AccountingIntegrationsSetup');

    render(<AccountingIntegrationsSetup />);

    expect(screen.getByTestId('qbo-settings-stub')).toBeInTheDocument();
  });

  it('T015: qbo_status=success auto-selects the QBO panel in EE', async () => {
    useSearchParamsMock.mockReturnValue(
      new URLSearchParams('qbo_status=success')
    );
    const { default: AccountingIntegrationsSetup } =
      await import('./AccountingIntegrationsSetup');

    render(<AccountingIntegrationsSetup />);

    expect(screen.getByTestId('qbo-settings-stub')).toBeInTheDocument();
  });

  it('T016: accounting_integration=quickbooks_online does NOT select QBO panel in non-EE', async () => {
    process.env.NEXT_PUBLIC_EDITION = 'community';
    useSearchParamsMock.mockReturnValue(
      new URLSearchParams('accounting_integration=quickbooks_online')
    );
    const { default: AccountingIntegrationsSetup } =
      await import('./AccountingIntegrationsSetup');

    render(<AccountingIntegrationsSetup />);

    // QBO card should not exist, so QBO panel should not be rendered
    expect(
      document.getElementById('accounting-integration-card-quickbooks_online')
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('qbo-settings-stub')).not.toBeInTheDocument();
  });
});
