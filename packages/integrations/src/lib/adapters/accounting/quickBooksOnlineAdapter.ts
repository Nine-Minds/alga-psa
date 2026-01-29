import logger from '@alga-psa/core/logger';
import { Knex } from 'knex';
import {
  AccountingExportAdapter,
  AccountingExportAdapterCapabilities,
  AccountingExportAdapterContext,
  AccountingExportDeliveryResult,
  AccountingExportTransformResult,
  AccountingExportDocument,
  ExternalInvoiceFetchResult,
  ExternalInvoiceData,
  ExternalInvoiceChargeTax,
  ExternalTaxComponent,
  PendingTaxImportRecord
} from './accountingExportAdapter';
import { createTenantKnex } from '@alga-psa/db';
import { AccountingMappingResolver, MappingResolution } from '../../services/accountingMappingResolver';
import { QboClientService } from '../../qbo/qboClientService';
import { QboInvoice, QboInvoiceLine, QboSalesItemLineDetail } from '../../qbo/types';
import {
  CompanyAccountingSyncService,
  KnexCompanyMappingRepository,
  buildNormalizedCompanyPayload
} from '../../services/companySync';
import { QuickBooksOnlineCompanyAdapter } from '../../services/companySync/adapters/quickBooksCompanyAdapter';
import { KnexInvoiceMappingRepository } from '../../repositories/invoiceMappingRepository';

type DbInvoice = {
  invoice_id: string;
  invoice_number: string;
  po_number?: string | null;
  invoice_date: string | Date;
  due_date?: string | Date | null;
  total_amount: number;
  client_id?: string | null;
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
  /** Charge IDs in same order as invoice.Line[] for mapping after delivery */
  chargeIds: string[];
  mapping?: {
    customerId: string;
    source?: string;
  };
  totals: {
    amountCents: number;
  };
}

