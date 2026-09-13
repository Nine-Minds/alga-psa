/* eslint-disable custom-rules/no-feature-to-feature-imports -- Accounting export adapter - intentionally bridges billing and Xero integration APIs */
import logger from '@alga-psa/core/logger';
import { Knex } from 'knex';
import {
  AccountingChangeSet,
  AccountingExportAdapter,
  AccountingExportAdapterCapabilities,
  AccountingExportAdapterContext,
  AccountingExportDeliveryResult,
  AccountingExportTransformResult,
  AccountingExportDocument,
  AccountingExternalChange,
  ExternalInvoiceFetchResult,
  ExternalInvoiceData,
  ExternalInvoiceChargeTax,
  NormalizedExternalDocumentPayload,
  NormalizedExternalPaymentPayload,
  PendingTaxImportRecord
} from '@alga-psa/types';
import {
  XeroClientService,
  XeroInvoicePayload,
  XeroInvoiceLinePayload,
  XeroTrackingCategoryOption,
  XeroTaxComponentPayload
} from '@alga-psa/integrations/lib/xero/xeroClientService';
import {
  readXeroServiceTargetKind,
  XeroServiceTargetKind
} from '@alga-psa/integrations/lib/xero/xeroServiceMappingTarget';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { lockInvoiceForExternalSync } from '../../lib/invoiceExternalSyncLock';
import { AccountingMappingResolver, MappingResolution } from '../../services/accountingMappingResolver';
import { CompanyAccountingSyncService } from '../../services/companySync/companySyncService';
import { KnexCompanyMappingRepository } from '../../services/companySync/companyMappingRepository';
import { buildNormalizedCompanyPayload } from '../../services/companySync/companySyncNormalizer';
import { XeroCompanyAdapter } from '../../services/companySync/adapters/xeroCompanyAdapter';
import { KnexInvoiceMappingRepository } from '../../repositories/invoiceMappingRepository';
import { AppError } from '@alga-psa/core';

export function buildXeroInvoiceReference(baseReference: string, poNumber?: string | null): string {
  const reference = poNumber ? `${baseReference} | PO ${poNumber}` : baseReference;
  return reference.length > 255 ? reference.slice(0, 255) : reference;
}

