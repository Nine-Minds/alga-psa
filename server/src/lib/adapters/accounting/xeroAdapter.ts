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
import {
  XeroClientService,
  XeroInvoicePayload,
  XeroInvoiceLinePayload,
  XeroTrackingCategoryOption,
  XeroTaxComponentPayload
} from '../../xero/xeroClientService';
import { createTenantKnex } from '../../db';
import { AccountingMappingResolver } from '../../services/accountingMappingResolver';
import { AppError } from '../../errors';

type DbInvoice = {
  invoice_id: string;
  invoice_number?: string | null;
  invoice_date?: string | Date | null;
  due_date?: string | Date | null;
  client_id?: string | null;
  company_id?: string | null;
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
  metadata: Record<string, any> | null;
};

interface XeroDocumentPayload {
  tenantId: string;
  connectionId?: string | null;
  invoice: XeroInvoicePayload;
  mapping: {
    clientId: string;
    source?: string;
  };
}

type LineAmountType = 'Exclusive' | 'Inclusive' | 'NoTax';

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
    const tenantId = context.batch.tenant;
    if (!tenantId) {
      throw new AppError('XERO_TENANT_REQUIRED', 'Xero export requires batch tenant identifier');
    }

    const { knex } = await createTenantKnex();
    const resolver = await AccountingMappingResolver.create();

    const invoicesById = await this.loadInvoices(knex, tenantId, context);
    const chargesById = await this.loadCharges(knex, tenantId, context);
    const clientData = await this.loadClients(knex, tenantId, context, invoicesById);

    const linesByInvoice = groupBy(context.lines, (line) => line.invoice_id);
    const documents: AccountingExportDocument[] = [];

    for (const [invoiceId, exportLines] of linesByInvoice.entries()) {
      const invoice = invoicesById.get(invoiceId);
      if (!invoice) {
        throw new AppError('XERO_INVOICE_NOT_FOUND', `Invoice ${invoiceId} not found for tenant ${tenantId}`);
      }

      const clientId =
        invoice.client_id ??
        invoice.company_id ??
        exportLines.find((line) => line.client_id)?.client_id ??
        null;

      if (!clientId) {
        throw new AppError('XERO_CLIENT_MISSING', `Invoice ${invoiceId} is missing client mapping data`);
      }

      const clientMapping = clientData.mappings.get(clientId);
      if (!clientMapping) {
        throw new AppError('XERO_CLIENT_MAPPING_MISSING', `No Xero contact mapping for client ${clientId}`);
      }

      const lineItems: XeroInvoiceLinePayload[] = [];
      let invoiceTotal = 0;
      let detectedLineAmountType: LineAmountType | undefined;

      for (const line of exportLines) {
        if (!line.invoice_charge_id) {
          throw new AppError('XERO_LINE_MISSING_CHARGE', `Export line ${line.line_id} missing invoice_charge_id`);
        }

        const charge = chargesById.get(line.invoice_charge_id);
        if (!charge) {
          throw new AppError('XERO_CHARGE_NOT_FOUND', `Charge ${line.invoice_charge_id} missing for invoice ${invoiceId}`);
        }
        if (!charge.service_id) {
          throw new AppError('XERO_SERVICE_MISSING', `Charge ${charge.item_id} missing service_id for invoice ${invoiceId}`);
        }

        const serviceMapping = await resolver.resolveServiceMapping({
          adapterType: this.type,
          serviceId: charge.service_id,
          targetRealm: context.batch.target_realm
        });

        if (!serviceMapping) {
          throw new AppError('XERO_SERVICE_MAPPING_MISSING', `No Xero mapping for service ${charge.service_id}`);
        }

        const serviceMetadata = serviceMapping.metadata ?? {};
        const lineResolution = (line.mapping_resolution ?? {}) as Record<string, any>;

        const taxMapping = charge.tax_region
          ? await resolver.resolveTaxCodeMapping({
              adapterType: this.type,
              taxRegionId: charge.tax_region,
              targetRealm: context.batch.target_realm
            })
          : null;

        const taxType =
          safeString(lineResolution.taxType) ??
          safeString(taxMapping?.external_entity_id) ??
          safeString(serviceMetadata.taxType);

        const taxComponents = normalizeTaxComponents(
          lineResolution.taxComponents ??
            serviceMetadata.taxComponents ??
            (taxMapping?.metadata ? (taxMapping.metadata as Record<string, any>)?.components : null)
        );

        const tracking = mergeTrackingOptions(
          normalizeTrackingOptions(lineResolution.tracking),
          normalizeTrackingOptions(serviceMetadata.tracking)
        );

        const lineAmountTypeHint = safeLineAmountType(
          lineResolution.lineAmountType ?? serviceMetadata.lineAmountType
        );
        if (lineAmountTypeHint && !detectedLineAmountType) {
          detectedLineAmountType = lineAmountTypeHint;
        }

        const taxAmountCents =
          typeof charge.tax_amount === 'number' ? Math.round(charge.tax_amount) : null;

        const description =
          line.notes ??
          charge.description ??
          `Invoice ${invoice.invoice_number ?? invoice.invoice_id} line`;

        const unitAmountCents =
          typeof charge.unit_price === 'number' ? Math.round(charge.unit_price) : null;

        const payload: XeroInvoiceLinePayload = {
          lineId: line.line_id,
          amountCents: Math.round(line.amount_cents),
          description,
          quantity: typeof charge.quantity === 'number' ? charge.quantity : 1,
          unitAmountCents,
          itemCode:
            safeString(lineResolution.itemCode) ??
            safeString(serviceMetadata.itemCode) ??
            safeString(serviceMapping.external_entity_id),
          accountCode:
            safeString(lineResolution.accountCode) ?? safeString(serviceMetadata.accountCode),
          taxType: taxType ?? undefined,
          taxAmountCents,
          taxComponents: taxComponents ?? null,
          tracking: tracking ?? null,
          servicePeriodStart: line.service_period_start ?? null,
          servicePeriodEnd: line.service_period_end ?? null
        };

        lineItems.push(payload);
        invoiceTotal += Math.round(line.amount_cents);
      }

      if (lineItems.length === 0) {
        logger.warn('[XeroAdapter] skipping invoice with no exportable lines', {
          tenant: tenantId,
          invoiceId
        });
        continue;
      }

      const invoicePayload: XeroInvoicePayload = {
        invoiceId,
        contactId: clientMapping.external_entity_id,
        currency: invoice.currency_code ?? exportLines[0]?.currency_code ?? null,
        reference: invoice.invoice_number ?? invoiceId,
        invoiceDate: formatDate(invoice.invoice_date),
        dueDate: formatDate(invoice.due_date),
        lineAmountType: detectedLineAmountType ?? defaultLineAmountType(lineItems),
        amountCents: invoiceTotal,
        lines: lineItems,
        metadata: {
          clientId,
          mappingSource: extractMappingSource(clientMapping.metadata),
          invoiceNumber: invoice.invoice_number ?? null
        }
      };

      const documentPayload: XeroDocumentPayload = {
        tenantId,
        connectionId: context.batch.target_realm ?? null,
        invoice: invoicePayload,
        mapping: {
          clientId,
          source: extractMappingSource(clientMapping.metadata)
        }
      };

      documents.push({
        documentId: invoiceId,
        lineIds: exportLines.map((line) => line.line_id),
        payload: documentPayload as unknown as Record<string, unknown>
      });
    }

    return {
      documents,
      metadata: {
        adapter: this.type,
        invoices: documents.length,
        lines: context.lines.length
      }
    };
  }

  async deliver(
    transformResult: AccountingExportTransformResult,
    context: AccountingExportAdapterContext
  ): Promise<AccountingExportDeliveryResult> {
    const tenantId = context.batch.tenant;
    if (!tenantId) {
      throw new AppError('XERO_TENANT_REQUIRED', 'Xero export requires batch tenant identifier');
    }

    const client = await XeroClientService.create(tenantId, context.batch.target_realm ?? null);

    const documents = transformResult.documents;
    logger.info('[XeroAdapter] delivering invoices to Xero', {
      batchId: context.batch.batch_id,
      tenantId,
      invoiceCount: documents.length
    });

    const payloads: XeroInvoicePayload[] = documents.map((document) => {
      const payload = document.payload as unknown as XeroDocumentPayload;
      return payload.invoice;
    });

    const deliveryResults = await client.createInvoices(payloads);
    if (deliveryResults.length !== documents.length) {
      throw new AppError('XERO_DELIVERY_MISMATCH', 'Xero returned unexpected number of invoices', {
        expected: documents.length,
        actual: deliveryResults.length
      });
    }

    const deliveredLines = documents.flatMap((document, index) => {
      const result = deliveryResults[index];
      const externalRef = result.invoiceId ?? result.documentId;
      if (!externalRef) {
        throw new AppError('XERO_DELIVERY_NO_ID', 'Xero did not return an invoice identifier', {
          documentId: document.documentId
        });
      }
      return document.lineIds.map((lineId) => ({
        lineId,
        externalDocumentRef: externalRef
      }));
    });

    return {
      deliveredLines,
      metadata: {
        adapter: this.type,
        deliveredInvoices: documents.length
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
        'invoice_date',
        'due_date',
        'client_id',
        'company_id',
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
      if (invoice.company_id) {
        clientIds.add(invoice.company_id);
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

    const mappingRows = await knex<MappingRowRaw>('tenant_external_entity_mappings')
      .select('*')
      .where('tenant', tenantId)
      .andWhere('integration_type', this.type)
      .andWhere('alga_entity_type', 'client')
      .whereIn('alga_entity_id', Array.from(clientIds))
      .modify((qb) => {
        if (context.batch.target_realm) {
          qb.andWhere((builder) => {
            builder
              .where('external_realm_id', context.batch.target_realm as string)
              .orWhereNull('external_realm_id');
          });
        } else {
          qb.andWhere((builder) => builder.whereNull('external_realm_id'));
        }
      });

    const mappingMap = new Map<string, MappingRow>();
    mappingRows.forEach((row) => {
      const normalized = normalizeMapping(row);
      mappingMap.set(normalized.alga_entity_id, normalized);
    });

    return { clients: clientMap, mappings: mappingMap };
  }
}

function safeString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  return undefined;
}

function safeLineAmountType(value: unknown): LineAmountType | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  if (value === 'Exclusive' || value === 'Inclusive' || value === 'NoTax') {
    return value;
  }
  return undefined;
}

