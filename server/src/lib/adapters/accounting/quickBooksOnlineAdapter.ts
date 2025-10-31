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
import { AccountingMappingResolver, MappingResolution } from '../../services/accountingMappingResolver';
import { QboClientService } from '../../qbo/qboClientService';
import { QboInvoice, QboInvoiceLine, QboSalesItemLineDetail } from '../../actions/qbo/types';
import {
  CompanyAccountingSyncService,
  KnexCompanyMappingRepository,
  buildNormalizedCompanyPayload
} from '../../services/companySync';
import { QuickBooksOnlineCompanyAdapter } from '../../services/companySync/adapters/quickBooksCompanyAdapter';

type DbInvoice = {
  invoice_id: string;
  invoice_number: string;
  invoice_date: string | Date;
  due_date?: string | Date | null;
  total_amount: number;
  client_id?: string | null;
  company_id?: string | null;
  currency_code?: string | null;
  exchange_rate_basis_points?: number | null;
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

interface InvoiceDocumentPayload {
  invoice: QboInvoice;
  clientId: string;
  mapping?: {
    customerId: string;
    source?: string;
  };
  totals: {
    amountCents: number;
  };
}

export class QuickBooksOnlineAdapter implements AccountingExportAdapter {
  static readonly TYPE = 'quickbooks_online';

  static async create(): Promise<QuickBooksOnlineAdapter> {
    return new QuickBooksOnlineAdapter();
  }

  readonly type = QuickBooksOnlineAdapter.TYPE;
  private readonly companyAdapter = new QuickBooksOnlineCompanyAdapter();

  capabilities(): AccountingExportAdapterCapabilities {
    return {
      deliveryMode: 'api',
      supportsPartialRetry: true,
      supportsInvoiceUpdates: true
    };
  }

  async transform(context: AccountingExportAdapterContext): Promise<AccountingExportTransformResult> {
    const { knex } = await createTenantKnex();
    const tenantId = context.batch.tenant;
    if (!tenantId) {
      throw new Error('QuickBooks adapter requires batch tenant identifier');
    }

    const companySyncService = CompanyAccountingSyncService.create({
      mappingRepository: new KnexCompanyMappingRepository(knex),
      adapterFactory: (adapterType) =>
        adapterType === QuickBooksOnlineAdapter.TYPE ? this.companyAdapter : null
    });

    const invoicesById = await this.loadInvoices(knex, tenantId, context);
    const chargesById = await this.loadCharges(knex, tenantId, context);
    const clientData = await this.loadClients(knex, tenantId, context, invoicesById);
    const resolver = await AccountingMappingResolver.create({ companySyncService });

    const linesByInvoice = groupBy(context.lines, (line) => line.invoice_id);
    const documents: AccountingExportDocument[] = [];
    const taxCodeCache = new Map<string, string | null>();
    const paymentTermCache = new Map<string, string | null>();

    for (const [invoiceId, exportLines] of linesByInvoice.entries()) {
      const invoice = invoicesById.get(invoiceId);
      if (!invoice) {
        throw new Error(`QuickBooks adapter: invoice ${invoiceId} not found for tenant ${tenantId}`);
      }

      const clientId =
        invoice.client_id ??
        invoice.company_id ??
        exportLines.find((line) => line.client_id)?.client_id ??
        null;

      if (!clientId) {
        throw new Error(`QuickBooks adapter: invoice ${invoiceId} is missing client mapping data`);
      }

      const clientRow = clientData.clients.get(clientId);
      if (!clientRow) {
        throw new Error(`QuickBooks adapter: client ${clientId} not found for invoice ${invoiceId}`);
      }

      let clientMapping = clientData.mappings.get(clientId);
      if (!clientMapping) {
        if (!context.batch.target_realm) {
          throw new Error('QuickBooks adapter requires batch target realm to sync customers');
        }

        const companyPayload = buildNormalizedCompanyPayload({
          companyId: clientId,
          name: clientRow.client_name ?? clientId,
          primaryEmail: clientRow.billing_email ?? null
        });

        const mappingResolution = await resolver.ensureCompanyMapping({
          tenantId,
          adapterType: this.type,
          companyId: clientId,
          payload: companyPayload,
          targetRealm: context.batch.target_realm
        });

        if (!mappingResolution) {
          throw new Error(`QuickBooks adapter: unable to resolve customer for client ${clientId}`);
        }

        clientMapping = mappingFromResolution(
          clientId,
          mappingResolution,
          this.type,
          context.batch.target_realm
        );
        clientData.mappings.set(clientId, clientMapping);
      }

      if (!clientMapping) {
        throw new Error(`QuickBooks adapter: no QuickBooks customer mapping for client ${clientId}`);
      }

      const qboLines: QboInvoiceLine[] = [];
      for (const line of exportLines) {
        if (!line.invoice_charge_id) {
          throw new Error(`QuickBooks adapter: export line ${line.line_id} has no invoice_charge_id`);
        }
        const charge = chargesById.get(line.invoice_charge_id);
        if (!charge) {
          throw new Error(`QuickBooks adapter: charge ${line.invoice_charge_id} missing for invoice ${invoiceId}`);
        }
        if (!charge.service_id) {
          throw new Error(`QuickBooks adapter: charge ${charge.item_id} missing service_id for invoice ${invoiceId}`);
        }

        const serviceMapping = await resolver.resolveServiceMapping({
          adapterType: this.type,
          serviceId: charge.service_id,
          targetRealm: context.batch.target_realm
        });

        if (!serviceMapping) {
          throw new Error(`QuickBooks adapter: no mapping for service ${charge.service_id}`);
        }

        const salesDetail: QboSalesItemLineDetail = {
          ItemRef: { value: serviceMapping.external_entity_id }
        };

        if (charge.quantity != null) {
          salesDetail.Qty = charge.quantity;
        }

        if (charge.unit_price != null) {
          salesDetail.UnitPrice = centsToAmount(charge.unit_price);
        }

        const serviceDate = line.service_period_start ?? line.service_period_end;
        if (serviceDate) {
          const formatted = formatDate(serviceDate);
          if (formatted) {
            salesDetail.ServiceDate = formatted;
          }
        }

        const taxRegion = charge.tax_region;
        if (taxRegion) {
          let taxCodeRef = taxCodeCache.get(taxRegion);
          if (taxCodeRef === undefined) {
            const taxMapping = await resolver.resolveTaxCodeMapping({
              adapterType: this.type,
              taxRegionId: taxRegion,
              targetRealm: context.batch.target_realm
            });
            taxCodeRef = taxMapping?.external_entity_id ?? null;
            taxCodeCache.set(taxRegion, taxCodeRef);
          }
          if (taxCodeRef) {
            salesDetail.TaxCodeRef = { value: taxCodeRef };
          }
        }

        qboLines.push({
          Amount: centsToAmount(line.amount_cents),
          DetailType: 'SalesItemLineDetail',
          Description: charge.description ?? undefined,
          SalesItemLineDetail: salesDetail
        });
      }

      if (qboLines.length === 0) {
        logger.warn('QuickBooks adapter: skipping invoice with no lines', { invoiceId, tenant: tenantId });
        continue;
      }

      const qboInvoice: QboInvoice = {
        DocNumber: invoice.invoice_number,
        TxnDate: formatDate(invoice.invoice_date),
        DueDate: formatDate(invoice.due_date),
        CustomerRef: {
          value: clientMapping.external_entity_id
        },
        Line: qboLines
      };

      if (clientRow?.payment_terms) {
        let termRef = paymentTermCache.get(clientRow.payment_terms);
        if (termRef === undefined) {
          const termMapping = await resolver.resolvePaymentTermMapping({
            adapterType: this.type,
            paymentTermId: clientRow.payment_terms,
            targetRealm: context.batch.target_realm
          });
          termRef = termMapping?.external_entity_id ?? null;
          paymentTermCache.set(clientRow.payment_terms, termRef);
        }
        if (termRef) {
          qboInvoice.SalesTermRef = { value: termRef };
        }
      }

      if (invoice.currency_code) {
        qboInvoice.CurrencyRef = { value: invoice.currency_code };
      }

      if (invoice.exchange_rate_basis_points) {
        qboInvoice.ExchangeRate = basisPointsToRate(invoice.exchange_rate_basis_points);
      }

      if (clientRow?.billing_email) {
        qboInvoice.BillEmail = { Address: clientRow.billing_email };
      }

      const clientMetadataRaw = clientMapping.metadata ?? {};
      const clientMetadata = clientMetadataRaw as Record<string, any>;
      const mappingSource =
        typeof clientMetadata?.source === 'string'
          ? clientMetadata.source
          : typeof clientMetadata?.sync_source === 'string'
            ? clientMetadata.sync_source
            : undefined;

      const payload: InvoiceDocumentPayload = {
        invoice: qboInvoice,
        clientId,
        mapping: {
          customerId: clientMapping.external_entity_id,
          source: mappingSource ?? 'mapping_table'
        },
        totals: {
          amountCents: exportLines.reduce((sum, line) => sum + line.amount_cents, 0)
        }
      };

      documents.push({
        documentId: invoiceId,
        lineIds: exportLines.map((line) => line.line_id),
        payload: payload as unknown as Record<string, unknown>
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
    const realmId = context.batch.target_realm;
    if (!realmId) {
      throw new Error('QuickBooks adapter requires batch.target_realm to deliver invoices');
    }

    const { knex } = await createTenantKnex();
    const tenantId = context.batch.tenant;
    if (!tenantId) {
      throw new Error('QuickBooks adapter requires batch tenant identifier for delivery');
    }
    const qboClient = await QboClientService.create(tenantId, realmId);

    const deliveredLines: { lineId: string; externalDocumentRef?: string | null }[] = [];

    for (const document of transformResult.documents) {
      const payload = document.payload as unknown as InvoiceDocumentPayload;
      const mapping = await fetchInvoiceMapping(knex, tenantId, document.documentId, realmId);
      const mappingMetadata = mapping?.metadata ?? null;
      const existingMetadata = mappingMetadata ?? undefined;
      let response: QboInvoice;

      if (mapping?.external_entity_id) {
        let syncToken =
          existingMetadata?.sync_token ??
          existingMetadata?.syncToken;
        if (!syncToken) {
          const remoteInvoice = await qboClient.read<QboInvoice>('Invoice', mapping.external_entity_id);
          syncToken = remoteInvoice?.SyncToken ?? undefined;
        }

        if (!syncToken) {
          throw new Error(`QuickBooks adapter: missing SyncToken for invoice ${document.documentId}`);
        }

        const updatePayload = {
          ...payload.invoice,
          Id: mapping.external_entity_id,
          SyncToken: syncToken,
          sparse: true
        };

        response = await qboClient.update<QboInvoice>('Invoice', updatePayload);
      } else {
        response = await qboClient.create<QboInvoice>('Invoice', payload.invoice);
      }

      const metadata = {
        ...(existingMetadata ?? {}),
        sync_token: response.SyncToken ?? existingMetadata?.sync_token ?? null,
        last_exported_at: new Date().toISOString()
      };

      const externalRef = response.Id;
      if (!externalRef) {
        throw new Error('QuickBooks adapter: QBO response missing Invoice Id');
      }

      await upsertInvoiceMapping(knex, tenantId, document.documentId, realmId, externalRef, metadata);

      deliveredLines.push(
        ...document.lineIds.map((lineId) => ({
          lineId,
          externalDocumentRef: externalRef
        }))
      );
    }

    return {
      deliveredLines,
      metadata: {
        adapter: this.type,
        deliveredInvoices: transformResult.documents.length
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
        'total_amount',
        'client_id',
        'company_id',
        'currency_code',
        'exchange_rate_basis_points'
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
    context: AccountingExportAdapterContext,
    invoices: Map<string, DbInvoice>
  ): Promise<{ clients: Map<string, DbClient>; mappings: Map<string, MappingRow> }> {
    const clientIds = new Set<string>();

    for (const invoice of invoices.values()) {
      if (invoice.client_id) {
        clientIds.add(invoice.client_id);
      } else if (invoice.company_id) {
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
      .select('client_id', 'client_name', 'billing_email', 'payment_terms')
      .where('tenant', tenantId)
      .whereIn('client_id', Array.from(clientIds));

    const clientMap = new Map(clients.map((client) => [client.client_id, client]));

    const mappingRows = await knex<MappingRowRaw>('tenant_external_entity_mappings')
      .select('*')
      .where('tenant', tenantId)
      .andWhere('integration_type', this.type)
      .whereIn('alga_entity_type', ['client', 'company'])
      .whereIn('alga_entity_id', Array.from(clientIds))
      .modify((qb) => {
        if (context.batch.target_realm) {
          qb.andWhere((builder) => {
            builder.where('external_realm_id', context.batch.target_realm as string).orWhereNull('external_realm_id');
          });
        } else {
          qb.andWhere((builder) => builder.whereNull('external_realm_id'));
        }
      });

    const mappingMap = new Map<string, MappingRow>();
    mappingRows.forEach((row) => {
      const normalized = normalizeMapping(row);
      const existing = mappingMap.get(normalized.alga_entity_id);
      if (!existing || existing.alga_entity_type !== 'company') {
        mappingMap.set(normalized.alga_entity_id, normalized);
      }
    });

    return { clients: clientMap, mappings: mappingMap };
  }
}

async function fetchInvoiceMapping(
  knex: Knex,
  tenantId: string,
  invoiceId: string,
  realmId: string
): Promise<MappingRow | undefined> {
  const row = await knex<MappingRowRaw>('tenant_external_entity_mappings')
    .where('tenant', tenantId)
    .andWhere('integration_type', QuickBooksOnlineAdapter.TYPE)
    .andWhere('alga_entity_type', 'invoice')
    .andWhere('alga_entity_id', invoiceId)
    .andWhere((builder) => {
      builder.where('external_realm_id', realmId).orWhereNull('external_realm_id');
    })
    .first();

  return row ? normalizeMapping(row) : undefined;
}

async function upsertInvoiceMapping(
  knex: Knex,
  tenantId: string,
  invoiceId: string,
  realmId: string,
  externalId: string,
  metadata: Record<string, unknown> | null
): Promise<void> {
  const now = new Date().toISOString();
  let cleanedMetadata: Record<string, unknown> | null = null;
  if (metadata && Object.keys(metadata).length > 0) {
    cleanedMetadata = metadata;
  }

  await knex('tenant_external_entity_mappings')
    .insert({
      id: knex.raw('gen_random_uuid()'),
      tenant: tenantId,
      integration_type: QuickBooksOnlineAdapter.TYPE,
      alga_entity_type: 'invoice',
      alga_entity_id: invoiceId,
      external_entity_id: externalId,
      external_realm_id: realmId,
      sync_status: 'synced',
      metadata: cleanedMetadata,
      created_at: now,
      updated_at: now
    })
    .onConflict(['tenant', 'integration_type', 'alga_entity_type', 'alga_entity_id'])
    .merge({
      external_entity_id: externalId,
      external_realm_id: realmId,
      sync_status: 'synced',
      metadata: cleanedMetadata,
      updated_at: now
    });
}

function centsToAmount(value: number): number {
  return Math.round(value) / 100;
}

function formatDate(value?: string | Date | null): string | undefined {
  if (!value) return undefined;
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toISOString().split('T')[0];
}

function basisPointsToRate(bps: number): number {
  return Math.round(bps) / 10_000;
}

function parseMetadata(input: unknown): Record<string, any> | undefined {
  if (!input) {
    return undefined;
  }
  if (typeof input === 'string') {
    try {
      return JSON.parse(input);
    } catch (error) {
      logger.warn('QuickBooks adapter: failed to parse mapping metadata string', { error });
      return undefined;
    }
  }
  if (typeof input === 'object') {
    return input as Record<string, any>;
  }
  return undefined;
}

function normalizeMapping(mapping: MappingRowRaw): MappingRow {
  const parsed = parseMetadata(mapping.metadata);
  return {
    ...mapping,
    metadata: parsed ?? null
  };
}

function mappingFromResolution(
  clientId: string,
  resolution: MappingResolution,
  adapterType: string,
  targetRealm: string | null
): MappingRow {
  return {
    id: `runtime-${clientId}`,
    integration_type: adapterType,
    alga_entity_type: 'company',
    alga_entity_id: clientId,
    external_entity_id: resolution.external_entity_id,
    external_realm_id: targetRealm,
    metadata: resolution.metadata ?? null
  };
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
