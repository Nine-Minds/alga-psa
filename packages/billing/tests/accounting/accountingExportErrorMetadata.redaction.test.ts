import { describe, expect, it } from 'vitest';
import { AppError } from '@alga-psa/core';

import { AccountingExportService } from '../../src/services/accountingExportService';

const SENTINELS = {
  accessToken: 'SENTINEL-ACCESS-TOKEN-9f8e7d6c5b4a39281706f5e4d3c2b1a0aabbccdd',
  refreshToken: 'SENTINEL-REFRESH-TOKEN-0a1b2c3d4e5f60718293a4b5c6d7e8f9deadbeef',
  clientSecret: 'SENTINEL-CLIENT-SECRET-abcdef0123456789abcdef0123456789cafebabe',
  authHeader: 'Bearer SENTINEL-AUTH-HEADER-fedcba9876543210fedcba9876543210feedface',
  customerName: 'SENTINEL Customer Acme Ltd',
  invoiceDetail: 'SENTINEL Invoice INV-4242 for 12 widgets'
};

function expectNoSentinels(serialized: string): void {
  for (const sentinel of Object.values(SENTINELS)) {
    expect(serialized).not.toContain(sentinel);
  }
}

/**
 * In-memory stand-in for AccountingExportRepository: captures exactly what
 * would be inserted into accounting_export_errors and serves it back the way
 * the batch-detail API reads it.
 */
function makeFakeRepository() {
  const errors: any[] = [];
  const lineUpdates: any[] = [];
  return {
    errors,
    lineUpdates,
    async addError(input: any) {
      const row = { ...input, error_id: `err-${errors.length + 1}`, resolution_state: 'open' };
      errors.push(row);
      return row;
    },
    async updateLine(lineId: string, updates: any) {
      lineUpdates.push({ lineId, ...updates });
      return { line_id: lineId, ...updates };
    },
    async listErrors() {
      return errors;
    }
  };
}

describe('accounting export error metadata redaction', () => {
  it('persists allowlisted diagnostics only, even when adapter errors carry raw provider payloads', async () => {
    const repository = makeFakeRepository();
    const service = new AccountingExportService(repository as any, {} as any);

    // An adapter error the way a compromised/legacy normalizer could have
    // produced it: validation details plus a raw provider element and tokens.
    const adapterError = new AppError('XERO_VALIDATION_ERROR', 'Xero rejected one or more invoices', {
      status: 400,
      correlationId: 'xero-corr-9',
      errors: [
        {
          documentId: 'doc-1',
          message: 'Account code is required',
          validationErrors: [
            {
              message: 'Account code is required',
              field: 'AccountCode',
              raw: { Contact: { Name: SENTINELS.customerName } }
            }
          ],
          raw: {
            Invoice: {
              Contact: { Name: SENTINELS.customerName },
              LineItems: [{ Description: SENTINELS.invoiceDetail }]
            },
            access_token: SENTINELS.accessToken,
            headers: { Authorization: SENTINELS.authHeader }
          }
        }
      ]
    });

    await (service as any).persistAdapterFailure({
      batchId: 'batch-1',
      adapterType: 'xero',
      context: { batch: { batch_id: 'batch-1' }, lines: [] },
      transformResult: {
        documents: [{ documentId: 'doc-1', lineIds: ['line-1'] }]
      },
      error: adapterError
    });

    expect(repository.errors).toHaveLength(1);
    const persisted = repository.errors[0];
    const serialized = JSON.stringify(persisted);

    // Sentinels are gone from what lands in the database…
    expectNoSentinels(serialized);
    expect(persisted.metadata.raw).toBeUndefined();
    expect(persisted.metadata.originalError).toBeUndefined();

    // …while the support-relevant diagnostics survive.
    expect(persisted.metadata.adapterType).toBe('xero');
    expect(persisted.metadata.adapterCode).toBe('XERO_VALIDATION_ERROR');
    expect(persisted.metadata.correlationId).toBe('xero-corr-9');
    expect(persisted.metadata.documentId).toBe('doc-1');
    expect(persisted.metadata.validationErrors).toEqual([
      { message: 'Account code is required', field: 'AccountCode' }
    ]);
    expect(persisted.message).toContain('Account code is required');

    // Readback path (what the billing settings API returns) is clean too.
    const readBack = await repository.listErrors();
    expectNoSentinels(JSON.stringify(readBack));
  });

  it('strips raw payload keys from delivery document failure metadata', async () => {
    const repository = makeFakeRepository();
    const service = new AccountingExportService(repository as any, {} as any);

    await (service as any).persistDeliveryDocumentFailure('batch-2', 'qbo', {
      documentId: 'doc-9',
      lineIds: [],
      code: 'QBO_VALIDATION_ERROR',
      message: 'QuickBooks rejected the invoice',
      metadata: {
        intuitTid: 'tid-55',
        raw: { body: SENTINELS.invoiceDetail, refresh_token: SENTINELS.refreshToken },
        originalError: { config: { headers: { Authorization: SENTINELS.authHeader } } }
      }
    });

    expect(repository.errors).toHaveLength(1);
    const persisted = repository.errors[0];
    expectNoSentinels(JSON.stringify(persisted));
    expect(persisted.metadata.raw).toBeUndefined();
    expect(persisted.metadata.originalError).toBeUndefined();
    expect(persisted.metadata.intuitTid).toBe('tid-55');
    expect(persisted.metadata.documentId).toBe('doc-9');
  });
});
