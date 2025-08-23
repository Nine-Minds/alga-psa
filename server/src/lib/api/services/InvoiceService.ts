/**
 * Invoice API Service
 * Comprehensive service layer for all invoice-related operations
 * Integrates with existing invoice server actions and database operations
 */

import { Knex } from 'knex';
import { Temporal } from '@js-temporal/polyfill';
import { v4 as uuidv4 } from 'uuid';
import { BaseService, ServiceContext, ListOptions, ListResult } from './BaseService';
import { withTransaction } from '@shared/db';
import { createTenantKnex } from '../../db';
import { getCurrentUser } from '../../actions/user-actions/userActions';
import { hasPermission } from '../../auth/rbac';
import { auditLog } from '../../logging/auditLog';
import { publishEvent } from '../../eventBus/publishers';

// Import existing service functions
import * as invoiceService from '../../services/invoiceService';
import { generateInvoiceNumber } from '../../actions/invoiceGeneration';
import { BillingEngine } from '../../billing/billingEngine';
import { TaxService } from '../../services/taxService';
import { NumberingService } from '../../services/numberingService';
import { PDFGenerationService, createPDFGenerationService } from '../../../services/pdf-generation.service';
import { StorageService } from '../../storage/StorageService';

// Import workflow actions
import { approveInvoice, rejectInvoice, processInvoiceEvent } from '../../actions/invoiceWorkflowActions';

// Import schemas and interfaces
import {
  CreateInvoice,
  UpdateInvoice,
  ManualInvoiceRequest,
  FinalizeInvoice,
  SendInvoice,
  ApplyCredit,
  InvoicePayment,
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
  IInvoiceItem,
  InvoiceViewModel,
  InvoiceStatus,
  DiscountType,
  PreviewInvoiceResponse
} from '../../../interfaces/invoice.interfaces';

import { IBillingResult, IBillingCharge, ICompanyBillingCycle } from '../../../interfaces/billing.interfaces';
import { ICompany } from '../../../interfaces/company.interfaces';
import { ISO8601String } from '../../../types/types.d';

export interface InvoiceServiceContext extends ServiceContext {
  permissions?: string[];
}

