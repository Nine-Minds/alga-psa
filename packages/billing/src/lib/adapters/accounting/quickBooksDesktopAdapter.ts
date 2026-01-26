import logger from '@alga-psa/core/logger';
import {
  AccountingExportAdapter,
  AccountingExportAdapterCapabilities,
  AccountingExportAdapterContext,
  AccountingExportDeliveryResult,
  AccountingExportTransformResult
} from './accountingExportAdapter';

export class QuickBooksDesktopAdapter implements AccountingExportAdapter {
  static readonly TYPE = 'quickbooks_desktop';

  static async create(): Promise<QuickBooksDesktopAdapter> {
    return new QuickBooksDesktopAdapter();
  }

  readonly type = QuickBooksDesktopAdapter.TYPE;

  capabilities(): AccountingExportAdapterCapabilities {
    return {
      deliveryMode: 'file',
      supportsPartialRetry: false,
      supportsInvoiceUpdates: false
    };
  }

  async transform(context: AccountingExportAdapterContext): Promise<AccountingExportTransformResult> {
    const header = '!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tAMOUNT\tNAME\tMEMO';
    const rows = context.lines.map((line) => {
      return `TRNS\t${line.line_id}\tINVOICE\t${context.batch.created_at}\tACCOUNTS_RECEIVABLE\t${line.amount_cents / 100}\t${line.client_id ?? ''}\tInvoice ${line.invoice_id}`;
    });

    const content = [header, ...rows, 'ENDTRNS'].join('\n');

    return {
      documents: [
        {
          documentId: context.batch.batch_id,
          lineIds: context.lines.map((line) => line.line_id),
          payload: {
            type: 'quickbooks_desktop_iif',
            batchId: context.batch.batch_id,
            generatedAt: new Date().toISOString()
          }
        }
      ],
      files: [
        {
          filename: `accounting-export-${context.batch.batch_id}.iif`,
          contentType: 'text/plain',
          content
        }
      ],
      metadata: {
        adapter: this.type,
        fileSize: content.length,
        lineCount: context.lines.length
      }
    };
  }

  async deliver(
    transformResult: AccountingExportTransformResult,
    context: AccountingExportAdapterContext
  ): Promise<AccountingExportDeliveryResult> {
    const artifact = transformResult.files?.[0];
    logger.info('[QuickBooksDesktopAdapter] Prepared IIF artifact', {
      batchId: context.batch.batch_id,
      filename: artifact?.filename
    });

    const deliveredLines = transformResult.documents.flatMap((doc) =>
      doc.lineIds.map((lineId) => ({
        lineId,
        externalDocumentRef: artifact?.filename ?? null
      }))
    );

    return {
      deliveredLines,
      artifacts: {
        file: artifact
      },
      metadata: {
        adapter: this.type,
        artifactPrepared: Boolean(artifact)
      }
    };
  }
}
