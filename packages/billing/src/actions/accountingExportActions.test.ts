import { beforeEach, describe, expect, it, vi } from 'vitest';

const createBatchFromFiltersMock = vi.hoisted(() => vi.fn());
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
    create: vi.fn(async () => ({ createBatchFromFilters: createBatchFromFiltersMock }))
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
  executeAccountingExportBatch
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
});
