/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

const capabilitiesState = vi.hoisted(() => ({
  current: {
    catalogRead: false,
    connectionsManage: false,
    mappingsManage: false,
    exportsExecute: false,
    remoteMutate: false,
    hasAny: false,
    loaded: true,
  },
}));
const actions = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  execute: vi.fn(),
  cancel: vi.fn(),
  health: vi.fn(),
}));

vi.mock('@alga-psa/auth/hooks/useAccountingCapabilities', () => ({
  useAccountingCapabilities: () => capabilitiesState.current,
}));

vi.mock('@alga-psa/billing/actions/accountingExportActions', () => ({
  listAccountingExportBatches: (...args: unknown[]) => actions.list(...args),
  getAccountingExportBatch: (...args: unknown[]) => actions.get(...args),
  createAccountingExportBatch: (...args: unknown[]) => actions.create(...args),
  executeAccountingExportBatch: (...args: unknown[]) => actions.execute(...args),
  cancelAccountingExportBatch: (...args: unknown[]) => actions.cancel(...args),
}));

vi.mock('@alga-psa/billing/actions/accountingSyncActions', () => ({
  getAccountingSyncHealth: (...args: unknown[]) => actions.health(...args),
}));

describe('Accounting Exports permission presentation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capabilitiesState.current = {
      catalogRead: false,
      connectionsManage: false,
      mappingsManage: false,
      exportsExecute: false,
      remoteMutate: false,
      hasAny: false,
      loaded: true,
    };
    actions.list.mockResolvedValue([]);
    actions.health.mockResolvedValue({ realms: [] });
  });

  afterEach(() => cleanup());

  it('shows only a generic denied state and makes no export calls without exports_execute', async () => {
    const { default: AccountingExportsTab } = await import(
      '../src/components/billing-dashboard/accounting/AccountingExportsTab'
    );

    render(<AccountingExportsTab />);

    expect(screen.getByRole('alert')).toHaveTextContent('Access denied');
    expect(screen.getByRole('alert')).toHaveTextContent('You do not have permission to access accounting exports.');
    expect(screen.queryByText('No export batches yet.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(actions.list).not.toHaveBeenCalled();
    expect(actions.health).not.toHaveBeenCalled();
  });

  it('turns a denied list result into the denied state and removes every export control', async () => {
    capabilitiesState.current = {
      ...capabilitiesState.current,
      exportsExecute: true,
      hasAny: true,
    };
    actions.list.mockResolvedValue({ permissionError: 'internal denied detail' });
    const { default: AccountingExportsTab } = await import(
      '../src/components/billing-dashboard/accounting/AccountingExportsTab'
    );

    render(<AccountingExportsTab />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Access denied');
    expect(screen.queryByText('internal denied detail')).not.toBeInTheDocument();
    expect(screen.queryByText('No export batches yet.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps the full export workflow available to an exports_execute-capable Finance user', async () => {
    capabilitiesState.current = {
      ...capabilitiesState.current,
      catalogRead: true,
      exportsExecute: true,
      hasAny: true,
    };
    actions.list.mockResolvedValue([
      {
        batch_id: 'batch-1',
        adapter_type: 'quickbooks_csv',
        status: 'ready',
        export_type: 'invoice',
        target_realm: null,
        queued_at: '2026-09-01T12:00:00.000Z',
        validated_at: null,
        delivered_at: null,
        posted_at: null,
        created_by: 'finance-user',
        last_updated_by: 'finance-user',
        created_at: '2026-09-01T12:00:00.000Z',
        updated_at: '2026-09-01T12:00:00.000Z',
        notes: null,
      },
    ]);
    const { default: AccountingExportsTab } = await import(
      '../src/components/billing-dashboard/accounting/AccountingExportsTab'
    );

    render(<AccountingExportsTab />);

    expect(await screen.findByText('batch-1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Execute' })).toBeEnabled();
    const newExport = screen.getByRole('button', { name: 'New Export' });
    expect(newExport).toBeEnabled();
    fireEvent.click(newExport);
    expect(await screen.findByRole('button', { name: 'Create Batch' })).toBeEnabled();
  });
});
