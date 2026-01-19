/**
 * QuickBooks CSV Export Adapter
 *
 * Generates QuickBooks-compatible CSV files for invoice import.
 * This is an alternative to the OAuth-based QuickBooksOnlineAdapter,
 * allowing users to manually import invoices into QuickBooks.
 */

import logger from '@alga-psa/core/logger';
import { Knex } from 'knex';
import {
  AccountingExportAdapter,
  AccountingExportAdapterCapabilities,
  AccountingExportAdapterContext,
  AccountingExportDeliveryResult,
  AccountingExportTransformResult,
  AccountingExportDocument,
  AccountingExportFileAttachment,
  PendingTaxImportRecord
} from './accountingExportAdapter';
import { createTenantKnex } from '@alga-psa/db';
import { AccountingMappingResolver } from '../../../services/accountingMappingResolver';
import { KnexInvoiceMappingRepository } from '../../../repositories/invoiceMappingRepository';

/**
 * Database types for invoices and charges
 */
type DbInvoice = {
  invoice_id: string;
  invoice_number: string;
  po_number?: string | null;
  invoice_date: string | Date;
  due_date?: string | Date | null;
  total_amount: number;
  client_id?: string | null;
  currency_code?: string | null;
  tax_source?: string | null;
};

type DbCharge = {
  item_id: string;
  invoice_id: string;
  service_id?: string | null;
  description?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  total_price: number;
  net_amount?: number | null;
  tax_amount?: number | null;
  is_taxable?: boolean | null;
  is_discount?: boolean | null;
  tax_region?: string | null;
};

type DbClient = {
  client_id: string;
  client_name: string;
  billing_email?: string | null;
  payment_terms?: string | null;
};

/**
 * CSV row structure for QuickBooks import
 */
interface QuickBooksCSVRow {
  '*InvoiceNo': string;
  '*Customer': string;
  '*InvoiceDate': string;
  '*DueDate': string;
  '*Item': string;
  ItemDescription: string;
  '*ItemQuantity': string;
  '*ItemRate': string;
  '*ItemAmount': string;
  Terms: string;
  Memo: string;
  TaxCode: string;
  TaxAmount: string;
}

/**
 * CSV fields in export order
 */
const CSV_FIELDS: (keyof QuickBooksCSVRow)[] = [
  '*InvoiceNo',
  '*Customer',
  '*InvoiceDate',
  '*DueDate',
  '*Item',
  'ItemDescription',
  '*ItemQuantity',
  '*ItemRate',
  '*ItemAmount',
  'Terms',
  'Memo',
  'TaxCode',
  'TaxAmount'
];

/**
 * Payload structure for each invoice document
 */
interface InvoiceDocumentPayload {
  invoiceId: string;
  invoiceNumber: string;
  clientId: string;
  clientName: string;
  invoiceDate: string;
  dueDate: string;
  csvRows: QuickBooksCSVRow[];
  totals: {
    amountCents: number;
    taxCents: number;
  };
}

export function buildQuickBooksCsvMemo(invoiceId: string, poNumber?: string | null): string {
  return poNumber ? `Alga PSA: ${invoiceId} | PO ${poNumber}` : `Alga PSA: ${invoiceId}`;
}

/**
 * QuickBooks CSV Adapter for file-based invoice export.
 */
export class QuickBooksCSVAdapter implements AccountingExportAdapter {
  static readonly TYPE = 'quickbooks_csv';

  static async create(): Promise<QuickBooksCSVAdapter> {
    return new QuickBooksCSVAdapter();
  }

  readonly type = QuickBooksCSVAdapter.TYPE;

  capabilities(): AccountingExportAdapterCapabilities {
    return {
      deliveryMode: 'file',
      supportsPartialRetry: false, // All-or-nothing file generation
      supportsInvoiceUpdates: false, // CSV export is one-way
      supportsTaxDelegation: true, // Can export without tax
      supportsInvoiceFetch: false, // Uses CSV import instead
      supportsTaxComponentImport: false
    };
  }

