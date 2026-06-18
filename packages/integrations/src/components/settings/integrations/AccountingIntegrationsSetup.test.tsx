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
  default: () => <div data-testid="xero-csv-settings-stub">Xero CSV Settings</div>
}));

vi.mock('./XeroIntegrationSettings', () => ({
  __esModule: true,
  default: () => <div data-testid="xero-settings-stub">Live Xero Settings</div>
}));

vi.mock('./QboIntegrationSettings', () => ({
  __esModule: true,
  default: () => <div data-testid="qbo-settings-stub">Live QBO Settings</div>
}));

function getRow(id: string): HTMLElement | null {
  return document.getElementById(`accounting-integration-card-${id}`);
}

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

  it('T001: enterprise mode lists live QBO and Xero beside the CSV options as selectable rows (no Coming Soon)', async () => {
    const { default: AccountingIntegrationsSetup } =
      await import('./AccountingIntegrationsSetup');

    render(<AccountingIntegrationsSetup />);

    const qboRow = getRow('quickbooks_online');
    const xeroRow = getRow('xero');
    const qboCsvRow = getRow('quickbooks_csv');
    const xeroCsvRow = getRow('xero_csv');

    expect(qboRow).toBeTruthy();
    expect(xeroRow).toBeTruthy();
    expect(qboCsvRow).toBeTruthy();
    expect(xeroCsvRow).toBeTruthy();

    // Each option is itself the clickable control (a button), not a row with a
    // separate "Configure" button inside it.
    expect(qboRow?.tagName).toBe('BUTTON');
    expect(xeroRow?.tagName).toBe('BUTTON');
    expect(qboRow).not.toBeDisabled();
    expect(xeroRow).not.toBeDisabled();

    // No Coming Soon affordance — every listed option is available in EE.
    expect(screen.queryByText('Coming Soon')).not.toBeInTheDocument();

    // Live options are tagged as live connections; CSV options as CSV exports.
    expect(
      within(qboRow as HTMLElement).getByText('Live connection')
    ).toBeInTheDocument();
    expect(
      within(xeroRow as HTMLElement).getByText('Live connection')
    ).toBeInTheDocument();
    expect(
      within(qboCsvRow as HTMLElement).getByText('CSV export')
    ).toBeInTheDocument();
  });

  it('T002: non-enterprise mode hides the live Xero option', async () => {
    process.env.NEXT_PUBLIC_EDITION = 'community';
    const { default: AccountingIntegrationsSetup } =
      await import('./AccountingIntegrationsSetup');

    render(<AccountingIntegrationsSetup />);

    expect(getRow('xero')).toBeNull();
    expect(screen.getByText('Xero CSV')).toBeInTheDocument();
  });

  it('T003: selecting Xero drills into the dedicated accounting-scoped Xero settings panel', async () => {
    const user = userEvent.setup();
    const { default: AccountingIntegrationsSetup } =
      await import('./AccountingIntegrationsSetup');

    render(<AccountingIntegrationsSetup />);

    const xeroRow = getRow('xero');
    expect(xeroRow).toBeTruthy();
    await user.click(xeroRow as HTMLElement);

    expect(screen.getByTestId('xero-settings-stub')).toBeInTheDocument();
    expect(
      screen.queryByTestId('xero-csv-settings-stub')
    ).not.toBeInTheDocument();
  });

  it('T010: enterprise mode shows the QuickBooks Online option as an enabled live-connection row', async () => {
    const { default: AccountingIntegrationsSetup } =
      await import('./AccountingIntegrationsSetup');

    render(<AccountingIntegrationsSetup />);

    const qboRow = getRow('quickbooks_online');
    expect(qboRow).toBeTruthy();
    expect(qboRow).not.toBeDisabled();
    expect(
      within(qboRow as HTMLElement).getByText('Live connection')
    ).toBeInTheDocument();
  });

  it('T011: non-enterprise mode hides the QuickBooks Online row', async () => {
    process.env.NEXT_PUBLIC_EDITION = 'community';
    const { default: AccountingIntegrationsSetup } =
      await import('./AccountingIntegrationsSetup');

    render(<AccountingIntegrationsSetup />);

    expect(getRow('quickbooks_online')).toBeNull();
    // QuickBooks CSV is still available
    expect(screen.getByText('QuickBooks CSV')).toBeInTheDocument();
  });

  it('T012: selecting QuickBooks Online drills into the QBO settings panel', async () => {
    const user = userEvent.setup();
    const { default: AccountingIntegrationsSetup } =
      await import('./AccountingIntegrationsSetup');

    render(<AccountingIntegrationsSetup />);

    const qboRow = getRow('quickbooks_online');
    expect(qboRow).toBeTruthy();
    await user.click(qboRow as HTMLElement);

    expect(screen.getByTestId('qbo-settings-stub')).toBeInTheDocument();
    expect(
      screen.queryByTestId('quickbooks-csv-settings-stub')
    ).not.toBeInTheDocument();
  });

  it('T012b: drilling in shows a back control that returns to the option list', async () => {
    const user = userEvent.setup();
    const { default: AccountingIntegrationsSetup } =
      await import('./AccountingIntegrationsSetup');

    render(<AccountingIntegrationsSetup />);

    await user.click(getRow('quickbooks_online') as HTMLElement);
    expect(screen.getByTestId('qbo-settings-stub')).toBeInTheDocument();

    await user.click(screen.getByText('All accounting integrations'));

    // Back on the list: the QBO panel is gone and the rows are shown again.
    expect(screen.queryByTestId('qbo-settings-stub')).not.toBeInTheDocument();
    expect(getRow('quickbooks_online')).toBeTruthy();
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

    // QBO row should not exist, so the QBO panel should not be rendered
    expect(getRow('quickbooks_online')).toBeNull();
    expect(screen.queryByTestId('qbo-settings-stub')).not.toBeInTheDocument();
  });
});
