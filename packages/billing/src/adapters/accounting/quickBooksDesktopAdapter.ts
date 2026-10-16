/**
 * QuickBooks Desktop (IIF) Export Adapter
 *
 * Generates an IIF file of INVOICE transactions for File → Utilities → Import →
 * IIF Files in QuickBooks Desktop. Each Alga invoice becomes one transaction:
 * a TRNS row debiting Accounts Receivable for the invoice total, one SPL row per
 * charge crediting its income account with the mapped item, quantity and rate,
 * an optional SPL row for Alga's sales tax, and ENDTRNS.
 *
 * Names are resolved through the QuickBooks CSV mappings (shared, as xero_csv
 * shares the xero mappings) plus the QuickBooks Desktop settings for the
 * account names IIF needs. QuickBooks creates any list entry an IIF file names
 * that it does not already know, so every name must resolve to a configured
 * value; nothing falls back to an Alga identifier.
 */

import logger from '@alga-psa/core/logger';
import { AppError, minorUnitsToPlainDecimalText } from '@alga-psa/core';
import { Knex } from 'knex';
import { expandAccountingExportCharges } from '../../services/accountingExportChargeExpansion';
import {
  AccountingExportAdapter,
  AccountingExportAdapterCapabilities,
  AccountingExportAdapterContext,
  AccountingExportDeliveryResult,
  AccountingExportDocument,
  AccountingExportFileAttachment,
  AccountingExportTransformResult,
  AUTOMATIC_DISCOUNT_MAPPING_ID,
  DISCOUNT_MAPPING_ENTITY_TYPE
} from '@alga-psa/types';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { lockInvoiceForExternalSync } from '../../lib/invoiceExternalSyncLock';
import { AccountingMappingResolver } from '../../services/accountingMappingResolver';
import { KnexInvoiceMappingRepository } from '../../repositories/invoiceMappingRepository';
import { reconcileExportLineQuantity } from './exportLineQuantity';
import { getQuickBooksItemName } from './quickBooksItemName';
import { buildQuickBooksCsvMemo } from './quickBooksCSVAdapter';
import { resolveMappingAdapterType } from './mappingAdapterType';

/** Mappings are maintained on the QuickBooks CSV setup and shared with Desktop. */
const MAPPING_ADAPTER_TYPE = resolveMappingAdapterType('quickbooks_desktop');
const IIF_MAX_QUANTITY_DECIMALS = 5;
// QuickBooks Desktop list-name limits, per ':'-separated segment.
const MAX_CUSTOMER_NAME_LENGTH = 41;
const MAX_ITEM_NAME_LENGTH = 31;
const MAX_ACCOUNT_NAME_LENGTH = 31;
const IIF_LINE_ENDING = '\r\n';
// QuickBooks Online tax codes a shared quickbooks_csv tax mapping may hold; never a Desktop item name.
const QBO_PSEUDO_TAX_CODES = new Set(['TAX', 'NON']);

const TRNS_FIELDS = [
  'TRNSID', 'TRNSTYPE', 'DATE', 'ACCNT', 'NAME', 'AMOUNT', 'DOCNUM', 'MEMO', 'TOPRINT', 'DUEDATE', 'TERMS', 'PONUM'
] as const;
const SPL_FIELDS = [
  'SPLID', 'TRNSTYPE', 'DATE', 'ACCNT', 'NAME', 'AMOUNT', 'DOCNUM', 'MEMO', 'QNTY', 'PRICE', 'INVITEM', 'TAXABLE', 'EXTRA'
] as const;

type TrnsRow = Record<(typeof TRNS_FIELDS)[number], string>;
type SplRow = Record<(typeof SPL_FIELDS)[number], string>;

// List records that create a customer or item in QuickBooks before the
// transactions that reference it. Emitted only for mappings the export prompt
// created (metadata.qbdCreateInBatch), until a batch that included them is
// delivered (metadata.qbdListRecordBatch); re-exporting that same batch keeps
// them. Never emitted for names that may already exist in the company file.
const CUST_FIELDS = [
  'NAME', 'BADDR1', 'BADDR2', 'BADDR3', 'BADDR4', 'BADDR5', 'PHONE1', 'EMAIL', 'TERMS'
] as const;
const INVITEM_FIELDS = [
  'NAME', 'INVITEMTYPE', 'DESC', 'ACCNT', 'ASSETACCNT', 'COGSACCNT', 'PRICE', 'COST', 'TAXABLE'
] as const;

type CustRow = Record<(typeof CUST_FIELDS)[number], string>;
type InvItemRow = Record<(typeof INVITEM_FIELDS)[number], string>;

export type QuickBooksDesktopProductItemType = 'NONINVENTORY' | 'INVENTORY';

