/**
 * Invoice API Service
 * Comprehensive service layer for all invoice-related operations
 * Integrates with existing invoice server actions and database operations
 */

import { Knex } from 'knex';
import { Temporal } from '@js-temporal/polyfill';
import { v4 as uuidv4 } from 'uuid';
import { BaseService, ServiceContext, ListOptions, ListResult } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { createTenantKnex } from '../../db';
import { getCurrentUser } from '@alga-psa/users/actions';
import { hasPermission } from '../../auth/rbac';
import { auditLog } from '../../logging/auditLog';
import { publishEvent, publishWorkflowEvent } from '../../eventBus/publishers';
import {
  buildInvoiceDueDateChangedPayload,
  buildInvoiceOverduePayload,
  buildInvoiceSentPayload,
  buildInvoiceStatusChangedPayload,
  buildInvoiceWrittenOffPayload,
  inferInvoiceDeliveryMethod,
  toIsoDateString,
} from './invoiceWorkflowEvents';
import { buildPaymentAppliedPayload, buildPaymentRecordedPayload, buildPaymentRefundedPayload } from './paymentWorkflowEvents';

// Import existing service functions
import * as invoiceService from '../../services/invoiceService';
import { generateInvoiceNumber } from '@alga-psa/billing/actions/invoiceGeneration';
import { BillingEngine } from '../../billing/billingEngine';
import { TaxService } from '../../services/taxService';
import { NumberingService } from '../../services/numberingService';
import { PDFGenerationService, createPDFGenerationService } from '../../../services/pdf-generation.service';
import { StorageService } from '../../storage/StorageService';

// Import workflow actions
import { approveInvoice, rejectInvoice, processInvoiceEvent } from '@alga-psa/billing/actions/invoiceWorkflowActions';

