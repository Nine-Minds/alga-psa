/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

const getXeroCsvSettingsMock = vi.hoisted(() => vi.fn());
const updateXeroCsvSettingsMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/integrations/actions', () => ({
  getXeroCsvSettings: (...args: unknown[]) => getXeroCsvSettingsMock(...args),
  updateXeroCsvSettings: (...args: unknown[]) => updateXeroCsvSettingsMock(...args)
}));

vi.mock('@alga-psa/integrations/components/csv/XeroCsvMappingManager', () => ({
  XeroCsvMappingManager: () => <div data-testid="xero-csv-mapping-manager">Xero CSV Mapping Manager</div>
}));

vi.mock('./XeroCsvClientSyncPanel', () => ({
  XeroCsvClientSyncPanel: () => <div data-testid="xero-csv-client-sync-panel">Xero CSV Client Sync</div>
}));

describe('XeroCsvIntegrationSettings contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getXeroCsvSettingsMock.mockResolvedValue({
      setupAcknowledged: true,
      dateFormat: 'MM/DD/YYYY',
      defaultCurrency: '',
      taxImportEnabled: true
    });
    updateXeroCsvSettingsMock.mockResolvedValue({
      setupAcknowledged: true,
      dateFormat: 'MM/DD/YYYY',
      defaultCurrency: '',
      taxImportEnabled: true
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('T023: existing Xero CSV settings still render the accounting export workflow entry points after live Xero is re-enabled', async () => {
    const { default: XeroCsvIntegrationSettings } = await import('./XeroCsvIntegrationSettings');

    render(<XeroCsvIntegrationSettings />);

    expect(await screen.findByText('Xero CSV Integration')).toBeInTheDocument();
    expect((await screen.findAllByText(/Billing → Accounting Exports/)).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Open Accounting Exports' })).toHaveAttribute(
      'href',
      '/msp/billing?tab=accounting-exports'
    );
    expect(screen.getByTestId('xero-csv-mapping-manager')).toBeInTheDocument();
    expect(screen.getByTestId('xero-csv-client-sync-panel')).toBeInTheDocument();
  });
});