export interface QuickBooksDesktopAdapterSettings {
  arAccount: string;
  defaultIncomeAccount: string;
  salesTaxPayableAccount: string;
  defaultSalesTaxItem: string;
  newProductItemType: QuickBooksDesktopProductItemType;
  inventoryAssetAccount: string;
  cogsAccount: string;
}

interface IifListRecords {
  customers: Record<string, string>;
  items: Record<string, string>;
}

interface ListRecordEntity {
  algaEntityType: string;
  algaEntityId: string;
}

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
  quantity?: number | string | null;
  unit_price?: number | null;
  total_price: number;
  net_amount?: number | null;
  tax_amount?: number | null;
  is_taxable?: boolean | null;
  is_discount?: boolean | null;
  is_manual?: boolean | null;
  tax_region?: string | null;
  adjustment_source_kind?: string | null;
};

type DbClient = {
  client_id: string;
  client_name: string;
  payment_terms?: string | null;
  billing_email?: string | null;
};

type DbClientLocation = {
  client_id?: string;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state_province?: string | null;
  postal_code?: string | null;
  country_name?: string | null;
  phone?: string | null;
  email?: string | null;
  is_billing_address?: boolean | null;
  is_default?: boolean | null;
};

type DbService = {
  service_id: string;
  service_name: string;
  description?: string | null;
  default_rate?: number | null;
  item_kind?: string | null;
};

function uniqueRows(names: string[], rowsByName: Record<string, string>): string[] {
  return Array.from(new Set(names)).map((name) => rowsByName[name]).filter((row): row is string => Boolean(row));
}

interface InvoiceDocumentPayload {
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  currency: string;
  /** IIF rows for this invoice: TRNS, SPL…, ENDTRNS. */
  iifRows: string[];
  /** Customer and item names whose list records this invoice depends on. */
  listRecordNames?: { customers: string[]; items: string[] };
  /** Mappings behind those list records, stamped as delivered when this invoice is. */
  listRecordEntities?: ListRecordEntity[];
  totals: {
    amountCents: number;
    taxCents: number;
  };
}

