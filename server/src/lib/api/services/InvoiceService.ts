/**
 * Invoice API Service
 * Comprehensive service layer for all invoice-related operations
 * Integrates with existing invoice server actions and database operations
 */

import { Knex } from 'knex';
import { Temporal } from '@js-temporal/polyfill';
import { v4 as uuidv4 } from 'uuid';
import { BaseService, ServiceContext, ListOptions, ListResult, tenantDb } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { createTenantKnex } from '../../db';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { hasPermission } from '../../auth/rbac';
import { auditLog } from '../../logging/auditLog';
import { publishEvent, publishWorkflowEvent } from '../../eventBus/publishers';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, NotImplementedError, ValidationError } from '../middleware/apiMiddleware';
import {
  buildInvoiceDueDateChangedPayload,
  buildInvoiceOverduePayload,
  buildInvoiceSentPayload,
  buildInvoiceStatusChangedPayload,
  buildInvoiceWrittenOffPayload,
  summarizeInvoiceRecurringProvenance,
  inferInvoiceDeliveryMethod,
  toIsoDateString,
} from './invoiceWorkflowEvents';
import { buildPaymentAppliedPayload, buildPaymentRecordedPayload, buildPaymentRefundedPayload } from './paymentWorkflowEvents';

// Import existing service functions
import {
  generateInvoiceForSelectionInput,
  generateInvoiceNumber,
  previewInvoiceForSelectionInput,
} from '@alga-psa/billing/actions/invoiceGeneration';
import { BillingEngine } from '@alga-psa/billing/services';
import { TaxService } from '@alga-psa/billing/services/taxService';
import { NumberingService } from '@shared/services/numberingService';
import { PDFGenerationService, createPDFGenerationService } from '@alga-psa/billing/services';
import { StorageService } from '../../storage/StorageService';
import InvoiceModel from '@alga-psa/billing/models/invoice';

// Import schemas and interfaces
import {
  CreateInvoice,
  UpdateInvoice,
  ManualInvoiceRequest,
  GenerateInvoice,
  FinalizeInvoice,
  SendInvoice,
  ApplyCredit,
  InvoicePayment,
  InvoiceRefund,
  InvoiceFilter,
  BulkInvoiceStatusUpdate,
  BulkInvoiceSend,
  BulkInvoiceDelete,
  BulkInvoiceCredit,
  TaxCalculationRequest,
  TaxCalculationResponse,
  RecurringInvoiceTemplate,
  CreateRecurringInvoiceTemplate,
  UpdateRecurringInvoiceTemplate,
  InvoicePreviewRequest,
} from '../schemas/invoiceSchemas';

import {
  IInvoice,
  IInvoiceCharge,
  InvoiceViewModel,
  InvoiceStatus,
  DiscountType,
  PreviewInvoiceResponse
} from '../../../interfaces/invoice.interfaces';

import { IBillingResult, IBillingCharge, IClientContractLineCycle } from '../../../interfaces/billing.interfaces';
import { IClient } from '../../../interfaces/client.interfaces';
import { ISO8601String } from '../../../types/types.d';
import {
  getClientDetails,
  persistManualInvoiceCharges,
  calculateAndDistributeTax,
  updateInvoiceTotalsAndRecordTransaction
} from '@alga-psa/billing/services/invoiceService';
import { getClientDefaultTaxRegionCode } from '@alga-psa/shared/billingClients';

type DeferredEvent = () => Promise<void>;

async function publishDeferredEvents(events: DeferredEvent[]): Promise<void> {
  for (const publish of events) {
    await publish();
  }
}

function throwRecurringInvoiceApiError(error: unknown): never {
  if (!(error instanceof Error)) {
    throw error;
  }

  const message = error.message;

  if (message === 'Permission denied: invoice create or generate required') {
    throw new ForbiddenError(message);
  }

  if (message === 'Invoice already exists for this recurring execution window') {
    throw new ConflictError(message, {
      code: (error as { code?: unknown }).code,
      executionIdentityKey: (error as { executionIdentityKey?: unknown }).executionIdentityKey,
      invoiceId: (error as { invoiceId?: unknown }).invoiceId,
    });
  }

  if (
    message === 'No billing settings found' ||
    message === 'Nothing to bill' ||
    message === 'No active contract lines found for this client in the selected billing period.' ||
    message.startsWith('Recurring service periods were not materialized') ||
    message.startsWith('Cannot generate invoice: No billing email address for ') ||
    message.startsWith('Blocked until approval: ') ||
    /^Service ".+" has an undefined rate$/.test(message) ||
    /^Client '.+' does not have a default tax region configured\. Please set one before generating invoices\.$/.test(message) ||
    message === 'Purchase Order is required for this contract but has not been provided. Please add a PO number to the contract before generating invoices.'
  ) {
    throw new ConflictError(message);
  }

  if (
    message === 'Recurring selector input execution window kind is not supported.' ||
    message === 'Recurring selector input is missing client-cadence assignment identity (schedule key).' ||
    message === 'Recurring selector input is missing contract-cadence assignment identity (contract line).' ||
    message === 'No recurring execution windows selected' ||
    message === 'Grouped recurring selection inputs must share the same client and invoice window.' ||
    message === 'Invalid billing cycle dates'
  ) {
    throw new ValidationError(message);
  }

  if (/^Billing cycle .+ not found for client .+$/.test(message)) {
    throw new NotFoundError('Billing cycle not found');
  }

  if (/^Billing cycle .+ has invalid dates/.test(message)) {
    throw new ValidationError('Billing cycle has invalid dates');
  }

  if (/^Client .+ not found in tenant .+$/.test(message)) {
    throw new NotFoundError('Client not found');
  }

  if (/^Billing Error: Client .+ has active contracts in multiple currencies \(.+\)\. Mixed currency billing is not supported\.$/.test(message)) {
    throw new ConflictError('This client has active contracts in multiple currencies. Mixed currency billing is not supported.');
  }

  throw error;
}

function isReturnedActionError(value: unknown): value is { readonly actionError: string } | { readonly permissionError: string } {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (
        typeof (value as { actionError?: unknown }).actionError === 'string' ||
        typeof (value as { permissionError?: unknown }).permissionError === 'string'
      ),
  );
}

function throwReturnedActionError(error: { readonly actionError: string } | { readonly permissionError: string }): never {
  throwRecurringInvoiceApiError(new Error('permissionError' in error ? error.permissionError : error.actionError));
}

export interface InvoiceServiceContext extends ServiceContext {
  permissions?: string[];
}

export interface InvoiceListOptions extends ListOptions {
  include_items?: boolean;
  include_client?: boolean;
  include_billing_cycle?: boolean;
  include_transactions?: boolean;
}

export interface InvoiceAnalytics {
  totalInvoices: number;
  totalAmount: number;
  averageAmount: number;
  statusBreakdown: Record<InvoiceStatus, number>;
  monthlyTrends: Array<{
    month: string;
    count: number;
    amount: number;
  }>;
  topClients: Array<{
    client_id: string;
    client_name: string;
    total_amount: number;
    invoice_count: number;
  }>;
  overdueMetrics: {
    count: number;
    amount: number;
    averageDaysOverdue: number;
  };
}

export interface InvoicePDFResult {
  buffer: Buffer;
  filename: string;
  contentType: 'application/pdf';
}

export interface InvoiceHATEOASLinks {
  self: string;
  items?: string;
  client?: string;
  billing_cycle?: string;
  transactions?: string;
  pdf?: string;
  finalize?: string;
  send?: string;
  approve?: string;
  reject?: string;
  duplicate?: string;
  credit?: string;
  payment?: string;
}

export class InvoiceService extends BaseService<IInvoice> {
  private taxService: TaxService;
  private billingEngine: BillingEngine;
  private storageService: StorageService;

  constructor() {
    super({
      tableName: 'invoices',
      primaryKey: 'invoice_id',
      tenantColumn: 'tenant',
      auditFields: {
        createdBy: 'created_by',
        updatedBy: 'updated_by',
        createdAt: 'created_at',
        updatedAt: 'updated_at'
      },
      searchableFields: ['invoice_number'],
      defaultSort: 'created_at',
      defaultOrder: 'desc'
    });
    
    this.taxService = new TaxService();
    this.billingEngine = new BillingEngine();
    this.storageService = new StorageService();
  }

  // Helper to get PDF service for specific tenant
  private getPdfService(tenant: string): PDFGenerationService {
    return createPDFGenerationService(tenant);
  }

  private async getInvoiceAmountDue(trx: Knex.Transaction, params: { invoiceId: string; totalAmount: number; creditApplied: number; tenantId: string }) {
    const payments = await tenantDb(trx, params.tenantId).table('invoice_payments')
      .where({ invoice_id: params.invoiceId })
      .sum('amount as total_paid');

    const totalPayments = Number((payments as Array<{ total_paid: string }>)[0]?.total_paid || 0);
    const amountDue = params.totalAmount - (params.creditApplied + totalPayments);
    return Math.max(0, amountDue);
  }

  private async getInvoiceRecurringProvenance(trx: Knex.Transaction, tenant: string, invoiceId: string) {
    const charges = await InvoiceModel.getInvoiceCharges(trx, tenant, invoiceId);
    return summarizeInvoiceRecurringProvenance(charges);
  }

  private getPaymentTermDays(paymentTerms?: string | null): number {
    switch (paymentTerms) {
      case 'net_15':
        return 15;
      case 'due_on_receipt':
        return 0;
      case 'net_30':
      default:
        return 30;
    }
  }

  private async computeDueDate(trx: Knex.Transaction, tenant: string, clientId: string, invoiceDate: string): Promise<string> {
    const client = await tenantDb(trx, tenant).table('clients')
      .where({ client_id: clientId })
      .select('payment_terms')
      .first();

    const plainInvoiceDate = Temporal.PlainDate.from(invoiceDate);
    return plainInvoiceDate
      .add({ days: this.getPaymentTermDays(client?.payment_terms) })
      .toString();
  }

  private buildRecurringInvoiceSummaryQuery(trx: Knex.Transaction, context: ServiceContext) {
    return tenantDb(trx, context.tenant).table('recurring_service_periods as rsp')
      .whereNotNull('rsp.invoice_id')
      .select('rsp.invoice_id')
      .min('rsp.service_period_start as recurring_service_period_start')
      .max('rsp.service_period_end as recurring_service_period_end')
      .min('rsp.invoice_window_start as recurring_invoice_window_start')
      .max('rsp.invoice_window_end as recurring_invoice_window_end')
      .max('rsp.cadence_owner as recurring_cadence_owner')
      .groupBy('rsp.invoice_id')
      .as('recurring_invoice_summary');
  }

