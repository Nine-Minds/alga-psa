import logger from '@shared/core/logger';
import { Knex } from 'knex';
import {
  AccountingExportAdapter,
  AccountingExportAdapterCapabilities,
  AccountingExportAdapterContext,
  AccountingExportDeliveryResult,
  AccountingExportTransformResult,
  AccountingExportDocument
} from './accountingExportAdapter';
import { createTenantKnex } from '../../db';
import { AccountingMappingResolver } from '../../services/accountingMappingResolver';
import { KnexInvoiceMappingRepository } from '../../repositories/invoiceMappingRepository';
import { AppError } from '../../errors';
import { unparseCSV } from '../../utils/csvParser';

/**
 * Fixed tracking category names for Xero CSV export.
 * These are used to link Xero invoices back to Alga PSA for tax import.
 */
const TRACKING_CATEGORY_SOURCE_SYSTEM = 'Source System';
const TRACKING_CATEGORY_SOURCE_VALUE = 'AlgaPSA';
const TRACKING_CATEGORY_INVOICE_ID = 'External Invoice ID';

export function buildXeroCsvReference(invoiceId: string, poNumber?: string | null): string {
  return poNumber ? `${invoiceId} | PO ${poNumber}` : invoiceId;
}

type DbInvoice = {
  invoice_id: string;
  invoice_number?: string | null;
  po_number?: string | null;
  invoice_date?: string | Date | null;
  due_date?: string | Date | null;
  client_id?: string | null;
  currency_code?: string | null;
};

type DbCharge = {
  item_id: string;
  invoice_id: string;
  service_id?: string | null;
  description?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  total_price: number;
  tax_amount?: number | null;
  tax_region?: string | null;
};

type DbClient = {
  client_id: string;
  client_name: string;
  billing_email?: string | null;
};

type MappingRowRaw = {
  id: string;
  integration_type: string;
  alga_entity_type: string;
  alga_entity_id: string;
  external_entity_id: string;
  external_realm_id?: string | null;
  metadata?: unknown;
};

type MappingRow = {
  id: string;
  integration_type: string;
  alga_entity_type: string;
  alga_entity_id: string;
  external_entity_id: string;
  external_realm_id?: string | null;
  metadata: Record<string, unknown> | null;
};

/**
 * CSV row structure for Xero Sales Invoice import.
 * Xero expects specific column names with asterisks (*) indicating required fields.
 */
interface XeroCsvRow {
  '*ContactName': string;
  'EmailAddress': string;
  'POAddressLine1': string;
  'POAddressLine2': string;
  'POAddressLine3': string;
  'POAddressLine4': string;
  'POCity': string;
  'PORegion': string;
  'POPostalCode': string;
  'POCountry': string;
  '*InvoiceNumber': string;
  'Reference': string;
  '*InvoiceDate': string;
  '*DueDate': string;
  'Total': string;
  'InventoryItemCode': string;
  '*Description': string;
  '*Quantity': string;
  '*UnitAmount': string;
  'Discount': string;
  '*AccountCode': string;
  '*TaxType': string;
  'TrackingName1': string;
  'TrackingOption1': string;
  'TrackingName2': string;
  'TrackingOption2': string;
  'Currency': string;
}

interface XeroCsvDocumentPayload {
  invoiceId: string;
  invoiceNumber: string;
  clientName: string;
  clientEmail: string;
  rows: XeroCsvRow[];
}

/**
 * Xero CSV Export Adapter
 *
 * Generates CSV files in Xero's Sales Invoice import format for manual import.
 * This adapter is used when OAuth-based integration is not available.
 *
 * Key features:
 * - File-based delivery (user downloads and imports manually)
 * - Includes tracking categories for invoice reconciliation
 * - Supports tax delegation (exports without tax, allowing Xero to calculate)
 * - Uses existing service and tax region mappings
 *
 * CSV Format follows Xero's official Sales Invoice import specification.
 */
export class XeroCsvAdapter implements AccountingExportAdapter {
  static readonly TYPE = 'xero_csv';

  static async create(): Promise<XeroCsvAdapter> {
    return new XeroCsvAdapter();
  }

  readonly type = XeroCsvAdapter.TYPE;

  capabilities(): AccountingExportAdapterCapabilities {
    return {
      deliveryMode: 'file',
      supportsPartialRetry: false,
      supportsInvoiceUpdates: false,
      supportsTaxDelegation: true,
      supportsInvoiceFetch: false, // No API access - CSV only
      supportsTaxComponentImport: false
    };
  }

