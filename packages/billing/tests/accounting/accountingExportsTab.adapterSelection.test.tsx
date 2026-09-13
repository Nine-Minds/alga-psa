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
  health: vi.fn(),
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
}));

vi.mock('@alga-psa/billing/actions/accountingSyncActions', () => ({
  getAccountingSyncHealth: (...args: unknown[]) => mocks.health(...args),
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

const QBO_HEALTH = {
  realms: [
    { realmId: 'smoke-realm-a', isDefault: true },
    { realmId: 'smoke-realm-b', isDefault: false },
  ],
};

const XERO_HEALTH = {
  realms: [
    { realmId: 'smoke-conn-a', isDefault: false },
    { realmId: 'smoke-conn-b', isDefault: true },
  ],
};

function healthFor(provider: string) {
  return provider === 'xero' ? XERO_HEALTH : QBO_HEALTH;
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
  mocks.health.mockImplementation(async (selection: { preferredAdapterType: string }) =>
    healthFor(selection.preferredAdapterType)
  );
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

    // Default adapter is a file adapter: no provider health call, no realm.
    expect(mocks.health).not.toHaveBeenCalled();

    selectAdapter('quickbooks_online');
    await waitFor(() => {
      expect(mocks.health).toHaveBeenCalledWith({ preferredAdapterType: 'quickbooks_online' });
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
      expect(mocks.health).toHaveBeenCalledWith({ preferredAdapterType: 'xero' });
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
    mocks.health.mockImplementation(
      () => new Promise((resolve) => { pending.push(resolve); })
    );

    await renderTab();

    selectAdapter('quickbooks_online');
    await waitFor(() => expect(pending).toHaveLength(1));
    selectAdapter('xero');
    await waitFor(() => expect(pending).toHaveLength(2));

    // Resolve the *new* (Xero) request first, then let the stale QBO request
    // finish last. The stale response must not overwrite the picker/target.
    pending[1](XERO_HEALTH);
    await waitFor(() => {
      expect(screen.getByTestId('accounting-export-realm')).toHaveValue('smoke-conn-b');
    });

    pending[0](QBO_HEALTH);
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
    expect(mocks.health).toHaveBeenCalledTimes(1);

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
    mocks.health.mockImplementation(
      () => new Promise((resolve) => { pending.push(resolve); })
    );

    await renderTab();
    selectAdapter('quickbooks_online');

    await waitFor(() => expect(pending).toHaveLength(1));
    expect(screen.getByRole('button', { name: 'Create Batch' })).toBeDisabled();

    pending[0](QBO_HEALTH);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create Batch' })).toBeEnabled();
    });
  });
});