  // ============================================================================
  // CRUD Operations
  // ============================================================================

  /**
   * List invoices with advanced filtering and pagination
   */
  async list(
    options: ListOptions,
    context: ServiceContext,
    filters?: InvoiceFilter
  ): Promise<ListResult<IInvoice & { _links?: any }>> {
    await this.validatePermissions(context, 'invoice', 'read');

    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      const db = tenantDb(trx, context.tenant);
      let query = this.buildBaseQuery(trx, context);

      // Apply filters
      if (filters) {
        query = this.applyInvoiceFilters(query, filters);
      }

      // Add joins based on include options
      if ((options as any).include_client) {
        // Use a subquery to get the billing address to avoid aggregate issues with Citus
        const billingAddressSubquery = db.table('client_locations as cl')
          .select(
            'cl.client_id',
            'cl.tenant',
            trx.raw(`CONCAT_WS(', ', 
              cl.address_line1, 
              cl.address_line2, 
              cl.city, 
              cl.state_province, 
              cl.postal_code, 
              cl.country_name
            ) as formatted_address`)
          )
          .where(function() {
            this.where('cl.is_billing_address', true)
                .orWhere('cl.is_default', true);
          })
          .orderByRaw('cl.is_billing_address DESC, cl.is_default DESC')
          .limit(1)
          .as('billing_loc');

        query = db.tenantJoin(query, 'clients', 'invoices.client_id', 'clients.client_id', { type: 'left' })
          .leftJoin(billingAddressSubquery, 'clients.client_id', 'billing_loc.client_id')
          .select(
            'clients.client_name',
            trx.raw('COALESCE(billing_loc.formatted_address, \'\') as billing_address')
          );
      }

      if ((options as any).include_billing_cycle) {
        query = db.tenantJoin(
          query,
          'client_billing_cycles',
          'invoices.billing_cycle_id',
          'client_billing_cycles.billing_cycle_id',
          { type: 'left' }
        )
          .select(
            'client_billing_cycles.period_start_date as period_start',
            'client_billing_cycles.period_end_date as period_end',
          );
      }

      if ((options as any).include_tax_details) {
        query = db.tenantJoin(
          query,
          'tax_rates',
          'invoices.tax_rate_id',
          'tax_rates.tax_rate_id',
          { type: 'left' }
        )
          .select('tax_rates.rate_percentage', 'tax_rates.tax_name');
      }

      // Apply pagination, sorting, and execute
      const { page = 1, limit = 25, sort, order } = options;
      const offset = (page - 1) * limit;
      
      const sortField = sort || this.defaultSort;
      const sortOrder = order || this.defaultOrder;
      
      query.orderBy(`invoices.${sortField}`, sortOrder);
      query.limit(limit).offset(offset);

      // Get total count using the same recurring summary join so execution-window filters stay consistent.
      const countQuery = this.buildBaseQuery(trx, context)
        .clearSelect()
        .clearOrder();

      if (filters) {
        this.applyInvoiceFilters(countQuery, filters);
      }

      const [data, [{ count }]] = await Promise.all([
        query,
        countQuery.countDistinct('invoices.invoice_id as count')
      ]);

      // Add HATEOAS links
      const dataWithLinks = data.map((invoice: any) => ({
        ...invoice,
        _links: this.generateInvoiceLinks(invoice)
      }));

      return {
        data: dataWithLinks,
        total: parseInt(count as string)
      };
    });
  }

  /**
   * Get invoice by ID with detailed information
   */
  async getById(id: string, context: ServiceContext, options?: any): Promise<IInvoice | null> {
      await this.validatePermissions(context, 'invoice', 'read');
  
      const { knex } = await this.getKnex();
      
      return withTransaction(knex, async (trx) => {
        const invoice = await this.buildBaseQuery(trx, context)
          .where('invoices.invoice_id', id)
          .first();
  
        if (!invoice) {
          return null;
        }
  
        // Get related data based on options
        const includeItems = options?.include_items !== false;
        const includeTransactions = options?.include_transactions === true;
        const includeClient = options?.include_client !== false;
  
        const [lineItems, client, billingCycle, taxDetails, payments, credits] = await Promise.all([
          includeItems ? this.getInvoiceLineItems(id, trx, context) : [],
          includeClient ? this.getInvoiceClient(invoice.client_id, trx, context) : null,
          invoice.billing_cycle_id ? this.getBillingCycle(invoice.billing_cycle_id, trx, context) : null,
          invoice.tax_rate_id ? this.getTaxDetails(invoice.tax_rate_id, trx, context) : null,
          includeTransactions ? this.getInvoicePayments(id, trx, context) : [],
          includeTransactions ? this.getInvoiceCredits(id, trx, context) : []
        ]);
  
        const result: any = {
          ...invoice,
          _links: this.generateInvoiceLinks(invoice)
        };
  
        if (includeItems) {
          result.line_items = lineItems;
          result.invoice_charges = lineItems; // Alias for controller compatibility
        }
        if (includeClient) {
          result.client = client;
        }
        if (billingCycle) {
          result.billing_cycle = billingCycle;
        }
        if (taxDetails) {
          result.tax_details = taxDetails;
        }
        if (includeTransactions) {
          result.payments = payments;
          result.credits = credits;
          result.transactions = [...payments, ...credits]; // Combined for transactions endpoint
        }
  
        return result;
      });
    }


  /**
   * Create a new invoice
   * Overloads for BaseService compatibility
   */
  async create(data: Partial<IInvoice>, context: ServiceContext): Promise<IInvoice>;
  async create(data: CreateInvoice, context: ServiceContext): Promise<IInvoice>;
  async create(data: any, context: ServiceContext): Promise<IInvoice> {
    await this.validatePermissions(context, 'invoice', 'create');

    const { knex } = await this.getKnex();
    const deferredEvents: DeferredEvent[] = [];
    
    const invoiceId = await withTransaction(knex, async (trx) => {
      // Generate invoice number
      const invoiceNumber = await generateInvoiceNumber(trx);

      // Calculate taxes if needed
      let taxCalculation: { tax_amount: number; tax_region: string; tax_rate: number; calculation_date: string } | null = null;
      if (data.items?.length) {
        const taxRegion = await this.resolveTaxRegion(trx, context.tenant, data.client_id);
        // Only calculate tax when the client has a configured tax region. We do not
        // fabricate a region (no hardcoded 'US' / inferred default), so a client with
        // no configured region simply has no tax applied here.
        if (taxRegion) {
          taxCalculation = await this.calculateTaxes({
            client_id: data.client_id,
            amount: data.subtotal,
            tax_region: taxRegion
          }, context);
        }
      }

      // Prepare invoice data
      const invoiceData = {
        invoice_id: uuidv4(),
        invoice_number: invoiceNumber,
        client_id: data.client_id,
        billing_cycle_id: data.billing_cycle_id,
        status: data.status || 'draft',
        invoice_date: data.invoice_date || new Date().toISOString().split('T')[0],
        due_date: data.due_date,
        subtotal: data.subtotal || 0,
        tax: taxCalculation?.tax_amount || 0,
        total_amount: data.total_amount || 0,
        // `billing_period_start/end` stores the invoice window, not the service period.
        // This generic create endpoint trusts the caller; rename to `invoice_window_*` is pending.
        billing_period_start: data.billing_period_start,
        billing_period_end: data.billing_period_end,
        is_manual: data.is_manual || false,
        is_prepayment: data.is_prepayment || false,
        credit_applied: data.credit_applied || 0,
        created_by: context.userId,
        updated_by: context.userId,
        tenant: context.tenant,
        created_at: new Date(),
        updated_at: new Date()
      };

      // Insert invoice
      const [invoice] = await tenantDb(trx, context.tenant).table('invoices').insert(invoiceData).returning('*');

      // Create line items if provided
      if (data.items?.length) {
        await this.createInvoiceLineItems(invoice.invoice_id, data.items, trx, context);
      }

      // Audit log
      await auditLog(trx, {
        userId: context.userId,
        operation: 'CREATE',
        tableName: 'invoices',
        recordId: invoice.invoice_id,
        changedData: { invoice_id: invoice.invoice_id, invoice_number: invoiceNumber },
        details: { action: 'invoice.created' }
      });

      deferredEvents.push(() => publishEvent({
        eventType: 'INVOICE_CREATED',
        payload: {
          tenantId: context.tenant,
          invoiceId: invoice.invoice_id,
          clientId: invoice.client_id,
          userId: context.userId,
          timestamp: new Date().toISOString()
        }
      }));

      return invoice.invoice_id;
    });

    await publishDeferredEvents(deferredEvents);

    // Re-fetch after commit: getById runs on a pooled (non-transaction)
    // connection, so it must read the row only after the tx commits.
    return this.getById(invoiceId, context) as Promise<IInvoice>;
  }

  /**
   * Update an existing invoice
   */
  async update(id: string, data: UpdateInvoice, context: ServiceContext): Promise<IInvoice> {
    await this.validatePermissions(context, 'invoice', 'update');

    const { knex } = await this.getKnex();
    const deferredEvents: DeferredEvent[] = [];

    await withTransaction(knex, async (trx) => {
      const existing = await tenantDb(trx, context.tenant).table('invoices')
        .where({ invoice_id: id })
        .first();

      if (!existing) {
        throw new NotFoundError('Invoice not found');
      }

      // Validate business rules
      if (existing.status === 'paid' && data.status && data.status !== 'paid') {
        throw new ConflictError('Cannot modify paid invoice status');
      }

      // Prepare update data
      const updateData: any = {
        ...data,
        updated_by: context.userId,
        updated_at: new Date()
      };

      // Remove undefined values
      Object.keys(updateData).forEach(key => {
        if (updateData[key] === undefined) {
          delete updateData[key];
        }
      });

      // Update invoice
      await tenantDb(trx, context.tenant).table('invoices')
        .where({ invoice_id: id })
        .update(updateData);

      // Update line items if provided
      if (data.items) {
        const replacedItemIds = await tenantDb(trx, context.tenant).table('invoice_line_items')
          .where({ invoice_id: id })
          .pluck('item_id');

        await tenantDb(trx, context.tenant).table('invoice_line_items')
          .where({ invoice_id: id })
          .del();

        for (const itemId of replacedItemIds) {
          deferredEvents.push(() => publishEvent({
            eventType: 'INVOICE_ITEM_DELETED',
            payload: {
              tenantId: context.tenant,
              invoiceId: id,
              itemId,
              userId: context.userId,
              timestamp: new Date().toISOString()
            }
          }));
        }
        
      // Normalize header alias: prefer is_bundle_header, but accept is_bundle_header
      const normalizedItems = data.items.map((it: any) => {
        if (it && typeof it === 'object') {
          if (it.is_bundle_header !== undefined && it.is_bundle_header === undefined) {
            return { ...it, is_bundle_header: it.is_bundle_header };
          }
        }
        return it;
      });

      await this.createInvoiceLineItems(id, normalizedItems, trx, context);
      }

      const recurringProvenance = await this.getInvoiceRecurringProvenance(trx, context.tenant, id);

      // Audit log
      await auditLog(trx, {
        userId: context.userId,
        operation: 'UPDATE',
        tableName: 'invoices',
        recordId: id,
        changedData: data,
        details: {
          action: 'invoice.updated',
          ...(recurringProvenance ? { recurring_provenance: recurringProvenance } : {}),
        }
      });

      const occurredAt = new Date().toISOString();
      const previousStatus = String(existing.status);
      const newStatus = updateData.status ? String(updateData.status) : previousStatus;

      const previousDueDate = toIsoDateString(existing.due_date);
      const nextDueDate = updateData.due_date ? toIsoDateString(updateData.due_date) : previousDueDate;

      if (newStatus !== previousStatus) {
        deferredEvents.push(() => publishWorkflowEvent({
          eventType: 'INVOICE_STATUS_CHANGED',
          payload: buildInvoiceStatusChangedPayload({
            invoiceId: id,
            previousStatus,
            newStatus,
            changedAt: occurredAt,
            recurringProvenance,
          }),
          ctx: {
            tenantId: context.tenant,
            occurredAt,
            actor: { actorType: 'USER', actorUserId: context.userId },
          },
        }));
      }

      if (previousDueDate && nextDueDate && previousDueDate !== nextDueDate) {
        deferredEvents.push(() => publishWorkflowEvent({
          eventType: 'INVOICE_DUE_DATE_CHANGED',
          payload: buildInvoiceDueDateChangedPayload({
            invoiceId: id,
            previousDueDate,
            newDueDate: nextDueDate,
            changedAt: occurredAt,
            recurringProvenance,
          }),
          ctx: {
            tenantId: context.tenant,
            occurredAt,
            actor: { actorType: 'USER', actorUserId: context.userId },
          },
        }));
      }

      if (newStatus === 'overdue' && previousStatus !== 'overdue') {
        const totalAmount = Number(updateData.total_amount ?? existing.total_amount ?? 0);
        const creditApplied = Number(updateData.credit_applied ?? existing.credit_applied ?? 0);
        const amountDue = await this.getInvoiceAmountDue(trx, {
          invoiceId: id,
          totalAmount,
          creditApplied,
          tenantId: context.tenant,
        });

        deferredEvents.push(() => publishWorkflowEvent({
          eventType: 'INVOICE_OVERDUE',
          payload: buildInvoiceOverduePayload({
            invoiceId: id,
            clientId: existing.client_id,
            overdueAt: occurredAt,
            dueDate: nextDueDate || previousDueDate,
            amountDue,
            currency: String(updateData.currency_code ?? existing.currency_code ?? 'USD'),
            recurringProvenance,
          }),
          ctx: {
            tenantId: context.tenant,
            occurredAt,
            actor: { actorType: 'USER', actorUserId: context.userId },
          },
        }));
      }

      if (previousStatus === 'overdue' && newStatus === 'cancelled') {
        const totalAmount = Number(updateData.total_amount ?? existing.total_amount ?? 0);
        const creditApplied = Number(updateData.credit_applied ?? existing.credit_applied ?? 0);
        const amountDue = await this.getInvoiceAmountDue(trx, {
          invoiceId: id,
          totalAmount,
          creditApplied,
          tenantId: context.tenant,
        });

        if (amountDue > 0) {
          deferredEvents.push(() => publishWorkflowEvent({
            eventType: 'INVOICE_WRITTEN_OFF',
            payload: buildInvoiceWrittenOffPayload({
              invoiceId: id,
              writtenOffAt: occurredAt,
              amountWrittenOff: amountDue,
              currency: String(updateData.currency_code ?? existing.currency_code ?? 'USD'),
              recurringProvenance,
            }),
            ctx: {
              tenantId: context.tenant,
              occurredAt,
              actor: { actorType: 'USER', actorUserId: context.userId },
            },
          }));
        }
      }

      deferredEvents.push(() => publishEvent({
        eventType: 'INVOICE_UPDATED',
        payload: {
          tenantId: context.tenant,
          invoiceId: id,
          clientId: existing.client_id,
          userId: context.userId,
          changes: data as Record<string, unknown>,
          timestamp: occurredAt
        }
      }));
    });

    await publishDeferredEvents(deferredEvents);

    // Re-fetch after commit: getById runs on a pooled (non-transaction)
    // connection, so it must read the row only after the tx commits.
    return this.getById(id, context) as Promise<IInvoice>;
  }

  /**
   * Delete an invoice (soft delete if has payments)
   */
  async delete(id: string, context: ServiceContext): Promise<void> {
    await this.validatePermissions(context, 'invoice', 'delete');

    const { knex } = await this.getKnex();
    const deferredEvents: DeferredEvent[] = [];
    
    await withTransaction(knex, async (trx) => {
      const invoice = await tenantDb(trx, context.tenant).table('invoices')
        .where({ invoice_id: id })
        .first();

      if (!invoice) {
        throw new NotFoundError('Invoice not found');
      }

      const recurringProvenance = await this.getInvoiceRecurringProvenance(trx, context.tenant, id);
      const hasCanonicalRecurringDetailPeriods =
        recurringProvenance?.authoritativePeriodSource === 'canonical_detail_rows' &&
        (recurringProvenance.detailPeriodCount ?? 0) > 0;

      // Check if invoice has payments
      const hasPayments = await tenantDb(trx, context.tenant).table('invoice_payments')
        .where({ invoice_id: id })
        .first();

      const occurredAt = new Date().toISOString();
      const softCancelled = Boolean(
        hasPayments ||
        invoice.status === 'paid' ||
        hasCanonicalRecurringDetailPeriods
      );

      if (softCancelled) {
        // Soft delete - mark as cancelled
        await tenantDb(trx, context.tenant).table('invoices')
          .where({ invoice_id: id })
          .update({
            status: 'cancelled',
            updated_by: context.userId,
            updated_at: new Date()
          });
      } else {
        // Hard delete if no payments
        await tenantDb(trx, context.tenant).table('invoice_line_items')
          .where({ invoice_id: id })
          .del();
        
        await tenantDb(trx, context.tenant).table('invoices')
          .where({ invoice_id: id })
          .del();
      }

      // Audit log
	      await auditLog(trx, {
	        userId: context.userId,
	        operation: 'DELETE',
	        tableName: 'invoices',
	        recordId: id,
	        changedData: {},
	        details: {
            action: 'invoice.deleted',
            ...(recurringProvenance ? { recurring_provenance: recurringProvenance } : {}),
          }
	      });

	      if (softCancelled && String(invoice.status) !== 'cancelled') {
	        deferredEvents.push(() => publishWorkflowEvent({
	          eventType: 'INVOICE_STATUS_CHANGED',
	          payload: buildInvoiceStatusChangedPayload({
	            invoiceId: id,
	            previousStatus: String(invoice.status),
	            newStatus: 'cancelled',
	            changedAt: occurredAt,
              recurringProvenance,
	          }),
	          ctx: {
	            tenantId: context.tenant,
	            occurredAt,
	            actor: { actorType: 'USER', actorUserId: context.userId },
	          },
	        }));
	      }

	      // Publish event
	      deferredEvents.push(() => publishEvent({
	        eventType: 'INVOICE_DELETED',
	        payload: {
	          tenantId: context.tenant,
	          invoiceId: id,
	          userId: context.userId,
	          timestamp: occurredAt
	        }
	      }));
    });

    await publishDeferredEvents(deferredEvents);
  }

  // ============================================================================
  // Invoice Operations
  // ============================================================================

  /**
   * Finalize an invoice (make it ready for sending)
   */
  async finalizeInvoice(data: FinalizeInvoice, context: ServiceContext): Promise<IInvoice> {
    await this.validatePermissions(context, 'invoice', 'finalize');

    const { knex } = await this.getKnex();
    const deferredEvents: DeferredEvent[] = [];

    await withTransaction(knex, async (trx) => {
      const invoice = await tenantDb(trx, context.tenant).table('invoices')
        .where({ invoice_id: data.invoice_id })
        .first();

      if (!invoice) {
        throw new NotFoundError('Invoice not found');
      }

      if (invoice.status !== 'draft') {
        throw new ConflictError('Only draft invoices can be finalized');
      }

      // Validate invoice has required data
      const hasInvoiceChargesTable = await trx.schema.hasTable('invoice_charges');
      const lineItems = hasInvoiceChargesTable
        ? await InvoiceModel.getInvoiceCharges(trx, context.tenant, data.invoice_id)
        : await tenantDb(trx, context.tenant).table('invoice_line_items')
          .where({ invoice_id: data.invoice_id });

      if (!lineItems.length) {
        throw new ConflictError('Invoice must have line items to be finalized');
      }

      // Calculate final amounts
      const subtotal = lineItems.reduce((sum: number, item: any) => sum + Number(item.total_price || 0), 0);
      const taxAmount = lineItems.reduce((sum: number, item: any) => sum + Number(item.tax_amount || 0), 0);
      const totalAmount = subtotal + taxAmount;

      const invoiceUpdate: Record<string, any> = {
        status: 'sent', // Change to sent instead of finalized
        subtotal,
        tax: taxAmount,
        total_amount: totalAmount,
        finalized_at: data.finalized_at || new Date().toISOString().split('T')[0],
        updated_at: new Date()
      };

      if (await trx.schema.hasColumn('invoices', 'updated_by')) {
        invoiceUpdate.updated_by = context.userId;
      }

      // Update invoice status and amounts
      await tenantDb(trx, context.tenant).table('invoices')
        .where({ invoice_id: data.invoice_id })
        .update(invoiceUpdate);

      const recurringProvenance = await this.getInvoiceRecurringProvenance(trx, context.tenant, data.invoice_id);

      // Audit log
      await auditLog(trx, {
        userId: context.userId,
        operation: 'UPDATE',
        tableName: 'invoices',
        recordId: data.invoice_id,
        changedData: { status: 'finalized', subtotal, tax_amount: taxAmount, total_amount: totalAmount },
        details: {
          action: 'invoice.finalized',
          ...(recurringProvenance ? { recurring_provenance: recurringProvenance } : {}),
        }
      });

      // Publish event
      deferredEvents.push(() => publishEvent({
        eventType: 'INVOICE_FINALIZED',
        payload: {
          tenantId: context.tenant,
          invoiceId: data.invoice_id,
          totalAmount,
          userId: context.userId,
          timestamp: new Date().toISOString()
        }
      }));

      deferredEvents.push(() => publishWorkflowEvent({
        eventType: 'INVOICE_STATUS_CHANGED',
        payload: buildInvoiceStatusChangedPayload({
          invoiceId: data.invoice_id,
          previousStatus: String(invoice.status),
          newStatus: 'sent',
          changedAt: new Date().toISOString(),
          recurringProvenance,
        }),
        ctx: {
          tenantId: context.tenant,
          actor: { actorType: 'USER', actorUserId: context.userId },
        },
      }));
    });

    await publishDeferredEvents(deferredEvents);

    // Re-fetch after commit: getById runs on a pooled (non-transaction)
    // connection, so it must read the row only after the tx commits.
    return this.getById(data.invoice_id, context) as Promise<IInvoice>;
  }

  /**
   * Send an invoice to the customer
   */
  async sendInvoice(data: SendInvoice, context: ServiceContext): Promise<IInvoice> {
    await this.validatePermissions(context, 'invoice', 'send');

    const { knex } = await this.getKnex();
    const deferredEvents: DeferredEvent[] = [];

    await withTransaction(knex, async (trx) => {
      const invoice = await tenantDb(trx, context.tenant).table('invoices')
        .where({ invoice_id: data.invoice_id })
        .first();

      if (!invoice) {
        throw new NotFoundError('Invoice not found');
      }

      if (!['sent', 'draft'].includes(invoice.status)) {
        throw new ConflictError('Only draft invoices can be sent');
      }

      // Generate PDF if requested
      let pdfPath = invoice.pdf_path;
      if (data.include_pdf) {
        const pdfService = this.getPdfService(context.tenant);
        // Note: This method doesn't exist in PDFGenerationService - would need to be implemented
        // pdfPath = await pdfService.generateInvoicePDF(invoice.invoice_id, context.tenant);
      }

      // Update invoice status
      await tenantDb(trx, context.tenant).table('invoices')
        .where({ invoice_id: data.invoice_id })
        .update({
          status: 'sent',
          updated_by: context.userId,
          updated_at: new Date()
        });

      // Send email notifications if specified
      if (data.email_addresses?.length) {
        await this.sendInvoiceEmail(
          data.invoice_id,
          data.email_addresses,
          data.subject,
          data.message,
          context
        );
      }

      const recurringProvenance = await this.getInvoiceRecurringProvenance(trx, context.tenant, data.invoice_id);

      // Audit log
      await auditLog(trx, {
        userId: context.userId,
        operation: 'UPDATE',
        tableName: 'invoices',
        recordId: data.invoice_id,
        changedData: { status: 'sent', sent_at: new Date() },
        details: {
          action: 'invoice.sent',
          recipients: data.email_addresses,
          ...(recurringProvenance ? { recurring_provenance: recurringProvenance } : {}),
        }
      });

      // Publish event
      const sentAt = new Date().toISOString();
      deferredEvents.push(() => publishWorkflowEvent({
        eventType: 'INVOICE_SENT',
        payload: buildInvoiceSentPayload({
          invoiceId: data.invoice_id,
          clientId: invoice.client_id,
          sentByUserId: context.userId,
          sentAt,
          deliveryMethod: inferInvoiceDeliveryMethod({
            emailRecipientCount: data.email_addresses?.length,
            includePdf: data.include_pdf,
          }),
          recurringProvenance,
        }),
        ctx: {
          tenantId: context.tenant,
          occurredAt: sentAt,
          actor: { actorType: 'USER', actorUserId: context.userId },
        },
      }));

      if (String(invoice.status) !== 'sent') {
        deferredEvents.push(() => publishWorkflowEvent({
          eventType: 'INVOICE_STATUS_CHANGED',
          payload: buildInvoiceStatusChangedPayload({
            invoiceId: data.invoice_id,
            previousStatus: String(invoice.status),
            newStatus: 'sent',
            changedAt: sentAt,
            recurringProvenance,
          }),
          ctx: {
            tenantId: context.tenant,
            occurredAt: sentAt,
            actor: { actorType: 'USER', actorUserId: context.userId },
          },
        }));
      }
    });

    await publishDeferredEvents(deferredEvents);

    // Re-fetch after commit: getById runs on a pooled (non-transaction)
    // connection, so it must read the row only after the tx commits.
    return this.getById(data.invoice_id, context) as Promise<IInvoice>;
  }

  /**
   * Record a payment for an invoice
   */
  async recordPayment(data: InvoicePayment, context: ServiceContext): Promise<IInvoice> {
    await this.validatePermissions(context, 'invoice', 'payment');

    const { knex } = await this.getKnex();
    const deferredEvents: DeferredEvent[] = [];

    await withTransaction(knex, async (trx) => {
      const occurredAt = new Date().toISOString();

      const invoice = await tenantDb(trx, context.tenant).table('invoices')
        .where({ invoice_id: data.invoice_id })
        .first();

      if (!invoice) {
        throw new NotFoundError('Invoice not found');
      }

      if (invoice.status === 'cancelled') {
        throw new ConflictError('Cannot record payment for cancelled invoice');
      }

      // Insert payment record
      const paymentData = {
        payment_id: uuidv4(),
        invoice_id: data.invoice_id,
        amount: data.payment_amount,
        payment_method: data.payment_method,
        payment_date: data.payment_date || new Date().toISOString().split('T')[0],
        reference_number: data.reference_number,
        notes: data.notes,
        created_by: context.userId,
        tenant: context.tenant,
        created_at: new Date()
      };

      await tenantDb(trx, context.tenant).table('invoice_payments').insert(paymentData);

      deferredEvents.push(() => publishWorkflowEvent({
        eventType: 'PAYMENT_RECORDED',
        payload: buildPaymentRecordedPayload({
          paymentId: paymentData.payment_id,
          clientId: invoice.client_id,
          receivedAt: occurredAt,
          amount: data.payment_amount,
          currency: String(invoice.currency_code ?? 'USD'),
          method: String(data.payment_method ?? 'manual'),
          receivedByUserId: context.userId,
          gatewayTransactionId: data.reference_number,
        }),
        ctx: {
          tenantId: context.tenant,
          occurredAt,
          actor: { actorType: 'USER', actorUserId: context.userId },
        },
        idempotencyKey: `payment_recorded:${paymentData.payment_id}`,
      }));

      deferredEvents.push(() => publishWorkflowEvent({
        eventType: 'PAYMENT_APPLIED',
        payload: buildPaymentAppliedPayload({
          paymentId: paymentData.payment_id,
          appliedAt: occurredAt,
          appliedByUserId: context.userId,
          applications: [{ invoiceId: data.invoice_id, amountApplied: data.payment_amount }],
        }),
        ctx: {
          tenantId: context.tenant,
          occurredAt,
          actor: { actorType: 'USER', actorUserId: context.userId },
        },
        idempotencyKey: `payment_applied:${paymentData.payment_id}:${data.invoice_id}`,
      }));

      // Calculate total payments
      const payments = await tenantDb(trx, context.tenant).table('invoice_payments')
        .where({ invoice_id: data.invoice_id })
        .sum('amount as total_paid');

      const totalPayments = Number((payments as Array<{ total_paid: string }>)[0]?.total_paid || 0);

      // Include credits in total paid calculation
      const creditApplied = Number(invoice.credit_applied || 0);
      const totalPaid = totalPayments + creditApplied;

      // Update invoice status
      let newStatus = invoice.status;
      if (totalPaid >= invoice.total_amount) {
        newStatus = 'paid';
      } else if (totalPaid > 0) {
        newStatus = 'partially_applied';
      }

      await tenantDb(trx, context.tenant).table('invoices')
        .where({ invoice_id: data.invoice_id })
        .update({
          status: newStatus,
          updated_by: context.userId,
          updated_at: new Date()
        });

        const recurringProvenance = await this.getInvoiceRecurringProvenance(trx, context.tenant, data.invoice_id);

	      // Audit log
	      await auditLog(trx, {
	        userId: context.userId,
	        operation: 'UPDATE',
	        tableName: 'invoices',
	        recordId: data.invoice_id,
	        changedData: { status: newStatus, total_paid: totalPaid },
	        details: {
            action: 'invoice.payment_recorded',
            payment_amount: data.payment_amount,
            ...(recurringProvenance ? { recurring_provenance: recurringProvenance } : {}),
          }
	      });

	      if (String(newStatus) !== String(invoice.status)) {
	        deferredEvents.push(() => publishWorkflowEvent({
	          eventType: 'INVOICE_STATUS_CHANGED',
	          payload: buildInvoiceStatusChangedPayload({
	            invoiceId: data.invoice_id,
	            previousStatus: String(invoice.status),
	            newStatus: String(newStatus),
	            changedAt: occurredAt,
              recurringProvenance,
	          }),
	          ctx: {
	            tenantId: context.tenant,
	            occurredAt,
	            actor: { actorType: 'USER', actorUserId: context.userId },
	          },
	        }));
	      }

	      // Publish event
	      deferredEvents.push(() => publishEvent({
	        eventType: 'INVOICE_PAYMENT_RECORDED',
	        payload: {
	          tenantId: context.tenant,
	          invoiceId: data.invoice_id,
	          paymentAmount: data.payment_amount,
	          totalPaid,
	          newStatus,
	          userId: context.userId,
	          timestamp: new Date().toISOString()
	        }
	      }));

    });

    await publishDeferredEvents(deferredEvents);

    // Re-fetch after commit: getById runs on a pooled (non-transaction)
    // connection, so it must read the row only after the tx commits.
    return this.getById(data.invoice_id, context) as Promise<IInvoice>;
  }

  /**
   * Apply credit to an invoice
   */
  async applyCredit(data: ApplyCredit, context: ServiceContext): Promise<IInvoice> {
    await this.validatePermissions(context, 'invoice', 'credit');

    const { knex } = await this.getKnex();
    const deferredEvents: DeferredEvent[] = [];

    await withTransaction(knex, async (trx) => {
      const invoice = await tenantDb(trx, context.tenant).table('invoices')
        .where({ invoice_id: data.invoice_id })
        .first();

      if (!invoice) {
        throw new NotFoundError('Invoice not found');
      }

      // Validate credit amount
      if (data.credit_amount <= 0) {
        throw new BadRequestError('Credit amount must be positive');
      }

      if (data.credit_amount > invoice.total_amount - (invoice.credit_applied ?? 0)) {
        throw new BadRequestError('Credit amount cannot exceed invoice balance due');
      }

      // Insert credit record
      const creditData = {
        credit_id: uuidv4(),
        invoice_id: data.invoice_id,
        credit_amount: data.credit_amount,
        transaction_id: data.transaction_id,
        applied_date: new Date(),
        created_by: context.userId,
        tenant: context.tenant,
        created_at: new Date()
      };

      await tenantDb(trx, context.tenant).table('invoice_credits').insert(creditData);

      // Update invoice credit applied
      const newCreditApplied = (invoice.credit_applied || 0) + data.credit_amount;

      // Calculate total payments to determine correct status
      const payments = await tenantDb(trx, context.tenant).table('invoice_payments')
        .where({ invoice_id: data.invoice_id })
        .sum('amount as total_paid');
      const totalPayments = Number((payments as Array<{ total_paid: string }>)[0]?.total_paid || 0);

      // Total paid includes both credits and payments
      const totalPaid = newCreditApplied + totalPayments;

      // Update invoice status based on total paid
      let newStatus = invoice.status;
      if (totalPaid >= invoice.total_amount) {
        newStatus = 'paid';
      } else if (totalPaid > 0 && invoice.status !== 'cancelled') {
        newStatus = 'partially_applied';
      }

      await tenantDb(trx, context.tenant).table('invoices')
        .where({ invoice_id: data.invoice_id })
        .update({
          credit_applied: newCreditApplied,
          status: newStatus,
          updated_by: context.userId,
          updated_at: new Date()
        });

      // Calculate remaining balance after credit application
      const remainingBalance = invoice.total_amount - totalPaid;

      const recurringProvenance = await this.getInvoiceRecurringProvenance(trx, context.tenant, data.invoice_id);

	      // Audit log
	      await auditLog(trx, {
	        userId: context.userId,
	        operation: 'UPDATE',
	        tableName: 'invoices',
	        recordId: data.invoice_id,
	        changedData: { 
	          credit_applied: newCreditApplied,
	          status: newStatus
	        },
	        details: {
            action: 'invoice.credit_applied',
            credit_amount: data.credit_amount,
            ...(recurringProvenance ? { recurring_provenance: recurringProvenance } : {}),
          }
	      });

	      if (String(newStatus) !== String(invoice.status)) {
	        const occurredAt = new Date().toISOString();
	        deferredEvents.push(() => publishWorkflowEvent({
	          eventType: 'INVOICE_STATUS_CHANGED',
	          payload: buildInvoiceStatusChangedPayload({
	            invoiceId: data.invoice_id,
	            previousStatus: String(invoice.status),
	            newStatus: String(newStatus),
	            changedAt: occurredAt,
              recurringProvenance,
	          }),
	          ctx: {
	            tenantId: context.tenant,
	            occurredAt,
	            actor: { actorType: 'USER', actorUserId: context.userId },
	          },
	        }));
	      }

	      // Publish event
	      deferredEvents.push(() => publishEvent({
	        eventType: 'INVOICE_CREDIT_APPLIED',
	        payload: {
	          tenantId: context.tenant,
	          invoiceId: data.invoice_id,
	          creditAmount: data.credit_amount,
	          newCreditApplied,
	          remainingBalance,
	          newStatus,
	          userId: context.userId,
	          timestamp: new Date().toISOString()
	        }
	      }));

    });

    await publishDeferredEvents(deferredEvents);

    // Re-fetch after commit: getById runs on a pooled (non-transaction)
    // connection, so it must read the row only after the tx commits.
    return this.getById(data.invoice_id, context) as Promise<IInvoice>;
  }

  /**
   * Record a refund for an invoice payment
   * This handles non-Stripe refunds (manual refunds, check refunds, etc.)
   */
  async recordRefund(data: InvoiceRefund, context: ServiceContext): Promise<IInvoice> {
    await this.validatePermissions(context, 'invoice', 'refund');

    const { knex } = await this.getKnex();
    const deferredEvents: DeferredEvent[] = [];

    await withTransaction(knex, async (trx) => {
      const occurredAt = new Date().toISOString();

      const invoice = await tenantDb(trx, context.tenant).table('invoices')
        .where({ invoice_id: data.invoice_id })
        .first();

      if (!invoice) {
        throw new NotFoundError('Invoice not found');
      }

      // Validate refund amount
      if (data.refund_amount <= 0) {
        throw new BadRequestError('Refund amount must be positive');
      }

      // Calculate current payments
      const payments = await tenantDb(trx, context.tenant).table('invoice_payments')
        .where({ invoice_id: data.invoice_id })
        .sum('amount as total_paid');
      const totalPayments = Number((payments as Array<{ total_paid: string }>)[0]?.total_paid || 0);

      if (data.refund_amount > totalPayments) {
        throw new BadRequestError('Refund amount cannot exceed total payments');
      }

      // Insert refund as negative payment
      const refundData = {
        payment_id: uuidv4(),
        invoice_id: data.invoice_id,
        amount: -data.refund_amount, // Negative amount for refund
        payment_method: 'refund',
        payment_date: new Date().toISOString().split('T')[0],
        reference_number: data.reference_number,
        notes: data.reason,
        status: 'refunded',
        created_by: context.userId,
        tenant: context.tenant,
        created_at: new Date()
      };

      await tenantDb(trx, context.tenant).table('invoice_payments').insert(refundData);

      deferredEvents.push(() => publishWorkflowEvent({
        eventType: 'PAYMENT_REFUNDED',
        payload: buildPaymentRefundedPayload({
          paymentId: refundData.payment_id,
          refundedAt: occurredAt,
          refundedByUserId: context.userId,
          amount: data.refund_amount,
          currency: String(invoice.currency_code ?? 'USD'),
          reason: data.reason,
        }),
        ctx: {
          tenantId: context.tenant,
          occurredAt,
          actor: { actorType: 'USER', actorUserId: context.userId },
        },
        idempotencyKey: `payment_refunded:${refundData.payment_id}`,
      }));

      // Calculate net payments after refund
      const netPayments = await tenantDb(trx, context.tenant).table('invoice_payments')
        .where({ invoice_id: data.invoice_id })
        .sum('amount as total_paid');
      const netPaid = Number((netPayments as Array<{ total_paid: string }>)[0]?.total_paid || 0);

      // Include credits in total paid
      const creditApplied = Number(invoice.credit_applied || 0);
      const totalPaid = netPaid + creditApplied;

      // Update invoice status based on net paid amount
      let newStatus: string;
      if (totalPaid <= 0) {
        newStatus = 'sent'; // Back to sent after full refund
      } else if (totalPaid >= invoice.total_amount) {
        newStatus = 'paid';
      } else {
        newStatus = 'partially_applied';
      }

      await tenantDb(trx, context.tenant).table('invoices')
        .where({ invoice_id: data.invoice_id })
        .update({
          status: newStatus,
          updated_by: context.userId,
          updated_at: new Date()
        });

        const recurringProvenance = await this.getInvoiceRecurringProvenance(trx, context.tenant, data.invoice_id);

	      // Audit log
	      await auditLog(trx, {
	        userId: context.userId,
	        operation: 'UPDATE',
	        tableName: 'invoices',
	        recordId: data.invoice_id,
	        changedData: { status: newStatus, refund_amount: data.refund_amount },
	        details: {
            action: 'invoice.refund_recorded',
            reason: data.reason,
            ...(recurringProvenance ? { recurring_provenance: recurringProvenance } : {}),
          }
	      });

	      if (String(newStatus) !== String(invoice.status)) {
	        deferredEvents.push(() => publishWorkflowEvent({
	          eventType: 'INVOICE_STATUS_CHANGED',
	          payload: buildInvoiceStatusChangedPayload({
	            invoiceId: data.invoice_id,
	            previousStatus: String(invoice.status),
	            newStatus: String(newStatus),
	            changedAt: occurredAt,
              recurringProvenance,
	          }),
	          ctx: {
	            tenantId: context.tenant,
	            occurredAt,
	            actor: { actorType: 'USER', actorUserId: context.userId },
	          },
	        }));
	      }

	      // Publish event
	      deferredEvents.push(() => publishEvent({
	        eventType: 'INVOICE_REFUND_RECORDED',
	        payload: {
	          tenantId: context.tenant,
	          invoiceId: data.invoice_id,
	          refundAmount: data.refund_amount,
	          reason: data.reason,
	          netPaid,
	          newStatus,
	          userId: context.userId,
	          timestamp: new Date().toISOString()
	        }
	      }));

    });

    await publishDeferredEvents(deferredEvents);

    // Re-fetch after commit: getById runs on a pooled (non-transaction)
    // connection, so it must read the row only after the tx commits.
    return this.getById(data.invoice_id, context) as Promise<IInvoice>;
  }

  // ============================================================================
  // Bulk Operations
  // ============================================================================

  /**
   * Bulk update invoice status
   */
  async bulkUpdateStatus(data: BulkInvoiceStatusUpdate, context: ServiceContext): Promise<{ updated_count: number; errors: string[] }> {
    await this.validatePermissions(context, 'invoice', 'bulk_update');

    const { knex } = await this.getKnex();
    const deferredEvents: DeferredEvent[] = [];
    
    const result = await withTransaction(knex, async (trx) => {
      const results: { updated_count: number; errors: string[] } = { updated_count: 0, errors: [] };

      for (const invoiceId of data.invoice_ids) {
        try {
          const invoice = await tenantDb(trx, context.tenant).table('invoices')
            .where({ invoice_id: invoiceId })
            .first();

          if (!invoice) {
            results.errors.push(`Invoice ${invoiceId} not found`);
            continue;
          }

          // Validate status transition
          if (!this.isValidStatusTransition(invoice.status, data.status)) {
            results.errors.push(`Invalid status transition from ${invoice.status} to ${data.status} for invoice ${invoiceId}`);
            continue;
          }

          await tenantDb(trx, context.tenant).table('invoices')
            .where({ invoice_id: invoiceId })
            .update({
              status: data.status,
              finalized_at: data.finalized_at,
              updated_by: context.userId,
              updated_at: new Date()
            });

          results.updated_count++;
          const recurringProvenance = await this.getInvoiceRecurringProvenance(trx, context.tenant, invoiceId);

	          // Audit log
	          await auditLog(trx, {
	            userId: context.userId,
	            operation: 'UPDATE',
	            tableName: 'invoices',
	            recordId: invoiceId,
	            changedData: { status: data.status },
	            details: {
                action: 'invoice.bulk_status_update',
                old_status: invoice.status,
                ...(recurringProvenance ? { recurring_provenance: recurringProvenance } : {}),
              }
	          });

	          const occurredAt = new Date().toISOString();
	          const previousStatus = String(invoice.status);
	          const newStatus = String(data.status);

	          if (newStatus !== previousStatus) {
	            deferredEvents.push(() => publishWorkflowEvent({
	              eventType: 'INVOICE_STATUS_CHANGED',
	              payload: buildInvoiceStatusChangedPayload({
	                invoiceId,
	                previousStatus,
	                newStatus,
	                changedAt: occurredAt,
                  recurringProvenance,
	              }),
	              ctx: {
	                tenantId: context.tenant,
	                occurredAt,
	                actor: { actorType: 'USER', actorUserId: context.userId },
	              },
	            }));
	          }

	          if (newStatus === 'overdue' && previousStatus !== 'overdue') {
	            const amountDue = await this.getInvoiceAmountDue(trx, {
	              invoiceId,
	              totalAmount: Number(invoice.total_amount ?? 0),
	              creditApplied: Number(invoice.credit_applied ?? 0),
	              tenantId: context.tenant,
	            });

	            deferredEvents.push(() => publishWorkflowEvent({
	              eventType: 'INVOICE_OVERDUE',
	              payload: buildInvoiceOverduePayload({
	                invoiceId,
	                clientId: invoice.client_id,
	                overdueAt: occurredAt,
	                dueDate: toIsoDateString(invoice.due_date),
	                amountDue,
	                currency: String(invoice.currency_code ?? 'USD'),
                  recurringProvenance,
	              }),
	              ctx: {
	                tenantId: context.tenant,
	                occurredAt,
	                actor: { actorType: 'USER', actorUserId: context.userId },
	              },
	            }));
	          }

	          if (previousStatus === 'overdue' && newStatus === 'cancelled') {
	            const amountDue = await this.getInvoiceAmountDue(trx, {
	              invoiceId,
	              totalAmount: Number(invoice.total_amount ?? 0),
	              creditApplied: Number(invoice.credit_applied ?? 0),
	              tenantId: context.tenant,
	            });

	            if (amountDue > 0) {
	              deferredEvents.push(() => publishWorkflowEvent({
	                eventType: 'INVOICE_WRITTEN_OFF',
	                payload: buildInvoiceWrittenOffPayload({
	                  invoiceId,
	                  writtenOffAt: occurredAt,
	                  amountWrittenOff: amountDue,
	                  currency: String(invoice.currency_code ?? 'USD'),
                    recurringProvenance,
	                }),
	                ctx: {
	                  tenantId: context.tenant,
	                  occurredAt,
	                  actor: { actorType: 'USER', actorUserId: context.userId },
	                },
	              }));
	            }
	          }

	        } catch {
	          results.errors.push(`Error updating invoice ${invoiceId}: update failed.`);
	        }
      }

      // Publish bulk event
      deferredEvents.push(() => publishEvent({
        eventType: 'INVOICE_BULK_STATUS_UPDATE',
        payload: {
          tenantId: context.tenant,
          invoiceIds: data.invoice_ids,
          newStatus: data.status,
          updatedCount: results.updated_count,
          errorCount: results.errors.length,
          userId: context.userId,
          timestamp: new Date().toISOString()
        }
      }));

      return results;
    });

    await publishDeferredEvents(deferredEvents);
    return result;
  }

  /**
   * Bulk send invoices
   */
  async bulkSendInvoices(data: BulkInvoiceSend, context: ServiceContext): Promise<{ sent_count: number; errors: string[] }> {
    await this.validatePermissions(context, 'invoice', 'bulk_send');

    const results: { sent_count: number; errors: string[] } = { sent_count: 0, errors: [] };

    for (const invoiceId of data.invoice_ids) {
      try {
        await this.sendInvoice({
          invoice_id: invoiceId,
          email_addresses: [], // Would need to get from client
          include_pdf: data.include_pdf
        }, context);

        results.sent_count++;
      } catch {
        results.errors.push(`Error sending invoice ${invoiceId}: send failed.`);
      }
    }

    return results;
  }

  /**
   * Override bulk delete to match BaseService signature
   */
  async bulkDeleteInvoices(data: BulkInvoiceDelete, context: ServiceContext): Promise<{ deleted_count: number; errors: string[] }> {
    await this.validatePermissions(context, 'invoice', 'bulk_delete');

    const results: { deleted_count: number; errors: string[] } = { deleted_count: 0, errors: [] };

    for (const invoiceId of data.ids) {
      try {
        await this.delete(invoiceId, context);
        results.deleted_count++;
      } catch {
        results.errors.push(`Error deleting invoice ${invoiceId}: delete failed.`);
      }
    }

    return results;
  }

  // ============================================================================
  // Tax Operations
  // ============================================================================

  /**
   * Calculate taxes for an invoice
   */
  /**
   * Resolve the tax region for an invoice from the client's configured default tax
   * region (via getClientDefaultTaxRegionCode).
   *
   * Returns null when the client has no configured region. Callers must skip tax
   * calculation in that case rather than fabricate a region — we deliberately do NOT
   * fall back to a hardcoded country (e.g. 'US') or infer a tenant-wide default region.
   */
  private async resolveTaxRegion(
    trx: Knex.Transaction,
    tenant: string,
    clientId: string
  ): Promise<string | null> {
    return getClientDefaultTaxRegionCode(trx, tenant, clientId);
  }

  async calculateTaxes(data: TaxCalculationRequest, context: ServiceContext): Promise<TaxCalculationResponse> {
    await this.validatePermissions(context, 'invoice', 'calculate_tax');

    // Simplified tax calculation - would integrate with actual tax service
    const taxRate = 0.08; // 8% default tax rate
    const taxAmount = Math.round(data.amount * taxRate);

    return {
      tax_amount: taxAmount,
      tax_rate: taxRate,
      tax_region: data.tax_region,
      calculation_date: data.calculation_date || new Date().toISOString().split('T')[0]
    };
  }

  // ============================================================================
  // Statistics and Reporting
  // ============================================================================

  /**
   * Get invoice statistics
   */
  async getStatistics(context: ServiceContext, filters?: InvoiceFilter): Promise<any> {
    await this.validatePermissions(context, 'invoice', 'read');

    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      let baseQuery = tenantDb(trx, context.tenant).table('invoices');

      // Apply filters if provided
      if (filters) {
        baseQuery = this.applyInvoiceFilters(baseQuery, filters);
      }

      const [statusStats, monthlyStats, topClients] = await Promise.all([
        this.getStatusStatistics(baseQuery.clone(), trx),
        this.getMonthlyStatistics(baseQuery.clone(), trx),
        this.getTopClientsByRevenue(baseQuery.clone(), trx, context.tenant)
      ]);

      return {
        status_breakdown: statusStats,
        monthly_trends: monthlyStats,
        top_clients: topClients,
        generated_at: new Date().toISOString()
      };
    });
  }

  // ============================================================================
  // Missing Methods - Stub Implementations  
  // ============================================================================

  private requireRecurringSelectorInput<T extends { selector_input?: GenerateInvoice['selector_input'] | InvoicePreviewRequest['selector_input'] }>(
    data: T,
    action: 'generate' | 'preview',
  ) {
    if (!data.selector_input) {
      throw new ValidationError(`Recurring invoice ${action} requires selector_input.`);
    }

    return data.selector_input;
  }

  async generateRecurringInvoice(data: GenerateInvoice, context: InvoiceServiceContext): Promise<IInvoice> {
    await this.validatePermissions(context, 'invoice', 'create');

    const selectorInput = this.requireRecurringSelectorInput(data, 'generate');
    const invoice = await generateInvoiceForSelectionInput(selectorInput).catch(throwRecurringInvoiceApiError);
    if (isReturnedActionError(invoice)) {
      throwReturnedActionError(invoice);
    }

    if (!invoice) {
      throw new ConflictError('No invoice was generated for the selected recurring period. Zero-dollar invoices may be suppressed by billing settings.');
    }

    return invoice as unknown as IInvoice;
  }

  async generateManualInvoice(data: ManualInvoiceRequest, context: InvoiceServiceContext): Promise<IInvoice> {
    await this.validatePermissions(context, 'invoice', 'create');

    const { knex, tenant } = await this.getKnex();
    const invoiceId = uuidv4();
    const numberingService = new NumberingService({ knex, tenant });
    const invoiceNumber = await numberingService.getNextNumber('INVOICE');
    const currentDate = Temporal.Now.plainDateISO().toString();
    const sessionLike = { user: { id: context.userId } } as { user: { id: string } };

    let createdInvoice: InvoiceViewModel | null = null;

    try {
      await withTransaction(knex, async (trx) => {
        const client = await getClientDetails(trx, tenant, data.clientId);
        const computedDueDate = await this.computeDueDate(trx, tenant, data.clientId, currentDate);

        await tenantDb(trx, tenant).table('invoices').insert({
          invoice_id: invoiceId,
          tenant,
          client_id: data.clientId,
          invoice_number: invoiceNumber,
          invoice_date: currentDate,
          due_date: computedDueDate,
          status: 'draft',
          subtotal: 0,
          tax: 0,
          total_amount: 0,
          credit_applied: 0,
          is_manual: true,
          is_prepayment: data.isPrepayment ?? false
        });

        await persistManualInvoiceCharges(
          trx,
          invoiceId,
          data.items.map((item) => ({
            ...item,
            rate: Math.round(item.rate)
          })),
          client,
          sessionLike as any,
          tenant
        );

        await calculateAndDistributeTax(trx, invoiceId, client, this.taxService, tenant);

        await updateInvoiceTotalsAndRecordTransaction(
          trx,
          invoiceId,
          client,
          tenant,
          invoiceNumber,
          data.expirationDate,
          {
            transactionType: 'invoice_generated',
            description: `Generated manual invoice ${invoiceNumber}`
          }
        );

        const invoiceRecord = await tenantDb(trx, tenant).table('invoices')
          .where({ invoice_id: invoiceId })
          .first();

        const updatedItems = await tenantDb(trx, tenant).table('invoice_charges')
          .where({ invoice_id: invoiceId })
          .orderBy('created_at', 'asc');

        if (!invoiceRecord) {
          throw new Error('Created invoice could not be reloaded after insert.');
        }

        const invoiceDate = typeof invoiceRecord.invoice_date === 'string'
          ? Temporal.PlainDate.from(invoiceRecord.invoice_date)
          : Temporal.PlainDate.from(invoiceRecord.invoice_date.toISOString().split('T')[0]);

        const dueDate = typeof invoiceRecord.due_date === 'string'
          ? Temporal.PlainDate.from(invoiceRecord.due_date)
          : Temporal.PlainDate.from(invoiceRecord.due_date.toISOString().split('T')[0]);

        createdInvoice = {
          invoice_id: invoiceId,
          invoice_number: invoiceNumber,
          client_id: data.clientId,
          client: {
            name: client.client_name,
            logo: client.logoUrl || '',
            address: client.location_address || ''
          },
          contact: {
            name: '',
            address: ''
          },
          invoice_date: invoiceDate,
          due_date: dueDate,
          status: invoiceRecord.status,
          subtotal: Number(invoiceRecord.subtotal ?? 0),
          tax: Number(invoiceRecord.tax ?? 0),
          total: Number(invoiceRecord.total_amount ?? 0),
          total_amount: Number(invoiceRecord.total_amount ?? 0),
          currencyCode: invoiceRecord.currency_code || 'USD',
          invoice_charges: updatedItems.map((item: any): IInvoiceCharge => ({
            item_id: item.item_id,
            invoice_id: invoiceId,
            service_id: item.service_id,
            description: item.description,
            quantity: Number(item.quantity),
            unit_price: Number(item.unit_price),
            total_price: Number(item.total_price),
            tax_amount: Number(item.tax_amount),
            net_amount: Number(item.net_amount),
            tenant,
            is_manual: true,
            is_discount: item.is_discount || false,
            discount_type: item.discount_type,
            applies_to_item_id: item.applies_to_item_id,
            applies_to_service_id: item.applies_to_service_id,
            created_by: item.created_by,
            created_at: item.created_at,
            rate: Number(item.unit_price)
          })),
          credit_applied: Number(invoiceRecord.credit_applied ?? 0),
          is_manual: true
        };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.startsWith('Client not found')) {
        throw new NotFoundError('Client not found');
      }
      if (message.startsWith('Service not found:')) {
        throw new NotFoundError('Service not found');
      }
      if (message.startsWith('Could not find invoice item for service:')) {
        throw new ValidationError('Discount applies_to_service_id must reference an invoice item');
      }
      if (message === 'Quantity must be greater than 0') {
        throw new ValidationError('Quantity must be greater than 0');
      }
      throw error;
    }

    if (!createdInvoice) {
      throw new Error('Manual invoice creation completed without returning an invoice.');
    }

    return createdInvoice;
  }

  async approve(id: string, context: InvoiceServiceContext, executionId?: string): Promise<IInvoice> {
    throw new NotImplementedError('approve not yet implemented');
  }

  async reject(id: string, reason: string, context: InvoiceServiceContext, executionId?: string): Promise<IInvoice> {
    throw new NotImplementedError('reject not yet implemented');
  }

  async generatePDF(id: string, context: InvoiceServiceContext): Promise<any> {
    await this.validatePermissions(context, 'invoice', 'read');

    const { knex } = await this.getKnex();
    const invoice = await tenantDb(knex, context.tenant).table('invoices')
      .where({ invoice_id: id })
      .select('invoice_id', 'invoice_number')
      .first();

    if (!invoice) {
      throw new NotFoundError('Invoice not found');
    }

    const buffer = await this.getPdfService(context.tenant).generatePDF({
      invoiceId: id,
      userId: context.userId,
    });

    const safeInvoiceNumber = String(invoice.invoice_number || invoice.invoice_id)
      .replace(/[^a-zA-Z0-9._-]/g, '_');

    return {
      buffer,
      filename: `Invoice_${safeInvoiceNumber}.pdf`,
      contentType: 'application/pdf' as const,
    };
  }

  async search(query: any, context: InvoiceServiceContext, options?: any): Promise<{ data: IInvoice[]; total: number }> {
    throw new NotImplementedError('search not yet implemented');
  }

  async createRecurringTemplate(data: CreateRecurringInvoiceTemplate, context: InvoiceServiceContext): Promise<RecurringInvoiceTemplate> {
    throw new NotImplementedError('createRecurringTemplate not yet implemented');
  }

  // ============================================================================
  // Preview and Templates
  // ============================================================================

  /**
   * Generate invoice preview
   */
  async generatePreview(data: InvoicePreviewRequest, context: ServiceContext): Promise<PreviewInvoiceResponse> {
    await this.validatePermissions(context, 'invoice', 'preview');

    return previewInvoiceForSelectionInput(
      this.requireRecurringSelectorInput(data, 'preview'),
    );
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  protected buildBaseQuery(trx: Knex.Transaction, context: ServiceContext): Knex.QueryBuilder {
    const recurringInvoiceSummary = this.buildRecurringInvoiceSummaryQuery(trx, context);

    return tenantDb(trx, context.tenant).table('invoices')
      .leftJoin(recurringInvoiceSummary, 'recurring_invoice_summary.invoice_id', 'invoices.invoice_id')
      .select(
        'invoices.*',
        trx.raw('COALESCE(invoices.credit_applied, 0) as credit_applied'),
        trx.raw('(invoices.total_amount - COALESCE(invoices.credit_applied, 0)) as balance_due'),
        'recurring_invoice_summary.recurring_service_period_start',
        'recurring_invoice_summary.recurring_service_period_end',
        'recurring_invoice_summary.recurring_invoice_window_start',
        'recurring_invoice_summary.recurring_invoice_window_end',
        trx.raw(`
          CASE
            WHEN recurring_invoice_summary.recurring_cadence_owner = 'contract' THEN 'contract_cadence_window'
            WHEN recurring_invoice_summary.recurring_cadence_owner = 'client' THEN 'client_cadence_window'
            ELSE NULL
          END as recurring_execution_window_kind
        `),
        trx.raw(`
          CASE
            WHEN recurring_invoice_summary.recurring_cadence_owner = 'contract' THEN 'contract_anniversary'
            WHEN recurring_invoice_summary.recurring_cadence_owner = 'client' THEN 'client_schedule'
            ELSE NULL
          END as recurring_cadence_source
        `)
      );
  }

  private applyInvoiceFilters(query: Knex.QueryBuilder, filters: InvoiceFilter): Knex.QueryBuilder {
    Object.entries(filters).forEach(([key, value]) => {
      if (value === undefined || value === null) return;

      switch (key) {
        case 'status':
          if (Array.isArray(value)) {
            query.whereIn('invoices.status', value);
          } else {
            query.where('invoices.status', value);
          }
          break;
        case 'client_id':
          if (Array.isArray(value)) {
            query.whereIn('invoices.client_id', value);
          } else {
            query.where('invoices.client_id', value);
          }
          break;
        case 'invoice_number':
          query.whereILike('invoices.invoice_number', `%${value}%`);
          break;
        case 'invoice_date_from':
          query.where('invoices.invoice_date', '>=', value);
          break;
        case 'invoice_date_to':
          query.where('invoices.invoice_date', '<=', value);
          break;
        case 'due_date_from':
          query.where('invoices.due_date', '>=', value);
          break;
        case 'due_date_to':
          query.where('invoices.due_date', '<=', value);
          break;
        case 'min_amount':
          query.where('invoices.total_amount', '>=', value);
          break;
        case 'max_amount':
          query.where('invoices.total_amount', '<=', value);
          break;
        case 'is_manual':
          query.where('invoices.is_manual', value);
          break;
        case 'is_prepayment':
          query.where('invoices.is_prepayment', value);
          break;
        case 'has_billing_cycle':
          if (value) {
            query.whereNotNull('invoices.billing_cycle_id');
          } else {
            query.whereNull('invoices.billing_cycle_id');
          }
          break;
        case 'billing_cycle_id':
          query.where('invoices.billing_cycle_id', value);
          break;
        case 'execution_window_kind':
          if (value === 'contract_cadence_window') {
            query.where('recurring_invoice_summary.recurring_cadence_owner', 'contract');
          } else if (value === 'client_cadence_window') {
            query.where('recurring_invoice_summary.recurring_cadence_owner', 'client');
          }
          break;
        case 'cadence_source':
          if (value === 'contract_anniversary') {
            query.where('recurring_invoice_summary.recurring_cadence_owner', 'contract');
          } else if (value === 'client_schedule') {
            query.where('recurring_invoice_summary.recurring_cadence_owner', 'client');
          }
          break;
        case 'has_credit_applied':
          if (value) {
            query.where('invoices.credit_applied', '>', 0);
          } else {
            query.where('invoices.credit_applied', '=', 0);
          }
          break;
      }
    });

    return query;
  }

  private generateInvoiceLinks(invoice: any): any {
    return {
      self: `/api/v1/invoices/${invoice.invoice_id}`,
      finalize: `/api/v1/invoices/${invoice.invoice_id}/finalize`,
      send: `/api/v1/invoices/${invoice.invoice_id}/send`,
      payment: `/api/v1/invoices/${invoice.invoice_id}/payments`,
      credit: `/api/v1/invoices/${invoice.invoice_id}/credits`,
      pdf: `/api/v1/invoices/${invoice.invoice_id}/pdf`,
      collection: '/api/v1/invoices'
    };
  }

  private async validatePermissions(context: ServiceContext, resource: string, action: string): Promise<void> {
    // Permission validation would typically be handled at the middleware level
    // For now, we'll do a basic check that the user ID exists
    if (!context.userId) {
      throw new ForbiddenError(`Permission denied: ${action} - No user ID provided`);
    }
    // TODO: Implement proper permission checking when user object is available in context
  }

  private isValidStatusTransition(currentStatus: string, newStatus: string): boolean {
    const validTransitions: Record<string, string[]> = {
      'draft': ['sent', 'cancelled'],
      'sent': ['paid', 'partially_applied', 'overdue', 'cancelled'],
      'partially_applied': ['paid', 'sent', 'overdue', 'cancelled'], // 'sent' for full refund
      'overdue': ['paid', 'partially_applied', 'cancelled'],
      'paid': ['partially_applied', 'sent'], // Allow refund transitions
      'cancelled': [],
      'pending': ['sent', 'cancelled'],
      'prepayment': ['paid', 'cancelled']
    };

    return validTransitions[currentStatus]?.includes(newStatus) || false;
  }

  // Additional helper methods...
  async getInvoiceLineItems(
    invoiceId: string,
    trxOrContext: Knex.Transaction | ServiceContext,
    maybeContext?: ServiceContext
  ): Promise<IInvoiceCharge[]> {
    if (maybeContext) {
      return InvoiceModel.getInvoiceCharges(trxOrContext as Knex.Transaction, maybeContext.tenant, invoiceId);
    }

    const context = trxOrContext as ServiceContext;
    await this.validatePermissions(context, 'invoice', 'read');
    const { knex } = await this.getKnex();
    return withTransaction(knex, async (trx) => {
      const exists = await tenantDb(trx, context.tenant).table('invoices')
        .where({ invoice_id: invoiceId })
        .select('invoice_id')
        .first();

      if (!exists) {
        throw new NotFoundError('Invoice not found');
      }

      return InvoiceModel.getInvoiceCharges(trx, context.tenant, invoiceId);
    });
  }

  private async getInvoiceClient(clientId: string, trx: Knex.Transaction, context: ServiceContext): Promise<any> {
    const db = tenantDb(trx, context.tenant);

    return db.tenantJoin(
      db.table('clients as c'),
      'client_locations as cl',
      'c.client_id',
      'cl.client_id',
      {
        type: 'left',
        on(join) {
          join.andOn(function() {
            this.on('cl.is_billing_address', '=', trx.raw('true'))
              .orOn('cl.is_default', '=', trx.raw('true'));
          });
        },
      }
    )
      .where({ 'c.client_id': clientId })
      .select(
        'c.client_id',
        'c.client_name',
        'c.billing_email as email',
        trx.raw(`CONCAT_WS(', ', cl.address_line1, cl.address_line2, cl.city, cl.state_province, cl.postal_code, cl.country_name) as billing_address`),
        'cl.phone as phone_no'
      )
      .orderByRaw('cl.is_billing_address DESC, cl.is_default DESC')
      .first();
  }

  private async getBillingCycle(cycleId: string, trx: Knex.Transaction, context: ServiceContext): Promise<any> {
    return tenantDb(trx, context.tenant).table('client_billing_cycles')
      .where({ billing_cycle_id: cycleId })
      .first();
  }

  private async getTaxDetails(taxRateId: string, trx: Knex.Transaction, context: ServiceContext): Promise<any> {
    return tenantDb(trx, context.tenant).table('tax_rates')
      .where({ tax_rate_id: taxRateId })
      .first();
  }

  async getInvoiceTransactions(invoiceId: string, context: ServiceContext): Promise<any[]> {
    await this.validatePermissions(context, 'invoice', 'read');
    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      const exists = await tenantDb(trx, context.tenant).table('invoices')
        .where({ invoice_id: invoiceId })
        .select('invoice_id')
        .first();

      if (!exists) {
        throw new NotFoundError('Invoice not found');
      }

      const [payments, credits] = await Promise.all([
        this.getInvoicePayments(invoiceId, trx, context),
        this.getInvoiceCredits(invoiceId, trx, context),
      ]);

      return [...payments, ...credits].sort((a, b) => {
        const aDate = new Date(a.payment_date || a.applied_date || a.created_at || 0).getTime();
        const bDate = new Date(b.payment_date || b.applied_date || b.created_at || 0).getTime();
        return bDate - aDate;
      });
    });
  }

  private async getInvoicePayments(invoiceId: string, trx: Knex.Transaction, context: ServiceContext): Promise<any[]> {
    const hasTable = await trx.schema.hasTable('invoice_payments');
    if (!hasTable) {
      return [];
    }

    return tenantDb(trx, context.tenant).table('invoice_payments')
      .where({ invoice_id: invoiceId })
      .orderBy('payment_date', 'desc');
  }

  private async getInvoiceCredits(invoiceId: string, trx: Knex.Transaction, context: ServiceContext): Promise<any[]> {
    const hasTable = await trx.schema.hasTable('invoice_credits');
    if (!hasTable) {
      return [];
    }

    return tenantDb(trx, context.tenant).table('invoice_credits')
      .where({ invoice_id: invoiceId })
      .orderBy('applied_date', 'desc');
  }

  private async createInvoiceLineItems(invoiceId: string, lineItems: any[], trx: Knex.Transaction, context: ServiceContext): Promise<void> {
    const lineItemsData = lineItems.map((item, index) => ({
      item_id: uuidv4(),
      invoice_id: invoiceId,
      service_id: item.service_id,
      contract_line_id: item.contract_line_id,
      description: item.description,
      quantity: item.quantity || 1,
      unit_price: item.unit_price,
      total_price: item.total_price,
      tax_amount: item.tax_amount || 0,
      net_amount: item.net_amount || item.total_price,
      tax_region: item.tax_region,
      tax_rate: item.tax_rate,
      is_manual: item.is_manual || false,
      is_taxable: item.is_taxable,
      is_discount: item.is_discount || false,
      discount_type: item.discount_type,
      discount_percentage: item.discount_percentage,
      applies_to_item_id: item.applies_to_item_id,
      applies_to_service_id: item.applies_to_service_id,
      client_contract_id: item.client_contract_id,
      contract_name: item.contract_name,
      is_bundle_header: (item.is_bundle_header ?? item.is_bundle_header) || false,
      parent_item_id: item.parent_item_id,
      rate: item.rate,
      tenant: context.tenant,
      created_at: new Date()
    }));

    await tenantDb(trx, context.tenant).table('invoice_line_items').insert(lineItemsData);

    for (const item of lineItemsData) {
      await publishEvent({
        eventType: 'INVOICE_ITEM_CREATED',
        payload: {
          tenantId: context.tenant,
          invoiceId,
          itemId: item.item_id,
          userId: context.userId,
          timestamp: new Date().toISOString()
        }
      });
    }
  }

  private async sendInvoiceEmail(
    invoiceId: string,
    emailAddresses: string[],
    subject?: string,
    message?: string,
    context?: ServiceContext
  ): Promise<void> {
    // Email sending implementation would go here
    // This would integrate with your email service
  }

  private async getStatusStatistics(query: Knex.QueryBuilder, trx: Knex.Transaction): Promise<Record<string, any>> {
    const results = await query
      .groupBy('status')
      .select('status', trx.raw('COUNT(*) as count'), trx.raw('SUM(total_amount) as total'));

    return results.reduce((acc: any, item: any) => {
      acc[item.status] = {
        count: parseInt(item.count),
        total: parseFloat(item.total || 0)
      };
      return acc;
    }, {});
  }

  private async getMonthlyStatistics(query: Knex.QueryBuilder, trx: Knex.Transaction): Promise<any[]> {
    return query
      .select(
        trx.raw("DATE_TRUNC('month', invoice_date) as month"),
        trx.raw('COUNT(*) as count'),
        trx.raw('SUM(total_amount) as total')
      )
      .groupBy(trx.raw("DATE_TRUNC('month', invoice_date)"))
      .orderBy('month', 'desc')
      .limit(12);
  }

  private async getTopClientsByRevenue(query: Knex.QueryBuilder, trx: Knex.Transaction, tenant: string): Promise<any[]> {
    return tenantDb(trx, tenant).tenantJoin(query, 'clients', 'invoices.client_id', 'clients.client_id')
      .groupBy('clients.client_id', 'clients.client_name')
      .select(
        'clients.client_id',
        'clients.client_name',
        trx.raw('SUM(invoices.total_amount) as total_revenue'),
        trx.raw('COUNT(*) as invoice_count')
      )
      .orderBy('total_revenue', 'desc')
      .limit(10);
  }

  // ============================================================================
  // Alias Methods for Controller Compatibility
  // ============================================================================

  async calculateTax(request: TaxCalculationRequest, context: InvoiceServiceContext): Promise<TaxCalculationResponse> {
    return this.calculateTaxes(request, context);
  }

  async finalize(data: FinalizeInvoice, context: InvoiceServiceContext): Promise<IInvoice> {
    return this.finalizeInvoice(data, context);
  }

  async send(data: SendInvoice, context: InvoiceServiceContext): Promise<IInvoice> {
    return this.sendInvoice(data, context);
  }

  async bulkSend(data: BulkInvoiceSend, context: InvoiceServiceContext): Promise<any> {
    const result = await this.bulkSendInvoices(data, context);
    return {
      sent_count: Array.isArray(result) ? result.length : (result?.sent_count || 0),
      errors: Array.isArray(result) ? [] : (result?.errors || [])
    };
  }

  async getAnalytics(context: InvoiceServiceContext, dateRange?: any): Promise<InvoiceAnalytics> {
    return this.getStatistics(context, dateRange) as Promise<InvoiceAnalytics>;
  }

  async previewInvoice(request: InvoicePreviewRequest, context: InvoiceServiceContext): Promise<PreviewInvoiceResponse> {
    return this.generatePreview(request, context);
  }

  // ============================================================================
  // Missing Methods - Stub Implementations
  // ============================================================================

  async bulkDelete(ids: string[], context: ServiceContext): Promise<void> {
    throw new NotImplementedError('bulkDelete not yet implemented');
  }


}
