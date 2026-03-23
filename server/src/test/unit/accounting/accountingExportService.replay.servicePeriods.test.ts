import { describe, expect, it, vi } from 'vitest';

import {
  AccountingExportService,
  AccountingExportValidation,
} from '@alga-psa/billing/services';
import type {
  AccountingExportAdapter,
  AccountingExportAdapterCapabilities,
  AccountingExportAdapterContext,
  AccountingExportBatch,
  AccountingExportDeliveryResult,
  AccountingExportLine,
  AccountingExportTransformResult,
} from '@alga-psa/types';

class StubAdapter implements AccountingExportAdapter {
  readonly type = 'quickbooks_online';

  capabilities(): AccountingExportAdapterCapabilities {
    return {
      deliveryMode: 'api',
      supportsPartialRetry: true,
      supportsInvoiceUpdates: true,
    };
  }

  async transform(_context: AccountingExportAdapterContext): Promise<AccountingExportTransformResult> {
    return {
      documents: [],
    };
  }

  async deliver(_transform: AccountingExportTransformResult, context: AccountingExportAdapterContext): Promise<AccountingExportDeliveryResult> {
    return {
      deliveredLines: context.lines.map((line) => ({
        lineId: line.line_id,
        externalDocumentRef: `QB-${line.invoice_id}`,
      })),
    };
  }
}

describe('AccountingExportService replay service-period behavior', () => {
  it('preserves stored service-period provenance across delivery and rejected replay attempts', async () => {
    const batch: AccountingExportBatch = {
      batch_id: '11111111-1111-4111-8111-111111111111',
      tenant: '22222222-2222-4222-8222-222222222222',
      adapter_type: 'quickbooks_online',
      export_type: 'invoice',
      status: 'pending',
      queued_at: '2025-03-01T00:00:00.000Z',
      created_at: '2025-03-01T00:00:00.000Z',
      updated_at: '2025-03-01T00:00:00.000Z',
    };

    const line: AccountingExportLine = {
      line_id: '33333333-3333-4333-8333-333333333333',
      batch_id: batch.batch_id,
      tenant: batch.tenant,
      invoice_id: '44444444-4444-4444-8444-444444444444',
      invoice_charge_id: '55555555-5555-4555-8555-555555555555',
      client_id: '66666666-6666-4666-8666-666666666666',
      amount_cents: 15000,
      currency_code: 'USD',
      service_period_start: '2025-01-01T00:00:00.000Z',
      service_period_end: '2025-02-01T00:00:00.000Z',
      payload: {
        invoice_number: 'INV-1',
        service_period_source: 'canonical_detail_periods',
        recurring_detail_periods: [
          {
            service_period_start: '2025-01-01T00:00:00.000Z',
            service_period_end: '2025-02-01T00:00:00.000Z',
            billing_timing: 'arrears',
          },
        ],
      },
      status: 'ready',
      created_at: '2025-03-01T00:00:00.000Z',
      updated_at: '2025-03-01T00:00:00.000Z',
    };

    const repository = {
      getBatch: vi.fn(async () => ({ ...batch })),
      listLines: vi.fn(async () => [{ ...line }]),
      listErrors: vi.fn(async () => []),
      updateBatchStatus: vi.fn(async (_batchId: string, updates: Partial<AccountingExportBatch>) => {
        Object.assign(batch, updates);
        return { ...batch };
      }),
      updateLine: vi.fn(async (lineId: string, updates: Partial<AccountingExportLine>) => {
        expect(lineId).toBe(line.line_id);
        Object.assign(line, updates);
        return { ...line };
      }),
      getInvoicesTaxSource: vi.fn(async () => [{ invoice_id: line.invoice_id, tax_source: 'internal' }]),
      attachTransactionsToBatch: vi.fn(async () => 0),
      addError: vi.fn(),
    } as any;

    const adapter = new StubAdapter();
    const adapterRegistry = {
      get: vi.fn(() => adapter),
    } as any;

    const validationSpy = vi
      .spyOn(AccountingExportValidation, 'ensureMappingsForBatch')
      .mockImplementation(async () => {
        batch.status = 'ready';
      });
    const publishers = await import('@alga-psa/event-bus/publishers');
    const publishSpy = vi.spyOn(publishers, 'publishEvent').mockResolvedValue();

    try {
      const service = new AccountingExportService(repository, adapterRegistry);

      await service.executeBatch(batch.batch_id);

      expect(batch.status).toBe('delivered');
      expect(line.status).toBe('delivered');
      expect(line.external_document_ref).toBe('QB-44444444-4444-4444-8444-444444444444');
      expect(line.payload).toMatchObject({
        service_period_source: 'canonical_detail_periods',
        recurring_detail_periods: [
          {
            service_period_start: '2025-01-01T00:00:00.000Z',
            service_period_end: '2025-02-01T00:00:00.000Z',
            billing_timing: 'arrears',
          },
        ],
      });

      await expect(service.executeBatch(batch.batch_id)).rejects.toMatchObject({
        code: 'ACCOUNTING_EXPORT_INVALID_STATE',
      });

      expect(line.payload).toMatchObject({
        service_period_source: 'canonical_detail_periods',
        recurring_detail_periods: [
          {
            service_period_start: '2025-01-01T00:00:00.000Z',
            service_period_end: '2025-02-01T00:00:00.000Z',
            billing_timing: 'arrears',
          },
        ],
      });
      expect(validationSpy).toHaveBeenCalledTimes(1);
      expect(publishSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'ACCOUNTING_EXPORT_COMPLETED',
        })
      );
    } finally {
      validationSpy.mockRestore();
      publishSpy.mockRestore();
    }
  });
});