  async transform(context: AccountingExportAdapterContext): Promise<AccountingExportTransformResult> {
    const { knex } = await createTenantKnex();
    const tenantId = context.batch.tenant;

    if (!tenantId) {
      throw new Error('QuickBooks CSV adapter requires batch tenant identifier');
    }

    logger.info('[QuickBooksCSVAdapter] Starting transform', {
      tenant: tenantId,
      batchId: context.batch.batch_id,
      lineCount: context.lines.length
    });

    // Load data
    const invoicesById = await this.loadInvoices(knex, tenantId, context);
    const chargesById = await this.loadCharges(knex, tenantId, context);
    const clientData = await this.loadClients(knex, tenantId, invoicesById);

    // Set up mapping resolver
    const resolver = await AccountingMappingResolver.create();

    // Group lines by invoice
    const linesByInvoice = this.groupBy(context.lines, (line) => line.invoice_id);
    const documents: AccountingExportDocument[] = [];
    let invoicesWithExternalTax = 0;

    for (const [invoiceId, exportLines] of linesByInvoice.entries()) {
      const invoice = invoicesById.get(invoiceId);
      if (!invoice) {
        throw new Error(`QuickBooks CSV adapter: invoice ${invoiceId} not found`);
      }

      const clientId = invoice.client_id ?? exportLines.find((line) => line.client_id)?.client_id;
      if (!clientId) {
        throw new Error(`QuickBooks CSV adapter: invoice ${invoiceId} missing client`);
      }

      const client = clientData.get(clientId);
      if (!client) {
        throw new Error(`QuickBooks CSV adapter: client ${clientId} not found for invoice ${invoiceId}`);
      }

      // Determine if tax should be excluded based on invoice's tax_source setting
      // 'external' or 'pending_external' means tax will be calculated by QuickBooks
      const shouldExcludeTax = invoice.tax_source === 'external' || invoice.tax_source === 'pending_external';
      if (shouldExcludeTax) {
        invoicesWithExternalTax++;
      }

      const csvRows: QuickBooksCSVRow[] = [];
      let totalAmountCents = 0;
      let totalTaxCents = 0;

      for (const line of exportLines) {
        if (!line.invoice_charge_id) {
          throw new Error(`QuickBooks CSV adapter: line ${line.line_id} missing invoice_charge_id`);
        }

        const charge = chargesById.get(line.invoice_charge_id);
        if (!charge) {
          throw new Error(`QuickBooks CSV adapter: charge ${line.invoice_charge_id} not found`);
        }

        if (!charge.service_id) {
          throw new Error(`QuickBooks CSV adapter: charge ${charge.item_id} missing service_id`);
        }

        // Resolve service mapping to get QuickBooks item name
        const serviceMapping = await resolver.resolveServiceMapping({
          adapterType: this.type,
          serviceId: charge.service_id,
          targetRealm: context.batch.target_realm
        });

        if (!serviceMapping) {
          throw new Error(`QuickBooks CSV adapter: no mapping for service ${charge.service_id}. Please configure service mappings before export.`);
        }

        // Get the item name from mapping metadata or use external_entity_id
        const itemName = this.getItemName(serviceMapping);

        // Calculate amounts
        const quantity = charge.quantity ?? 1;
        const unitPrice = charge.unit_price ?? charge.total_price;
        const lineAmount = charge.net_amount ?? charge.total_price;
        const taxAmount = shouldExcludeTax ? 0 : (charge.tax_amount ?? 0);

        totalAmountCents += lineAmount;
        totalTaxCents += taxAmount;

        // Resolve tax code if applicable
        let taxCode = '';
        if (!shouldExcludeTax && charge.tax_region) {
          const taxMapping = await resolver.resolveTaxCodeMapping({
            adapterType: this.type,
            taxRegionId: charge.tax_region,
            targetRealm: context.batch.target_realm
          });
          taxCode = taxMapping?.external_entity_id ?? '';
        }

      // Resolve payment terms
      const paymentTermId = client.payment_terms ?? 'net_30';
      const termMapping = await resolver.resolvePaymentTermMapping({
        adapterType: this.type,
        paymentTermId,
        targetRealm: context.batch.target_realm
      });
      const terms = termMapping?.external_entity_id ?? paymentTermId;

      // Resolve optional client/customer mapping
      const customerMapping = await resolver.resolveClientMapping({
        adapterType: this.type,
        clientId,
        targetRealm: context.batch.target_realm
      });
      const customerName = customerMapping?.external_entity_id ?? client.client_name;

      const csvRow: QuickBooksCSVRow = {
        '*InvoiceNo': invoice.invoice_number,
        '*Customer': customerName,
        '*InvoiceDate': this.formatDate(invoice.invoice_date),
        '*DueDate': this.formatDate(invoice.due_date) || this.formatDate(invoice.invoice_date),
        '*Item': itemName,
        ItemDescription: charge.description ?? '',
        '*ItemQuantity': quantity.toString(),
          '*ItemRate': this.centsToAmount(unitPrice).toFixed(2),
          '*ItemAmount': this.centsToAmount(lineAmount).toFixed(2),
          Terms: terms,
          Memo: buildQuickBooksCsvMemo(invoiceId, invoice.po_number),
          TaxCode: taxCode,
          TaxAmount: shouldExcludeTax ? '' : this.centsToAmount(taxAmount).toFixed(2)
        };

        csvRows.push(csvRow);
      }

      if (csvRows.length === 0) {
        logger.warn('[QuickBooksCSVAdapter] Skipping invoice with no lines', {
          invoiceId,
          tenant: tenantId
        });
        continue;
      }

      const payload: InvoiceDocumentPayload = {
        invoiceId,
        invoiceNumber: invoice.invoice_number,
        clientId,
        clientName: client.client_name,
        invoiceDate: this.formatDate(invoice.invoice_date),
        dueDate: this.formatDate(invoice.due_date) || this.formatDate(invoice.invoice_date),
        csvRows,
        totals: {
          amountCents: totalAmountCents,
          taxCents: totalTaxCents
        }
      };

      documents.push({
        documentId: invoiceId,
        lineIds: exportLines.map((line) => line.line_id),
        payload: payload as unknown as Record<string, unknown>
      });
    }

    logger.info('[QuickBooksCSVAdapter] Transform completed', {
      tenant: tenantId,
      documentsCreated: documents.length,
      invoicesWithExternalTax
    });

    return {
      documents,
      metadata: {
        adapter: this.type,
        invoices: documents.length,
        lines: context.lines.length,
        invoicesWithExternalTax
      }
    };
  }

