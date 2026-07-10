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

const TENANT = '22222222-2222-4222-8222-222222222222';
const BATCH_ID = '11111111-1111-4111-8111-111111111111';

function makeBatch(): AccountingExportBatch {
  return {
    batch_id: BATCH_ID,
    tenant: TENANT,
    adapter_type: 'quickbooks_online',
    export_type: 'invoice',
    status: 'pending',
    queued_at: '2025-03-01T00:00:00.000Z',
    created_at: '2025-03-01T00:00:00.000Z',
    updated_at: '2025-03-01T00:00:00.000Z',
  };
}

function makeLine(lineId: string, invoiceId: string): AccountingExportLine {
  return {
    line_id: lineId,
    batch_id: BATCH_ID,
    tenant: TENANT,
    document_id: invoiceId,
    amount_cents: 15000,
    currency_code: 'USD',
    status: 'ready',
    created_at: '2025-03-01T00:00:00.000Z',
    updated_at: '2025-03-01T00:00:00.000Z',
  };
}

/**
 * Adapter that delivers the first document and reports the rest as per-document
 * failures, mirroring how the QuickBooks Online adapter isolates rejected invoices.
 */
class PartialFailureAdapter implements AccountingExportAdapter {
  readonly type = 'quickbooks_online';

  constructor(private readonly deliverableInvoiceIds: Set<string>) {}

  capabilities(): AccountingExportAdapterCapabilities {
    return {
      deliveryMode: 'api',
      supportedExportTypes: ['invoice'],
      supportsPartialRetry: true,
      supportsInvoiceUpdates: true,
    };
  }

  async transform(context: AccountingExportAdapterContext): Promise<AccountingExportTransformResult> {
    return {
      documents: context.lines.map((line) => ({
        documentId: line.document_id,
        lineIds: [line.line_id],
        payload: {},
      })),
    };
  }

  async deliver(
    transformResult: AccountingExportTransformResult,
    _context: AccountingExportAdapterContext
  ): Promise<AccountingExportDeliveryResult> {
    const deliveredLines: AccountingExportDeliveryResult['deliveredLines'] = [];
    const failedDocuments: NonNullable<AccountingExportDeliveryResult['failedDocuments']> = [];

    for (const document of transformResult.documents) {
      if (this.deliverableInvoiceIds.has(document.documentId)) {
        deliveredLines.push(
          ...document.lineIds.map((lineId) => ({
            lineId,
            externalDocumentRef: `QB-${document.documentId}`,
          }))
        );
      } else {
        failedDocuments.push({
          documentId: document.documentId,
          lineIds: document.lineIds,
          code: 'QBO_VALIDATION_ERROR',
          message: 'QBO API Error during create on Invoice: Business Validation Error',
        });
      }
    }

    return {
      deliveredLines,
      failedDocuments: failedDocuments.length > 0 ? failedDocuments : undefined,
    };
  }
}

function makeHarness(lines: AccountingExportLine[], adapter: AccountingExportAdapter) {
  const batch = makeBatch();
  const linesById = new Map(lines.map((line) => [line.line_id, line]));
  const addedErrors: Array<Record<string, any>> = [];

  const repository = {
    getBatch: vi.fn(async () => ({ ...batch })),
    listLines: vi.fn(async () => lines.map((line) => ({ ...line }))),
    listErrors: vi.fn(async () => []),
    updateBatchStatus: vi.fn(async (_batchId: string, updates: Partial<AccountingExportBatch>) => {
      Object.assign(batch, updates);
      return { ...batch };
    }),
    updateLine: vi.fn(async (lineId: string, updates: Partial<AccountingExportLine>) => {
      const line = linesById.get(lineId);
      expect(line).toBeDefined();
      Object.assign(line!, updates);
      return { ...line! };
    }),
    getInvoicesTaxSource: vi.fn(async () =>
      lines.map((line) => ({ invoice_id: line.document_id, tax_source: 'internal' }))
    ),
    attachTransactionsToBatch: vi.fn(async () => 0),
    addError: vi.fn(async (input: Record<string, any>) => {
      addedErrors.push(input);
      return input;
    }),
  } as any;

  const adapterRegistry = {
    get: vi.fn(() => adapter),
  } as any;

  return { batch, repository, adapterRegistry, addedErrors };
}

