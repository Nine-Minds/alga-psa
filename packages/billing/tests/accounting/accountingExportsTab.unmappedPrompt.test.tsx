/**
 * @vitest-environment jsdom
 *
 * A QuickBooks Desktop/CSV batch blocked on unmapped clients or items opens the
 * create-or-link prompt instead of a bare error; saving the decisions writes the
 * mappings and re-executes the same batch.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  execute: vi.fn(),
  getUnmapped: vi.fn(),
  saveMappings: vi.fn(),
  capabilities: {
    catalogRead: true,
    connectionsManage: true,
    mappingsManage: true,
    exportsExecute: true,
    remoteMutate: true,
    hasAny: true,
    loaded: true,
  },
}));

vi.mock('@alga-psa/auth/hooks/useAccountingCapabilities', () => ({
  useAccountingCapabilities: () => mocks.capabilities,
}));

vi.mock('@alga-psa/billing/actions/accountingExportActions', () => ({
  listAccountingExportBatches: (...args: unknown[]) => mocks.list(...args),
  getAccountingExportBatch: (...args: unknown[]) => mocks.get(...args),
  createAccountingExportBatch: vi.fn(),
  executeAccountingExportBatch: (...args: unknown[]) => mocks.execute(...args),
  cancelAccountingExportBatch: vi.fn(),
  getAccountingExportConnections: vi.fn(),
}));

vi.mock('../../src/actions/quickBooksExportMappingActions', () => ({
  getUnmappedQuickBooksEntities: (...args: unknown[]) => mocks.getUnmapped(...args),
  saveQuickBooksExportMappings: (...args: unknown[]) => mocks.saveMappings(...args),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, onValueChange, options, disabled }: {
    id?: string;
    value?: string | null;
    onValueChange?: (value: string) => void;
    options?: Array<{ value: string; label: React.ReactNode }>;
    disabled?: boolean;
  }) => (
    <select
      id={id}
      data-testid={id}
      value={value ?? ''}
      disabled={disabled}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      {(options ?? []).map((option) => (
        <option key={option.value} value={option.value}>
          {typeof option.label === 'string' ? option.label : option.value}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: ({ id }: { id?: string }) => <input id={id} data-testid={id} readOnly />,
}));

const NOW = '2026-10-15T00:00:00.000Z';
const batch = (adapterType: string) => ({
  batch_id: 'batch-1',
  adapter_type: adapterType,
  status: 'needs_attention',
  export_type: 'invoice',
  target_realm: null,
  queued_at: NOW,
  validated_at: NOW,
  delivered_at: null,
  posted_at: null,
  created_by: null,
  last_updated_by: null,
  created_at: NOW,
  updated_at: NOW,
  notes: null,
});

const ENTITIES = [
  { algaEntityType: 'client', algaEntityId: 'client-1', algaName: 'Acme Corp', itemKind: null, proposedName: 'Acme Corp', maxNameLength: 41 },
  { algaEntityType: 'service', algaEntityId: 'svc-1', algaName: 'Dell 16 Laptop', itemKind: 'product', proposedName: 'Dell 16 Laptop', maxNameLength: 31 },
];

async function renderTab() {
  const { default: AccountingExportsTab } = await import(
    '../../src/components/billing-dashboard/accounting/AccountingExportsTab'
  );
  render(<AccountingExportsTab />);
  return screen.findByRole('button', { name: 'Execute' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.capabilities = { ...mocks.capabilities, mappingsManage: true };
  mocks.list.mockResolvedValue([batch('quickbooks_desktop')]);
  mocks.get.mockResolvedValue({ batch: batch('quickbooks_desktop'), lines: [], errors: [] });
  mocks.execute
    .mockResolvedValueOnce({ success: false, code: 'ACCOUNTING_EXPORT_VALIDATION_FAILED', message: 'Batch needs attention' })
    .mockResolvedValue({ deliveredLines: [], failedDocuments: [], metadata: { files: [] } });
  mocks.getUnmapped.mockResolvedValue(ENTITIES);
  mocks.saveMappings.mockResolvedValue({ saved: 2 });
});

afterEach(() => {
  cleanup();
});

describe('AccountingExportsTab unmapped QuickBooks prompt', () => {
  it('prompts on a blocked Desktop batch, saves the decisions, and re-executes the batch', async () => {
    fireEvent.click(await renderTab());

    await screen.findByText('Unmapped QuickBooks items');
    expect(mocks.getUnmapped).toHaveBeenCalledWith('batch-1');
    expect(screen.getByRole('link', { name: 'Go to QuickBooks mappings' })).toHaveAttribute(
      'href',
      '/msp/settings?tab=integrations&category=accounting&accounting_integration=quickbooks_desktop'
    );

    fireEvent.change(screen.getByTestId('accounting-exports-unmapped-client-client-1-mode'), { target: { value: 'existing' } });
    fireEvent.change(document.getElementById('accounting-exports-unmapped-service-svc-1-name') as HTMLInputElement, {
      target: { value: 'Laptop - Dell 16' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save mappings and export' }));

    await waitFor(() => {
      expect(mocks.saveMappings).toHaveBeenCalledWith('batch-1', [
        { algaEntityType: 'client', algaEntityId: 'client-1', externalName: 'Acme Corp', mode: 'existing' },
        { algaEntityType: 'service', algaEntityId: 'svc-1', externalName: 'Laptop - Dell 16', mode: 'create' },
      ]);
    });
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Unmapped QuickBooks items')).not.toBeInTheDocument();
  });

  it('blocks saving an over-long QuickBooks name', async () => {
    fireEvent.click(await renderTab());
    await screen.findByText('Unmapped QuickBooks items');

    fireEvent.change(document.getElementById('accounting-exports-unmapped-service-svc-1-name') as HTMLInputElement, {
      target: { value: '' },
    });
    expect(screen.getByRole('button', { name: 'Save mappings and export' })).toBeDisabled();
  });

  it('does not prompt for adapters other than QuickBooks Desktop and CSV', async () => {
    mocks.list.mockResolvedValue([batch('xero_csv')]);
    mocks.get.mockResolvedValue({ batch: batch('xero_csv'), lines: [], errors: [] });
    fireEvent.click(await renderTab());

    await waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(1));
    expect(mocks.getUnmapped).not.toHaveBeenCalled();
    expect(screen.queryByText('Unmapped QuickBooks items')).not.toBeInTheDocument();
  });

  it('keeps the prompt open and shows the error when saving fails', async () => {
    mocks.saveMappings.mockResolvedValue({ actionError: 'Name already used', messageKey: 'msp/billing:errors.accountingExport.quickbooksMapping.nameTakenByItem' });
    fireEvent.click(await renderTab());
    await screen.findByText('Unmapped QuickBooks items');

    fireEvent.click(screen.getByRole('button', { name: 'Save mappings and export' }));
    expect(await screen.findByText('Name already used')).toBeInTheDocument();
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });
});