export interface InvoiceListOptions extends ListOptions {
  include_items?: boolean;
  include_company?: boolean;
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
  topCompanies: Array<{
    company_id: string;
    company_name: string;
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
  company?: string;
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
      if ((options as any).include_company) {
        // Use a subquery to get the billing address to avoid aggregate issues with Citus
        const billingAddressSubquery = trx('company_locations as cl')
          .select(
            'cl.company_id',
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
          .leftJoin('companies', 'invoices.company_id', 'companies.company_id')
          .leftJoin(billingAddressSubquery, function() {
            this.on('companies.company_id', '=', 'billing_loc.company_id')
                .andOn('companies.tenant', '=', 'billing_loc.tenant');
          })
          .select(
            'companies.company_name',
            trx.raw('COALESCE(billing_loc.formatted_address, \'\') as billing_address')
          );
      }

      if ((options as any).include_billing_cycle) {
        query = query.leftJoin('company_billing_cycles', 'invoices.billing_cycle_id', 'company_billing_cycles.cycle_id')
          .select('company_billing_cycles.period_start', 'company_billing_cycles.period_end');
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

      // Get total count
      const countQuery = this.buildBaseQuery(trx, context);
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
        const includeCompany = options?.include_company !== false;
  
        const [lineItems, company, billingCycle, taxDetails, payments, credits] = await Promise.all([
          includeItems ? this.getInvoiceLineItems(id, trx, context) : [],
          includeCompany ? this.getInvoiceCompany(invoice.company_id, trx, context) : null,
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
          result.invoice_items = lineItems; // Alias for controller compatibility
        }
        if (includeCompany) {
          result.company = company;
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
          company_id: data.company_id,
          amount: data.subtotal,
          tax_region: 'US' // Default, should come from company
        }, context);
      }

      // Prepare invoice data
      const invoiceData = {
        invoice_id: uuidv4(),
        invoice_number: invoiceNumber,
        company_id: data.company_id,
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

      // Publish event
      await publishEvent({
        eventType: 'INVOICE_CREATED',
        payload: {
          tenantId: context.tenant,
          invoiceId: invoice.invoice_id,
          invoiceNumber: invoiceNumber,
          companyId: data.company_id,
          totalAmount: invoice.total_amount,
          userId: context.userId,
          timestamp: new Date().toISOString()
        }
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
        
        await this.createInvoiceLineItems(id, data.items, trx, context);
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

      // Publish event
      await publishEvent({
        eventType: 'INVOICE_UPDATED',
        payload: {
          tenantId: context.tenant,
          invoiceId: id,
          changes: data,
          userId: context.userId,
          timestamp: new Date().toISOString()
        }
      });

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

      // Publish event
      await publishEvent({
        eventType: 'INVOICE_DELETED',
        payload: {
          tenantId: context.tenant,
          invoiceId: id,
          userId: context.userId,
          timestamp: new Date().toISOString()
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
      await publishEvent({
        eventType: 'INVOICE_SENT',
        payload: {
          tenantId: context.tenant,
          invoiceId: data.invoice_id,
          recipients: data.email_addresses,
          userId: context.userId,
          timestamp: new Date().toISOString()
        }
      });

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

      // Calculate total payments
      const payments = await trx('invoice_payments')
        .where({ invoice_id: data.invoice_id, tenant: context.tenant })
        .sum('amount as total_paid');

      const totalPaid = payments[0]?.total_paid || 0;

      // Update invoice status
      let newStatus = invoice.status;
      if (totalPaid >= invoice.total_amount) {
        newStatus = 'paid';
      } else if (totalPaid > 0) {
        newStatus = 'partially_applied'; // Using schema-defined status
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
      const newTotal = invoice.total_amount - newCreditApplied;

      // Update invoice status
      let newStatus = invoice.status;
      if (newTotal <= 0) {
        newStatus = 'paid';
      }

      await trx('invoices')
        .where({ invoice_id: data.invoice_id, tenant: context.tenant })
        .update({
          credit_applied: newCreditApplied,
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
        changedData: { total_amount: newTotal },
        details: { action: 'invoice.credit_applied', credit_amount: data.credit_amount }
      });

      // Publish event
      await publishEvent({
        eventType: 'INVOICE_CREDIT_APPLIED',
        payload: {
          tenantId: context.tenant,
          invoiceId: data.invoice_id,
          creditAmount: data.credit_amount,
          newTotal,
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
          email_addresses: [], // Would need to get from company
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

      const [statusStats, monthlyStats, topCompanies] = await Promise.all([
        this.getStatusStatistics(baseQuery.clone(), trx),
        this.getMonthlyStatistics(baseQuery.clone(), trx),
        this.getTopCompaniesByRevenue(baseQuery.clone(), trx)
      ]);

      return {
        status_breakdown: statusStats,
        monthly_trends: monthlyStats,
        top_companies: topCompanies,
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
    throw new Error('generateManualInvoice not yet implemented');
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
      const billingCycle = await trx('company_billing_cycles')
        .where({ cycle_id: data.billing_cycle_id, tenant: context.tenant })
        .first();

      if (!billingCycle) {
        return {
          success: false,
          error: 'Billing cycle not found'
        };
      }

      // Get company details with location
      const company = await trx('companies as c')
        .leftJoin('company_locations as cl', function() {
          this.on('c.company_id', '=', 'cl.company_id')
              .andOn('c.tenant', '=', 'cl.tenant')
              .andOn('cl.is_default', '=', trx.raw('true'));
        })
        .select(
          'c.*',
          'cl.address_line1 as location_address'
        )
        .where({ 'c.company_id': billingCycle.company_id, 'c.tenant': context.tenant })
        .first();

      if (!company) {
        return {
          success: false,
          error: 'Company not found'
        };
      }

      // Get tenant company details with location
      const tenantCompany = await trx('companies as c')
        .leftJoin('company_locations as cl', function() {
          this.on('c.company_id', '=', 'cl.company_id')
              .andOn('c.tenant', '=', 'cl.tenant')
              .andOn('cl.is_default', '=', trx.raw('true'));
        })
        .select(
          'c.*',
          'cl.address_line1 as location_address'
        )
        .where({ 'c.tenant': context.tenant, 'c.is_tenant_company': true })
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
            name: company.company_name,
            address: company.location_address || ''
          },
          tenantCompany: tenantCompany ? {
            name: tenantCompany.company_name,
            address: tenantCompany.location_address || '',
            logoUrl: tenantCompany.logo_url || null
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
        case 'company_id':
          if (Array.isArray(value)) {
            query.whereIn('invoices.company_id', value);
          } else {
            query.where('invoices.company_id', value);
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
      'partially_applied': ['paid', 'overdue', 'cancelled'],
      'overdue': ['paid', 'partially_applied', 'cancelled'],
      'paid': [],
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

  private async getInvoiceCompany(companyId: string, trx: Knex.Transaction, context: ServiceContext): Promise<any> {
    return trx('companies')
      .where({ company_id: companyId, tenant: context.tenant })
      .select('company_id', 'company_name', 'billing_address', 'email', 'phone_no')
      .first();
  }

  private async getBillingCycle(cycleId: string, trx: Knex.Transaction, context: ServiceContext): Promise<any> {
    return trx('company_billing_cycles')
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
      plan_id: item.plan_id,
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
      company_bundle_id: item.company_bundle_id,
      bundle_name: item.bundle_name,
      is_bundle_header: item.is_bundle_header || false,
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

  private async getTopCompaniesByRevenue(query: Knex.QueryBuilder, trx: Knex.Transaction): Promise<any[]> {
    return query
      .join('companies', 'invoices.company_id', 'companies.company_id')
      .groupBy('companies.company_id', 'companies.company_name')
      .select(
        'companies.company_id',
        'companies.company_name',
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
