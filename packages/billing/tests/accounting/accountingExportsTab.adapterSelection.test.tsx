/**
 * @vitest-environment jsdom
 *
 * Composed coverage for the manual-export dialog's connection lifecycle.
 *
 * With both providers connected and multiple organisations each, switching the
 * adapter must load only the selected provider's connections, default to that
 * provider's selected organisation, clear the target for file adapters, and
 * never let a late response from a previously selected provider repopulate the
 * picker or reselect its own realm. The real AccountingExportsTab drives the
 * real selection effect and submits through the (mocked) action boundary so the
 * persisted adapter/target pair is asserted exactly as the UI would send it.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const mocks = vi.hoisted(() => ({
  connections: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  execute: vi.fn(),
  cancel: vi.fn(),
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
  createAccountingExportBatch: (...args: unknown[]) => mocks.create(...args),
  executeAccountingExportBatch: (...args: unknown[]) => mocks.execute(...args),
  cancelAccountingExportBatch: (...args: unknown[]) => mocks.cancel(...args),
  getAccountingExportConnections: (...args: unknown[]) => mocks.connections(...args),
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

const QBO_CONNECTIONS = {
  adapterType: 'quickbooks_online',
  connected: true,
  issue: null,
  organisationName: 'smoke-realm-a',
  realms: [
    { realmId: 'smoke-realm-a', isDefault: true },
    { realmId: 'smoke-realm-b', isDefault: false },
  ],
};

const XERO_CONNECTIONS = {
  adapterType: 'xero',
  connected: true,
  issue: null,
  organisationName: 'Smoke Org B',
  realms: [
    { realmId: 'smoke-conn-a', isDefault: false },
    { realmId: 'smoke-conn-b', isDefault: true },
  ],
};

function connectionsFor(provider: string) {
  return provider === 'xero' ? XERO_CONNECTIONS : QBO_CONNECTIONS;
}

async function renderTab() {
  const { default: AccountingExportsTab } = await import(
    '../../src/components/billing-dashboard/accounting/AccountingExportsTab'
  );
  render(<AccountingExportsTab />);
  fireEvent.click(await screen.findByRole('button', { name: 'New Export' }));
  await screen.findByTestId('accounting-export-adapter');
}

function selectAdapter(adapterId: string) {
  fireEvent.change(screen.getByTestId('accounting-export-adapter'), {
    target: { value: adapterId },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.capabilities = {
    catalogRead: true,
    connectionsManage: true,
    mappingsManage: true,
    exportsExecute: true,
    remoteMutate: true,
    hasAny: true,
    loaded: true,
  };
  mocks.list.mockResolvedValue([]);
  mocks.get.mockResolvedValue({ batch: null, lines: [], errors: [] });
  mocks.connections.mockImplementation(async (provider: string) => connectionsFor(provider));
  mocks.create.mockImplementation(async (input: { adapter_type: string; target_realm?: string }) => ({
    ...input,
    batch_id: 'batch-1',
  }));
  mocks.execute.mockResolvedValue({ deliveredLines: [], failedDocuments: [] });
  mocks.cancel.mockResolvedValue({ batch_id: 'batch-1' });
});

afterEach(() => {
  cleanup();
});

describe('AccountingExportsTab adapter-scoped connection selection', () => {
  it('exposes and submits only the selected QBO realm', async () => {
    await renderTab();

    // Default adapter is a file adapter: no provider connection call, no realm.
    expect(mocks.connections).not.toHaveBeenCalled();

    selectAdapter('quickbooks_online');
    await waitFor(() => {
      expect(mocks.connections).toHaveBeenCalledWith('quickbooks_online');
    });
    const qboRealm = await screen.findByTestId('accounting-export-realm');
    expect(qboRealm).toHaveValue('smoke-realm-a');
    expect(screen.getByRole('option', { name: /^smoke-realm-a/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /^smoke-realm-b/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /smoke-conn-a/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /smoke-conn-b/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create Batch' }));
    await waitFor(() => {
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({ adapter_type: 'quickbooks_online', target_realm: 'smoke-realm-a' })
      );
    });
  });

  it('replaces the previous provider options and default when switching QBO -> Xero', async () => {
    await renderTab();

    selectAdapter('quickbooks_online');
    await waitFor(() => {
      expect(screen.getByTestId('accounting-export-realm')).toHaveValue('smoke-realm-a');
    });

    selectAdapter('xero');
    await waitFor(() => {
      expect(mocks.connections).toHaveBeenCalledWith('xero');
    });
    await waitFor(() => {
      expect(screen.getByTestId('accounting-export-realm')).toHaveValue('smoke-conn-b');
    });
    expect(screen.queryByRole('option', { name: /smoke-realm-a/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /smoke-realm-b/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /smoke-conn-a/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create Batch' }));
    await waitFor(() => {
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({ adapter_type: 'xero', target_realm: 'smoke-conn-b' })
      );
    });
  });

  it('ignores a late response from a previously selected provider', async () => {
    const pending: Array<(value: unknown) => void> = [];
    mocks.connections.mockImplementation(
      () => new Promise((resolve) => { pending.push(resolve); })
    );

    await renderTab();

    selectAdapter('quickbooks_online');
    await waitFor(() => expect(pending).toHaveLength(1));
    selectAdapter('xero');
    await waitFor(() => expect(pending).toHaveLength(2));

    // Resolve the *new* (Xero) request first, then let the stale QBO request
    // finish last. The stale response must not overwrite the picker/target.
    pending[1](XERO_CONNECTIONS);
    await waitFor(() => {
      expect(screen.getByTestId('accounting-export-realm')).toHaveValue('smoke-conn-b');
    });

    pending[0](QBO_CONNECTIONS);
    await waitFor(() => {
      expect(screen.getByTestId('accounting-export-realm')).toHaveValue('smoke-conn-b');
    });
    expect(screen.queryByRole('option', { name: 'smoke-realm-a' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create Batch' }));
    await waitFor(() => {
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({ adapter_type: 'xero', target_realm: 'smoke-conn-b' })
      );
    });
  });

  it('clears the realm for CSV adapters and creates a realm-less export', async () => {
    await renderTab();

    selectAdapter('xero');
    await waitFor(() => {
      expect(screen.getByTestId('accounting-export-realm')).toBeInTheDocument();
    });

    selectAdapter('xero_csv');
    await waitFor(() => {
      expect(screen.queryByTestId('accounting-export-realm-picker')).not.toBeInTheDocument();
    });
    expect(mocks.connections).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Create Batch' }));
    await waitFor(() => {
      expect(mocks.create).toHaveBeenCalledWith(
        expect.not.objectContaining({ target_realm: expect.anything() })
      );
    });
    const createArg = mocks.create.mock.calls[mocks.create.mock.calls.length - 1][0] as Record<string, unknown>;
    expect(createArg.adapter_type).toBe('xero_csv');
    expect('target_realm' in createArg).toBe(false);
  });

  it('disables submission until the selected provider connections resolve', async () => {
    const pending: Array<(value: unknown) => void> = [];
    mocks.connections.mockImplementation(
      () => new Promise((resolve) => { pending.push(resolve); })
    );

    await renderTab();
    selectAdapter('quickbooks_online');

    await waitFor(() => expect(pending).toHaveLength(1));
    expect(screen.getByRole('button', { name: 'Create Batch' })).toBeDisabled();

    pending[0](QBO_CONNECTIONS);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create Batch' })).toBeEnabled();
    });
  });
});

describe('review regressions', () => {
  it('does not silently select an org when the resolver reports an ambiguous Xero default', async () => {
    mocks.connections.mockResolvedValue({
      adapterType: 'xero',
      connected: false,
      issue: 'ambiguous',
      organisationName: null,
      realms: [
        { realmId: 'smoke-conn-a', isDefault: false },
        { realmId: 'smoke-conn-b', isDefault: false },
      ],
    });

    await renderTab();
    selectAdapter('xero');

    // No auto-selected target, actionable guidance, and Create stays blocked.
    await waitFor(() => {
      expect(document.getElementById('accounting-export-realm-guidance')).toBeInTheDocument();
    });
    const realmSelect = await screen.findByTestId('accounting-export-realm');
    // The native <select> mock shows its first option when the controlled value
    // is empty; the disabled Create button is the real "no target" signal.
    expect(screen.getByRole('button', { name: 'Create Batch' })).toBeDisabled();
    expect(mocks.create).not.toHaveBeenCalled();

    // A deliberate choice is required and must be submitted verbatim.
    fireEvent.change(realmSelect, { target: { value: 'smoke-conn-b' } });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create Batch' })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Batch' }));
    await waitFor(() => {
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({ adapter_type: 'xero', target_realm: 'smoke-conn-b' })
      );
    });
  });

  it('surfaces a connection-load failure with a retry that recovers', async () => {
    mocks.connections
      .mockRejectedValueOnce(new Error('Forbidden'))
      .mockResolvedValueOnce(QBO_CONNECTIONS);

    await renderTab();
    selectAdapter('quickbooks_online');

    const errorAlert = await screen.findByRole('alert');
    expect(errorAlert).toHaveTextContent(/could not load accounting connections/i);
    expect(screen.getByRole('button', { name: 'Create Batch' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(document.getElementById('accounting-export-connections-error')).toBeNull();
    });
    await waitFor(() => {
      expect(screen.getByTestId('accounting-export-realm')).toHaveValue('smoke-realm-a');
    });
    expect(screen.getByRole('button', { name: 'Create Batch' })).toBeEnabled();
  });

  it('lets an exports_execute user without catalog_read create a live export', async () => {
    mocks.capabilities = { ...mocks.capabilities, catalogRead: false };

    await renderTab();
    selectAdapter('quickbooks_online');

    await waitFor(() => {
      expect(screen.getByTestId('accounting-export-realm')).toHaveValue('smoke-realm-a');
    });
    expect(screen.getByRole('button', { name: 'Create Batch' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Create Batch' }));
    await waitFor(() => {
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({ adapter_type: 'quickbooks_online', target_realm: 'smoke-realm-a' })
      );
    });
  });
});