  async transform(context: AccountingExportAdapterContext): Promise<AccountingExportTransformResult> {
    const tenantId = context.batch.tenant;
    if (!tenantId) {
      throw new AppError('XERO_CSV_TENANT_REQUIRED', 'Xero CSV export requires batch tenant identifier');
    }

    const { knex } = await createTenantKnex();
    const resolver = await AccountingMappingResolver.create({});

    const invoicesById = await this.loadInvoices(knex, tenantId, context);
    const chargesById = await this.loadCharges(knex, tenantId, context);
    const clientData = await this.loadClients(knex, tenantId, context, invoicesById);

    const linesByInvoice = groupBy(context.lines, (line) => line.invoice_id);
    const documents: AccountingExportDocument[] = [];
    const allCsvRows: XeroCsvRow[] = [];

    // Extract date format from adapter settings (default to MM/DD/YYYY)
    const dateFormat: XeroDateFormat = (context.adapterSettings?.dateFormat as XeroDateFormat) || 'MM/DD/YYYY';

    for (const [invoiceId, exportLines] of linesByInvoice.entries()) {
      const invoice = invoicesById.get(invoiceId);
      if (!invoice) {
        throw new AppError('XERO_CSV_INVOICE_NOT_FOUND', `Invoice ${invoiceId} not found for tenant ${tenantId}`);
      }

      const clientId =
        invoice.client_id ??
        exportLines.find((line) => line.client_id)?.client_id ??
        null;

      if (!clientId) {
        throw new AppError('XERO_CSV_CLIENT_MISSING', `Invoice ${invoiceId} is missing client data`);
      }

      const clientRow = clientData.clients.get(clientId);
      if (!clientRow) {
        throw new AppError('XERO_CSV_CLIENT_NOT_FOUND', `Client ${clientId} missing for invoice ${invoiceId}`);
      }

      const invoiceNumber = invoice.invoice_number ?? invoiceId;
      const invoiceDate = formatDateForXero(invoice.invoice_date, dateFormat);
      const dueDate = formatDateForXero(invoice.due_date, dateFormat) ?? invoiceDate;
      const currency = invoice.currency_code ?? '';

      const invoiceRows: XeroCsvRow[] = [];
      let isFirstLine = true;

      for (const line of exportLines) {
        if (!line.invoice_charge_id) {
          throw new AppError('XERO_CSV_LINE_MISSING_CHARGE', `Export line ${line.line_id} missing invoice_charge_id`);
        }

        const charge = chargesById.get(line.invoice_charge_id);
        if (!charge) {
          throw new AppError('XERO_CSV_CHARGE_NOT_FOUND', `Charge ${line.invoice_charge_id} missing for invoice ${invoiceId}`);
        }

        // Resolve service mapping for item code and account code
        let itemCode = '';
        let accountCode = '';
        let taxType = '';

        if (charge.service_id) {
          const serviceMapping = await resolver.resolveServiceMapping({
            adapterType: 'xero', // Use xero mappings (shared with OAuth adapter)
            serviceId: charge.service_id,
            targetRealm: context.batch.target_realm
          });

          if (serviceMapping) {
            const metadata = serviceMapping.metadata ?? {};
            itemCode = safeString(metadata.itemCode) ?? safeString(serviceMapping.external_entity_id) ?? '';
            accountCode = safeString(metadata.accountCode) ?? '';
            taxType = safeString(metadata.taxType) ?? '';
          }
        }

        // Resolve tax mapping if we have a tax region
        if (charge.tax_region && !taxType) {
          const taxMapping = await resolver.resolveTaxCodeMapping({
            adapterType: 'xero', // Use xero mappings
            taxRegionId: charge.tax_region,
            targetRealm: context.batch.target_realm
          });

          if (taxMapping) {
            taxType = safeString(taxMapping.external_entity_id) ?? '';
          }
        }

        const description = line.notes ?? charge.description ?? `Line item for invoice ${invoiceNumber}`;
        const quantity = typeof charge.quantity === 'number' ? charge.quantity : 1;
        const unitAmount = typeof charge.unit_price === 'number'
          ? (charge.unit_price / 100).toFixed(2)
          : (line.amount_cents / 100 / quantity).toFixed(2);

        // Build CSV row
        const row: XeroCsvRow = {
          '*ContactName': isFirstLine ? clientRow.client_name : '',
          'EmailAddress': isFirstLine ? (clientRow.billing_email ?? '') : '',
          'POAddressLine1': '',
          'POAddressLine2': '',
          'POAddressLine3': '',
          'POAddressLine4': '',
          'POCity': '',
          'PORegion': '',
          'POPostalCode': '',
          'POCountry': '',
          '*InvoiceNumber': isFirstLine ? invoiceNumber : '',
          'Reference': isFirstLine
            ? buildXeroCsvReference(invoiceId, invoice.po_number)
            : '', // Store Alga invoice ID in Reference (plus PO when available)
          '*InvoiceDate': isFirstLine ? invoiceDate : '',
          '*DueDate': isFirstLine ? dueDate : '',
          'Total': '', // Xero calculates this
          'InventoryItemCode': itemCode,
          '*Description': description,
          '*Quantity': quantity.toString(),
          '*UnitAmount': unitAmount,
          'Discount': '',
          '*AccountCode': accountCode,
          '*TaxType': taxType,
          'TrackingName1': TRACKING_CATEGORY_SOURCE_SYSTEM,
          'TrackingOption1': TRACKING_CATEGORY_SOURCE_VALUE,
          'TrackingName2': TRACKING_CATEGORY_INVOICE_ID,
          'TrackingOption2': invoiceId, // Store Alga invoice ID for reconciliation
          'Currency': isFirstLine ? currency : ''
        };

        invoiceRows.push(row);
        allCsvRows.push(row);
        isFirstLine = false;
      }

      if (invoiceRows.length === 0) {
        logger.warn('[XeroCsvAdapter] skipping invoice with no exportable lines', {
          tenant: tenantId,
          invoiceId
        });
        continue;
      }

      const documentPayload: XeroCsvDocumentPayload = {
        invoiceId,
        invoiceNumber,
        clientName: clientRow.client_name,
        clientEmail: clientRow.billing_email ?? '',
        rows: invoiceRows
      };

      documents.push({
        documentId: invoiceId,
        lineIds: exportLines.map((line) => line.line_id),
        payload: documentPayload as unknown as Record<string, unknown>
      });
    }

    // Generate CSV content
    const csvHeaders = [
      '*ContactName',
      'EmailAddress',
      'POAddressLine1',
      'POAddressLine2',
      'POAddressLine3',
      'POAddressLine4',
      'POCity',
      'PORegion',
      'POPostalCode',
      'POCountry',
      '*InvoiceNumber',
      'Reference',
      '*InvoiceDate',
      '*DueDate',
      'Total',
      'InventoryItemCode',
      '*Description',
      '*Quantity',
      '*UnitAmount',
      'Discount',
      '*AccountCode',
      '*TaxType',
      'TrackingName1',
      'TrackingOption1',
      'TrackingName2',
      'TrackingOption2',
      'Currency'
    ];

    const csvContent = unparseCSV(allCsvRows, csvHeaders);

    const filename = `xero-invoice-export-${context.batch.batch_id}.csv`;

    logger.info('[XeroCsvAdapter] generated CSV export', {
      batchId: context.batch.batch_id,
      tenantId,
      invoiceCount: documents.length,
      lineCount: allCsvRows.length,
      fileSize: csvContent.length
    });

    return {
      documents,
      files: [
        {
          filename,
          contentType: 'text/csv',
          content: csvContent
        }
      ],
      metadata: {
        adapter: this.type,
        invoices: documents.length,
        lines: allCsvRows.length,
        taxDelegationMode: context.taxDelegationMode ?? 'none',
        trackingCategories: {
          sourceSystem: TRACKING_CATEGORY_SOURCE_SYSTEM,
          sourceValue: TRACKING_CATEGORY_SOURCE_VALUE,
          invoiceId: TRACKING_CATEGORY_INVOICE_ID
        }
      }
    };
  }