function extractMappingSource(metadata: Record<string, any> | null): string | undefined {
  if (!metadata) return undefined;
  const source = metadata.source ?? metadata.sync_source ?? metadata.origin;
  return typeof source === 'string' ? source : undefined;
}

function normalizeTrackingOptions(input: unknown): XeroTrackingCategoryOption[] | undefined {
  if (!input) return undefined;
  if (Array.isArray(input)) {
    return input
      .map((entry) => {
        if (entry && typeof entry === 'object') {
          const name = (entry as Record<string, any>).name ?? (entry as Record<string, any>).category;
          const option = (entry as Record<string, any>).option ?? (entry as Record<string, any>).value;
          if (typeof name === 'string' && typeof option === 'string') {
            return { name, option };
          }
        }
        return undefined;
      })
      .filter((item): item is XeroTrackingCategoryOption => Boolean(item));
  }
  if (typeof input === 'object') {
    return Object.entries(input as Record<string, any>)
      .filter(([key, value]) => typeof key === 'string' && typeof value === 'string')
      .map(([name, option]) => ({ name, option: option as string }));
  }
  return undefined;
}

function mergeTrackingOptions(
  ...sources: Array<XeroTrackingCategoryOption[] | undefined>
): XeroTrackingCategoryOption[] | undefined {
  const merged = new Map<string, XeroTrackingCategoryOption>();
  for (const source of sources) {
    if (!source) continue;
    for (const entry of source) {
      merged.set(entry.name, entry);
    }
  }
  return merged.size > 0 ? Array.from(merged.values()) : undefined;
}