  async deliver(
    transformResult: AccountingExportTransformResult,
    context: AccountingExportAdapterContext
  ): Promise<AccountingExportDeliveryResult> {
    const tenantId = context.batch.tenant;

    if (!tenantId) {
      throw new Error('QuickBooks CSV adapter requires batch tenant identifier for delivery');
    }

    const { knex } = await createTenantKnex();
    const invoiceMappingRepository = new KnexInvoiceMappingRepository(knex);
    const deliveredAt = new Date().toISOString();

    logger.info('[QuickBooksCSVAdapter] Starting delivery (file generation)', {
      tenant: tenantId,
      batchId: context.batch.batch_id,
      documentCount: transformResult.documents.length
    });

    // Collect all CSV rows from all documents
    const allRows: QuickBooksCSVRow[] = [];
    const deliveredLines: { lineId: string; externalDocumentRef?: string | null }[] = [];

    for (const document of transformResult.documents) {
      const payload = document.payload as unknown as InvoiceDocumentPayload;
      allRows.push(...payload.csvRows);

      // Mark lines as delivered with the invoice number as reference
      for (const lineId of document.lineIds) {
        deliveredLines.push({
          lineId,
          externalDocumentRef: `csv:${payload.invoiceNumber}`
        });
      }
    }

    if (allRows.length === 0) {
      throw new Error('QuickBooks CSV adapter: no data to export');
    }

    // Generate CSV content
    const csvContent = unparseCSV(allRows, CSV_FIELDS as string[]);

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const filename = `quickbooks-invoices-${timestamp}.csv`;

    for (const document of transformResult.documents) {
      const payload = document.payload as unknown as InvoiceDocumentPayload;
      const externalRef = `csv:${payload.invoiceNumber}`;
      await invoiceMappingRepository.upsertInvoiceMapping({
        tenantId,
        adapterType: this.type,
        invoiceId: document.documentId,
        externalInvoiceId: externalRef,
        targetRealm: context.batch.target_realm ?? null,
        metadata: {
          last_exported_at: deliveredAt,
          filename,
          invoiceNumber: payload.invoiceNumber
        }
      });
    }

    // Create file attachment
    const files: AccountingExportFileAttachment[] = [{
      filename,
      contentType: 'text/csv',
      content: csvContent
    }];

    logger.info('[QuickBooksCSVAdapter] Delivery completed', {
      tenant: tenantId,
      filename,
      rowCount: allRows.length,
      fileSize: csvContent.length
    });

    return {
      deliveredLines,
      artifacts: {
        filename,
        rowCount: allRows.length,
        fileSize: csvContent.length
      },
      metadata: {
        adapter: this.type,
        deliveredInvoices: transformResult.documents.length,
        files
      }
    };
  }