  async deliver(
    transformResult: AccountingExportTransformResult,
    context: AccountingExportAdapterContext
  ): Promise<AccountingExportDeliveryResult> {
    const tenantId = context.batch.tenant;
    if (!tenantId) {
      throw new AppError('XERO_CSV_TENANT_REQUIRED', 'Xero CSV delivery requires batch tenant identifier');
    }

    const { knex } = await createTenantKnex();
    const invoiceMappingRepository = new KnexInvoiceMappingRepository(knex);
    const artifact = transformResult.files?.[0];
    const deliveredAt = new Date().toISOString();

    logger.info('[XeroCsvAdapter] prepared CSV artifact for download', {
      batchId: context.batch.batch_id,
      filename: artifact?.filename,
      documentCount: transformResult.documents.length
    });

    // For file-based delivery, map all lines to the generated file
    const deliveredLines = transformResult.documents.flatMap((doc) =>
      doc.lineIds.map((lineId) => ({
        lineId,
        externalDocumentRef: artifact?.filename ?? null
      }))
    );

    // Create invoice mappings to mark invoices as exported (prevents re-export)
    for (const document of transformResult.documents) {
      const payload = document.payload as unknown as XeroCsvDocumentPayload;
      const externalRef = `csv:${payload.invoiceNumber}`;

      await invoiceMappingRepository.upsertInvoiceMapping({
        tenantId,
        adapterType: this.type,
        invoiceId: document.documentId,
        externalInvoiceId: externalRef,
        targetRealm: context.batch.target_realm ?? null,
        metadata: {
          last_exported_at: deliveredAt,
          filename: artifact?.filename,
          invoiceNumber: payload.invoiceNumber,
          trackingCategories: {
            sourceSystem: TRACKING_CATEGORY_SOURCE_SYSTEM,
            sourceValue: TRACKING_CATEGORY_SOURCE_VALUE,
            invoiceId: TRACKING_CATEGORY_INVOICE_ID
          }
        }
      });
    }

    logger.info('[XeroCsvAdapter] created invoice mappings', {
      batchId: context.batch.batch_id,
      tenant: tenantId,
      invoiceCount: transformResult.documents.length
    });

    return {
      deliveredLines,
      artifacts: {
        file: artifact
      },
      metadata: {
        adapter: this.type,
        artifactPrepared: Boolean(artifact),
        instructions: {
          step1: 'Download the CSV file',
          step2: 'In Xero: Go to Business → Invoices → Import',
          step3: 'Upload the CSV file',
          step4: 'Review and import as Draft invoices',
          step5: 'Xero will calculate tax based on your tax settings',
          step6: 'To import tax back: Export Invoice Details Report from Xero and upload to Alga'
        }
      }
    };
  }

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
        'client_id',
        'currency_code'
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
        'tax_amount',
        'tax_region'
      )
      .where('tenant', tenantId)
      .whereIn('item_id', chargeIds);

    return new Map(rows.map((row) => [row.item_id, row]));
  }

  private async loadClients(
    knex: Knex,
    tenantId: string,
    context: AccountingExportAdapterContext,
    invoices: Map<string, DbInvoice>
  ): Promise<{ clients: Map<string, DbClient>; mappings: Map<string, MappingRow> }> {
    const clientIds = new Set<string>();

    for (const invoice of invoices.values()) {
      if (invoice.client_id) {
        clientIds.add(invoice.client_id);
      }
    }

    for (const line of context.lines) {
      if (line.client_id) {
        clientIds.add(line.client_id);
      }
    }

    if (clientIds.size === 0) {
      return { clients: new Map(), mappings: new Map() };
    }

    const clients = await knex<DbClient>('clients')
      .select('client_id', 'client_name', 'billing_email')
      .where('tenant', tenantId)
      .whereIn('client_id', Array.from(clientIds));

    const clientMap = new Map(clients.map((client) => [client.client_id, client]));

    // For CSV export, we don't need Xero contact mappings since we use client names directly
    return { clients: clientMap, mappings: new Map() };
  }
}