export function buildQboPrivateNoteForPurchaseOrder(poNumber: string): string {
  return `PO: ${poNumber}`;
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
      supportsInvoiceUpdates: true,
      supportsTaxDelegation: true,
      supportsInvoiceFetch: true,
      supportsTaxComponentImport: true // QBO provides tax components at invoice level via TxnTaxDetail.TaxLine
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
      const chargeIds: string[] = []; // Track charge IDs in same order as qboLines
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

        // Handle tax based on delegation mode
        const shouldExcludeTax = context.excludeTaxFromExport || context.taxDelegationMode === 'delegate';

        if (!shouldExcludeTax) {
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
        }
        // Note: When shouldExcludeTax is true, we don't set TaxCodeRef
        // QBO will apply default tax behavior or NON depending on settings

        qboLines.push({
          Amount: centsToAmount(line.amount_cents),
          DetailType: 'SalesItemLineDetail',
          Description: charge.description ?? undefined,
          SalesItemLineDetail: salesDetail
        });
        chargeIds.push(line.invoice_charge_id);
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

      if (invoice.po_number) {
        qboInvoice.PrivateNote = buildQboPrivateNoteForPurchaseOrder(invoice.po_number);
      }

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
        chargeIds, // Alga charge IDs in same order as invoice.Line[]
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
        lines: context.lines.length,
        taxDelegationMode: context.taxDelegationMode ?? 'none',
        taxExcluded: context.excludeTaxFromExport || context.taxDelegationMode === 'delegate'
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
    const invoiceMappingRepository = new KnexInvoiceMappingRepository(knex);

    const deliveredLines: { lineId: string; externalDocumentRef?: string | null }[] = [];

    for (const document of transformResult.documents) {
      const payload = document.payload as unknown as InvoiceDocumentPayload;
      const mapping = await invoiceMappingRepository.findInvoiceMapping({
        tenantId,
        adapterType: this.type,
        invoiceId: document.documentId,
        targetRealm: realmId
      });
      const mappingMetadata = mapping?.metadata ?? null;
      const existingMetadata = mappingMetadata ?? undefined;
      let response: QboInvoice;

      if (mapping?.externalInvoiceId) {
        let syncToken =
          existingMetadata?.sync_token ??
          existingMetadata?.syncToken;
        if (!syncToken) {
          const remoteInvoice = await qboClient.read<QboInvoice>('Invoice', mapping.externalInvoiceId);
          syncToken = remoteInvoice?.SyncToken ? String(remoteInvoice.SyncToken) : undefined;
        }

        if (!syncToken) {
          throw new Error(`QuickBooks adapter: missing SyncToken for invoice ${document.documentId}`);
        }

        const updatePayload = {
          ...payload.invoice,
          Id: mapping.externalInvoiceId,
          SyncToken: syncToken as string,
          sparse: true
        } as { [key: string]: any; Id: string; SyncToken: string };

        response = await qboClient.update<QboInvoice>('Invoice', updatePayload);
      } else {
        response = await qboClient.create<QboInvoice>('Invoice', payload.invoice);
      }

      // Build charge-to-QBO-line mapping from response
      // QBO returns lines in same order as sent, filter to SalesItemLineDetail only
      const qboSalesLines = (response.Line ?? [])
        .filter((line: QboInvoiceLine) => line.DetailType === 'SalesItemLineDetail');
      const chargeLineMappings: Array<{ chargeId: string; qboLineId: string }> = [];
      for (let i = 0; i < payload.chargeIds.length && i < qboSalesLines.length; i++) {
        const qboLineId = qboSalesLines[i].Id;
        if (qboLineId) {
          chargeLineMappings.push({
            chargeId: payload.chargeIds[i],
            qboLineId
          });
        }
      }

      const metadata = {
        ...(existingMetadata ?? {}),
        sync_token: response.SyncToken ?? existingMetadata?.sync_token ?? null,
        last_exported_at: new Date().toISOString(),
        chargeLineMappings // Store mapping for tax import
      };

      const externalRef = response.Id;
      if (!externalRef) {
        throw new Error('QuickBooks adapter: QBO response missing Invoice Id');
      }

      await invoiceMappingRepository.upsertInvoiceMapping({
        tenantId,
        adapterType: this.type,
        invoiceId: document.documentId,
        externalInvoiceId: externalRef,
        targetRealm: realmId,
        metadata
      });

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
        'po_number',
        'invoice_date',
        'due_date',
        'total_amount',
        'client_id',
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
      .whereIn('alga_entity_type', ['client'])
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
    mappingRows.forEach((row: MappingRowRaw) => {
      const normalized = normalizeMapping(row);
      mappingMap.set(normalized.alga_entity_id, normalized);
    });

    return { clients: clientMap, mappings: mappingMap };
  }

  /**
   * Fetch invoice data including tax amounts from QuickBooks Online.
   * Used to import externally calculated tax back into Alga PSA.
   */
  async fetchExternalInvoice(
    externalInvoiceRef: string,
    targetRealm?: string
  ): Promise<ExternalInvoiceFetchResult> {
    try {
      const { knex } = await createTenantKnex();
      const tenantId = await this.getTenantFromContext(knex);

      if (!targetRealm) {
        return {
          success: false,
          error: 'QuickBooks adapter requires targetRealm to fetch invoices'
        };
      }

      const qboClient = await QboClientService.create(tenantId, targetRealm);
      const qboInvoice = await qboClient.read<QboInvoice>('Invoice', externalInvoiceRef);

      if (!qboInvoice) {
        return {
          success: false,
          error: `Invoice ${externalInvoiceRef} not found in QuickBooks`
        };
      }

      // Look up charge-to-line mapping from invoice metadata
      // This was stored during export to enable robust matching
      const mappingRow = await knex('tenant_external_entity_mappings')
        .where({
          tenant: tenantId,
          integration_type: this.type,
          alga_entity_type: 'invoice',
          external_entity_id: externalInvoiceRef
        })
        .first();

      const chargeLineMappings: Array<{ chargeId: string; qboLineId: string }> =
        (mappingRow?.metadata as any)?.chargeLineMappings ?? [];

      // Build reverse map: QBO line ID → Alga charge ID
      const qboLineToChargeId = new Map<string, string>();
      for (const mapping of chargeLineMappings) {
        qboLineToChargeId.set(mapping.qboLineId, mapping.chargeId);
      }

      // Calculate total tax from QBO invoice
      const totalTax = amountToCents(qboInvoice.TxnTaxDetail?.TotalTax ?? 0);
      const totalAmount = amountToCents(qboInvoice.TotalAmt ?? 0);

      // Extract line items with their amounts for proportional tax distribution
      const lineItems: Array<{
        lineId: string;
        externalLineId?: string;
        amount: number;
        taxCode?: string;
      }> = [];
      let lineIndex = 0;

      for (const line of qboInvoice.Line ?? []) {
        if (line.DetailType === 'SalesItemLineDetail' && line.SalesItemLineDetail) {
          const detail = line.SalesItemLineDetail;
          // QBO line Amount is the line total before tax
          const lineAmount = amountToCents(line.Amount ?? 0);
          const qboLineId = line.Id ?? undefined;

          // Use stored charge ID if available, otherwise fall back to positional index
          const chargeId = qboLineId ? qboLineToChargeId.get(qboLineId) : undefined;
          const lineId = chargeId ?? `line-${lineIndex}`;

          lineItems.push({
            lineId,
            externalLineId: qboLineId,
            amount: lineAmount,
            taxCode: detail.TaxCodeRef?.value
          });
          lineIndex++;
        }
      }

      // Calculate subtotal from line items
      const subtotal = lineItems.reduce((sum, item) => sum + item.amount, 0);

      // Distribute tax proportionally across lines based on line amounts
      // Using documented rounding algorithm from docs/tax_calculation_allocation.md:
      // - Use Math.floor() for each line's proportional share
      // - Assign remainder to the LAST item to ensure sum equals total
      const charges: ExternalInvoiceChargeTax[] = lineItems.map((item, index) => {
        let taxAmount = 0;

        if (subtotal > 0 && totalTax > 0) {
          // Proportional distribution: itemTax = floor((itemNetAmount / totalRegionalNet) × totalGroupTax)
          taxAmount = Math.floor((item.amount / subtotal) * totalTax);
        }

        // Calculate effective tax rate for this line
        const effectiveRate = item.amount > 0 ? (taxAmount / item.amount) * 100 : undefined;

        return {
          lineId: item.lineId,
          externalLineId: item.externalLineId,
          taxAmount,
          taxCode: item.taxCode,
          taxRate: effectiveRate
        };
      });

      // Handle rounding - assign remainder to the LAST item (per documented algorithm)
      if (charges.length > 0 && totalTax > 0) {
        const distributedTax = charges.reduce((sum, c) => sum + c.taxAmount, 0);
        const roundingDiff = totalTax - distributedTax;
        if (roundingDiff !== 0) {
          // Apply rounding difference to the last item in the group
          charges[charges.length - 1].taxAmount += roundingDiff;
        }
      }

      // Extract tax component breakdown from TxnTaxDetail.TaxLine[]
      // QBO provides this at the invoice level (not per-line like Xero)
      const taxLines = qboInvoice.TxnTaxDetail?.TaxLine ?? [];
      const invoiceTaxComponents: ExternalTaxComponent[] = taxLines
        .filter(line => line.TaxLineDetailType === 'TaxLineDetail' || line.Amount !== undefined)
        .map(line => ({
          name: line.TaxRateRef?.name ?? line.TaxRateRef?.value ?? 'Tax',
          rate: line.TaxPercent ?? 0,
          amount: amountToCents(line.Amount ?? 0)
        }));

      // If we have tax components, distribute them proportionally to line items
      // Using documented rounding algorithm: floor + remainder to last item
      if (invoiceTaxComponents.length > 0 && charges.length > 0) {
        // For each tax component, distribute to charges proportionally
        for (const component of invoiceTaxComponents) {
          let distributedComponentTax = 0;

          for (let i = 0; i < charges.length; i++) {
            const charge = charges[i];
            if (!charge.taxComponents) {
              charge.taxComponents = [];
            }

            if (subtotal > 0 && charge.taxAmount > 0) {
              const isLastCharge = i === charges.length - 1;
              let componentAmount: number;

              if (isLastCharge) {
                // Last item gets the remainder
                componentAmount = component.amount - distributedComponentTax;
              } else {
                // Use floor for all but the last
                const proportion = charge.taxAmount / totalTax;
                componentAmount = Math.floor(component.amount * proportion);
                distributedComponentTax += componentAmount;
              }

              charge.taxComponents.push({
                name: component.name,
                rate: component.rate,
                amount: componentAmount
              });
            }
          }
        }
      }

      const externalInvoice: ExternalInvoiceData = {
        externalInvoiceId: qboInvoice.Id ?? externalInvoiceRef,
        externalInvoiceRef: qboInvoice.DocNumber ?? undefined,
        status: 'synced', // QBO invoice was fetched successfully
        totalTax,
        totalAmount,
        currency: qboInvoice.CurrencyRef?.value,
        charges,
        metadata: {
          syncToken: qboInvoice.SyncToken,
          txnDate: qboInvoice.TxnDate,
          dueDate: qboInvoice.DueDate,
          customerId: qboInvoice.CustomerRef?.value,
          // Include invoice-level tax components for reference
          taxComponents: invoiceTaxComponents.length > 0 ? invoiceTaxComponents : undefined,
          txnTaxCodeRef: qboInvoice.TxnTaxDetail?.TxnTaxCodeRef?.value
        }
      };

      return {
        success: true,
        invoice: externalInvoice
      };
    } catch (error: any) {
      logger.error('QuickBooks adapter: failed to fetch external invoice', {
        externalInvoiceRef,
        targetRealm,
        error: error.message
      });
      return {
        success: false,
        error: error.message ?? 'Failed to fetch invoice from QuickBooks'
      };
    }
  }

  /**
   * Called after export when tax delegation is enabled.
   * Records pending tax imports for invoices exported without tax.
   */
  async onTaxDelegationExport(
    deliveryResult: AccountingExportDeliveryResult,
    context: AccountingExportAdapterContext
  ): Promise<PendingTaxImportRecord[]> {
    // Only create pending records if tax delegation is active
    if (context.taxDelegationMode !== 'delegate') {
      return [];
    }

    const pendingRecords: PendingTaxImportRecord[] = [];
    const now = new Date().toISOString();

    // Group by document to get unique invoice refs
    const invoiceRefs = new Map<string, string>();
    for (const line of deliveryResult.deliveredLines) {
      if (line.externalDocumentRef) {
        // We need to correlate back to the invoice ID
        // The lineId format should help us map back
        const invoiceId = this.extractInvoiceIdFromLine(context, line.lineId);
        if (invoiceId && !invoiceRefs.has(invoiceId)) {
          invoiceRefs.set(invoiceId, line.externalDocumentRef);
        }
      }
    }

    for (const [invoiceId, externalRef] of invoiceRefs.entries()) {
      pendingRecords.push({
        invoiceId,
        externalInvoiceRef: externalRef,
        adapterType: this.type,
        targetRealm: context.batch.target_realm ?? undefined,
        exportedAt: now
      });
    }

    logger.info('QuickBooks adapter: created pending tax import records', {
      count: pendingRecords.length,
      batchId: context.batch.batch_id
    });

    return pendingRecords;
  }

  /**
   * Helper to get tenant ID from knex context
   */
  private async getTenantFromContext(knex: Knex): Promise<string> {
    // The tenant is typically set in the knex context via RLS
    // This is a workaround to extract it
    const result = await knex.raw('SELECT current_setting(\'app.current_tenant\', true) as tenant');
    const tenant = result.rows?.[0]?.tenant;
    if (!tenant) {
      throw new Error('QuickBooks adapter: unable to determine tenant from context');
    }
    return tenant;
  }

  /**
   * Helper to extract invoice ID from a delivery line
   */
  private extractInvoiceIdFromLine(
    context: AccountingExportAdapterContext,
    lineId: string
  ): string | undefined {
    const line = context.lines.find(l => l.line_id === lineId);
    return line?.invoice_id;
  }
}

function centsToAmount(value: number): number {
  return Math.round(value) / 100;
}

function amountToCents(value: number): number {
  return Math.round(value * 100);
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
    alga_entity_type: 'client',
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