function resolveXeroLineServicePeriod(
  line: AccountingExportAdapterContext['lines'][number]
): {
  servicePeriodStart: string | null;
  servicePeriodEnd: string | null;
} {
  if (line.payload?.service_period_source === 'financial_document_fallback') {
    return {
      servicePeriodStart: null,
      servicePeriodEnd: null
    };
  }

  // Xero can represent both boundaries, so keep the compatibility summary range on the
  // line payload and let the downstream client flatten that range into description copy
  // only when the external API cannot represent the period semantics directly.
  return {
    servicePeriodStart: line.service_period_start ?? null,
    servicePeriodEnd: line.service_period_end ?? null
  };
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
  net_amount?: number | null;
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
  /** Charge IDs in same order as invoice.lines[] for mapping after delivery */
  chargeIds: string[];
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
  private readonly companyAdapter = new XeroCompanyAdapter();

  capabilities(): AccountingExportAdapterCapabilities {
    return {
      deliveryMode: 'api',
      supportedExportTypes: ['invoice'],
      supportsPartialRetry: true,
      supportsInvoiceUpdates: true,
      supportsTaxDelegation: true,
      supportsInvoiceFetch: true,
      supportsTaxComponentImport: true, // Xero provides detailed tax component breakdown
      supportsChangePolling: true,
      // Xero outbound writes beyond invoice export are not implemented. These
      // flags make shared appliers gate them explicitly (observable exception)
      // instead of dispatching through another provider's client.
      supportsPaymentRecording: false,
      supportsOutboundPayment: false,
      supportsOutboundCredit: false,
      supportsOutboundVoid: false
    };
  }

  /**
   * Poll changed invoices, payments and credit notes since a cursor.
   *
   * Pagination: each Xero collection is fetched page by page (100 per page)
   * until a short page is returned, so the caller receives a complete change
   * set before the cycle may advance its cursor. `truncated` is set only if a
   * safety page cap is hit.
   *
   * Replay/idempotency: every emitted change carries a stable external id and
   * a `syncToken` (Xero UpdatedDateUTC, plus amount for synthesized credit
   * allocations). The shared appliers no-op on an unchanged token, which makes
   * overlapping polls and the cursor overlap window safe.
   *
   * Reversals: a status of DELETED/VOIDED emits a deleted document change; a
   * removed credit allocation emits a deleted synthesized payment change for
   * the previously recorded ledger row.
   */
  async fetchChanges(
    tenantId: string,
    since: string,
    targetRealm?: string | null
  ): Promise<AccountingChangeSet> {
    if (!targetRealm) {
      throw new AppError('XERO_REALM_REQUIRED', 'Xero change polling requires a connection id');
    }

    // Conservative pre-poll watermark: any change written after this instant is
    // re-fetched on the next cycle, so a poll that outlives the cursor overlap
    // can never skip a record it happened to collect before that record was
    // written. `fetchedAt` is therefore the *start* of the poll, not its end.
    const watermark = new Date().toISOString();

    const client = await XeroClientService.create(tenantId, targetRealm);
    const changes: AccountingExternalChange[] = [];

    const [invoices, payments, creditNotes] = await Promise.all([
      this.collectChanged(client, 'invoice', since),
      this.collectChanged(client, 'payment', since),
      this.collectChanged(client, 'creditNote', since)
    ]);

    const truncated = invoices.truncated || payments.truncated || creditNotes.truncated;

    for (const record of invoices.records) {
      const change = normalizeXeroInvoice(record);
      if (change) {
        changes.push(change);
      }
    }

    for (const record of payments.records) {
      const change = normalizeXeroPayment(record);
      if (change) {
        changes.push(change);
      }
    }

    const currentCreditAllocations = new Map<string, Set<string>>();
    for (const record of creditNotes.records) {
      const documentChange = normalizeXeroCreditNote(record);
      if (documentChange) {
        changes.push(documentChange);
      }
      const creditNoteId = String(record?.CreditNoteID ?? '');
      if (!creditNoteId) {
        continue;
      }
      const allocationIds = new Set<string>();
      for (const allocationChange of normalizeXeroCreditAllocations(record)) {
        changes.push(allocationChange);
        allocationIds.add(allocationChange.externalId);
      }
      currentCreditAllocations.set(creditNoteId, allocationIds);
    }

    // Reconcile credit notes whose allocations were removed: emit a deletion
    // for any previously recorded synthetic allocation that is no longer in
    // Xero's current allocation set. Deletions are emitted before the document
    // changes that may have created them so a replacement is reversible even
    // if a consumer does not reorder; the shared cycle still sorts deletions
    // ahead of applications.
    if (currentCreditAllocations.size > 0) {
      const removed = await this.findRemovedCreditAllocations(
        tenantId,
        targetRealm,
        currentCreditAllocations
      );
      changes.unshift(...removed);
    }

    // No nextCursor is emitted: with a single stored timestamp there is no safe
    // resume boundary when a feed truncates. Xero pages are not guaranteed to
    // be ordered by UpdatedDateUTC, and a set larger than the page cap can share
    // one timestamp across pages, so advancing to the newest fetched record (or
    // to a newer completed feed's timestamp) can skip unread history. The cycle
    // leaves the cursor untouched on a truncated poll and re-polls the same
    // window until the source stops truncating.
    return {
      changes,
      truncated,
      fetchedAt: watermark
    };
  }

  private async collectChanged(
    client: XeroClientService,
    kind: 'invoice' | 'payment' | 'creditNote',
    since: string
  ): Promise<{ records: Array<Record<string, any>>; truncated: boolean }> {
    const records: Array<Record<string, any>> = [];
    const MAX_PAGES = 1000;

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const result =
        kind === 'invoice'
          ? await client.listChangedInvoices(since, page)
          : kind === 'payment'
            ? await client.listChangedPayments(since, page)
            : await client.listChangedCreditNotes(since, page);

      records.push(...result.records);

      if (!result.hasMore) {
        return { records, truncated: false };
      }
    }

    return { records, truncated: true };
  }

  private async findRemovedCreditAllocations(
    tenantId: string,
    targetRealm: string,
    current: Map<string, Set<string>>
  ): Promise<AccountingExternalChange[]> {
    const creditNoteIds = Array.from(current.keys());
    if (creditNoteIds.length === 0) {
      return [];
    }

    const { knex } = await createTenantKnex();
    // `metadata->>` is a JSON expression, not a column: bind it through a raw
    // parameterized predicate so PostgreSQL evaluates the extraction instead
    // of looking for a column literally named `metadata->>xero_credit_note_id`.
    const rows = await tenantDb(knex, tenantId).table<MappingRowRaw>('tenant_external_entity_mappings')
      .select('*')
      .where('integration_type', this.type)
      .where('alga_entity_type', 'invoice_payment')
      .where('external_realm_id', targetRealm)
      .whereNull('deleted_at')
      .whereRaw("(metadata->>'xero_credit_note_id') = ANY(?)", [creditNoteIds]);

    const removed: AccountingExternalChange[] = [];
    for (const row of rows) {
      const metadata = parseMetadata(row.metadata) ?? {};
      const creditNoteId = String(metadata.xero_credit_note_id ?? '');
      if (!creditNoteId) {
        continue;
      }
      const allocations = current.get(creditNoteId);
      if (allocations && !allocations.has(row.external_entity_id)) {
        removed.push({
          entityType: 'Payment',
          externalId: row.external_entity_id,
          deleted: true,
          updatedAt: new Date().toISOString()
        });
      }
    }
    return removed;
  }

  async transform(context: AccountingExportAdapterContext): Promise<AccountingExportTransformResult> {
    const tenantId = context.batch.tenant;
    if (!tenantId) {
      throw new AppError('XERO_TENANT_REQUIRED', 'Xero export requires batch tenant identifier');
    }
    const targetRealm = context.batch.target_realm;
    if (!targetRealm) {
      throw new AppError('XERO_REALM_REQUIRED', 'Xero export requires an immutable batch target realm');
    }

    const { knex } = await createTenantKnex();
    const companySyncService = CompanyAccountingSyncService.create({
      mappingRepository: new KnexCompanyMappingRepository(knex),
      adapterFactory: (adapterType) => (adapterType === XeroAdapter.TYPE ? this.companyAdapter : null)
    });
    const resolver = await AccountingMappingResolver.create({ companySyncService });
    const invoiceMappingRepository = new KnexInvoiceMappingRepository(knex);

    const invoicesById = await this.loadInvoices(knex, tenantId, context);
    const chargesById = await this.loadCharges(knex, tenantId, context);
    const clientData = await this.loadClients(knex, tenantId, context, invoicesById);

    const linesByInvoice = groupBy(context.lines, (line) => line.document_id);
    const documents: AccountingExportDocument[] = [];

    for (const [invoiceId, exportLines] of linesByInvoice.entries()) {
      const invoice = invoicesById.get(invoiceId);
      if (!invoice) {
        throw new AppError('XERO_INVOICE_NOT_FOUND', `Invoice ${invoiceId} not found for tenant ${tenantId}`);
      }

      // If this invoice was already exported to Xero, look up the Xero InvoiceID
      // and the per-charge LineItemIDs so we can send them back on this export.
      // Xero upserts invoices by InvoiceNumber; without an InvoiceID on an update
      // it rematches by number and then rejects any LineItemID it doesn't already
      // have in that draft. Threading the known IDs makes the retry idempotent.
      const existingMapping = await invoiceMappingRepository.findInvoiceMapping({
        tenantId,
        adapterType: this.type,
        invoiceId,
        targetRealm
      });

      // Export suppression: a tombstoned (unlinked) mapping must never be
      // re-exported as a brand-new remote document. Unlink is an explicit
      // stop — a later export requires an explicit relink-or-recreate choice.
      if (!existingMapping) {
        const unlinked = await invoiceMappingRepository.findUnlinkedInvoiceMapping({
          tenantId,
          adapterType: this.type,
          invoiceId,
          targetRealm: context.batch.target_realm ?? null
        });
        if (unlinked) {
          throw new AppError(
            'XERO_EXPORT_UNLINKED_DOCUMENT',
            `Invoice ${invoiceId} was unlinked from Xero (external id ${unlinked.externalInvoiceId}). ` +
              'Relink it or explicitly re-create it before exporting — nothing was written to Xero.'
          );
        }
      }
      const storedChargeLineMappings = Array.isArray(
        (existingMapping?.metadata as any)?.chargeLineMappings
      )
        ? ((existingMapping!.metadata as any).chargeLineMappings as Array<{
            chargeId: string;
            xeroLineItemId: string;
          }>)
        : [];
      const knownChargeToXeroLineItemId = new Map<string, string>();
      for (const entry of storedChargeLineMappings) {
        if (entry?.chargeId && entry?.xeroLineItemId) {
          knownChargeToXeroLineItemId.set(entry.chargeId, entry.xeroLineItemId);
        }
      }

      const clientId =
        invoice.client_id ??
        exportLines.find((line) => line.client_id)?.client_id ??
        null;

      if (!clientId) {
        throw new AppError('XERO_CLIENT_MISSING', `Invoice ${invoiceId} is missing client mapping data`);
      }

      const clientRow = clientData.clients.get(clientId);
      if (!clientRow) {
        throw new AppError('XERO_CLIENT_NOT_FOUND', `Client ${clientId} missing for invoice ${invoiceId}`);
      }

      let clientMapping = clientData.mappings.get(clientId);
      if (!clientMapping) {
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
          targetRealm
        });

        if (!mappingResolution) {
          throw new AppError('XERO_CLIENT_MAPPING_MISSING', `Unable to resolve Xero contact for client ${clientId}`);
        }

        clientMapping = mappingFromResolution(
          clientId,
          mappingResolution,
          this.type,
          targetRealm
        );
        clientData.mappings.set(clientId, clientMapping);
      }

      if (!clientMapping) {
        throw new AppError('XERO_CLIENT_MAPPING_MISSING', `No Xero contact mapping for client ${clientId}`);
      }

      const lineItems: XeroInvoiceLinePayload[] = [];
      const chargeIds: string[] = []; // Track charge IDs in same order as lineItems
      let invoiceTotal = 0;
      let detectedLineAmountType: LineAmountType | undefined;

      for (const line of exportLines) {
        if (!line.document_line_id) {
          throw new AppError('XERO_LINE_MISSING_CHARGE', `Export line ${line.line_id} missing invoice_charge_id`);
        }

        const charge = chargesById.get(line.document_line_id);
        if (!charge) {
          throw new AppError('XERO_CHARGE_NOT_FOUND', `Charge ${line.document_line_id} missing for invoice ${invoiceId}`);
        }
        if (!charge.service_id) {
          throw new AppError('XERO_SERVICE_MISSING', `Charge ${charge.item_id} missing service_id for invoice ${invoiceId}`);
        }

        const serviceMapping = await resolver.resolveServiceMapping({
          tenantId: context.batch.tenant,
          adapterType: this.type,
          serviceId: charge.service_id,
          targetRealm: context.batch.target_realm
        });

        if (!serviceMapping) {
          throw new AppError('XERO_SERVICE_MAPPING_MISSING', `No Xero mapping for service ${charge.service_id}`);
        }

        const serviceMetadata = serviceMapping.metadata ?? {};
        const lineResolution = (line.mapping_resolution ?? {}) as Record<string, any>;

        // Handle tax based on delegation mode
        const shouldExcludeTax = context.excludeTaxFromExport || context.taxDelegationMode === 'delegate';

        // Resolve tax mapping - needed for both delegation and non-delegation
        const taxMapping = charge.tax_region
          ? await resolver.resolveTaxCodeMapping({
              tenantId: context.batch.tenant,
              adapterType: this.type,
              taxRegionId: charge.tax_region,
              targetRealm: context.batch.target_realm
            })
          : null;

        let taxType: string | undefined = undefined;
        let taxComponents: XeroTaxComponentPayload[] | undefined = undefined;
        let taxAmountCents: number | null = null;

        // Always resolve tax type (needed so external system knows which tax to apply)
        taxType =
          safeString(lineResolution.taxType) ??
          safeString(taxMapping?.external_entity_id) ??
          safeString(serviceMetadata.taxType);

        if (!shouldExcludeTax) {
          // Include pre-calculated tax amounts and components
          taxComponents = normalizeTaxComponents(
            lineResolution.taxComponents ??
              serviceMetadata.taxComponents ??
              (taxMapping?.metadata ? (taxMapping.metadata as Record<string, any>)?.components : null)
          );

          taxAmountCents = coerceChargeCents(charge.tax_amount);
        }
        // When shouldExcludeTax is true, taxComponents and taxAmountCents remain undefined/null
        // This allows the external system to calculate tax based on the taxType

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

        const description =
          line.notes ??
          charge.description ??
          `Invoice ${invoice.invoice_number ?? invoice.invoice_id} line`;

        const unitAmountCents = coerceChargeCents(charge.unit_price);

        const netAmountCents = coerceChargeCents(charge.net_amount);
        if (netAmountCents === null) {
          throw new AppError(
            'XERO_CHARGE_MISSING_NET_AMOUNT',
            `Charge ${charge.item_id} on invoice ${invoiceId} is missing net_amount; run the backfill migration.`
          );
        }

        const servicePeriod = resolveXeroLineServicePeriod(line);

        // The mapping's target kind is explicit metadata, never inferred from
        // the shape of the stored code: an Item Code and an Account Code can
        // hold identical strings, and guessing would silently change the
        // accounting classification. Legacy mappings without a kind are item
        // mappings — that is the only semantics they ever had.
        const targetKind: XeroServiceTargetKind | null = readXeroServiceTargetKind(
          serviceMapping.metadata ?? null
        );
        if (targetKind === null) {
          throw new AppError(
            'XERO_SERVICE_MAPPING_KIND_INVALID',
            `Service ${charge.service_id} has a Xero mapping with an unrecognised target kind; ` +
              're-save the mapping as a Xero Item or a Xero Revenue Account.'
          );
        }

        let itemCode: string | undefined;
        let accountCode: string | undefined;
        if (targetKind === 'account') {
          // Account-code-only line: AccountCode is sent and ItemCode is
          // omitted ENTIRELY — an empty ItemCode or a display name would be
          // rejected by Xero (support case alga0002321).
          accountCode =
            safeString(lineResolution.accountCode) ??
            safeString(serviceMapping.external_entity_id);
          if (!accountCode) {
            throw new AppError(
              'XERO_ACCOUNT_CODE_MISSING',
              `Service ${charge.service_id} is mapped to a Xero revenue account but no account code is stored.`
            );
          }
        } else {
          itemCode =
            safeString(lineResolution.itemCode) ??
            safeString(serviceMetadata.itemCode) ??
            safeString(serviceMapping.external_entity_id);
          accountCode =
            safeString(lineResolution.accountCode) ?? safeString(serviceMetadata.accountCode);
        }

        const payload: XeroInvoiceLinePayload = {
          lineId: line.line_id,
          externalLineItemId: knownChargeToXeroLineItemId.get(line.document_line_id) ?? null,
          amountCents: netAmountCents,
          description,
          quantity: coerceChargeDecimal(charge.quantity) ?? 1,
          unitAmountCents,
          itemCode,
          accountCode,
          taxType: taxType ?? undefined,
          taxAmountCents,
          taxComponents: taxComponents ?? null,
          tracking: tracking ?? null,
          servicePeriodStart: servicePeriod.servicePeriodStart,
          servicePeriodEnd: servicePeriod.servicePeriodEnd
        };

        // Export evidence: snapshot how this line's service mapping resolved
        // (kind, code, realm) onto the stored line so a failed batch can be
        // diagnosed later without reconstructing mutable mapping state. This
        // is evidence, not an input — transform re-resolves from the current
        // mapping on every run, so a retry after remediation picks up the fix
        // while the refreshed snapshot keeps recording what was actually used.
        await tenantDb(knex, tenantId).table('accounting_export_lines')
          .where({ line_id: line.line_id })
          .update({
            mapping_resolution: JSON.stringify({
              ...lineResolution,
              serviceTarget: {
                kind: targetKind,
                code: targetKind === 'account' ? accountCode : itemCode ?? null,
                realm: targetRealm,
                source: serviceMapping.source
              }
            }),
            updated_at: new Date().toISOString()
          });

        lineItems.push(payload);
        chargeIds.push(line.document_line_id);
        invoiceTotal += netAmountCents;
      }

      if (lineItems.length === 0) {
        logger.warn('[XeroAdapter] skipping invoice with no exportable lines', {
          tenant: tenantId,
          invoiceId
        });
        continue;
      }

      const baseReference = invoice.invoice_number ?? invoiceId;
      const reference = buildXeroInvoiceReference(baseReference, invoice.po_number);

      const invoicePayload: XeroInvoicePayload = {
        invoiceId,
        externalInvoiceId: existingMapping?.externalInvoiceId ?? null,
        contactId: clientMapping.external_entity_id,
        currency: invoice.currency_code ?? exportLines[0]?.currency_code ?? null,
        reference,
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
        chargeIds, // Alga charge IDs in same order as invoice.lines[]
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
    const tenantId = context.batch.tenant;
    if (!tenantId) {
      throw new AppError('XERO_TENANT_REQUIRED', 'Xero export requires batch tenant identifier');
    }
    const targetRealm = context.batch.target_realm;
    if (!targetRealm) {
      throw new AppError('XERO_REALM_REQUIRED', 'Xero export requires an immutable batch target realm');
    }

    const { knex } = await createTenantKnex();
    const client = await XeroClientService.create(tenantId, targetRealm);

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

    // Serialize against invoice void on the shared invoice row lock
    // (invoiceExternalSyncLock.ts). Xero delivers the whole batch in one remote
    // call, so every invoice row is locked FOR UPDATE and confirmed not
    // cancelled BEFORE any remote mutation, and the mapping writes commit with
    // those locks held. A void that already committed cancels its invoice and
    // refuses this batch; a void that starts later queues on the same lock and
    // re-reads the mapping under its own lock once this batch commits.
    return withTransaction(knex, async (trx) => {
      const invoiceIds = Array.from(new Set(documents.map((document) => document.documentId))).sort();
      for (const invoiceId of invoiceIds) {
        await lockInvoiceForExternalSync(trx, tenantId, invoiceId);
      }

      const deliveryResults = await client.createInvoices(payloads);
      if (deliveryResults.length !== documents.length) {
        throw new AppError('XERO_DELIVERY_MISMATCH', 'Xero returned unexpected number of invoices', {
          expected: documents.length,
          actual: deliveryResults.length
        });
      }

      const invoiceMappingRepository = new KnexInvoiceMappingRepository(trx);

      const deliveredLines: { lineId: string; externalDocumentRef: string }[] = [];

      for (let i = 0; i < documents.length; i++) {
        const document = documents[i];
        const result = deliveryResults[i];
        const payload = document.payload as unknown as XeroDocumentPayload;
        const externalRef = result.invoiceId ?? result.documentId;

        if (!externalRef) {
          throw new AppError('XERO_DELIVERY_NO_ID', 'Xero did not return an invoice identifier', {
            documentId: document.documentId
          });
        }

        // Build charge-to-Xero-line mapping from response
        // Xero may return line IDs in the raw response - extract if available
        const rawInvoice = result.raw as Record<string, any> | undefined;
        const xeroLines = rawInvoice?.LineItems ?? [];
        const chargeLineMappings: Array<{ chargeId: string; xeroLineItemId: string }> = [];

        for (let j = 0; j < payload.chargeIds.length && j < xeroLines.length; j++) {
          const xeroLineItemId = xeroLines[j]?.LineItemID;
          if (xeroLineItemId) {
            chargeLineMappings.push({
              chargeId: payload.chargeIds[j],
              xeroLineItemId
            });
          }
        }

        // Store invoice mapping with the authoritative delivery snapshot the
        // drift detector compares against, plus the charge line mappings used
        // for tax import. Older mappings that lack a snapshot are handled
        // explicitly by the drift detector (it adopts the first observed
        // document as the baseline instead of silently ignoring changes).
        const rawTotal = Number(rawInvoice?.Total);
        const exportedTotal = Number.isFinite(rawTotal) ? rawTotal : payload.invoice.amountCents / 100;
        const metadata = {
          last_exported_at: new Date().toISOString(),
          invoiceNumber: result.invoiceNumber ?? rawInvoice?.InvoiceNumber ?? null,
          doc_number: result.invoiceNumber ?? rawInvoice?.InvoiceNumber ?? null,
          sync_token: rawInvoice?.UpdatedDateUTC != null ? String(rawInvoice.UpdatedDateUTC) : null,
          exported_total: exportedTotal,
          external_entity_type: 'Invoice',
          chargeLineMappings // Store mapping for tax import
        };

        await invoiceMappingRepository.upsertInvoiceMapping({
          tenantId,
          adapterType: this.type,
          invoiceId: document.documentId,
          externalInvoiceId: externalRef,
          targetRealm,
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
          deliveredInvoices: documents.length
        }
      };
    });
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
        'client_id',
        'currency_code'
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
        'tax_region'
      )
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

    const clients = await tenantDb(knex, tenantId).table<DbClient>('clients')
      .select('client_id', 'client_name', 'billing_email')
      .whereIn('client_id', Array.from(clientIds));

    const clientMap = new Map(clients.map((client) => [client.client_id, client]));

    const mappingRows = await tenantDb(knex, tenantId).table<MappingRowRaw>('tenant_external_entity_mappings')
      .select('*')
      .where('integration_type', this.type)
      .whereIn('alga_entity_type', ['client'])
      .whereIn('alga_entity_id', Array.from(clientIds))
      .whereNull('deleted_at')
      .modify((qb) => {
        // Realm-exact: a contact mapping from another Xero organisation (or a
        // legacy realm-less row) must not select the contact this batch
        // exports against.
        if (context.batch.target_realm) {
          qb.andWhere('external_realm_id', context.batch.target_realm);
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
   * Fetch invoice data including tax amounts from Xero.
   * Used to import externally calculated tax back into AlgaPSA.
   * Xero provides detailed tax component breakdown per line.
   */
  async fetchExternalInvoice(
    externalInvoiceRef: string,
    targetRealm?: string
  ): Promise<ExternalInvoiceFetchResult> {
    try {
      const { knex, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new AppError('XERO_TENANT_REQUIRED', 'Unable to determine tenant from context');
      }
      const tenantId = tenant;

      if (!targetRealm) {
        return {
          success: false,
          error: 'Xero adapter requires targetRealm to fetch invoices'
        };
      }

      const client = await XeroClientService.create(tenantId, targetRealm);
      const xeroInvoice = await client.getInvoice(externalInvoiceRef);

      if (!xeroInvoice) {
        return {
          success: false,
          error: `Invoice ${externalInvoiceRef} not found in Xero`
        };
      }

      // Look up charge-to-line mapping from invoice metadata
      // This was stored during export to enable robust matching
      const mappingRow = await tenantDb(knex, tenantId).table<MappingRowRaw>('tenant_external_entity_mappings')
        .where({
          integration_type: this.type,
          alga_entity_type: 'invoice',
          external_entity_id: externalInvoiceRef,
          external_realm_id: targetRealm
        })
        .first();

      const chargeLineMappings: Array<{ chargeId: string; xeroLineItemId: string }> =
        (mappingRow?.metadata as any)?.chargeLineMappings ?? [];

      // Build reverse map: Xero lineItemId -> Alga charge ID
      const xeroLineToChargeId = new Map<string, string>();
      for (const mapping of chargeLineMappings) {
        xeroLineToChargeId.set(mapping.xeroLineItemId, mapping.chargeId);
      }

      // Map Xero line items to external invoice charges with full tax component details
      const charges: ExternalInvoiceChargeTax[] = xeroInvoice.lineItems.map((line, index) => {
        // Calculate effective tax rate from the line if available
        const effectiveRate = line.lineAmount > 0
          ? (line.taxAmount / line.lineAmount) * 100
          : undefined;

        // Map Xero tax components to our format
        const taxComponents = line.taxComponents?.map(component => ({
          name: component.name,
          rate: component.rate,
          amount: component.amount
        }));

        // Use stored charge ID if available, otherwise fall back to Xero lineItemId or positional index
        const xeroLineItemId = line.lineItemId;
        const chargeId = xeroLineItemId ? xeroLineToChargeId.get(xeroLineItemId) : undefined;
        const lineId = chargeId ?? xeroLineItemId ?? `line-${index}`;

        return {
          lineId,
          externalLineId: xeroLineItemId,
          taxAmount: line.taxAmount,
          taxCode: line.taxType,
          taxRate: effectiveRate,
          taxComponents
        };
      });

      const externalInvoice: ExternalInvoiceData = {
        externalInvoiceId: xeroInvoice.invoiceId,
        externalInvoiceRef: xeroInvoice.invoiceNumber ?? xeroInvoice.reference,
        status: xeroInvoice.status ?? 'synced',
        totalTax: xeroInvoice.totalTax,
        totalAmount: xeroInvoice.total,
        currency: xeroInvoice.currencyCode,
        charges,
        metadata: {
          lineAmountTypes: xeroInvoice.lineAmountTypes,
          subTotal: xeroInvoice.subTotal,
          reference: xeroInvoice.reference
        }
      };

      logger.info('[XeroAdapter] successfully fetched invoice with tax details', {
        invoiceId: externalInvoiceRef,
        totalTax: xeroInvoice.totalTax,
        lineCount: charges.length,
        hasComponentBreakdown: charges.some(c => c.taxComponents && c.taxComponents.length > 0)
      });

      return {
        success: true,
        invoice: externalInvoice
      };
    } catch (error: any) {
      logger.error('[XeroAdapter] failed to fetch external invoice', {
        externalInvoiceRef,
        targetRealm,
        error: error.message
      });
      return {
        success: false,
        error: error.message ?? 'Failed to fetch invoice from Xero'
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

    logger.info('[XeroAdapter] created pending tax import records', {
      count: pendingRecords.length,
      batchId: context.batch.batch_id
    });

    return pendingRecords;
  }

  /**
   * Helper to get tenant ID from knex context
   */
  private async getTenantFromContext(knex: Knex): Promise<string> {
    const result = await knex.raw('SELECT current_setting(\'app.current_tenant\', true) as tenant');
    const tenant = result.rows?.[0]?.tenant;
    if (!tenant) {
      throw new AppError('XERO_TENANT_REQUIRED', 'Unable to determine tenant from context');
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
    return line?.document_id;
  }
}

function safeString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  return undefined;
}

function xeroSyncToken(record: Record<string, any> | undefined): string | undefined {
  return record?.UpdatedDateUTC != null ? String(record.UpdatedDateUTC) : undefined;
}

/**
 * Normalize the date shapes Xero returns. Wrapped dates
 * (`/Date(1700000000000+0000)/`) are common in older responses; a naive
 * `new Date(value)` yields Invalid Date and downstream writes would silently
 * fall back to "now".
 */
function xeroDateToIso(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === 'string') {
    const match = /^\/Date\((-?\d+)([+-]\d{4})?\)\/$/.exec(value.trim());
    if (match) {
      const ms = Number(match[1]);
      return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

function xeroStatusIsDeleted(status: unknown): boolean {
  return (
    typeof status === 'string' &&
    (status.toUpperCase() === 'DELETED' || status.toUpperCase() === 'VOIDED')
  );
}

function normalizeXeroInvoice(record: Record<string, any>): AccountingExternalChange | null {
  const externalId = record?.InvoiceID != null ? String(record.InvoiceID) : null;
  if (!externalId) {
    return null;
  }
  const status = record?.Status;
  const total = Number(record?.Total);
  const normalized: NormalizedExternalDocumentPayload = {
    totalAmount: Number.isFinite(total) ? total : null,
    docNumber: record?.InvoiceNumber != null ? String(record.InvoiceNumber) : null,
    isVoided: xeroStatusIsDeleted(status),
    providerMetadata: {
      xero_status: status ?? null,
      xero_type: record?.Type ?? null,
      xero_reference: record?.Reference ?? null
    }
  };
  return {
    entityType: 'Invoice',
    externalId,
    syncToken: xeroSyncToken(record),
    deleted: typeof status === 'string' && status.toUpperCase() === 'DELETED',
    updatedAt: xeroDateToIso(record?.UpdatedDateUTC) ?? undefined,
    payload: record,
    normalized
  };
}

function normalizeXeroCreditNote(record: Record<string, any>): AccountingExternalChange | null {
  const externalId = record?.CreditNoteID != null ? String(record.CreditNoteID) : null;
  if (!externalId) {
    return null;
  }
  const status = record?.Status;
  const total = Number(record?.Total);
  const normalized: NormalizedExternalDocumentPayload = {
    totalAmount: Number.isFinite(total) ? total : null,
    docNumber: record?.CreditNoteNumber != null ? String(record.CreditNoteNumber) : null,
    isVoided: xeroStatusIsDeleted(status),
    providerMetadata: { xero_status: status ?? null, xero_type: record?.Type ?? null }
  };
  return {
    entityType: 'CreditMemo',
    externalId,
    syncToken: xeroSyncToken(record),
    deleted: typeof status === 'string' && status.toUpperCase() === 'DELETED',
    updatedAt: xeroDateToIso(record?.UpdatedDateUTC) ?? undefined,
    payload: record,
    normalized
  };
}

function normalizeXeroPayment(record: Record<string, any>): AccountingExternalChange | null {
  const externalId = record?.PaymentID != null ? String(record.PaymentID) : null;
  if (!externalId) {
    return null;
  }
  const amountCents = Math.round(Number(record?.Amount) * 100);
  const allocations: NormalizedExternalPaymentPayload['allocations'] = [];
  const invoiceId = record?.Invoice?.InvoiceID;
  if (invoiceId && Number.isFinite(amountCents) && amountCents > 0) {
    allocations.push({ externalInvoiceId: String(invoiceId), amountCents });
  }
  const isCreditApplication = Boolean(record?.CreditNote?.CreditNoteID);
  const reference =
    typeof record?.Reference === 'string' && record.Reference.trim().length > 0
      ? record.Reference.trim()
      : externalId;

  const normalized: NormalizedExternalPaymentPayload = {
    reference,
    txnDate: xeroDateToIso(record?.Date) ?? undefined,
    totalCents: Number.isFinite(amountCents) ? amountCents : undefined,
    allocations,
    isCreditApplication,
    providerMetadata: {
      xero_status: record?.Status ?? null,
      xero_payment_type: isCreditApplication ? 'credit_application' : 'payment'
    }
  };

  return {
    entityType: 'Payment',
    externalId,
    syncToken: xeroSyncToken(record),
    deleted: typeof record?.Status === 'string' && record.Status.toUpperCase() === 'DELETED',
    updatedAt: xeroDateToIso(record?.UpdatedDateUTC) ?? undefined,
    payload: record,
    normalized
  };
}

interface NormalizedXeroAllocation {
  allocationId: string | null;
  invoiceId: string;
  amountCents: number;
  date: string | null;
}

function makeCreditAllocationChange(
  record: Record<string, any>,
  externalId: string,
  allocation: { invoiceId: string; amountCents: number; date: string | null },
  providerMetadata: Record<string, unknown>
): AccountingExternalChange {
  const normalized: NormalizedExternalPaymentPayload = {
    reference: `Xero credit note ${record?.CreditNoteNumber ?? record?.CreditNoteID ?? ''}`,
    txnDate: allocation.date ?? undefined,
    totalCents: allocation.amountCents,
    allocations: [{ externalInvoiceId: allocation.invoiceId, amountCents: allocation.amountCents }],
    isCreditApplication: true,
    providerMetadata
  };
  return {
    entityType: 'Payment',
    externalId,
    syncToken: `${xeroSyncToken(record) ?? ''}:${allocation.amountCents}`,
    deleted: false,
    updatedAt: xeroDateToIso(record?.UpdatedDateUTC) ?? undefined,
    payload: record,
    normalized
  };
}

/**
 * Synthesize the payment changes that carry a credit note's current
 * allocations into the shared applier.
 *
 * Identity: when every allocation has an AllocationID, one change is emitted
 * per allocation (`creditnote:<noteId>:alloc:<allocationId>`). Two allocations
 * to the same invoice therefore stay distinct instead of collapsing (equal
 * amounts skipped, differing amounts replacing one another). When Xero omits
 * AllocationID, allocations are explicitly aggregated per invoice
 * (`creditnote:<noteId>:inv:<invoiceId>`, summed amount). The stable ids are
 * what let the applier replay, reverse, and reconcile removals correctly; a
 * scheme change across polls surfaces as a removal + fresh application.
 */
function normalizeXeroCreditAllocations(record: Record<string, any>): AccountingExternalChange[] {
  const creditNoteId = record?.CreditNoteID != null ? String(record.CreditNoteID) : null;
  if (!creditNoteId || xeroStatusIsDeleted(record?.Status)) {
    return [];
  }

  const rawAllocations = Array.isArray(record?.Allocations) ? record.Allocations : [];
  const allocations: NormalizedXeroAllocation[] = [];
  for (const allocation of rawAllocations) {
    const invoiceId = allocation?.Invoice?.InvoiceID;
    const amountCents = Math.round(Number(allocation?.Amount) * 100);
    if (!invoiceId || !Number.isFinite(amountCents) || amountCents <= 0) {
      continue;
    }
    allocations.push({
      allocationId: typeof allocation?.AllocationID === 'string' ? allocation.AllocationID : null,
      invoiceId: String(invoiceId),
      amountCents,
      date: xeroDateToIso(allocation?.Date)
    });
  }

  if (allocations.length === 0) {
    return [];
  }

  const allHaveIds = allocations.every((allocation) => Boolean(allocation.allocationId));
  if (allHaveIds) {
    return allocations.map((allocation) =>
      makeCreditAllocationChange(
        record,
        `creditnote:${creditNoteId}:alloc:${allocation.allocationId}`,
        allocation,
        {
          xero_credit_note_id: creditNoteId,
          xero_allocation_id: allocation.allocationId,
          xero_allocation_invoice_id: allocation.invoiceId
        }
      )
    );
  }

  const byInvoice = new Map<string, { amountCents: number; date: string | null }>();
  for (const allocation of allocations) {
    const existing = byInvoice.get(allocation.invoiceId);
    if (existing) {
      existing.amountCents += allocation.amountCents;
      if (!existing.date) {
        existing.date = allocation.date;
      }
    } else {
      byInvoice.set(allocation.invoiceId, { amountCents: allocation.amountCents, date: allocation.date });
    }
  }

  return Array.from(byInvoice.entries()).map(([invoiceId, aggregate]) =>
    makeCreditAllocationChange(
      record,
      `creditnote:${creditNoteId}:inv:${invoiceId}`,
      { invoiceId, amountCents: aggregate.amountCents, date: aggregate.date },
      {
        xero_credit_note_id: creditNoteId,
        xero_allocation_invoice_id: invoiceId,
        xero_allocations_aggregated: true
      }
    )
  );
}

function coerceChargeCents(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    const parsed = parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function coerceChargeDecimal(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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
  // When we delegate tax calculation to Xero we still send a TaxType per line so
  // Xero knows which rate to apply. Those TaxType codes are only valid on
  // Exclusive/Inclusive invoices — on a NoTax invoice Xero overrides TaxType to
  // NONE and charges no tax, which silently breaks writeback.
  if (lines.some((line) => Boolean(line.taxType))) {
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