export function sanitizeIifField(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  // Tabs and line breaks are the IIF field and record separators; a double
  // quote opens a quoted field in QuickBooks' parser.
  return String(value).replace(/[\t\r\n]+/g, ' ').replace(/"/g, "'").trim();
}

/** MM/DD/YYYY without shifting a date-only value across timezones. */
export function formatIifDate(value?: string | Date | null): string {
  if (!value) return '';
  if (typeof value === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (match) {
      return `${match[2]}/${match[3]}/${match[1]}`;
    }
  }
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  // pg parses DATE columns to local midnight, so local components are the stored day.
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}/${day}/${date.getFullYear()}`;
}

function formatIifQuantity(quantity: number): string {
  const rounded = Number(quantity.toFixed(IIF_MAX_QUANTITY_DECIMALS));
  if (rounded === 0) {
    return '0';
  }
  return String(rounded);
}

function toCents(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function serializeRow<F extends readonly string[]>(tag: string, fields: F, row: Record<F[number], string>): string {
  return [tag, ...fields.map((field) => sanitizeIifField(row[field as F[number]]))].join('\t');
}

export class QuickBooksDesktopAdapter implements AccountingExportAdapter {
  static readonly TYPE = 'quickbooks_desktop';

  static async create(): Promise<QuickBooksDesktopAdapter> {
    return new QuickBooksDesktopAdapter();
  }

  readonly type = QuickBooksDesktopAdapter.TYPE;

  capabilities(): AccountingExportAdapterCapabilities {
    return {
      deliveryMode: 'file',
      supportedExportTypes: ['invoice'],
      supportsPartialRetry: false,
      supportsInvoiceUpdates: false,
      // IIF has no channel to return QuickBooks-calculated tax to Alga.
      supportsTaxDelegation: false,
      supportsInvoiceFetch: false,
      supportsTaxComponentImport: false
    };
  }

  async transform(context: AccountingExportAdapterContext): Promise<AccountingExportTransformResult> {
    const tenantId = context.batch.tenant;
    if (!tenantId) {
      throw new AppError('QBD_TENANT_REQUIRED', 'QuickBooks Desktop export requires batch tenant identifier');
    }

    const settings = this.readSettings(context.adapterSettings);
    const { knex } = await createTenantKnex();
    const resolver = await AccountingMappingResolver.create();

    const invoicesById = await this.loadInvoices(knex, tenantId, context);
    const loadedCharges = await this.loadCharges(knex, tenantId, context);
    // Split canonical fixed-plan parents into their per-service allocations and
    // project contract-change descriptions, as the QuickBooks/Xero CSV adapters do.
    const expanded = await expandAccountingExportCharges(knex, tenantId, loadedCharges, context.lines);
    const chargesById = expanded.charges;
    context = { ...context, lines: expanded.lines };
    const clientsById = await this.loadClients(knex, tenantId, invoicesById, context);

    const linesByInvoice = new Map<string, typeof context.lines>();
    for (const line of context.lines) {
      const list = linesByInvoice.get(line.document_id) ?? [];
      list.push(line);
      linesByInvoice.set(line.document_id, list);
    }

    const documents: AccountingExportDocument[] = [];
    const listRecords: IifListRecords = { customers: {}, items: {} };

    for (const [invoiceId, exportLines] of linesByInvoice.entries()) {
      const invoice = invoicesById.get(invoiceId);
      if (!invoice) {
        throw new AppError('QBD_INVOICE_NOT_FOUND', `QuickBooks Desktop export: invoice ${invoiceId} not found`);
      }

      const invoiceNumber = invoice.invoice_number ?? invoiceId;
      const clientId = invoice.client_id ?? exportLines.find((line) => line.client_id)?.client_id;
      if (!clientId) {
        throw new AppError('QBD_CLIENT_MISSING', `QuickBooks Desktop export: invoice ${invoiceNumber} is missing a client`);
      }
      const client = clientsById.get(clientId);
      if (!client) {
        throw new AppError('QBD_CLIENT_NOT_FOUND', `QuickBooks Desktop export: client ${clientId} not found for invoice ${invoiceNumber}`);
      }

      const customerMapping = await resolver.resolveClientMapping({
        tenantId,
        adapterType: MAPPING_ADAPTER_TYPE,
        clientId,
        targetRealm: context.batch.target_realm
      });
      const customerName = sanitizeIifField(nonEmptyString(customerMapping?.external_entity_id) ?? client.client_name);
      this.assertListName(customerName, MAX_CUSTOMER_NAME_LENGTH, 'customer', invoiceNumber,
        'Add a Clients mapping with the exact QuickBooks Desktop customer name.');

      const termMapping = client.payment_terms
        ? await resolver.resolvePaymentTermMapping({
            tenantId,
            adapterType: MAPPING_ADAPTER_TYPE,
            paymentTermId: client.payment_terms,
            targetRealm: context.batch.target_realm
          })
        : null;
      // Unmapped terms stay blank: an Alga term id would be created as a new QuickBooks term.
      const terms = nonEmptyString(termMapping?.external_entity_id) ?? '';

      const invoiceListNames = { customers: [] as string[], items: [] as string[] };
      const invoiceListEntities: ListRecordEntity[] = [];
      if (customerMapping?.source === 'company' && this.needsListRecord(customerMapping.metadata, context)) {
        if (!listRecords.customers[customerName]) {
          const contact = await this.loadClientContact(knex, tenantId, clientId);
          listRecords.customers[customerName] = serializeRow('CUST', CUST_FIELDS, {
            NAME: customerName,
            BADDR1: client.client_name,
            BADDR2: contact?.address_line1 ?? '',
            BADDR3: contact?.address_line2 ?? '',
            BADDR4: [contact?.city, contact?.state_province, contact?.postal_code].filter(Boolean).join(' '),
            BADDR5: contact?.country_name ?? '',
            PHONE1: contact?.phone ?? '',
            EMAIL: contact?.email ?? client.billing_email ?? '',
            TERMS: terms
          });
        }
        invoiceListNames.customers.push(customerName);
        invoiceListEntities.push({ algaEntityType: 'client', algaEntityId: clientId });
      }

      const currency = invoice.currency_code ?? exportLines.find((line) => line.currency_code)?.currency_code ?? 'USD';
      const excludeTax = invoice.tax_source === 'external' || invoice.tax_source === 'pending_external';
      const date = formatIifDate(invoice.invoice_date);
      if (!date) {
        throw new AppError('QBD_INVOICE_DATE_INVALID', `QuickBooks Desktop export: invoice ${invoiceNumber} has no valid invoice date`);
      }
      const dueDate = formatIifDate(invoice.due_date) || date;

      const splRows: SplRow[] = [];
      let amountCents = 0;
      let taxCents = 0;
      const taxItems = new Set<string>();

      for (const line of exportLines) {
        if (!line.document_line_id) {
          throw new AppError('QBD_LINE_MISSING_CHARGE', `QuickBooks Desktop export: line ${line.line_id} is missing its invoice charge`);
        }
        const charge = chargesById.get(line.document_line_id);
        if (!charge) {
          throw new AppError('QBD_CHARGE_NOT_FOUND', `QuickBooks Desktop export: charge ${line.document_line_id} not found`);
        }

        const isServicelessDiscount = !charge.service_id && Boolean(charge.is_discount);
        if (!charge.service_id && !isServicelessDiscount) {
          throw new AppError('QBD_CHARGE_MISSING_SERVICE', `QuickBooks Desktop export: charge ${charge.item_id} on invoice ${invoiceNumber} has no service`);
        }

        const itemMapping = isServicelessDiscount
          ? await resolver.resolveDiscountMapping({
              tenantId,
              adapterType: MAPPING_ADAPTER_TYPE,
              targetRealm: context.batch.target_realm
            })
          : await resolver.resolveServiceMapping({
              tenantId,
              adapterType: MAPPING_ADAPTER_TYPE,
              serviceId: charge.service_id!,
              targetRealm: context.batch.target_realm
            });

        if (!itemMapping) {
          throw new AppError(
            'QBD_MAPPING_MISSING',
            isServicelessDiscount
              ? 'QuickBooks Desktop export: no mapping for discount lines. Configure the Discounts mapping before export.'
              : `QuickBooks Desktop export: no item mapping for service ${charge.service_id}. Configure the Items / Services mapping before export.`,
            { serviceId: charge.service_id ?? null, invoiceId }
          );
        }

        const itemName = sanitizeIifField(getQuickBooksItemName(itemMapping));
        this.assertListName(itemName, MAX_ITEM_NAME_LENGTH, 'item', invoiceNumber,
          'Map the service to the exact QuickBooks Desktop item name.');

        const incomeAccount = sanitizeIifField(
          nonEmptyString(itemMapping.metadata?.qbdIncomeAccount) ?? settings.defaultIncomeAccount
        );
        if (!incomeAccount) {
          throw new AppError(
            'QBD_INCOME_ACCOUNT_MISSING',
            `QuickBooks Desktop export: no income account for item "${itemName}". Set the default income account in the QuickBooks Desktop settings or "qbdIncomeAccount" on the mapping.`
          );
        }
        this.assertListName(incomeAccount, MAX_ACCOUNT_NAME_LENGTH, 'account', invoiceNumber,
          'Use the exact QuickBooks Desktop income account name.');

        // Only a direct service or discount mapping can come from the prompt; a
        // service resolved through its category mapping is never redefined.
        const itemFromPrompt =
          (itemMapping.source === 'service' || itemMapping.source === 'discount') &&
          this.needsListRecord(itemMapping.metadata, context);
        if (itemFromPrompt) {
          if (!listRecords.items[itemName]) {
            listRecords.items[itemName] = await this.buildItemRecord(
              knex, tenantId, itemName, incomeAccount, isServicelessDiscount ? null : charge.service_id!, charge, settings, invoiceNumber, currency
            );
          }
          invoiceListEntities.push(
            isServicelessDiscount
              ? { algaEntityType: DISCOUNT_MAPPING_ENTITY_TYPE, algaEntityId: AUTOMATIC_DISCOUNT_MAPPING_ID }
              : { algaEntityType: 'service', algaEntityId: charge.service_id! }
          );
          invoiceListNames.items.push(itemName);
        }

        const lineAmount = toCents(charge.net_amount ?? charge.total_price);
        const { quantity, unitPriceCents } = reconcileExportLineQuantity({
          quantity: charge.quantity,
          unitPriceCents: charge.unit_price ?? null,
          amountCents: lineAmount,
          maxQuantityDecimals: IIF_MAX_QUANTITY_DECIMALS
        });
        const lineTax = excludeTax ? 0 : toCents(charge.tax_amount);
        const taxable = Boolean(charge.is_taxable) || toCents(charge.tax_amount) > 0;

        if (lineTax !== 0) {
          taxItems.add(await this.resolveSalesTaxItem(resolver, tenantId, context, charge, settings, invoiceNumber));
        }

        amountCents += lineAmount;
        taxCents += lineTax;

        // Income splits are credits: negative amount and quantity, positive rate.
        splRows.push({
          SPLID: '',
          TRNSTYPE: 'INVOICE',
          DATE: date,
          ACCNT: incomeAccount,
          NAME: '',
          AMOUNT: minorUnitsToPlainDecimalText(-lineAmount, 'en-US', currency),
          DOCNUM: invoiceNumber,
          MEMO: line.notes ?? charge.description ?? '',
          QNTY: formatIifQuantity(-quantity),
          PRICE: minorUnitsToPlainDecimalText(unitPriceCents, 'en-US', currency),
          INVITEM: itemName,
          TAXABLE: taxable ? 'Y' : 'N',
          EXTRA: ''
        });
      }

      if (splRows.length === 0) {
        logger.warn('[QuickBooksDesktopAdapter] Skipping invoice with no lines', { invoiceId, tenant: tenantId });
        continue;
      }

      if (taxCents !== 0) {
        if (taxItems.size > 1) {
          throw new AppError(
            'QBD_MIXED_SALES_TAX_ITEMS',
            `QuickBooks Desktop export: invoice ${invoiceNumber} has tax regions mapped to different sales tax items (${Array.from(taxItems).join(', ')}). QuickBooks Desktop allows one sales tax item or group per invoice.`
          );
        }
        const [taxItem] = Array.from(taxItems);
        this.assertListName(settings.salesTaxPayableAccount, MAX_ACCOUNT_NAME_LENGTH, 'account', invoiceNumber,
          'Use the exact QuickBooks Desktop sales tax liability account name.');
        splRows.push({
          SPLID: '',
          TRNSTYPE: 'INVOICE',
          DATE: date,
          ACCNT: settings.salesTaxPayableAccount,
          NAME: '',
          AMOUNT: minorUnitsToPlainDecimalText(-taxCents, 'en-US', currency),
          DOCNUM: invoiceNumber,
          MEMO: 'Sales tax',
          QNTY: '',
          PRICE: '',
          INVITEM: taxItem,
          TAXABLE: 'N',
          EXTRA: 'AUTOSTAX'
        });
      }

      const totalCents = amountCents + taxCents;
      if (toCents(invoice.total_amount) !== totalCents) {
        logger.warn('[QuickBooksDesktopAdapter] Exported lines do not sum to the invoice total', {
          invoiceId,
          invoiceTotal: invoice.total_amount,
          exportedTotal: totalCents,
          taxExcluded: excludeTax
        });
      }

      this.assertListName(settings.arAccount, MAX_ACCOUNT_NAME_LENGTH, 'account', invoiceNumber,
        'Use the exact QuickBooks Desktop accounts receivable account name.');
      const trnsRow: TrnsRow = {
        TRNSID: '',
        TRNSTYPE: 'INVOICE',
        DATE: date,
        ACCNT: settings.arAccount,
        NAME: customerName,
        AMOUNT: minorUnitsToPlainDecimalText(totalCents, 'en-US', currency),
        DOCNUM: invoiceNumber,
        MEMO: buildQuickBooksCsvMemo(invoiceId, invoice.po_number),
        TOPRINT: 'N',
        DUEDATE: dueDate,
        TERMS: terms,
        PONUM: invoice.po_number ?? ''
      };

      const iifRows = [
        serializeRow('TRNS', TRNS_FIELDS, trnsRow),
        ...splRows.map((row) => serializeRow('SPL', SPL_FIELDS, row)),
        'ENDTRNS'
      ];

      const payload: InvoiceDocumentPayload = {
        invoiceId,
        invoiceNumber,
        customerName,
        currency,
        iifRows,
        listRecordNames: invoiceListNames,
        listRecordEntities: invoiceListEntities,
        totals: { amountCents: totalCents, taxCents }
      };

      documents.push({
        documentId: invoiceId,
        lineIds: [...new Set(exportLines.map((line) => line.line_id))],
        payload: payload as unknown as Record<string, unknown>
      });
    }

    const file = documents.length > 0 ? this.buildFile(context, documents, listRecords) : null;

    logger.info('[QuickBooksDesktopAdapter] Transform completed', {
      tenant: tenantId,
      batchId: context.batch.batch_id,
      invoices: documents.length,
      newCustomers: Object.keys(listRecords.customers).length,
      newItems: Object.keys(listRecords.items).length
    });

    return {
      documents,
      files: file ? [file] : [],
      metadata: {
        adapter: this.type,
        invoices: documents.length,
        lines: context.lines.length,
        fileSize: file?.content.length ?? 0,
        listRecords
      }
    };
  }

  async deliver(
    transformResult: AccountingExportTransformResult,
    context: AccountingExportAdapterContext
  ): Promise<AccountingExportDeliveryResult> {
    const tenantId = context.batch.tenant;
    if (!tenantId) {
      throw new AppError('QBD_TENANT_REQUIRED', 'QuickBooks Desktop export requires batch tenant identifier for delivery');
    }

    const { knex } = await createTenantKnex();
    const deliveredAt = new Date().toISOString();
    const filename = this.buildFilename(context);

    const deliveredLines: { lineId: string; externalDocumentRef?: string | null }[] = [];
    const deliveredDocuments: AccountingExportDocument[] = [];
    const failedDocuments: Array<{ documentId: string; lineIds: string[]; code: string; message: string }> = [];

    // Same ordering as the CSV adapter: the mapping insert takes the invoice row
    // lock the void path holds, so a concurrently voided invoice is refused here
    // and left out of the file.
    for (const document of transformResult.documents) {
      const payload = document.payload as unknown as InvoiceDocumentPayload;
      const externalRef = `iif:${payload.invoiceNumber}`;
      try {
        await withTransaction(knex, async (trx) => {
          await lockInvoiceForExternalSync(trx, tenantId, document.documentId);
          await new KnexInvoiceMappingRepository(trx).upsertInvoiceMapping({
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
          if (payload.listRecordEntities?.length) {
            await this.markListRecordsDelivered(trx, tenantId, context, payload.listRecordEntities);
          }
        });

        deliveredDocuments.push(document);
        for (const lineId of document.lineIds) {
          deliveredLines.push({ lineId, externalDocumentRef: externalRef });
        }
      } catch (error) {
        const code = error instanceof AppError ? error.code : 'QBD_DELIVERY_ERROR';
        const message = error instanceof Error ? error.message : 'Unknown QuickBooks Desktop delivery error';
        logger.warn('[QuickBooksDesktopAdapter] Skipping invoice delivery failure', {
          invoiceId: document.documentId,
          code,
          error: message
        });
        failedDocuments.push({ documentId: document.documentId, lineIds: document.lineIds, code, message });
      }
    }

    const listRecords = (transformResult.metadata?.listRecords as IifListRecords | undefined) ?? { customers: {}, items: {} };
    const files: AccountingExportFileAttachment[] =
      deliveredDocuments.length > 0 ? [this.buildFile(context, deliveredDocuments, listRecords)] : [];

    logger.info('[QuickBooksDesktopAdapter] Delivery completed', {
      tenant: tenantId,
      batchId: context.batch.batch_id,
      filename,
      delivered: deliveredDocuments.length,
      failed: failedDocuments.length
    });

    return {
      deliveredLines,
      failedDocuments: failedDocuments.length > 0 ? failedDocuments : undefined,
      artifacts: {
        filename,
        invoiceCount: deliveredDocuments.length,
        fileSize: files[0]?.content.length ?? 0
      },
      metadata: {
        adapter: this.type,
        deliveredInvoices: deliveredDocuments.length,
        files
      }
    };
  }

  private readSettings(raw: Record<string, unknown> | undefined): QuickBooksDesktopAdapterSettings {
    const text = (key: keyof QuickBooksDesktopAdapterSettings) => sanitizeIifField(nonEmptyString(raw?.[key]) ?? '');
    return {
      arAccount: text('arAccount') || 'Accounts Receivable',
      defaultIncomeAccount: text('defaultIncomeAccount'),
      salesTaxPayableAccount: text('salesTaxPayableAccount') || 'Sales Tax Payable',
      defaultSalesTaxItem: text('defaultSalesTaxItem'),
      newProductItemType: text('newProductItemType') === 'INVENTORY' ? 'INVENTORY' : 'NONINVENTORY',
      inventoryAssetAccount: text('inventoryAssetAccount') || 'Inventory Asset',
      cogsAccount: text('cogsAccount') || 'Cost of Goods Sold'
    };
  }

  /**
   * A prompt-created mapping still needs its CUST/INVITEM record until a batch
   * that included it is delivered; that batch keeps emitting it, so its file
   * regenerates identically.
   */
  private needsListRecord(metadata: Record<string, unknown> | null | undefined, context: AccountingExportAdapterContext): boolean {
    if (!metadata || !metadata.qbdCreateInBatch) return false;
    const deliveredIn = metadata.qbdListRecordBatch;
    return deliveredIn === undefined || deliveredIn === null || deliveredIn === context.batch.batch_id;
  }

  /**
   * Called inside the invoice's delivery transaction: marks the prompt-created
   * mappings whose list records this delivered file defines, so later batches
   * stop redefining them. Mappings already stamped keep their first batch.
   */
  private async markListRecordsDelivered(
    trx: Knex.Transaction,
    tenantId: string,
    context: AccountingExportAdapterContext,
    entities: ListRecordEntity[]
  ): Promise<void> {
    for (const entity of entities) {
      await tenantDb(trx, tenantId).table('tenant_external_entity_mappings')
        .where({
          integration_type: MAPPING_ADAPTER_TYPE,
          alga_entity_type: entity.algaEntityType,
          alga_entity_id: entity.algaEntityId
        })
        .modify((query: Knex.QueryBuilder) => {
          if (context.batch.target_realm) {
            query.where('external_realm_id', context.batch.target_realm);
          } else {
            query.whereNull('external_realm_id');
          }
        })
        .whereNull('deleted_at')
        .whereRaw("metadata ->> 'qbdCreateInBatch' IS NOT NULL")
        .whereRaw("metadata ->> 'qbdListRecordBatch' IS NULL")
        .update({
          metadata: trx.raw("jsonb_set(COALESCE(metadata, '{}'::jsonb), '{qbdListRecordBatch}', to_jsonb(?::text))", [
            context.batch.batch_id
          ]),
          updated_at: trx.fn.now()
        });
    }
  }

  private async buildItemRecord(
    knex: Knex,
    tenantId: string,
    itemName: string,
    incomeAccount: string,
    serviceId: string | null,
    charge: DbCharge,
    settings: QuickBooksDesktopAdapterSettings,
    invoiceNumber: string,
    currency: string
  ): Promise<string> {
    if (!serviceId) {
      return serializeRow('INVITEM', INVITEM_FIELDS, {
        NAME: itemName,
        INVITEMTYPE: 'DISC',
        DESC: charge.description ?? '',
        ACCNT: incomeAccount,
        ASSETACCNT: '',
        COGSACCNT: '',
        PRICE: '',
        COST: '',
        TAXABLE: 'N'
      });
    }

    const service = await tenantDb(knex, tenantId).table<DbService>('service_catalog')
      .select('service_id', 'service_name', 'description', 'default_rate', 'item_kind')
      .where({ service_id: serviceId })
      .first();
    const isProduct = service?.item_kind === 'product';
    const asInventory = isProduct && settings.newProductItemType === 'INVENTORY';
    let averageCost: number | null = null;
    if (asInventory) {
      this.assertListName(settings.inventoryAssetAccount, MAX_ACCOUNT_NAME_LENGTH, 'account', invoiceNumber,
        'Set the inventory asset account in the QuickBooks Desktop settings.');
      this.assertListName(settings.cogsAccount, MAX_ACCOUNT_NAME_LENGTH, 'account', invoiceNumber,
        'Set the cost of goods sold account in the QuickBooks Desktop settings.');
      const inventory = await tenantDb(knex, tenantId).table<{ service_id: string; average_cost?: number | null }>('product_inventory_settings')
        .select('average_cost')
        .where({ service_id: serviceId })
        .first();
      averageCost = inventory?.average_cost ?? null;
    }

    // Catalog rates and costs are stored in minor units; IIF list prices are plain decimals.
    const toDecimal = (cents: number | null | undefined) =>
      cents === null || cents === undefined ? '' : minorUnitsToPlainDecimalText(toCents(cents), 'en-US', currency);

    return serializeRow('INVITEM', INVITEM_FIELDS, {
      NAME: itemName,
      INVITEMTYPE: !isProduct ? 'SERV' : asInventory ? 'INVENTORY' : 'PART',
      DESC: service?.description ?? service?.service_name ?? charge.description ?? '',
      ACCNT: incomeAccount,
      ASSETACCNT: asInventory ? settings.inventoryAssetAccount : '',
      COGSACCNT: asInventory ? settings.cogsAccount : '',
      PRICE: toDecimal(charge.unit_price ?? service?.default_rate),
      COST: asInventory ? toDecimal(averageCost) : '',
      TAXABLE: charge.is_taxable ? 'Y' : 'N'
    });
  }

  private async loadClientContact(knex: Knex, tenantId: string, clientId: string): Promise<DbClientLocation | null> {
    const locations = await tenantDb(knex, tenantId).table<DbClientLocation>('client_locations')
      .select('address_line1', 'address_line2', 'city', 'state_province', 'postal_code', 'country_name', 'phone', 'email', 'is_billing_address', 'is_default')
      .where({ client_id: clientId });
    const list = Array.isArray(locations) ? locations : [];
    return list.find((row) => row.is_billing_address) ?? list.find((row) => row.is_default) ?? list[0] ?? null;
  }

  private async resolveSalesTaxItem(
    resolver: AccountingMappingResolver,
    tenantId: string,
    context: AccountingExportAdapterContext,
    charge: DbCharge,
    settings: QuickBooksDesktopAdapterSettings,
    invoiceNumber: string
  ): Promise<string> {
    const taxMapping = charge.tax_region
      ? await resolver.resolveTaxCodeMapping({
          tenantId,
          adapterType: MAPPING_ADAPTER_TYPE,
          taxRegionId: charge.tax_region,
          targetRealm: context.batch.target_realm
        })
      : null;
    // Desktop has no per-line tax code in IIF, only one sales tax *item* per
    // invoice. A region's item is metadata.qbdSalesTaxItem, else the mapping's
    // own value (what a Desktop-only tenant types in the Tax Code field), unless
    // that value is a QuickBooks Online pseudo code (TAX/NON) kept for CSV use.
    const mappedValue = nonEmptyString(taxMapping?.external_entity_id);
    const mappedItem =
      mappedValue && !QBO_PSEUDO_TAX_CODES.has(mappedValue.toUpperCase()) ? mappedValue : null;
    const item = sanitizeIifField(
      nonEmptyString(taxMapping?.metadata?.qbdSalesTaxItem) ?? mappedItem ?? settings.defaultSalesTaxItem
    );
    if (!item) {
      throw new AppError(
        'QBD_SALES_TAX_ITEM_MISSING',
        `QuickBooks Desktop export: invoice ${invoiceNumber} has sales tax${charge.tax_region ? ` for region ${charge.tax_region}` : ''} but no sales tax item. Set the default sales tax item in the QuickBooks Desktop settings, or map the region on the Tax Codes tab to the QuickBooks Desktop sales tax item name.`
      );
    }
    this.assertListName(item, MAX_ITEM_NAME_LENGTH, 'item', invoiceNumber,
      'Use the exact QuickBooks Desktop sales tax item or group name.');
    return item;
  }

  private assertListName(name: string, maxLength: number, kind: string, invoiceNumber: string, hint: string): void {
    if (!name) {
      throw new AppError('QBD_NAME_MISSING', `QuickBooks Desktop export: invoice ${invoiceNumber} has an empty ${kind} name. ${hint}`);
    }
    const tooLong = name.split(':').find((segment) => segment.length > maxLength);
    if (tooLong !== undefined) {
      throw new AppError(
        'QBD_NAME_TOO_LONG',
        `QuickBooks Desktop export: ${kind} name "${name}" on invoice ${invoiceNumber} exceeds the ${maxLength}-character QuickBooks Desktop limit. ${hint}`
      );
    }
  }

  private buildFilename(context: AccountingExportAdapterContext): string {
    return `quickbooks-desktop-invoices-${context.batch.batch_id}.iif`;
  }

  private buildFile(
    context: AccountingExportAdapterContext,
    documents: AccountingExportDocument[],
    listRecords: IifListRecords
  ): AccountingExportFileAttachment {
    const payloads = documents.map((document) => document.payload as unknown as InvoiceDocumentPayload);
    // Only list records the included invoices reference, so a delivery that
    // drops an invoice does not create its customer or items either.
    const customerRows = uniqueRows(payloads.flatMap((p) => p.listRecordNames?.customers ?? []), listRecords.customers);
    const itemRows = uniqueRows(payloads.flatMap((p) => p.listRecordNames?.items ?? []), listRecords.items);

    const rows = [
      ...(customerRows.length > 0 ? [`!CUST\t${CUST_FIELDS.join('\t')}`, ...customerRows] : []),
      ...(itemRows.length > 0 ? [`!INVITEM\t${INVITEM_FIELDS.join('\t')}`, ...itemRows] : []),
      `!TRNS\t${TRNS_FIELDS.join('\t')}`,
      `!SPL\t${SPL_FIELDS.join('\t')}`,
      '!ENDTRNS',
      ...payloads.flatMap((payload) => payload.iifRows)
    ];
    return {
      filename: this.buildFilename(context),
      contentType: 'text/plain',
      content: rows.join(IIF_LINE_ENDING) + IIF_LINE_ENDING
    };
  }

  private async loadInvoices(
    knex: Knex,
    tenantId: string,
    context: AccountingExportAdapterContext
  ): Promise<Map<string, DbInvoice>> {
    const invoiceIds = Array.from(new Set(context.lines.map((line) => line.document_id)));
    if (invoiceIds.length === 0) {
      return new Map();
    }

    const rows = await tenantDb(knex, tenantId).table<DbInvoice>('invoices')
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
      .whereIn('invoice_id', invoiceIds);

    return new Map(rows.map((row) => [row.invoice_id, row]));
  }

  private async loadCharges(
    knex: Knex,
    tenantId: string,
    context: AccountingExportAdapterContext
  ): Promise<Map<string, DbCharge>> {
    const chargeIds = context.lines
      .map((line) => line.document_line_id)
      .filter((id): id is string => Boolean(id));
    if (chargeIds.length === 0) {
      return new Map();
    }

    const rows = await tenantDb(knex, tenantId).table<DbCharge>('invoice_charges')
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
        'is_manual',
        'tax_region',
        'adjustment_source_kind'
      )
      .whereIn('item_id', chargeIds);

    return new Map(rows.map((row) => [row.item_id, row]));
  }

  private async loadClients(
    knex: Knex,
    tenantId: string,
    invoices: Map<string, DbInvoice>,
    context: AccountingExportAdapterContext
  ): Promise<Map<string, DbClient>> {
    const candidates = [
      ...Array.from(invoices.values()).map((invoice) => invoice.client_id),
      ...context.lines.map((line) => line.client_id)
    ];
    const clientIds = Array.from(new Set(candidates.filter((id): id is string => Boolean(id))));
    if (clientIds.length === 0) {
      return new Map();
    }

    const rows = await tenantDb(knex, tenantId).table<DbClient>('clients')
      .select('client_id', 'client_name', 'payment_terms', 'billing_email')
      .whereIn('client_id', clientIds);

    return new Map(rows.map((row) => [row.client_id, row]));
  }
}
