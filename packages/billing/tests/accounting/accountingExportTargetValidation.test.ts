/* eslint-disable custom-rules/no-feature-to-feature-imports -- exercises the real billing-to-integrations accounting adapter boundary */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';

/**
 * An explicitly supplied manual-export target must be a connected integration
 * that matches the selected provider and belongs to the authenticated tenant.
 * These cases drive the real resolver (only the stored-connection loaders and
 * the persistence boundary are faked) so a stale picker value can never persist
 * a cross-provider batch, and prove no batch/line writes happen on rejection.
 */

const createBatch = vi.hoisted(() => vi.fn(async (input: Record<string, unknown>) => ({
  ...input, batch_id: 'batch-1'
})));
const appendLines = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action({ user_id: 'user-1', user_type: 'internal' }, { tenant: 'tenant-1' }, ...args)
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));

// The authenticated tenant owns two Xero connections and one QBO company.
vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  getStoredQboCredentialsMap: async () => ({ 'qbo-realm-a': { realmId: 'qbo-realm-a' } }),
  getDefaultQboRealmId: async () => 'qbo-realm-a'
}));
vi.mock('@alga-psa/integrations/lib/xero/xeroClientService', () => ({
  getStoredXeroConnections: async () => ({
    'conn-a': { connectionId: 'conn-a', xeroTenantId: 'org-a' },
    'conn-b': { connectionId: 'conn-b', xeroTenantId: 'org-b' }
  }),
  getXeroDefaultSelection: async () => ({ status: 'resolved', connectionId: 'conn-b' })
}));

const DB_TENANT = 'tenant-1';

function settingsBuilder() {
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.first = async () => ({ settings: { accountingSync: { defaultRealm: null } } });
  return builder;
}

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {}, tenant: DB_TENANT })),
  tenantDb: vi.fn(() => ({ table: () => settingsBuilder() })),
  writeAccountingAudit: vi.fn(async () => undefined)
}));

vi.mock('../../src/services/accountingExportService', () => ({
  AccountingExportService: {
    createForTenant: vi.fn(async () => ({ createBatch, appendLines }))
  }
}));
vi.mock('../../src/services/accountingSync/syncProducers', () => ({
  satisfyExportOpsForManualBatch: vi.fn(async () => undefined)
}));

import { AppError } from '@alga-psa/core';
import { AccountingExportInvoiceSelector } from '../../src/services/accountingExportInvoiceSelector';
import { createAccountingExportBatch } from '../../src/actions/accountingExportActions';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createBatchFromFilters explicit target validation', () => {
  function makeSelector() {
    const selector = new AccountingExportInvoiceSelector({} as Knex, DB_TENANT);
    const preview = vi.spyOn(selector, 'previewInvoiceLines').mockResolvedValue([
      {
        invoiceId: 'invoice-1', chargeId: 'charge-1', clientId: 'client-1',
        invoiceNumber: 'INV-1', invoiceDate: '2026-01-01', invoiceStatus: 'sent', clientName: 'Example',
        amountCents: 5000, currencyCode: 'USD', servicePeriodSource: 'financial_document_fallback',
        isManualInvoice: false, isManualCharge: false, isMultiPeriod: false,
        isCredit: false, isZeroAmount: false, transactionIds: []
      }
    ]);
    return { selector, preview };
  }

  it.each([
    ['cross-provider Xero connection on a QBO export', 'quickbooks_online', 'conn-b'],
    ['unknown QBO realm', 'quickbooks_online', 'qbo-realm-missing'],
    ['cross-tenant Xero connection', 'xero', 'conn-other-tenant'],
  ])('rejects %s before preview or persistence', async (_label, adapterType, targetRealm) => {
    const { selector, preview } = makeSelector();

    await expect(
      selector.createBatchFromFilters({ adapterType, targetRealm, filters: {} })
    ).rejects.toMatchObject({
      constructor: AppError,
      code: 'ACCOUNTING_EXPORT_TARGET_UNAVAILABLE'
    });

    expect(preview).not.toHaveBeenCalled();
    expect(createBatch).not.toHaveBeenCalled();
    expect(appendLines).not.toHaveBeenCalled();
  });

  it('persists the validated QBO adapter/target pair', async () => {
    const { selector } = makeSelector();
    const { batch } = await selector.createBatchFromFilters({
      adapterType: 'quickbooks_online', targetRealm: 'qbo-realm-a', filters: {}
    });

    expect(batch.batch_id).toBe('batch-1');
    expect(createBatch).toHaveBeenCalledWith(expect.objectContaining({
      adapter_type: 'quickbooks_online', target_realm: 'qbo-realm-a'
    }));
    expect(appendLines).toHaveBeenCalledOnce();
  });

  it('persists the validated Xero connection pair', async () => {
    const { selector } = makeSelector();
    await selector.createBatchFromFilters({
      adapterType: 'xero', targetRealm: 'conn-a', filters: {}
    });

    expect(createBatch).toHaveBeenCalledWith(expect.objectContaining({
      adapter_type: 'xero', target_realm: 'conn-a'
    }));
  });

  it('discards a stale realm for file adapters instead of failing the CSV export', async () => {
    const { selector } = makeSelector();
    await selector.createBatchFromFilters({
      adapterType: 'xero_csv', targetRealm: 'conn-b', filters: {}
    });

    expect(createBatch).toHaveBeenCalledWith(expect.objectContaining({
      adapter_type: 'xero_csv', target_realm: null
    }));
  });
});

describe('createAccountingExportBatch action explicit target validation', () => {
  it('returns a structured target-unavailable error without persisting anything', async () => {
    const result = await createAccountingExportBatch({
      adapter_type: 'quickbooks_online',
      export_type: 'invoice',
      filters: {},
      target_realm: 'conn-b'
    } as never);

    expect(result).toMatchObject({
      success: false,
      code: 'ACCOUNTING_EXPORT_TARGET_UNAVAILABLE'
    });
    expect(createBatch).not.toHaveBeenCalled();
    expect(appendLines).not.toHaveBeenCalled();
  });
});