// Import schemas and interfaces
import {
  CreateInvoice,
  UpdateInvoice,
  ManualInvoiceRequest,
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
  InvoicePreviewResponse
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
} from '../../services/invoiceService';

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
    const payments = await trx('invoice_payments')
      .where({ invoice_id: params.invoiceId, tenant: params.tenantId })
      .sum('amount as total_paid');

    const totalPayments = Number(payments[0]?.total_paid || 0);
    const amountDue = params.totalAmount - (params.creditApplied + totalPayments);
    return Math.max(0, amountDue);
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
      let query = this.buildBaseQuery(trx, context);

      // Apply filters
      if (filters) {
        query = this.applyInvoiceFilters(query, filters);
      }

      // Add joins based on include options
      if ((options as any).include_client) {
        // Use a subquery to get the billing address to avoid aggregate issues with Citus
        const billingAddressSubquery = trx('client_locations as cl')
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

        query = query
          .leftJoin('clients', 'invoices.client_id', 'clients.client_id')
          .leftJoin(billingAddressSubquery, function() {
            this.on('clients.client_id', '=', 'billing_loc.client_id')
                .andOn('clients.tenant', '=', 'billing_loc.tenant');
          })
          .select(
            'clients.client_name',
            trx.raw('COALESCE(billing_loc.formatted_address, \'\') as billing_address')
          );
      }

      if ((options as any).include_billing_cycle) {
        query = query.leftJoin('client_billing_cycles', 'invoices.billing_cycle_id', 'client_billing_cycles.cycle_id')
          .select('client_billing_cycles.period_start', 'client_billing_cycles.period_end');
      }

      if ((options as any).include_tax_details) {
        query = query.leftJoin('tax_rates', 'invoices.tax_rate_id', 'tax_rates.tax_rate_id')
          .select('tax_rates.rate_percentage', 'tax_rates.tax_name');
      }

      // Apply pagination, sorting, and execute
      const { page = 1, limit = 25, sort, order } = options;
      const offset = (page - 1) * limit;
      
      const sortField = sort || this.defaultSort;
      const sortOrder = order || this.defaultOrder;
      
      query.orderBy(`invoices.${sortField}`, sortOrder);
      query.limit(limit).offset(offset);

      // Get total count - use a separate query without SELECT columns to avoid GROUP BY issues
      const countQuery = trx('invoices')
        .where('invoices.tenant', context.tenant);

      if (filters) {
        this.applyInvoiceFilters(countQuery, filters);
      }

      const [data, [{ count }]] = await Promise.all([
        query,
        countQuery.count('* as count')
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
    
    return withTransaction(knex, async (trx) => {
      // Generate invoice number
      const invoiceNumber = await generateInvoiceNumber(trx);

      // Calculate taxes if needed
      let taxCalculation: { tax_amount: number; tax_region: string; tax_rate: number; calculation_date: string } | null = null;
      if (data.items?.length) {
        taxCalculation = await this.calculateTaxes({
          client_id: data.client_id,
          amount: data.subtotal,
          tax_region: 'US' // Default, should come from client
        }, context);
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
      const [invoice] = await trx('invoices').insert(invoiceData).returning('*');

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

      return this.getById(invoice.invoice_id, context) as Promise<IInvoice>;
    });
  }

  /**
   * Update an existing invoice
   */
  async update(id: string, data: UpdateInvoice, context: ServiceContext): Promise<IInvoice> {
    await this.validatePermissions(context, 'invoice', 'update');

    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      const existing = await trx('invoices')
        .where({ invoice_id: id, tenant: context.tenant })
        .first();

      if (!existing) {
        throw new Error('Invoice not found');
      }

      // Validate business rules
      if (existing.status === 'paid' && data.status && data.status !== 'paid') {
        throw new Error('Cannot modify paid invoice status');
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
      await trx('invoices')
        .where({ invoice_id: id, tenant: context.tenant })
        .update(updateData);

      // Update line items if provided
      if (data.items) {
        await trx('invoice_line_items')
          .where({ invoice_id: id, tenant: context.tenant })
          .del();
        
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

      // Audit log
      await auditLog(trx, {
        userId: context.userId,
        operation: 'UPDATE',
        tableName: 'invoices',
        recordId: id,
        changedData: data,
        details: { action: 'invoice.updated' }
      });

      const occurredAt = new Date().toISOString();
      const previousStatus = String(existing.status);
      const newStatus = updateData.status ? String(updateData.status) : previousStatus;

      const previousDueDate = toIsoDateString(existing.due_date);
      const nextDueDate = updateData.due_date ? toIsoDateString(updateData.due_date) : previousDueDate;

      if (newStatus !== previousStatus) {
        await publishWorkflowEvent({
          eventType: 'INVOICE_STATUS_CHANGED',
          payload: buildInvoiceStatusChangedPayload({
            invoiceId: id,
            previousStatus,
            newStatus,
            changedAt: occurredAt,
          }),
          ctx: {
            tenantId: context.tenant,
            occurredAt,
            actor: { actorType: 'USER', actorUserId: context.userId },
          },
        });
      }

      if (previousDueDate && nextDueDate && previousDueDate !== nextDueDate) {
        await publishWorkflowEvent({
          eventType: 'INVOICE_DUE_DATE_CHANGED',
          payload: buildInvoiceDueDateChangedPayload({
            invoiceId: id,
            previousDueDate,
            newDueDate: nextDueDate,
            changedAt: occurredAt,
          }),
          ctx: {
            tenantId: context.tenant,
            occurredAt,
            actor: { actorType: 'USER', actorUserId: context.userId },
          },
        });
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

        await publishWorkflowEvent({
          eventType: 'INVOICE_OVERDUE',
          payload: buildInvoiceOverduePayload({
            invoiceId: id,
            clientId: existing.client_id,
            overdueAt: occurredAt,
            dueDate: nextDueDate || previousDueDate,
            amountDue,
            currency: String(updateData.currency_code ?? existing.currency_code ?? 'USD'),
          }),
          ctx: {
            tenantId: context.tenant,
            occurredAt,
            actor: { actorType: 'USER', actorUserId: context.userId },
          },
        });
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
          await publishWorkflowEvent({
            eventType: 'INVOICE_WRITTEN_OFF',
            payload: buildInvoiceWrittenOffPayload({
              invoiceId: id,
              writtenOffAt: occurredAt,
              amountWrittenOff: amountDue,
              currency: String(updateData.currency_code ?? existing.currency_code ?? 'USD'),
            }),
            ctx: {
              tenantId: context.tenant,
              occurredAt,
              actor: { actorType: 'USER', actorUserId: context.userId },
            },
          });
        }
      }

      return this.getById(id, context) as Promise<IInvoice>;
    });
  }

  /**
   * Delete an invoice (soft delete if has payments)
   */
  async delete(id: string, context: ServiceContext): Promise<void> {
    await this.validatePermissions(context, 'invoice', 'delete');

    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      const invoice = await trx('invoices')
        .where({ invoice_id: id, tenant: context.tenant })
        .first();

      if (!invoice) {
        throw new Error('Invoice not found');
      }

      // Check if invoice has payments
	      const hasPayments = await trx('invoice_payments')
	        .where({ invoice_id: id, tenant: context.tenant })
	        .first();

	      const occurredAt = new Date().toISOString();
	      const softCancelled = Boolean(hasPayments || invoice.status === 'paid');

	      if (hasPayments || invoice.status === 'paid') {
	        // Soft delete - mark as cancelled
	        await trx('invoices')
	          .where({ invoice_id: id, tenant: context.tenant })
	          .update({
	            status: 'cancelled',
	            updated_by: context.userId,
	            updated_at: new Date()
	          });
	      } else {
        // Hard delete if no payments
        await trx('invoice_line_items')
          .where({ invoice_id: id, tenant: context.tenant })
          .del();
        
        await trx('invoices')
          .where({ invoice_id: id, tenant: context.tenant })
          .del();
      }

      // Audit log
	      await auditLog(trx, {
	        userId: context.userId,
	        operation: 'DELETE',
	        tableName: 'invoices',
	        recordId: id,
	        changedData: {},
	        details: { action: 'invoice.deleted' }
	      });

	      if (softCancelled && String(invoice.status) !== 'cancelled') {
	        await publishWorkflowEvent({
	          eventType: 'INVOICE_STATUS_CHANGED',
	          payload: buildInvoiceStatusChangedPayload({
	            invoiceId: id,
	            previousStatus: String(invoice.status),
	            newStatus: 'cancelled',
	            changedAt: occurredAt,
	          }),
	          ctx: {
	            tenantId: context.tenant,
	            occurredAt,
	            actor: { actorType: 'USER', actorUserId: context.userId },
	          },
	        });
	      }

	      // Publish event
	      await publishEvent({
	        eventType: 'INVOICE_DELETED',
	        payload: {
	          tenantId: context.tenant,
	          invoiceId: id,
	          userId: context.userId,
	          timestamp: occurredAt
	        }
	      });
    });
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
    
    return withTransaction(knex, async (trx) => {
      const invoice = await trx('invoices')
        .where({ invoice_id: data.invoice_id, tenant: context.tenant })
        .first();

      if (!invoice) {
        throw new Error('Invoice not found');
      }

      if (invoice.status !== 'draft') {
        throw new Error('Only draft invoices can be finalized');
      }

      // Validate invoice has required data
      const lineItems = await trx('invoice_line_items')
        .where({ invoice_id: data.invoice_id, tenant: context.tenant });

      if (!lineItems.length) {
        throw new Error('Invoice must have line items to be finalized');
      }

      // Calculate final amounts
      const subtotal = lineItems.reduce((sum: number, item: any) => sum + item.total_price, 0);
      const taxAmount = lineItems.reduce((sum: number, item: any) => sum + (item.tax_amount || 0), 0);
      const totalAmount = subtotal + taxAmount;

      // Update invoice status and amounts
      await trx('invoices')
        .where({ invoice_id: data.invoice_id, tenant: context.tenant })
        .update({
          status: 'sent', // Change to sent instead of finalized
          subtotal,
          tax: taxAmount,
          total_amount: totalAmount,
          finalized_at: data.finalized_at || new Date().toISOString().split('T')[0],
          updated_by: context.userId,
          updated_at: new Date()
        });

      // Audit log
      await auditLog(trx, {
        userId: context.userId,
        operation: 'UPDATE',
        tableName: 'invoices',
        recordId: data.invoice_id,
        changedData: { status: 'finalized', subtotal, tax_amount: taxAmount, total_amount: totalAmount },
        details: { action: 'invoice.finalized' }
      });

      // Publish event
      await publishEvent({
        eventType: 'INVOICE_FINALIZED',
        payload: {
          tenantId: context.tenant,
          invoiceId: data.invoice_id,
          totalAmount,
          userId: context.userId,
          timestamp: new Date().toISOString()
        }
      });

      await publishWorkflowEvent({
        eventType: 'INVOICE_STATUS_CHANGED',
        payload: buildInvoiceStatusChangedPayload({
          invoiceId: data.invoice_id,
          previousStatus: String(invoice.status),
          newStatus: 'sent',
          changedAt: new Date().toISOString(),
        }),
        ctx: {
          tenantId: context.tenant,
          actor: { actorType: 'USER', actorUserId: context.userId },
        },
      });

      return this.getById(data.invoice_id, context) as Promise<IInvoice>;
    });
  }

  /**
   * Send an invoice to the customer
   */
  async sendInvoice(data: SendInvoice, context: ServiceContext): Promise<IInvoice> {
    await this.validatePermissions(context, 'invoice', 'send');

    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      const invoice = await trx('invoices')
        .where({ invoice_id: data.invoice_id, tenant: context.tenant })
        .first();

      if (!invoice) {
        throw new Error('Invoice not found');
      }

      if (!['sent', 'draft'].includes(invoice.status)) {
        throw new Error('Only draft invoices can be sent');
      }

      // Generate PDF if requested
      let pdfPath = invoice.pdf_path;
      if (data.include_pdf) {
        const pdfService = this.getPdfService(context.tenant);
        // Note: This method doesn't exist in PDFGenerationService - would need to be implemented
        // pdfPath = await pdfService.generateInvoicePDF(invoice.invoice_id, context.tenant);
      }

      // Update invoice status
      await trx('invoices')
        .where({ invoice_id: data.invoice_id, tenant: context.tenant })
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

      // Audit log
      await auditLog(trx, {
        userId: context.userId,
        operation: 'UPDATE',
        tableName: 'invoices',
        recordId: data.invoice_id,
        changedData: { status: 'sent', sent_at: new Date() },
        details: { action: 'invoice.sent', recipients: data.email_addresses }
      });

      // Publish event
      const sentAt = new Date().toISOString();
      await publishWorkflowEvent({
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
        }),
        ctx: {
          tenantId: context.tenant,
          occurredAt: sentAt,
          actor: { actorType: 'USER', actorUserId: context.userId },
        },
      });

      if (String(invoice.status) !== 'sent') {
        await publishWorkflowEvent({
          eventType: 'INVOICE_STATUS_CHANGED',
          payload: buildInvoiceStatusChangedPayload({
            invoiceId: data.invoice_id,
            previousStatus: String(invoice.status),
            newStatus: 'sent',
            changedAt: sentAt,
          }),
          ctx: {
            tenantId: context.tenant,
            occurredAt: sentAt,
            actor: { actorType: 'USER', actorUserId: context.userId },
          },
        });
      }

      return this.getById(data.invoice_id, context) as Promise<IInvoice>;
    });
  }

  /**
   * Record a payment for an invoice
   */
  async recordPayment(data: InvoicePayment, context: ServiceContext): Promise<IInvoice> {
    await this.validatePermissions(context, 'invoice', 'payment');

    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      const occurredAt = new Date().toISOString();

      const invoice = await trx('invoices')
        .where({ invoice_id: data.invoice_id, tenant: context.tenant })
        .first();

      if (!invoice) {
        throw new Error('Invoice not found');
      }

      if (invoice.status === 'cancelled') {
        throw new Error('Cannot record payment for cancelled invoice');
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

      await trx('invoice_payments').insert(paymentData);

      await publishWorkflowEvent({
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
      });

      await publishWorkflowEvent({
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
      });

      // Calculate total payments
      const payments = await trx('invoice_payments')
        .where({ invoice_id: data.invoice_id, tenant: context.tenant })
        .sum('amount as total_paid');

      const totalPayments = Number(payments[0]?.total_paid || 0);

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

      await trx('invoices')
        .where({ invoice_id: data.invoice_id, tenant: context.tenant })
        .update({
          status: newStatus,
          updated_by: context.userId,
          updated_at: new Date()
        });

	      // Audit log
	      await auditLog(trx, {
	        userId: context.userId,
	        operation: 'UPDATE',
	        tableName: 'invoices',
	        recordId: data.invoice_id,
	        changedData: { status: newStatus, total_paid: totalPaid },
	        details: { action: 'invoice.payment_recorded', payment_amount: data.payment_amount }
	      });

	      if (String(newStatus) !== String(invoice.status)) {
	        await publishWorkflowEvent({
	          eventType: 'INVOICE_STATUS_CHANGED',
	          payload: buildInvoiceStatusChangedPayload({
	            invoiceId: data.invoice_id,
	            previousStatus: String(invoice.status),
	            newStatus: String(newStatus),
	            changedAt: occurredAt,
	          }),
	          ctx: {
	            tenantId: context.tenant,
	            occurredAt,
	            actor: { actorType: 'USER', actorUserId: context.userId },
	          },
	        });
	      }

	      // Publish event
	      await publishEvent({
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
	      });

      return this.getById(data.invoice_id, context) as Promise<IInvoice>;
    });
  }

  /**
   * Apply credit to an invoice
   */
  async applyCredit(data: ApplyCredit, context: ServiceContext): Promise<IInvoice> {
    await this.validatePermissions(context, 'invoice', 'credit');

    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      const invoice = await trx('invoices')
        .where({ invoice_id: data.invoice_id, tenant: context.tenant })
        .first();

      if (!invoice) {
        throw new Error('Invoice not found');
      }

      // Validate credit amount
      if (data.credit_amount <= 0) {
        throw new Error('Credit amount must be positive');
      }

      if (data.credit_amount > invoice.total_amount) {
        throw new Error('Credit amount cannot exceed invoice total');
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

      await trx('invoice_credits').insert(creditData);

      // Update invoice credit applied
      const newCreditApplied = (invoice.credit_applied || 0) + data.credit_amount;

      // Calculate total payments to determine correct status
      const payments = await trx('invoice_payments')
        .where({ invoice_id: data.invoice_id, tenant: context.tenant })
        .sum('amount as total_paid');
      const totalPayments = Number(payments[0]?.total_paid || 0);

      // Total paid includes both credits and payments
      const totalPaid = newCreditApplied + totalPayments;

      // Update invoice status based on total paid
      let newStatus = invoice.status;
      if (totalPaid >= invoice.total_amount) {
        newStatus = 'paid';
      } else if (totalPaid > 0 && invoice.status !== 'cancelled') {
        newStatus = 'partially_applied';
      }

      await trx('invoices')
        .where({ invoice_id: data.invoice_id, tenant: context.tenant })
        .update({
          credit_applied: newCreditApplied,
          status: newStatus,
          updated_by: context.userId,
          updated_at: new Date()
        });

      // Calculate remaining balance after credit application
      const remainingBalance = invoice.total_amount - totalPaid;

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
	        details: { action: 'invoice.credit_applied', credit_amount: data.credit_amount }
	      });

	      if (String(newStatus) !== String(invoice.status)) {
	        const occurredAt = new Date().toISOString();
	        await publishWorkflowEvent({
	          eventType: 'INVOICE_STATUS_CHANGED',
	          payload: buildInvoiceStatusChangedPayload({
	            invoiceId: data.invoice_id,
	            previousStatus: String(invoice.status),
	            newStatus: String(newStatus),
	            changedAt: occurredAt,
	          }),
	          ctx: {
	            tenantId: context.tenant,
	            occurredAt,
	            actor: { actorType: 'USER', actorUserId: context.userId },
	          },
	        });
	      }

	      // Publish event
	      await publishEvent({
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
	      });

      return this.getById(data.invoice_id, context) as Promise<IInvoice>;
    });
  }

  /**
   * Record a refund for an invoice payment
   * This handles non-Stripe refunds (manual refunds, check refunds, etc.)
   */
  async recordRefund(data: InvoiceRefund, context: ServiceContext): Promise<IInvoice> {
    await this.validatePermissions(context, 'invoice', 'refund');

    const { knex } = await this.getKnex();

    return withTransaction(knex, async (trx) => {
      const occurredAt = new Date().toISOString();

      const invoice = await trx('invoices')
        .where({ invoice_id: data.invoice_id, tenant: context.tenant })
        .first();

      if (!invoice) {
        throw new Error('Invoice not found');
      }

      // Validate refund amount
      if (data.refund_amount <= 0) {
        throw new Error('Refund amount must be positive');
      }

      // Calculate current payments
      const payments = await trx('invoice_payments')
        .where({ invoice_id: data.invoice_id, tenant: context.tenant })
        .sum('amount as total_paid');
      const totalPayments = Number(payments[0]?.total_paid || 0);

      if (data.refund_amount > totalPayments) {
        throw new Error('Refund amount cannot exceed total payments');
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

      await trx('invoice_payments').insert(refundData);

      await publishWorkflowEvent({
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
      });

      // Calculate net payments after refund
      const netPayments = await trx('invoice_payments')
        .where({ invoice_id: data.invoice_id, tenant: context.tenant })
        .sum('amount as total_paid');
      const netPaid = Number(netPayments[0]?.total_paid || 0);

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

      await trx('invoices')
        .where({ invoice_id: data.invoice_id, tenant: context.tenant })
        .update({
          status: newStatus,
          updated_by: context.userId,
          updated_at: new Date()
        });

	      // Audit log
	      await auditLog(trx, {
	        userId: context.userId,
	        operation: 'UPDATE',
	        tableName: 'invoices',
	        recordId: data.invoice_id,
	        changedData: { status: newStatus, refund_amount: data.refund_amount },
	        details: { action: 'invoice.refund_recorded', reason: data.reason }
	      });

	      if (String(newStatus) !== String(invoice.status)) {
	        await publishWorkflowEvent({
	          eventType: 'INVOICE_STATUS_CHANGED',
	          payload: buildInvoiceStatusChangedPayload({
	            invoiceId: data.invoice_id,
	            previousStatus: String(invoice.status),
	            newStatus: String(newStatus),
	            changedAt: occurredAt,
	          }),
	          ctx: {
	            tenantId: context.tenant,
	            occurredAt,
	            actor: { actorType: 'USER', actorUserId: context.userId },
	          },
	        });
	      }

	      // Publish event
	      await publishEvent({
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
	      });

      return this.getById(data.invoice_id, context) as Promise<IInvoice>;
    });
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
    
    return withTransaction(knex, async (trx) => {
      const results: { updated_count: number; errors: string[] } = { updated_count: 0, errors: [] };

      for (const invoiceId of data.invoice_ids) {
        try {
          const invoice = await trx('invoices')
            .where({ invoice_id: invoiceId, tenant: context.tenant })
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

          await trx('invoices')
            .where({ invoice_id: invoiceId, tenant: context.tenant })
            .update({
              status: data.status,
              finalized_at: data.finalized_at,
              updated_by: context.userId,
              updated_at: new Date()
            });

          results.updated_count++;

	          // Audit log
	          await auditLog(trx, {
	            userId: context.userId,
	            operation: 'UPDATE',
	            tableName: 'invoices',
	            recordId: invoiceId,
	            changedData: { status: data.status },
	            details: { action: 'invoice.bulk_status_update', old_status: invoice.status }
	          });

	          const occurredAt = new Date().toISOString();
	          const previousStatus = String(invoice.status);
	          const newStatus = String(data.status);

	          if (newStatus !== previousStatus) {
	            await publishWorkflowEvent({
	              eventType: 'INVOICE_STATUS_CHANGED',
	              payload: buildInvoiceStatusChangedPayload({
	                invoiceId,
	                previousStatus,
	                newStatus,
	                changedAt: occurredAt,
	              }),
	              ctx: {
	                tenantId: context.tenant,
	                occurredAt,
	                actor: { actorType: 'USER', actorUserId: context.userId },
	              },
	            });
	          }

	          if (newStatus === 'overdue' && previousStatus !== 'overdue') {
	            const amountDue = await this.getInvoiceAmountDue(trx, {
	              invoiceId,
	              totalAmount: Number(invoice.total_amount ?? 0),
	              creditApplied: Number(invoice.credit_applied ?? 0),
	              tenantId: context.tenant,
	            });

	            await publishWorkflowEvent({
	              eventType: 'INVOICE_OVERDUE',
	              payload: buildInvoiceOverduePayload({
	                invoiceId,
	                clientId: invoice.client_id,
	                overdueAt: occurredAt,
	                dueDate: toIsoDateString(invoice.due_date),
	                amountDue,
	                currency: String(invoice.currency_code ?? 'USD'),
	              }),
	              ctx: {
	                tenantId: context.tenant,
	                occurredAt,
	                actor: { actorType: 'USER', actorUserId: context.userId },
	              },
	            });
	          }

	          if (previousStatus === 'overdue' && newStatus === 'cancelled') {
	            const amountDue = await this.getInvoiceAmountDue(trx, {
	              invoiceId,
	              totalAmount: Number(invoice.total_amount ?? 0),
	              creditApplied: Number(invoice.credit_applied ?? 0),
	              tenantId: context.tenant,
	            });

	            if (amountDue > 0) {
	              await publishWorkflowEvent({
	                eventType: 'INVOICE_WRITTEN_OFF',
	                payload: buildInvoiceWrittenOffPayload({
	                  invoiceId,
	                  writtenOffAt: occurredAt,
	                  amountWrittenOff: amountDue,
	                  currency: String(invoice.currency_code ?? 'USD'),
	                }),
	                ctx: {
	                  tenantId: context.tenant,
	                  occurredAt,
	                  actor: { actorType: 'USER', actorUserId: context.userId },
	                },
	              });
	            }
	          }

	        } catch (error) {
	          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
	          results.errors.push(`Error updating invoice ${invoiceId}: ${errorMessage}`);
	        }
      }

      // Publish bulk event
      await publishEvent({
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
      });

      return results;
    });
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
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.errors.push(`Error sending invoice ${invoiceId}: ${errorMessage}`);
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
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.errors.push(`Error deleting invoice ${invoiceId}: ${errorMessage}`);
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
      let baseQuery = trx('invoices').where('tenant', context.tenant);

      // Apply filters if provided
      if (filters) {
        baseQuery = this.applyInvoiceFilters(baseQuery, filters);
      }

      const [statusStats, monthlyStats, topClients] = await Promise.all([
        this.getStatusStatistics(baseQuery.clone(), trx),
        this.getMonthlyStatistics(baseQuery.clone(), trx),
        this.getTopClientsByRevenue(baseQuery.clone(), trx)
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

  async generateFromBillingCycle(data: any, context: InvoiceServiceContext): Promise<IInvoice> {
    throw new Error('generateFromBillingCycle not yet implemented');
  }

  async generateManualInvoice(data: ManualInvoiceRequest, context: InvoiceServiceContext): Promise<IInvoice> {
    await this.validatePermissions(context, 'invoice', 'create');

    const { knex, tenant } = await this.getKnex();
    const invoiceId = uuidv4();
    const numberingService = new NumberingService();
    const invoiceNumber = await numberingService.getNextNumber('INVOICE');
    const currentDate = Temporal.Now.plainDateISO().toString();
    const sessionLike = { user: { id: context.userId } } as { user: { id: string } };

    let createdInvoice: InvoiceViewModel | null = null;

    await withTransaction(knex, async (trx) => {
      const client = await getClientDetails(trx, tenant, data.clientId);

      await trx('invoices').insert({
        invoice_id: invoiceId,
        tenant,
        client_id: data.clientId,
        invoice_number: invoiceNumber,
        invoice_date: currentDate,
        due_date: currentDate,
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

      const invoiceRecord = await trx('invoices')
        .where({ invoice_id: invoiceId, tenant })
        .first();

      const updatedItems = await trx('invoice_charges')
        .where({ invoice_id: invoiceId, tenant })
        .orderBy('created_at', 'asc');

      if (!invoiceRecord) {
        throw new Error('Failed to load created invoice record');
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

    if (!createdInvoice) {
      throw new Error('Failed to create manual invoice');
    }

    return createdInvoice;
  }

  async approve(id: string, context: InvoiceServiceContext, executionId?: string): Promise<IInvoice> {
    throw new Error('approve not yet implemented');
  }

  async reject(id: string, reason: string, context: InvoiceServiceContext, executionId?: string): Promise<IInvoice> {
    throw new Error('reject not yet implemented');
  }

  async generatePDF(id: string, context: InvoiceServiceContext): Promise<any> {
    throw new Error('generatePDF not yet implemented');
  }

  async search(query: any, context: InvoiceServiceContext, options?: any): Promise<{ data: IInvoice[]; total: number }> {
    throw new Error('search not yet implemented');
  }

  async createRecurringTemplate(data: CreateRecurringInvoiceTemplate, context: InvoiceServiceContext): Promise<RecurringInvoiceTemplate> {
    throw new Error('createRecurringTemplate not yet implemented');
  }

  // ============================================================================
  // Preview and Templates
  // ============================================================================

  /**
   * Generate invoice preview
   */
  async generatePreview(data: InvoicePreviewRequest, context: ServiceContext): Promise<InvoicePreviewResponse> {
    await this.validatePermissions(context, 'invoice', 'preview');

    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      // Get billing cycle details
      const billingCycle = await trx('client_billing_cycles')
        .where({ cycle_id: data.billing_cycle_id, tenant: context.tenant })
        .first();

      if (!billingCycle) {
        return {
          success: false,
          error: 'Billing cycle not found'
        };
      }

      // Get client details with location
      const client = await trx('clients as c')
        .leftJoin('client_locations as cl', function() {
          this.on('c.client_id', '=', 'cl.client_id')
              .andOn('c.tenant', '=', 'cl.tenant')
              .andOn('cl.is_default', '=', trx.raw('true'));
        })
        .select(
          'c.*',
          'cl.address_line1 as location_address'
        )
        .where({ 'c.client_id': billingCycle.client_id, 'c.tenant': context.tenant })
        .first();

      if (!client) {
        return {
          success: false,
          error: 'Client not found'
        };
      }

      // Get tenant client details with location
      const tenantClient = await trx('clients as c')
        .leftJoin('client_locations as cl', function() {
          this.on('c.client_id', '=', 'cl.client_id')
              .andOn('c.tenant', '=', 'cl.tenant')
              .andOn('cl.is_default', '=', trx.raw('true'));
        })
        .select(
          'c.*',
          'cl.address_line1 as location_address'
        )
        .where({ 'c.tenant': context.tenant, 'c.is_tenant_client': true })
        .first();

      // Generate preview data
      const invoiceNumber = 'PREVIEW-' + Date.now();
      const issueDate = new Date().toISOString().split('T')[0];
      const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      // Mock line items - would be calculated from billing cycle
      const items = [
        {
          id: '1',
          description: 'Service Fee',
          quantity: 1,
          unitPrice: 100,
          total: 100
        }
      ];

      const subtotal = items.reduce((sum, item) => sum + item.total, 0);
      const tax = Math.round(subtotal * 0.08);
      const total = subtotal + tax;

      return {
        success: true,
        data: {
          invoiceNumber,
          issueDate,
          dueDate,
          customer: {
            name: client.client_name,
            address: client.location_address || ''
          },
          tenantClient: tenantClient ? {
            name: tenantClient.client_name,
            address: tenantClient.location_address || '',
            logoUrl: tenantClient.logo_url || null
          } : null,
          items,
          subtotal,
          tax,
          total
        }
      };
    });
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  protected buildBaseQuery(trx: Knex.Transaction, context: ServiceContext): Knex.QueryBuilder {
    return trx('invoices')
      .where('invoices.tenant', context.tenant)
      .select(
        'invoices.*',
        trx.raw('COALESCE(invoices.credit_applied, 0) as credit_applied'),
        trx.raw('(invoices.total_amount - COALESCE(invoices.credit_applied, 0)) as balance_due')
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
      throw new Error(`Permission denied: ${action} - No user ID provided`);
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
  private async getInvoiceLineItems(invoiceId: string, trx: Knex.Transaction, context: ServiceContext): Promise<any[]> {
    return trx('invoice_line_items')
      .where({ invoice_id: invoiceId, tenant: context.tenant })
      .orderBy('line_number');
  }

  private async getInvoiceClient(clientId: string, trx: Knex.Transaction, context: ServiceContext): Promise<any> {
    return trx('clients')
      .where({ client_id: clientId, tenant: context.tenant })
      .select('client_id', 'client_name', 'billing_address', 'email', 'phone_no')
      .first();
  }

  private async getBillingCycle(cycleId: string, trx: Knex.Transaction, context: ServiceContext): Promise<any> {
    return trx('client_billing_cycles')
      .where({ cycle_id: cycleId, tenant: context.tenant })
      .first();
  }

  private async getTaxDetails(taxRateId: string, trx: Knex.Transaction, context: ServiceContext): Promise<any> {
    return trx('tax_rates')
      .where({ tax_rate_id: taxRateId, tenant: context.tenant })
      .first();
  }

  private async getInvoicePayments(invoiceId: string, trx: Knex.Transaction, context: ServiceContext): Promise<any[]> {
    return trx('invoice_payments')
      .where({ invoice_id: invoiceId, tenant: context.tenant })
      .orderBy('payment_date', 'desc');
  }

  private async getInvoiceCredits(invoiceId: string, trx: Knex.Transaction, context: ServiceContext): Promise<any[]> {
    return trx('invoice_credits')
      .where({ invoice_id: invoiceId, tenant: context.tenant })
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

    await trx('invoice_line_items').insert(lineItemsData);
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

  private async getTopClientsByRevenue(query: Knex.QueryBuilder, trx: Knex.Transaction): Promise<any[]> {
    return query
      .join('clients', 'invoices.client_id', 'clients.client_id')
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

  async previewInvoice(request: InvoicePreviewRequest, context: InvoiceServiceContext): Promise<InvoicePreviewResponse> {
    return this.generatePreview(request, context);
  }

  // ============================================================================
  // Missing Methods - Stub Implementations
  // ============================================================================

  async bulkDelete(ids: string[], context: ServiceContext): Promise<void> {
    throw new Error('bulkDelete not yet implemented');
  }


}
