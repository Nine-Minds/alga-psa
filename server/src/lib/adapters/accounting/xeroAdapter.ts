import logger from '@shared/core/logger';
import {
  AccountingExportAdapter,
  AccountingExportAdapterCapabilities,
  AccountingExportAdapterContext,
  AccountingExportDeliveryResult,
  AccountingExportTransformResult,
  AccountingExportDocument
} from './accountingExportAdapter';
import { XeroClientService, XeroInvoicePayload, XeroInvoiceLinePayload } from '../../xero/xeroClientService';

interface XeroInvoiceDraft {
  invoiceId: string;
  contactId: string | null;
  currency: string | null;
  amountCents: number;
  lines: XeroInvoiceLinePayload[];
}

interface XeroDocumentPayload {
  tenantId: string | null;
  connectionId?: string | null;
  invoice: XeroInvoiceDraft;
}

export class XeroAdapter implements AccountingExportAdapter {
  static readonly TYPE = 'xero';

  static async create(): Promise<XeroAdapter> {
    return new XeroAdapter();
  }

  readonly type = XeroAdapter.TYPE;

  capabilities(): AccountingExportAdapterCapabilities {
    return {
      deliveryMode: 'api',
      supportsPartialRetry: true,
      supportsInvoiceUpdates: true
    };
  }

  async transform(context: AccountingExportAdapterContext): Promise<AccountingExportTransformResult> {
    const invoices = new Map<string, XeroInvoiceDraft>();

    for (const line of context.lines) {
      const invoice = invoices.get(line.invoice_id) ?? {
        invoiceId: line.invoice_id,
        contactId: line.client_id ?? null,
        currency: line.currency_code ?? null,
        amountCents: 0,
        lines: []
      };

      invoice.amountCents += line.amount_cents;

      const linePayload: XeroInvoiceLinePayload = {
        lineId: line.line_id,
        amountCents: line.amount_cents,
        description: line.notes ?? null,
        itemCode: typeof line.mapping_resolution?.itemCode === 'string'
          ? line.mapping_resolution?.itemCode
          : null,
        tracking: line.mapping_resolution?.tracking ?? null,
        servicePeriodStart: line.service_period_start ?? null,
        servicePeriodEnd: line.service_period_end ?? null
      };

      invoice.lines.push(linePayload);
      invoices.set(line.invoice_id, invoice);
    }

    const documents: AccountingExportDocument[] = Array.from(invoices.values()).map((invoice) => {
      const payload: XeroDocumentPayload = {
        tenantId: context.batch.tenant ?? null,
        connectionId: context.batch.target_realm ?? null,
        invoice
      };

      return {
        documentId: invoice.invoiceId,
        lineIds: invoice.lines.map((line) => line.lineId),
        payload: payload as unknown as Record<string, unknown>
      };
    });

    return {
      documents,
      metadata: {
        adapter: this.type,
        tenant: context.batch.tenant,
        invoiceCount: documents.length,
        lineCount: context.lines.length
      }
    };
  }

  async deliver(
    transformResult: AccountingExportTransformResult,
    context: AccountingExportAdapterContext
  ): Promise<AccountingExportDeliveryResult> {
    const connectionId = context.batch.target_realm ?? null;
    const tenantId = context.batch.tenant ?? null;

    const client = await XeroClientService.create(tenantId ?? 'unknown', connectionId);

    const invoices = transformResult.documents.map((doc) => {
      const payload = doc.payload as unknown as XeroDocumentPayload;
      const invoice = payload.invoice;
      const mappedLines = invoice.lines.map((line) => ({
        ...line
      }));

      const invoicePayload: XeroInvoicePayload = {
        invoiceId: invoice.invoiceId,
        contactId: invoice.contactId,
        currency: invoice.currency,
        amountCents: invoice.amountCents,
        lines: mappedLines,
        metadata: {
          tenantId: payload.tenantId,
          connectionId: payload.connectionId
        }
      };

      return invoicePayload;
    });

    logger.info('[XeroAdapter] Delivering payload to Xero', {
      batchId: context.batch.batch_id,
      documents: invoices.length
    });

    const deliveryResults = await client.createInvoices(invoices);

    const deliveredLines = transformResult.documents.flatMap((doc, index) => {
      const externalId = deliveryResults[index]?.invoiceId ?? null;
      return doc.lineIds.map((lineId) => ({
        lineId,
        externalDocumentRef: externalId
      }));
    });

    return {
      deliveredLines,
      metadata: {
        adapter: this.type,
        deliveredCount: deliveredLines.length
      }
    };
  }
}
