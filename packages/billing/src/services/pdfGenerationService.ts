import { v4 as uuidv4 } from 'uuid';
import type { Page } from 'puppeteer';
import type { Knex } from 'knex';

import { createTenantKnex, runWithTenant, tenantDb, withTransaction } from '@alga-psa/db';
import type { DocumentAssociationEntityType, TemplateAst } from '@alga-psa/types';
import type { FileStore } from '@alga-psa/storage/types/storage';
import { StorageProviderFactory, generateStoragePath, FileStoreModel } from '@alga-psa/storage';
import { convertBlockContentToHTML } from '@alga-psa/formatting/blocknoteUtils';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { buildDocumentGeneratedPayload } from '@alga-psa/workflow-streams';
import { Document as DocumentModel, DocumentAssociation } from '@alga-psa/documents/models';
import {
  getTenantDefaultLocale,
  getUserInfoForEmail,
  resolveEmailLocale,
} from '@alga-psa/notifications/notifications/emailLocaleResolver';

import { mapDbInvoiceToWasmViewModel } from '../lib/adapters/invoiceAdapters';
import { enrichInvoiceViewModelWithLocations } from '../lib/adapters/invoiceAdapters.server';
import { mapDbQuoteToViewModel } from '../lib/adapters/quoteAdapters';
import { mapDbSalesOrderToViewModel } from '../lib/adapters/salesOrderAdapters';
import { fetchTenantParty } from '../lib/adapters/tenantPartyAdapter';
import { evaluateTemplateAst } from '../lib/invoice-template-ast/evaluator';
import { INVOICE_TEMPLATE_BINDING_ALIASES } from '../lib/invoice-template-ast/bindingAliases';
import { resolvePdfPrintOptionsFromAst } from '../lib/invoice-template-ast/printSettings';
import { renderEvaluatedTemplateAst } from '../lib/invoice-template-ast/react-renderer';
import { renderTemplateAstHtmlDocument } from '../lib/invoice-template-ast/server-render';
import {
  autoSelectStandardInvoiceTemplateCode,
  getStandardTemplateAstByCode,
  STANDARD_INVOICE_BY_LOCATION_CODE,
} from '../lib/invoice-template-ast/standardTemplates';
import Invoice from '../models/invoice';
import { getStandardQuoteTemplateAstByCode } from '../lib/quote-template-ast/standardTemplates';
import { resolveQuoteTemplateAst } from '../lib/quote-template-ast/templateSelection';
import { getStandardSalesOrderTemplateAstByCode } from '../lib/sales-order-template-ast/standardTemplates';
import { resolveSalesOrderTemplateAst } from '../lib/sales-order-template-ast/templateSelection';
import { browserPoolService } from './browserPoolService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SalesOrderDocumentKind = 'sales-order' | 'packing-slip' | 'pick-list';

interface PDFGenerationOptions {
  invoiceId?: string;
  quoteId?: string;
  salesOrderId?: string;
  salesOrderDocumentType?: SalesOrderDocumentKind;
  documentId?: string;
  invoiceNumber?: string;
  quoteNumber?: string;
  salesOrderNumber?: string;
  version?: number;
  cacheKey?: string;
  userId: string;
  /** Force a fresh render even when a stored document already exists. */
  regenerate?: boolean;
}

/** The stored file, plus the `documents` row it was filed as (absent for the export branch). */
export type StoredPdfResult = FileStore & { document_id?: string };

/** Where a generated PDF is filed, and what it is filed against. */
interface FilingTarget {
  sourceType: Extract<DocumentAssociationEntityType, 'invoice' | 'quote' | 'sales_order'>;
  entityId: string;
  clientId: string | null;
  folderPath: string;
  isClientVisible: boolean;
  documentName: string;
  /** Base name for the stored file — preserved from the pre-filing behaviour. */
  fileBaseName: string;
  reuseExisting: boolean;
}

interface RenderedPdf {
  buffer: Buffer;
  templateId: string | null;
  templateVersion: number | null;
}

const SALES_ORDER_DOCUMENT_PREFIX: Record<SalesOrderDocumentKind, string> = {
  'sales-order': 'SalesOrder',
  'packing-slip': 'PackingSlip',
  'pick-list': 'PickList',
};

