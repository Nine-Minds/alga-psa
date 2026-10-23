/* eslint-disable custom-rules/no-feature-to-feature-imports -- exercises the existing billing-to-integrations accounting adapter boundary */
import type { Knex } from 'knex';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  defaultRealm: null as string | null,
  connections: {} as Record<string, { connectionId: string; xeroTenantId: string }>
}));
const createBatch = vi.hoisted(() => vi.fn(async (input: Record<string, unknown>) => ({
  ...input, batch_id: 'batch-1'
})));
const appendLines = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getTenantSecret: async (tenant: string, name: string) =>
      tenant === 'tenant-1' && name === 'xero_credentials'
        ? JSON.stringify(state.connections)
        : null
  })
}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  tenantDb: () => ({
    table: () => ({ select: () => ({ first: async () => ({
      settings: { accountingSync: { defaultRealm: state.defaultRealm } }
    }) }) })
  })
}));
vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  getDefaultQboRealmId: async () => 'qbo-realm',
  // Explicit manual targets are validated against the tenant's connected
  // integrations, so the QBO company must appear connected here.
  getStoredQboCredentialsMap: async () => ({ 'qbo-realm': { realmId: 'qbo-realm' } })
}));
vi.mock('../../src/services/accountingExportService', () => ({
  AccountingExportService: { createForTenant: async () => ({ createBatch, appendLines }) }
}));
vi.mock('../../src/services/accountingSync/syncProducers', () => ({
  satisfyExportOpsForManualBatch: vi.fn()
}));

import { AccountingExportInvoiceSelector, type InvoicePreviewLine } from '../../src/services/accountingExportInvoiceSelector';
import {
  getXeroDefaultSelection,
  resolveDefaultXeroConnectionId
} from '@alga-psa/integrations/lib/xero/xeroClientService';

// Exercise the real stored-connection loader, default selector and batch
// creation together. Preview and persistence are separate tested boundaries;
// importantly, the selection outcome itself is never stubbed here.
function makeSelector(tenant = 'tenant-1') {
  const selector = new AccountingExportInvoiceSelector({} as Knex, tenant);
  const preview = vi.spyOn(selector, 'previewInvoiceLines').mockResolvedValue([{
    invoiceId: 'invoice-1', chargeId: 'charge-1', clientId: 'client-1',
    invoiceNumber: 'INV-1', invoiceDate: '2026-01-01', invoiceStatus: 'sent', clientName: 'Example',
    amountCents: 5000, currencyCode: 'USD', servicePeriodSource: 'financial_document_fallback',
    isManualInvoice: false, isManualCharge: false, isMultiPeriod: false,
    isCredit: false, isZeroAmount: false, transactionIds: []
  } satisfies InvoicePreviewLine]);
  return { selector, preview };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.defaultRealm = null;
  state.connections = {
    'conn-1': { connectionId: 'conn-1', xeroTenantId: 'org-1' },
    'conn-2': { connectionId: 'conn-2', xeroTenantId: 'org-2' }
  };
});

describe('Xero stored selection to manual export batch', () => {
  it.each([
    { label: 'unset default', persisted: null, expected: 'conn-1' },
    { label: 'QBO default', persisted: 'qbo-realm', expected: 'conn-1' },
    { label: 'removed default', persisted: 'removed-connection', expected: 'conn-1' },
    { label: 'selected connection', persisted: 'conn-2', expected: 'conn-2' },
    { label: 'historical organisation default', persisted: 'org-2', expected: 'conn-2' }
  ])('uses the same connection for settings and batch creation with $label', async ({ persisted, expected }) => {
    state.defaultRealm = persisted;
    const { selector, preview } = makeSelector();
    expect(await getXeroDefaultSelection('tenant-1')).toEqual({ status: 'resolved', connectionId: expected });
    expect(await resolveDefaultXeroConnectionId('tenant-1')).toBe(expected);

    const { batch } = await selector.createBatchFromFilters({ adapterType: 'xero', filters: {} });
    expect(batch.target_realm).toBe(expected);
    expect(preview).toHaveBeenCalledWith(expect.objectContaining({ targetRealm: expected }));
    expect(createBatch).toHaveBeenCalledWith(expect.objectContaining({ target_realm: expected }));
    expect(appendLines).toHaveBeenCalledOnce();
  });

  it('selects the single connected organisation on first use', async () => {
    delete state.connections['conn-2'];
    const { selector } = makeSelector();
    const { batch } = await selector.createBatchFromFilters({ adapterType: 'xero', filters: {} });
    expect(batch.target_realm).toBe('conn-1');
  });

  it('rejects ambiguity before preview or persistence while allowing an explicit connection', async () => {
    state.defaultRealm = 'org-shared';
    state.connections = {
      unrelated: { connectionId: 'unrelated', xeroTenantId: 'org-other' },
      'conn-1': { connectionId: 'conn-1', xeroTenantId: 'org-shared' },
      'conn-2': { connectionId: 'conn-2', xeroTenantId: 'org-shared' }
    };
    const { selector, preview } = makeSelector();
    await expect(selector.createBatchFromFilters({ adapterType: 'xero', filters: {} }))
      .rejects.toMatchObject({ code: 'ACCOUNTING_EXPORT_XERO_SELECTION_AMBIGUOUS' });
    expect(preview).not.toHaveBeenCalled();
    expect(createBatch).not.toHaveBeenCalled();
    const { batch } = await selector.createBatchFromFilters({
      adapterType: 'xero', targetRealm: 'conn-2', filters: {}
    });
    expect(batch.target_realm).toBe('conn-2');
  });

  it.each(['tenant-1', 'tenant-2'])('rejects exports with no connection owned by %s', async (tenant) => {
    if (tenant === 'tenant-1') state.connections = {};
    const { selector, preview } = makeSelector(tenant);
    await expect(selector.createBatchFromFilters({ adapterType: 'xero', filters: {} }))
      .rejects.toMatchObject({ code: 'ACCOUNTING_EXPORT_XERO_CONNECTION_REQUIRED' });
    expect(preview).not.toHaveBeenCalled();
    expect(createBatch).not.toHaveBeenCalled();
  });

  it('preserves QBO manual batch selection', async () => {
    const { selector } = makeSelector();
    const { batch } = await selector.createBatchFromFilters({ adapterType: 'quickbooks_online', filters: {} });
    expect(batch.target_realm).toBe('qbo-realm');
  });
});