function safeString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  return undefined;
}

type XeroDateFormat = 'DD/MM/YYYY' | 'MM/DD/YYYY';

function formatDateForXero(value?: string | Date | null, dateFormat: XeroDateFormat = 'MM/DD/YYYY'): string {
  if (!value) {
    return formatCurrentDate(dateFormat);
  }
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return formatCurrentDate(dateFormat);
  }
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();

  if (dateFormat === 'DD/MM/YYYY') {
    return `${day}/${month}/${year}`;
  }
  // MM/DD/YYYY format
  return `${month}/${day}/${year}`;
}

function formatCurrentDate(dateFormat: XeroDateFormat): string {
  const now = new Date();
  const day = now.getDate().toString().padStart(2, '0');
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const year = now.getFullYear();

  if (dateFormat === 'DD/MM/YYYY') {
    return `${day}/${month}/${year}`;
  }
  return `${month}/${day}/${year}`;
}

function normalizeMapping(mapping: MappingRowRaw): MappingRow {
  const parsed = parseMetadata(mapping.metadata);
  return {
    ...mapping,
    metadata: parsed ?? null
  };
}

function parseMetadata(input: unknown): Record<string, unknown> | undefined {
  if (!input) return undefined;
  if (typeof input === 'string') {
    try {
      return JSON.parse(input);
    } catch {
      return undefined;
    }
  }
  if (typeof input === 'object') {
    return input as Record<string, unknown>;
  }
  return undefined;
}

function groupBy<T>(items: T[], iteratee: (item: T) => string): Map<string, T[]> {
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