describe('AccountingExportService partial delivery handling', () => {
  it('rejects batches whose export_type is unsupported by the adapter', async () => {
    const line = makeLine(
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444'
    );
    const adapter = new PartialFailureAdapter(new Set([line.document_id]));
    const { batch, repository, adapterRegistry } = makeHarness([line], adapter);
    batch.export_type = 'vendor_bill';

    const validationSpy = vi.spyOn(AccountingExportValidation, 'ensureMappingsForBatch');

    try {
      const service = new AccountingExportService(repository, adapterRegistry);
      await expect(service.executeBatch(BATCH_ID)).rejects.toMatchObject({
        code: 'ACCOUNTING_EXPORT_UNSUPPORTED_TYPE',
      });
      expect(validationSpy).not.toHaveBeenCalled();
    } finally {
      validationSpy.mockRestore();
    }
  });

  it('marks failed documents, records errors, and flags the batch needs_attention when some invoices deliver', async () => {
    const deliveredLine = makeLine(
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444'
    );
    const failedLine = makeLine(
      '55555555-5555-4555-8555-555555555555',
      '66666666-6666-4666-8666-666666666666'
    );
    const adapter = new PartialFailureAdapter(new Set([deliveredLine.document_id]));
    const { batch, repository, adapterRegistry, addedErrors } = makeHarness(
      [deliveredLine, failedLine],
      adapter
    );

    const validationSpy = vi
      .spyOn(AccountingExportValidation, 'ensureMappingsForBatch')
      .mockImplementation(async () => {
        batch.status = 'ready';
      });
    const publishers = await import('@alga-psa/event-bus/publishers');
    const publishSpy = vi.spyOn(publishers, 'publishEvent').mockResolvedValue();

    try {
      const service = new AccountingExportService(repository, adapterRegistry);
      const result = await service.executeBatch(BATCH_ID);

      expect(result.deliveredLines).toHaveLength(1);
      expect(result.failedDocuments).toHaveLength(1);

      expect(deliveredLine.status).toBe('delivered');
      expect(deliveredLine.external_document_ref).toBe(`QB-${deliveredLine.document_id}`);

      expect(failedLine.status).toBe('failed');
      expect(failedLine.notes).toContain('Business Validation Error');

      expect(addedErrors).toHaveLength(1);
      expect(addedErrors[0]).toMatchObject({
        batch_id: BATCH_ID,
        line_id: failedLine.line_id,
        code: 'QBO_VALIDATION_ERROR',
      });

      expect(batch.status).toBe('needs_attention');
      expect(batch.notes).toContain('1 of 2 document(s) failed to deliver');
      expect(batch.delivered_at).toBeTruthy();

      expect(publishSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'ACCOUNTING_EXPORT_COMPLETED' })
      );
      expect(publishSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'ACCOUNTING_EXPORT_FAILED',
          payload: expect.objectContaining({
            batchId: BATCH_ID,
            deliveredLineIds: [deliveredLine.line_id],
            error: expect.objectContaining({ code: 'QBO_VALIDATION_ERROR' }),
          }),
        })
      );
    } finally {
      validationSpy.mockRestore();
      publishSpy.mockRestore();
    }
  });

  it('marks the batch failed when every document fails to deliver', async () => {
    const lineA = makeLine(
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444'
    );
    const lineB = makeLine(
      '55555555-5555-4555-8555-555555555555',
      '66666666-6666-4666-8666-666666666666'
    );
    const adapter = new PartialFailureAdapter(new Set());
    const { batch, repository, adapterRegistry, addedErrors } = makeHarness([lineA, lineB], adapter);

    const validationSpy = vi
      .spyOn(AccountingExportValidation, 'ensureMappingsForBatch')
      .mockImplementation(async () => {
        batch.status = 'ready';
      });
    const publishers = await import('@alga-psa/event-bus/publishers');
    const publishSpy = vi.spyOn(publishers, 'publishEvent').mockResolvedValue();

    try {
      const service = new AccountingExportService(repository, adapterRegistry);
      const result = await service.executeBatch(BATCH_ID);

      expect(result.deliveredLines).toHaveLength(0);
      expect(lineA.status).toBe('failed');
      expect(lineB.status).toBe('failed');
      expect(addedErrors).toHaveLength(2);

      expect(batch.status).toBe('failed');

      expect(publishSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'ACCOUNTING_EXPORT_COMPLETED' })
      );
      expect(publishSpy).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'ACCOUNTING_EXPORT_FAILED' })
      );
    } finally {
      validationSpy.mockRestore();
      publishSpy.mockRestore();
    }
  });
});