  /**
   * Called after export to create pending tax import records for invoices
   * that have external tax source (tax_source = 'external' or 'pending_external').
   * These invoices need tax amounts imported from QuickBooks after calculation.
   */
  async onTaxDelegationExport(
    deliveryResult: AccountingExportDeliveryResult,
    context: AccountingExportAdapterContext
  ): Promise<PendingTaxImportRecord[]> {
    const { knex } = await createTenantKnex();
    const tenantId = context.batch.tenant;
    const pendingRecords: PendingTaxImportRecord[] = [];
    const now = new Date().toISOString();

    // Extract unique invoice IDs from delivery result
    const invoiceRefs = new Map<string, string>();
    for (const line of deliveryResult.deliveredLines) {
      if (line.externalDocumentRef) {
        const invoiceId = this.extractInvoiceIdFromLine(context, line.lineId);
        if (invoiceId && !invoiceRefs.has(invoiceId)) {
          invoiceRefs.set(invoiceId, line.externalDocumentRef);
        }
      }
    }

    if (invoiceRefs.size === 0) {
      return [];
    }

    // Load invoices to check their tax_source setting
    const invoiceIds = Array.from(invoiceRefs.keys());
    const invoices = await knex('invoices')
      .select('invoice_id', 'tax_source')
      .where('tenant', tenantId)
      .whereIn('invoice_id', invoiceIds);

    const invoiceTaxSources = new Map(invoices.map((inv: { invoice_id: string; tax_source: string | null }) =>
      [inv.invoice_id, inv.tax_source]
    ));

    // Only create pending records for invoices with external tax source
    for (const [invoiceId, externalRef] of invoiceRefs.entries()) {
      const taxSource = invoiceTaxSources.get(invoiceId);
      if (taxSource === 'external' || taxSource === 'pending_external') {
        pendingRecords.push({
          invoiceId,
          externalInvoiceRef: externalRef,
          adapterType: this.type,
          targetRealm: context.batch.target_realm ?? undefined,
          exportedAt: now
        });
      }
    }

    if (pendingRecords.length > 0) {
      logger.info('[QuickBooksCSVAdapter] Created pending tax import records', {
        count: pendingRecords.length,
        batchId: context.batch.batch_id
      });
    }

    return pendingRecords;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private Helper Methods
  // ─────────────────────────────────────────────────────────────────────────────

  private async loadInvoices(
    knex: Knex,
    tenantId: string,
    context: AccountingExportAdapterContext
  ): Promise<Map<string, DbInvoice>> {
    const invoiceIds = Array.from(new Set(context.lines.map((line) => line.invoice_id)));
    if (invoiceIds.length === 0) {
      return new Map();
    }

    const rows = await knex<DbInvoice>('invoices')
      .select(
        'invoice_id',
        'invoice_number',
        'po_number',
        'invoice_date',
        'due_date',
        'total_amount',
        'client_id',
        'currency_code',
        'tax_source'
      )
      .where('tenant', tenantId)
      .whereIn('invoice_id', invoiceIds);

    return new Map(rows.map((row) => [row.invoice_id, row]));
  }

  private async loadCharges(
    knex: Knex,
    tenantId: string,
    context: AccountingExportAdapterContext
  ): Promise<Map<string, DbCharge>> {
    const chargeIds = context.lines
      .map((line) => line.invoice_charge_id)
      .filter((id): id is string => Boolean(id));

    if (chargeIds.length === 0) {
      return new Map();
    }

    const rows = await knex<DbCharge>('invoice_charges')
      .select(
        'item_id',
        'invoice_id',
        'service_id',
        'description',
        'quantity',
        'unit_price',
        'total_price',
        'net_amount',
        'tax_amount',
        'is_taxable',
        'is_discount',
        'tax_region'
      )
      .where('tenant', tenantId)
      .whereIn('item_id', chargeIds);

    return new Map(rows.map((row) => [row.item_id, row]));
  }

  private async loadClients(
    knex: Knex,
    tenantId: string,
    invoices: Map<string, DbInvoice>
  ): Promise<Map<string, DbClient>> {
    const clientIds = new Set<string>();

    for (const invoice of invoices.values()) {
      if (invoice.client_id) {
        clientIds.add(invoice.client_id);
      }
    }

    if (clientIds.size === 0) {
      return new Map();
    }

    const clients = await knex<DbClient>('clients')
      .select('client_id', 'client_name', 'billing_email', 'payment_terms')
      .where('tenant', tenantId)
      .whereIn('client_id', Array.from(clientIds));

    return new Map(clients.map((client) => [client.client_id, client]));
  }

  private getItemName(mapping: { external_entity_id: string; metadata?: Record<string, any> | null }): string {
    // Try to get a display name from metadata, otherwise use the external_entity_id
    const metadata = mapping.metadata;
    if (metadata) {
      if (typeof metadata.name === 'string') return metadata.name;
      if (typeof metadata.display_name === 'string') return metadata.display_name;
      if (typeof metadata.item_name === 'string') return metadata.item_name;
    }
    return mapping.external_entity_id;
  }

  private formatDate(value?: string | Date | null): string {
    if (!value) return '';
    const date = typeof value === 'string' ? new Date(value) : value;
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    // MM/DD/YYYY format for QuickBooks
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${month}/${day}/${year}`;
  }

  private centsToAmount(cents: number): number {
    return Math.round(cents) / 100;
  }

  private groupBy<T>(items: T[], iteratee: (item: T) => string): Map<string, T[]> {
    return items.reduce<Map<string, T[]>>((acc, item) => {
      const key = iteratee(item);
      const group = acc.get(key);
      if (group) {
        group.push(item);
      } else {
        acc.set(key, [item]);
      }
      return acc;
    }, new Map<string, T[]>());
  }

  private extractInvoiceIdFromLine(
    context: AccountingExportAdapterContext,
    lineId: string
  ): string | undefined {
    const line = context.lines.find((l) => l.line_id === lineId);
    return line?.invoice_id;
  }
}
