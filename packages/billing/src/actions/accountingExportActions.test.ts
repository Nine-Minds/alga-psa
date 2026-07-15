import { beforeEach, describe, expect, it, vi } from 'vitest';

const createBatchFromFiltersMock = vi.hoisted(() => vi.fn());
const previewInvoiceLinesMock = vi.hoisted(() => vi.fn());
const executeBatchMock = vi.hoisted(() => vi.fn());
const cancelBatchMock = vi.hoisted(() => vi.fn());
const loggerErrorMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action(
        { user_id: 'user-1', user_type: 'internal' },
        { tenant: 'tenant-1' },
        ...args
      )
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true)
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { error: loggerErrorMock }
}));

vi.mock('../services/accountingExportInvoiceSelector', () => ({
  AccountingExportInvoiceSelector: {
    create: vi.fn(async () => ({
      createBatchFromFilters: createBatchFromFiltersMock,
      previewInvoiceLines: previewInvoiceLinesMock
    }))
  }
}));

vi.mock('../services/accountingExportService', () => ({
  AccountingExportService: {
    create: vi.fn(async () => ({
      executeBatch: executeBatchMock,
      cancelBatch: cancelBatchMock
    }))
  }
}));

import { AppError } from '@alga-psa/core';
import {
  createAccountingExportBatch,
  executeAccountingExportBatch,
  previewAccountingExport
} from './accountingExportActions';

describe('accounting export action error boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a structured duplicate-filter error instead of throwing across the server-action boundary', async () => {
    createBatchFromFiltersMock.mockRejectedValue(new AppError(
      'ACCOUNTING_EXPORT_DUPLICATE',
      'An export batch already exists for this filter selection'
    ));

    await expect(createAccountingExportBatch({
      adapter_type: 'xero',
      export_type: 'invoice',
      filters: { invoice_statuses: ['sent'] }
    })).resolves.toEqual({
      success: false,
      code: 'ACCOUNTING_EXPORT_DUPLICATE',
      message: 'An export batch already exists for this filter selection'
    });
  });

  it.each([
    ['ACCOUNTING_EXPORT_EMPTY_BATCH', 'No invoices match the selected filters.'],
    ['ACCOUNTING_EXPORT_VALIDATION_FAILED', 'Export batch batch-1 is not ready for delivery.']
  ])('returns structured %s execution failures', async (code, message) => {
    executeBatchMock.mockRejectedValue(new AppError(code, message));

    const result = await executeAccountingExportBatch('batch-1');

    expect(result).toMatchObject({ success: false, code });
    expect((result as { message: string }).message).toContain(message);
  });

  it('does not expose unexpected database details to the browser', async () => {
    executeBatchMock.mockRejectedValue(new Error(
      'insert into accounting_export_lines: column document_id does not exist'
    ));

    const result = await executeAccountingExportBatch('batch-1');

    expect(result).toEqual({
      success: false,
      code: 'ACCOUNTING_EXPORT_UNEXPECTED',
      message: 'Unable to execute the accounting export. Please try again or contact support.'
    });
    expect(JSON.stringify(result)).not.toContain('document_id');
    expect(loggerErrorMock).toHaveBeenCalledOnce();
  });

  it('T037: preserves project references for milestone and deposit export previews', async () => {
    const baseLine = {
      invoiceId: 'invoice-1',
      invoiceNumber: 'INV-100',
      invoiceDate: '2026-07-15T00:00:00.000Z',
      invoiceStatus: 'sent',
      clientId: 'client-1',
      clientName: 'Acme',
      currencyCode: 'USD',
      servicePeriodStart: null,
      servicePeriodEnd: null,
      servicePeriodSource: 'financial_document_fallback',
      isManualInvoice: false,
      isManualCharge: false,
      isMultiPeriod: false,
      isCredit: false,
      isZeroAmount: false,
      transactionIds: [],
      projectId: 'project-1',
      projectNumber: 'PRJ-100',
      projectName: 'Datacenter migration'
    };
    previewInvoiceLinesMock.mockResolvedValue([
      {
        ...baseLine,
        chargeId: 'charge-1',
        amountCents: 25000,
        chargeType: 'project_milestone',
        scheduleEntryId: 'entry-1'
      },
      {
        ...baseLine,
        chargeId: 'charge-2',
        amountCents: 10000,
        chargeType: 'project_deposit',
        scheduleEntryId: 'entry-2'
      }
    ]);

    await expect(previewAccountingExport()).resolves.toMatchObject({
      invoiceCount: 1,
      lineCount: 2,
      lines: [
        {
          chargeType: 'project_milestone',
          projectId: 'project-1',
          projectNumber: 'PRJ-100',
          projectName: 'Datacenter migration',
          scheduleEntryId: 'entry-1'
        },
        {
          chargeType: 'project_deposit',
          projectId: 'project-1',
          projectNumber: 'PRJ-100',
          projectName: 'Datacenter migration',
          scheduleEntryId: 'entry-2'
        }
      ]
    });
  });
});