function normalizeTaxComponents(input: unknown): XeroTaxComponentPayload[] | undefined {
  if (!input) return undefined;
  if (!Array.isArray(input)) {
    return undefined;
  }

  const components: XeroTaxComponentPayload[] = [];
  for (const component of input) {
    if (!component || typeof component !== 'object') {
      continue;
    }
    const raw = component as Record<string, any>;
    const normalized: XeroTaxComponentPayload = {};
    const componentId = safeString(raw.taxComponentId ?? raw.id);
    if (componentId) {
      normalized.taxComponentId = componentId;
    }
    const name = safeString(raw.name);
    if (name) {
      normalized.name = name;
    }
    if (typeof raw.rate === 'number') {
      normalized.rate = raw.rate;
    }
    if (typeof raw.amountCents === 'number') {
      normalized.amountCents = Math.round(raw.amountCents);
    } else if (typeof raw.amount === 'number') {
      normalized.amountCents = Math.round(raw.amount * 100);
    }

    if (Object.keys(normalized).length > 0) {
      components.push(normalized);
    }
  }

  return components.length > 0 ? components : undefined;
}

function defaultLineAmountType(lines: XeroInvoiceLinePayload[]): LineAmountType {
  if (lines.some((line) => typeof line.taxAmountCents === 'number' && line.taxAmountCents !== 0)) {
    return 'Exclusive';
  }
  return 'NoTax';
}

function formatDate(value?: string | Date | null): string | undefined {
  if (!value) return undefined;
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toISOString().split('T')[0];
}

function normalizeMapping(mapping: MappingRowRaw): MappingRow {
  const parsed = parseMetadata(mapping.metadata);
  return {
    ...mapping,
    metadata: parsed ?? null
  };
}

function parseMetadata(input: unknown): Record<string, any> | undefined {
  if (!input) return undefined;
  if (typeof input === 'string') {
    try {
      return JSON.parse(input);
    } catch (error) {
      logger.warn('[XeroAdapter] failed to parse mapping metadata', { error });
      return undefined;
    }
  }
  if (typeof input === 'object') {
    return input as Record<string, any>;
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