export interface QuotePDFOptions {
  quoteId: string;
  templateCode?: string;
  templateAst?: TemplateAst;
}

export interface SalesOrderPDFOptions {
  salesOrderId: string;
  /** Which Sales Order document to render — confirmation (default), packing slip, or pick list. */
  documentType?: SalesOrderDocumentKind;
  templateCode?: string;
  templateAst?: TemplateAst;
}

const DEFAULT_DOCUMENT_PDF_OPTIONS = {
  format: 'A4',
  printBackground: true,
  margin: {
    top: '10mm',
    right: '10mm',
    bottom: '10mm',
    left: '10mm',
  },
} as const;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class PDFGenerationService {
  constructor(private readonly tenant: string) {
    if (!tenant) {
      throw new Error('Tenant is required for PDF generation');
    }
  }

  // ---- Generic entry points ------------------------------------------------

  async generatePDF(options: { invoiceId?: string; quoteId?: string; salesOrderId?: string; salesOrderDocumentType?: SalesOrderDocumentKind; documentId?: string; userId: string; templateAst?: TemplateAst; templateId?: string }): Promise<Buffer> {
    return (await this.renderPdf(options)).buffer;
  }

  private async renderPdf(options: { invoiceId?: string; quoteId?: string; salesOrderId?: string; salesOrderDocumentType?: SalesOrderDocumentKind; documentId?: string; userId: string; templateAst?: TemplateAst; templateId?: string }): Promise<RenderedPdf> {
    let htmlContent: string;
    let templateAst: TemplateAst | null = null;
    let templateId: string | null = null;
    let templateVersion: number | null = null;

    if (options.invoiceId) {
      const result = await this.getInvoiceHtml(options.invoiceId, options.templateId);
      htmlContent = result.htmlContent;
      templateAst = result.templateAst;
      templateId = result.templateId;
      templateVersion = result.templateVersion;
    } else if (options.quoteId) {
      const result = await this.getQuoteHtml({ quoteId: options.quoteId, templateAst: options.templateAst });
      htmlContent = result.htmlContent;
      templateAst = result.templateAst;
      templateId = result.templateId;
      templateVersion = result.templateVersion;
    } else if (options.salesOrderId) {
      const result = await this.getSalesOrderHtml({ salesOrderId: options.salesOrderId, documentType: options.salesOrderDocumentType, templateAst: options.templateAst });
      htmlContent = result.htmlContent;
      templateAst = result.templateAst;
      templateId = result.templateId;
      templateVersion = result.templateVersion;
    } else if (options.documentId) {
      htmlContent = await this.getDocumentHtml(options.documentId);
    } else {
      throw new Error('One of invoiceId, quoteId, salesOrderId, or documentId must be provided');
    }

    return {
      buffer: await this.generatePDFBuffer(htmlContent, templateAst),
      templateId,
      templateVersion,
    };
  }

  /**
   * Render (or reuse) a PDF, store the bytes, and file the result as a `documents`
   * row associated with its source entity and client. Invoice and sales-order
   * documents are reused when one is already on file: `generateAndStore` is called
   * from download paths too, and re-rendering there both drifts from the artifact
   * that was sent and grows storage on every click. Pass `regenerate` for a
   * deliberate new render.
   */
  async generateAndStore(options: PDFGenerationOptions): Promise<StoredPdfResult> {
    return runWithTenant(this.tenant, async () => {
      const { knex } = await createTenantKnex();
      const target = await this.resolveFilingTarget(knex, options);

      let fileName: string;
      let sourceType: string;
      let sourceId: string;
      const reuse = Boolean(target?.reuseExisting) && !options.regenerate;

      if (target) {
        fileName = target.fileBaseName;
        sourceType = target.sourceType;
        sourceId = target.entityId;

        if (reuse) {
          const reused = await this.findStoredPdf(knex, target);
          if (reused) {
            return reused;
          }
        }
      } else {
        const document = await this.getDocumentRecord(options.documentId!);
        if (!document) {
          throw new Error(`Document ${options.documentId} not found.`);
        }
        fileName = document.document_name || options.documentId!;
        sourceType = 'document';
        sourceId = options.documentId!;
      }

      const rendered = await this.renderPdf({
        invoiceId: options.invoiceId,
        quoteId: options.quoteId,
        salesOrderId: options.salesOrderId,
        salesOrderDocumentType: options.salesOrderDocumentType,
        documentId: options.documentId,
        userId: options.userId,
      });

      const fileId = uuidv4();
      const storagePath = generateStoragePath(this.tenant, 'pdfs', `${fileName}.pdf`);

      const provider = await StorageProviderFactory.createProvider();
      const uploadResult = await provider.upload(Buffer.from(rendered.buffer), storagePath, {
        mime_type: 'application/pdf',
      });

      const fileRecord = await FileStoreModel.create(knex, {
        fileId,
        file_name: storagePath.split('/').pop()!,
        original_name: `${fileName}.pdf`,
        mime_type: 'application/pdf',
        file_size: rendered.buffer.length,
        storage_path: uploadResult.path,
        uploaded_by_id: options.userId,
      });

      let documentId = target ? undefined : options.documentId;
      let result: StoredPdfResult = { ...fileRecord };

      if (target) {
        const filed = await this.fileGeneratedDocument(knex, target, fileRecord, rendered, options.userId, reuse);
        documentId = filed.document_id;
        // Lost a filing race: an equivalent document already existed, so return it
        // rather than handing back a second copy of the same artifact.
        result = filed.reusedFile ?? { ...fileRecord, document_id: filed.document_id };
      }

      try {
        await publishWorkflowEvent({
          eventType: 'DOCUMENT_GENERATED',
          ctx: {
            tenantId: this.tenant,
            actor: { actorType: 'USER', actorUserId: options.userId },
          },
          payload: buildDocumentGeneratedPayload({
            documentId: documentId!,
            sourceType,
            sourceId,
            generatedByUserId: options.userId,
            generatedAt: new Date().toISOString(),
            fileName: `${fileName}.pdf`,
          }),
        });
      } catch {
        // Non-blocking
      }

      return result;
    });
  }

  // ---- Filing --------------------------------------------------------------

  private async resolveFilingTarget(
    knex: Knex,
    options: PDFGenerationOptions
  ): Promise<FilingTarget | null> {
    if (options.invoiceId) {
      const invoice = await tenantDb(knex, this.tenant).table('invoices')
        .where({ invoice_id: options.invoiceId })
        .first<{ invoice_number?: string | null; client_id?: string | null } | undefined>(
          'invoice_number',
          'client_id'
        );
      const invoiceNumber = options.invoiceNumber || invoice?.invoice_number || options.invoiceId;

      return {
        sourceType: 'invoice',
        entityId: options.invoiceId,
        clientId: invoice?.client_id ?? null,
        folderPath: '/Clients/Invoices',
        // Explicit, never inherited from the folder default: an invoice document
        // becomes client-visible when the invoice is sent, not when it is generated.
        isClientVisible: false,
        documentName: `Invoice_${invoiceNumber}.pdf`,
        fileBaseName: options.invoiceNumber || options.invoiceId,
        reuseExisting: true,
      };
    }

    if (options.salesOrderId) {
      const salesOrder = await tenantDb(knex, this.tenant).table('sales_orders')
        .where({ so_id: options.salesOrderId })
        .first<{ so_number?: string | null; client_id?: string | null } | undefined>('so_number', 'client_id');
      const soNumber = options.salesOrderNumber || salesOrder?.so_number || options.salesOrderId;
      const documentType = options.salesOrderDocumentType ?? 'sales-order';

      return {
        sourceType: 'sales_order',
        entityId: options.salesOrderId,
        clientId: salesOrder?.client_id ?? null,
        folderPath: '/Clients/Sales Orders',
        isClientVisible: false,
        documentName: `${SALES_ORDER_DOCUMENT_PREFIX[documentType]}_${soNumber}.pdf`,
        fileBaseName: options.salesOrderNumber || salesOrder?.so_number || options.salesOrderId,
        reuseExisting: true,
      };
    }

    if (options.quoteId) {
      const quoteNumber = options.quoteNumber || options.quoteId;
      return {
        sourceType: 'quote',
        entityId: options.quoteId,
        // Quotes keep their pre-existing filing exactly: quote association only.
        clientId: null,
        folderPath: '/Quotes/Generated',
        isClientVisible: true,
        documentName: `Quote_${quoteNumber}.pdf`,
        fileBaseName: quoteNumber,
        // A quote is re-rendered on every send, and each send is its own artifact.
        reuseExisting: false,
      };
    }

    if (options.documentId) {
      return null;
    }

    throw new Error('One of invoiceId, quoteId, salesOrderId, or documentId must be provided');
  }

  /** The most recently filed PDF for this target, or null when none exists. */
  private async findStoredPdf(
    knexOrTrx: Knex | Knex.Transaction,
    target: FilingTarget
  ): Promise<StoredPdfResult | null> {
    const db = tenantDb(knexOrTrx, this.tenant);
    const query = db.table('document_associations as da')
      .where({
        'da.entity_id': target.entityId,
        'da.entity_type': target.sourceType,
      })
      .andWhere('d.document_name', target.documentName)
      .whereNotNull('d.file_id')
      .orderBy('da.created_at', 'desc')
      .select('d.document_id', 'd.file_id')
      .first<{ document_id: string; file_id: string } | undefined>();
    db.tenantJoin(query, 'documents as d', 'da.document_id', 'd.document_id');

    const existing = await query;
    if (!existing?.file_id) {
      return null;
    }

    const fileRecord = await FileStoreModel.findById(knexOrTrx, existing.file_id);
    return fileRecord ? { ...fileRecord, document_id: existing.document_id } : null;
  }

  private async fileGeneratedDocument(
    knex: Knex,
    target: FilingTarget,
    fileRecord: FileStore,
    rendered: RenderedPdf,
    userId: string,
    reuse: boolean
  ): Promise<{ document_id: string; reusedFile: StoredPdfResult | null }> {
    const renderedLocale = await this.resolveRenderedLocale(knex, target.clientId);

    return withTransaction(knex, async (trx: Knex.Transaction) => {
      if (reuse) {
        // Serialize filing per source entity so two concurrent generations do not
        // both file the same artifact.
        await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?), hashtext(?))', [
          'alga:generated-document-filing',
          `${this.tenant}:${target.sourceType}:${target.entityId}:${target.documentName}`,
        ]);

        const raced = await this.findStoredPdf(trx, target);
        if (raced?.document_id) {
          return { document_id: raced.document_id, reusedFile: raced };
        }
      }

      const documentId = uuidv4();
      await DocumentModel.insert(trx, {
        document_id: documentId,
        document_name: target.documentName,
        type_id: null,
        user_id: userId,
        created_by: userId,
        order_number: 0,
        tenant: this.tenant,
        file_id: fileRecord.file_id,
        storage_path: fileRecord.storage_path,
        mime_type: 'application/pdf',
        file_size: fileRecord.file_size,
        folder_path: target.folderPath,
        is_client_visible: target.isClientVisible,
        source_template_id: rendered.templateId,
        source_template_version: rendered.templateVersion,
        rendered_locale: renderedLocale,
      });

      await DocumentAssociation.create(trx, {
        document_id: documentId,
        entity_id: target.entityId,
        entity_type: target.sourceType,
        tenant: this.tenant,
      });

      if (target.clientId) {
        await DocumentAssociation.create(trx, {
          document_id: documentId,
          entity_id: target.clientId,
          entity_type: 'client',
          tenant: this.tenant,
        });
      }

      return { document_id: documentId, reusedFile: null };
    });
  }

  /**
   * The locale this document was issued in: the billing contact's, else the
   * client's, else the tenant's. Recorded now so that when template labels become
   * translatable every stored document already answers "what language was this?".
   */
  private async resolveRenderedLocale(knex: Knex, clientId: string | null): Promise<string | null> {
    try {
      if (!clientId) {
        return await getTenantDefaultLocale(this.tenant, 'client');
      }

      const client = await tenantDb(knex, this.tenant).table('clients')
        .where({ client_id: clientId })
        .first<{ billing_contact_id?: string | null; billing_email?: string | null } | undefined>(
          'billing_contact_id',
          'billing_email'
        );

      let email = client?.billing_email ?? null;
      if (client?.billing_contact_id) {
        const contact = await tenantDb(knex, this.tenant).table('contacts')
          .where({ contact_name_id: client.billing_contact_id })
          .first<{ email?: string | null } | undefined>('email');
        email = contact?.email ?? email;
      }

      const recipient = email ? await getUserInfoForEmail(this.tenant, email) : null;
      return await resolveEmailLocale(this.tenant, {
        email: email ?? '',
        userId: recipient?.userId,
        userType: 'client',
        clientId,
      });
    } catch {
      return null;
    }
  }

  // ---- Preview entry points -------------------------------------------------

  async renderInvoicePreview(options: {
    invoiceId: string;
    templateId?: string;
    templateAst?: TemplateAst;
  }): Promise<{ html: string; css: string; templateAst: TemplateAst | null }> {
    return runWithTenant(this.tenant, async () => {
      const { knex } = await createTenantKnex();

      const dbInvoiceData = await this.getInvoiceForRendering(knex, options.invoiceId);
      if (!dbInvoiceData) {
        throw new Error(`Invoice ${options.invoiceId} not found`);
      }

      let templateAst: TemplateAst | null = options.templateAst ?? null;

      if (!templateAst) {
        const templateId = options.templateId ?? await this.resolveInvoiceTemplateId(knex, dbInvoiceData);
        if (!templateId) {
          throw new Error('No invoice templates available');
        }
        const templates = await this.getInvoiceTemplates(knex);
        const selected = templates.find((t: any) => t.template_id === templateId);
        templateAst = (selected?.templateAst ?? null) as TemplateAst | null;
        if (!templateAst) {
          const canonical = await this.getInvoiceTemplate(knex, templateId);
          templateAst = (canonical?.templateAst ?? null) as TemplateAst | null;
        }
      }

      if (!templateAst) {
        throw new Error('No invoice template AST available');
      }

      const enrichedData = await this.enrichWithTenantClient(knex, dbInvoiceData);
      const invoiceViewModel = mapDbInvoiceToWasmViewModel(enrichedData);
      if (!invoiceViewModel) {
        throw new Error(`Failed to map invoice ${options.invoiceId} to view model`);
      }

      const evaluation = evaluateTemplateAst(
        templateAst,
        invoiceViewModel as unknown as Record<string, unknown>,
        { bindingAliases: INVOICE_TEMPLATE_BINDING_ALIASES }
      );
      const rendered = await renderEvaluatedTemplateAst(templateAst, evaluation);
      return { html: rendered.html, css: rendered.css, templateAst };
    });
  }

  // ---- Quote-specific entry points -----------------------------------------

  async renderQuotePreview(options: QuotePDFOptions): Promise<{ html: string; css: string; templateAst: TemplateAst | null }> {
    return runWithTenant(this.tenant, async () => {
      const { knex } = await createTenantKnex();
      const quoteViewModel = await mapDbQuoteToViewModel(knex, this.tenant, options.quoteId);

      if (!quoteViewModel) {
        throw new Error(`Quote ${options.quoteId} not found`);
      }

      const templateAst = options.templateAst
        ?? (options.templateCode
          ? getStandardQuoteTemplateAstByCode(options.templateCode)
          : (await resolveQuoteTemplateAst(knex, this.tenant, options.quoteId)).templateAst);

      if (!templateAst) {
        throw new Error('No quote template AST available');
      }

      const evaluation = evaluateTemplateAst(
        templateAst,
        quoteViewModel as unknown as Record<string, unknown>
      );
      const rendered = await renderEvaluatedTemplateAst(templateAst, evaluation);
      return { html: rendered.html, css: rendered.css, templateAst };
    });
  }

  // ---- Invoice HTML --------------------------------------------------------

  private async resolveInvoiceTemplateId(knex: Knex | Knex.Transaction, dbInvoiceData: any): Promise<string | null> {
    let templateId: string | null = null;

    try {
      const client = await tenantDb(knex, this.tenant).table('clients')
        .where({ client_id: dbInvoiceData.client_id })
        .first();
      if (client?.invoice_template_id) {
        templateId = client.invoice_template_id;
      }
    } catch {
      // Fall back to default template selection
    }

    if (!templateId) {
      const templates = await this.getInvoiceTemplates(knex);
      const defaultTemplate = templates.find((t: any) => t.is_default || t.isTenantDefault) ?? templates[0];
      templateId = defaultTemplate?.template_id ?? null;
    }

    return templateId;
  }

  private async getInvoiceHtml(
    invoiceId: string,
    overrideTemplateId?: string
  ): Promise<{ htmlContent: string; templateAst: TemplateAst | null; templateId: string | null; templateVersion: number | null }> {
    return runWithTenant(this.tenant, async () => {
      const { knex } = await createTenantKnex();
      const [dbInvoiceData, templates] = await Promise.all([
        this.getInvoiceForRendering(knex, invoiceId),
        this.getInvoiceTemplates(knex),
      ]);

      if (!dbInvoiceData) {
        throw new Error(`Invoice ${invoiceId} not found`);
      }

      const templateId = overrideTemplateId || await this.resolveInvoiceTemplateId(knex, dbInvoiceData);

      if (!templateId) {
        throw new Error('No invoice templates available for PDF generation');
      }

      const selectedTemplate = templates.find((entry: any) => entry.template_id === templateId) ?? null;
      let templateAst = (selectedTemplate?.templateAst ?? null) as TemplateAst | null;
      if (!templateAst && templateId) {
        const canonicalTemplate = await this.getInvoiceTemplate(knex, templateId);
        templateAst = (canonicalTemplate?.templateAst ?? null) as TemplateAst | null;
      }

      let renderedTemplateId: string | null = templateId ?? null;
      let renderedTemplateVersion: number | null = selectedTemplate?.version ?? null;

      if (!templateAst) {
        throw new Error(`Template ${templateId} does not have a templateAst payload.`);
      }

      const enrichedData = await this.enrichWithTenantClient(knex, dbInvoiceData);
      const invoiceViewModel = mapDbInvoiceToWasmViewModel(enrichedData);

      if (!invoiceViewModel) {
        throw new Error(`Failed to map invoice ${invoiceId} to view model`);
      }

      await enrichInvoiceViewModelWithLocations(knex, this.tenant, invoiceViewModel, invoiceId);

      // Standard-fallback auto-branch: when no custom template was picked and
      // the invoice spans ≥2 distinct locations, swap in the by-location
      // standard template. Custom tenant templates are deliberately not
      // auto-swapped — they only pick up the new binding if authors opt in.
      if (
        selectedTemplate?.isStandard &&
        !overrideTemplateId &&
        invoiceViewModel.hasMultipleLocations
      ) {
        const fallbackCode = autoSelectStandardInvoiceTemplateCode({
          hasMultipleLocations: true,
        });
        if (fallbackCode === STANDARD_INVOICE_BY_LOCATION_CODE) {
          const fallbackAst = getStandardTemplateAstByCode(fallbackCode);
          if (fallbackAst) {
            templateAst = fallbackAst;
            renderedTemplateId = fallbackCode;
            renderedTemplateVersion = null;
          }
        }
      }

      const evaluation = evaluateTemplateAst(
        templateAst,
        invoiceViewModel as unknown as Record<string, unknown>,
        { bindingAliases: INVOICE_TEMPLATE_BINDING_ALIASES }
      );

      const htmlContent = await renderTemplateAstHtmlDocument(templateAst, evaluation, {
        title: 'Invoice',
        knex,
      });

      return {
        htmlContent,
        templateAst,
        templateId: renderedTemplateId,
        templateVersion: renderedTemplateVersion,
      };
    });
  }

  private async enrichWithTenantClient(
    knex: Knex | Knex.Transaction,
    dbData: any,
  ): Promise<any> {
    try {
      const tenantParty = await fetchTenantParty(knex, this.tenant);
      if (!tenantParty) return dbData;

      return {
        ...dbData,
        tenantClient: {
          name: tenantParty.name,
          address: tenantParty.address,
          logoUrl: tenantParty.logo_url,
        },
      };
    } catch {
      return dbData;
    }
  }

  private async getInvoiceForRendering(knex: Knex | Knex.Transaction, invoiceId: string): Promise<any> {
    return Invoice.getFullInvoiceById(knex, this.tenant, invoiceId);
  }

  private async getInvoiceTemplates(knex: Knex | Knex.Transaction): Promise<any[]> {
    return Invoice.getAllTemplates(knex, this.tenant);
  }

  private async getInvoiceTemplate(knex: Knex | Knex.Transaction, templateId: string): Promise<any | null> {
    const templates = await this.getInvoiceTemplates(knex);
    return templates.find((template: any) => template.template_id === templateId) ?? null;
  }

  // ---- Quote HTML ----------------------------------------------------------

  private async getQuoteHtml(
    options: QuotePDFOptions
  ): Promise<{ htmlContent: string; templateAst: TemplateAst | null; templateId: string | null; templateVersion: number | null }> {
    return runWithTenant(this.tenant, async () => {
      const { knex } = await createTenantKnex();
      const quoteViewModel = await mapDbQuoteToViewModel(knex, this.tenant, options.quoteId);

      if (!quoteViewModel) {
        throw new Error(`Quote ${options.quoteId} not found`);
      }

      let templateAst = options.templateAst ?? null;
      let templateId: string | null = null;

      if (!templateAst && options.templateCode) {
        templateAst = getStandardQuoteTemplateAstByCode(options.templateCode);
        templateId = options.templateCode;
      } else if (!templateAst) {
        const resolved = await resolveQuoteTemplateAst(knex, this.tenant, options.quoteId);
        templateAst = resolved.templateAst;
        templateId = resolved.templateId ?? resolved.standardCode ?? null;
      }

      if (!templateAst) {
        throw new Error('No quote template AST available for PDF generation');
      }

      const evaluation = evaluateTemplateAst(
        templateAst,
        quoteViewModel as unknown as Record<string, unknown>
      );

      const htmlContent = await renderTemplateAstHtmlDocument(templateAst, evaluation, {
        title: `Quote ${quoteViewModel.quote_number ?? ''}`.trim(),
        knex,
      });

      return { htmlContent, templateAst, templateId, templateVersion: null };
    });
  }

  // ---- Sales Order HTML ----------------------------------------------------

  private async getSalesOrderHtml(
    options: SalesOrderPDFOptions
  ): Promise<{ htmlContent: string; templateAst: TemplateAst | null; templateId: string | null; templateVersion: number | null }> {
    return runWithTenant(this.tenant, async () => {
      const { knex } = await createTenantKnex();
      const viewModel = await mapDbSalesOrderToViewModel(knex, this.tenant, options.salesOrderId);

      if (!viewModel) {
        throw new Error(`Sales order ${options.salesOrderId} not found`);
      }

      const documentType = options.documentType ?? 'sales-order';
      let templateAst = options.templateAst ?? null;
      let templateId: string | null = null;
      let templateVersion: number | null = null;

      if (!templateAst && options.templateCode) {
        templateAst = getStandardSalesOrderTemplateAstByCode(options.templateCode);
        templateId = options.templateCode;
      } else if (!templateAst) {
        const resolved = await resolveSalesOrderTemplateAst(knex, this.tenant, documentType, { clientId: viewModel.client_id });
        templateAst = resolved.ast;
        templateId = resolved.templateId;
        templateVersion = resolved.templateVersion;
      }

      if (!templateAst) {
        throw new Error('No sales order template AST available for PDF generation');
      }

      const evaluation = evaluateTemplateAst(
        templateAst,
        viewModel as unknown as Record<string, unknown>,
        { bindingAliases: INVOICE_TEMPLATE_BINDING_ALIASES }
      );

      const htmlContent = await renderTemplateAstHtmlDocument(templateAst, evaluation, {
        title: `Sales Order ${viewModel.so_number ?? ''}`.trim(),
        knex,
      });

      return { htmlContent, templateAst, templateId, templateVersion };
    });
  }

  // ---- Document HTML -------------------------------------------------------

  private async getDocumentHtml(documentId: string): Promise<string> {
    return runWithTenant(this.tenant, async () => {
      const { knex } = await createTenantKnex();
      const document = await this.getDocumentRecord(documentId);

      if (!document) {
        throw new Error(`Document ${documentId} not found`);
      }

      let htmlContent = '';
      const db = tenantDb(knex, this.tenant);

      const blockContent = await db.table('document_block_content')
        .where({ document_id: documentId })
        .first();

      if (blockContent && blockContent.block_data) {
        htmlContent = convertBlockContentToHTML(blockContent.block_data);
      } else {
        const textContent = await db.table('document_content')
          .where({ document_id: documentId })
          .first();

        if (textContent && textContent.content) {
          if (document.mime_type === 'text/markdown') {
            const { marked } = await import('marked');
            htmlContent = await marked(textContent.content);
          } else {
            const escapedText = textContent.content
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;');
            htmlContent = `<pre>${escapedText}</pre>`;
          }
        } else {
          throw new Error(`Document ${documentId} has no content`);
        }
      }

      const escapedTitle = (document.document_name || 'Document')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${document.document_name || 'Document'}</title>
    <style>
      body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; margin: 0; padding: 5mm; }
      pre { white-space: pre-wrap; word-wrap: break-word; }
      h1, h2, h3, h4, h5, h6 { margin-top: 1em; margin-bottom: 0.5em; }
      .document-title { margin-top: 0; padding-bottom: 0.4em; border-bottom: 1px solid #e2e8f0; font-size: 1.8em; }
      p { margin-top: 0; margin-bottom: 1em; }
      table { border-collapse: collapse; width: 100%; margin-bottom: 1em; }
      th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
      ul, ol { padding-left: 20px; margin-top: 0; margin-bottom: 1em; }
      blockquote { border-left: 3px solid #ddd; margin: 0 0 1em; padding: 0.5em 1em; color: #555; }
      img { max-width: 100%; height: auto; }
      a { color: #1e40af; text-decoration: underline; }
      code { background-color: #f1f5f9; padding: 1px 4px; border-radius: 3px; font-size: 0.9em; }
      pre code { background: none; padding: 0; }
      pre { background-color: #f8fafc; padding: 12px; border-radius: 6px; border: 1px solid #e2e8f0; }
    </style>
  </head>
  <body>
    <h1 class="document-title">${escapedTitle}</h1>
    ${htmlContent}
  </body>
</html>`;
    });
  }

  private async getDocumentRecord(documentId: string): Promise<{ document_id: string; document_name: string; mime_type?: string; tenant: string } | null> {
    const { knex } = await createTenantKnex();
    return (await tenantDb(knex, this.tenant).table('documents')
      .where({ document_id: documentId })
      .select('document_id', 'document_name', 'mime_type', 'tenant')
      .first()) ?? null;
  }

  // ---- Puppeteer -----------------------------------------------------------

  private async generatePDFBuffer(htmlContent: string, templateAst?: TemplateAst | null): Promise<Buffer> {
    const browser = await browserPoolService.getBrowser();
    let page: Page | null = null;

    try {
      page = await browser.newPage();
      await page.setContent(htmlContent, { waitUntil: 'load' });
      const pdfBuffer = await page.pdf(
        templateAst ? resolvePdfPrintOptionsFromAst(templateAst) : DEFAULT_DOCUMENT_PDF_OPTIONS
      );
      return Buffer.from(pdfBuffer);
    } finally {
      if (page) {
        await page.close().catch(() => undefined);
      }
      await browserPoolService.releaseBrowser(browser).catch(() => undefined);
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createPDFGenerationService(tenant: string): PDFGenerationService {
  return new PDFGenerationService(tenant);
}

/**
 * Publish generated documents for an entity to the client portal. Generated
 * invoice/sales-order documents are filed MSP-only; they become client-visible
 * at send time, not at generation time.
 */
export async function publishGeneratedDocumentsToClient(
  tenant: string,
  sourceType: 'invoice' | 'sales_order',
  entityId: string
): Promise<number> {
  return runWithTenant(tenant, async () => {
    const { knex } = await createTenantKnex();
    const db = tenantDb(knex, tenant);

    const associations = await db.table('document_associations')
      .where({ entity_id: entityId, entity_type: sourceType })
      .pluck<string[]>('document_id');

    if (associations.length === 0) {
      return 0;
    }

    return db.table('documents')
      .whereIn('document_id', associations)
      .update({ is_client_visible: true });
  });
}
