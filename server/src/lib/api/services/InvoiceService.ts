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
  protected tableName = 'invoices';
  protected primaryKey = 'invoice_id';
  protected tenantColumn = 'tenant';
  
  private taxService: TaxService;
  private billingEngine: BillingEngine;
  private pdfService: PDFGenerationService;
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
      searchableFields: ['invoice_number', 'description'],
      defaultSort: 'created_at',
      defaultOrder: 'desc'
    });
    
    this.taxService = new TaxService();
    this.billingEngine = new BillingEngine();
    this.pdfService = createPDFGenerationService();
    this.storageService = new StorageService();
  }

  // ============================================================================
  // CRUD Operations
  // ============================================================================

  /**
   * List invoices with advanced filtering and pagination
   */
  async list(
    options: InvoiceListOptions,
    context: InvoiceServiceContext,
    filters?: InvoiceFilter
  ): Promise<ListResult<IInvoice & { _links?: InvoiceHATEOASLinks }>> {
    await this.validatePermissions(context, 'invoice:read');

    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      let query = this.buildBaseQuery(trx, context);

      // Apply filters
      if (filters) {
        query = this.applyInvoiceFilters(query, filters);
      }

      // Add joins based on include options
      if (options.include_company) {
        query = query.leftJoin('companies', 'invoices.company_id', 'companies.company_id')
          .select('companies.company_name', 'companies.billing_address');
      }

      if (options.include_billing_cycle) {
        query = query.leftJoin('company_billing_cycles', 'invoices.billing_cycle_id', 'company_billing_cycles.cycle_id')
          .select('company_billing_cycles.period_start', 'company_billing_cycles.period_end');
      }

      // Execute query with pagination
      const result = await this.executePaginatedQuery(query, options);

      // Add HATEOAS links
      result.data = result.data.map(invoice => ({
        ...invoice,
        _links: this.generateHATEOASLinks(invoice, context)
      }));

      // Load invoice items if requested
      if (options.include_items) {
        for (const invoice of result.data) {
          invoice.invoice_items = await this.getInvoiceItems(trx, invoice.invoice_id, context);
        }
      }

      return result;
    });
  }

  /**
   * Get single invoice by ID with HATEOAS links
   */
  async getById(
    id: string,
    context: InvoiceServiceContext,
    options: InvoiceListOptions = {}
  ): Promise<(IInvoice & { _links?: InvoiceHATEOASLinks }) | null> {
    await this.validatePermissions(context, 'invoice:read');

    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      let query = this.buildBaseQuery(trx, context)
        .where(`${this.tableName}.${this.primaryKey}`, id);

      // Add joins based on options
      if (options.include_company) {
        query = query.leftJoin('companies', 'invoices.company_id', 'companies.company_id')
          .select('companies.company_name', 'companies.billing_address');
      }

      const invoice = await query.first();
      if (!invoice) return null;

      // Add HATEOAS links
      invoice._links = this.generateHATEOASLinks(invoice, context);

      // Load related data
      if (options.include_items) {
        invoice.invoice_items = await this.getInvoiceItems(trx, invoice.invoice_id, context);
      }

      if (options.include_transactions) {
        invoice.transactions = await this.getInvoiceTransactions(trx, invoice.invoice_id, context);
      }

      await auditLog(context.userId, 'invoice:read', 'Invoice viewed', {
        invoice_id: invoice.invoice_id,
        invoice_number: invoice.invoice_number
      });

      return invoice;
    });
  }

  /**
   * Create new invoice
   */
  async create(
    data: CreateInvoice,
    context: InvoiceServiceContext
  ): Promise<IInvoice & { _links?: InvoiceHATEOASLinks }> {
    await this.validatePermissions(context, 'invoice:create');

    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      const invoiceId = uuidv4();
      const invoiceNumber = await generateInvoiceNumber();
      const now = Temporal.Now.instant().toString();

      const invoiceData = {
        invoice_id: invoiceId,
        invoice_number: invoiceNumber,
        tenant: context.tenant,
        created_by: context.userId,
        created_at: now,
        updated_at: now,
        ...data
      };

      const [invoice] = await trx(this.tableName)
        .insert(invoiceData)
        .returning('*');

      // Create invoice items if provided
      if (data.items && data.items.length > 0) {
        await this.createInvoiceItems(trx, invoiceId, data.items, context);
      }

      // Add HATEOAS links
      invoice._links = this.generateHATEOASLinks(invoice, context);

      await auditLog(context.userId, 'invoice:create', 'Invoice created', {
        invoice_id: invoice.invoice_id,
        invoice_number: invoice.invoice_number
      });

      await publishEvent('invoice.created', {
        invoice_id: invoice.invoice_id,
        tenant: context.tenant,
        user_id: context.userId
      });

      return invoice;
    });
  }

  /**
   * Update existing invoice
   */
  async update(
    id: string,
    data: UpdateInvoice,
    context: InvoiceServiceContext
  ): Promise<IInvoice & { _links?: InvoiceHATEOASLinks }> {
    await this.validatePermissions(context, 'invoice:update');

    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      // Check if invoice exists and is editable
      const existingInvoice = await this.buildBaseQuery(trx, context)
        .where(`${this.primaryKey}`, id)
        .first();

      if (!existingInvoice) {
        throw new Error('Invoice not found');
      }

      if (!this.isInvoiceEditable(existingInvoice)) {
        throw new Error('Invoice cannot be modified in its current state');
      }

      const updateData = {
        ...data,
        updated_by: context.userId,
        updated_at: Temporal.Now.instant().toString()
      };

      const [invoice] = await trx(this.tableName)
        .where(this.primaryKey, id)
        .andWhere(this.tenantColumn, context.tenant)
        .update(updateData)
        .returning('*');

      // Add HATEOAS links
      invoice._links = this.generateHATEOASLinks(invoice, context);

      await auditLog(context.userId, 'invoice:update', 'Invoice updated', {
        invoice_id: invoice.invoice_id,
        invoice_number: invoice.invoice_number,
        changes: updateData
      });

      await publishEvent('invoice.updated', {
        invoice_id: invoice.invoice_id,
        tenant: context.tenant,
        user_id: context.userId
      });

      return invoice;
    });
  }

  /**
   * Delete invoice (soft delete if configured)
   */
  async delete(id: string, context: InvoiceServiceContext): Promise<boolean> {
    await this.validatePermissions(context, 'invoice:delete');

    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      const invoice = await this.buildBaseQuery(trx, context)
        .where(`${this.primaryKey}`, id)
        .first();

      if (!invoice) {
        throw new Error('Invoice not found');
      }

      if (!this.isInvoiceDeletable(invoice)) {
        throw new Error('Invoice cannot be deleted in its current state');
      }

      const deleted = await trx(this.tableName)
        .where(this.primaryKey, id)
        .andWhere(this.tenantColumn, context.tenant)
        .del();

      await auditLog(context.userId, 'invoice:delete', 'Invoice deleted', {
        invoice_id: invoice.invoice_id,
        invoice_number: invoice.invoice_number
      });

      await publishEvent('invoice.deleted', {
        invoice_id: invoice.invoice_id,
        tenant: context.tenant,
        user_id: context.userId
      });

      return deleted > 0;
    });
  }

  // ============================================================================
  // Invoice Generation
  // ============================================================================

  /**
   * Generate invoice from billing cycle
   */
  async generateFromBillingCycle(
    billingCycleId: string,
    context: InvoiceServiceContext
  ): Promise<IInvoice & { _links?: InvoiceHATEOASLinks }> {
    await this.validatePermissions(context, 'invoice:create');

    const { session, knex, tenant } = await invoiceService.validateSessionAndTenant();
    
    return withTransaction(knex, async (trx) => {
      // Get billing cycle details
      const billingCycle = await trx('company_billing_cycles')
        .where({ cycle_id: billingCycleId, tenant })
        .first();

      if (!billingCycle) {
        throw new Error('Billing cycle not found');
      }

      // Get company details
      const company = await invoiceService.getCompanyDetails(knex, tenant, billingCycle.company_id);

      // Generate billing charges using existing billing engine
      const billingResult: IBillingResult = await this.billingEngine.generateCharges({
        companyId: billingCycle.company_id,
        cycleId: billingCycleId,
        periodStart: billingCycle.period_start,
        periodEnd: billingCycle.period_end,
        includeUsage: true,
        includeTime: true,
        includeFixed: true
      });

      // Create invoice
      const invoiceId = uuidv4();
      const invoiceNumber = await generateInvoiceNumber();
      const now = Temporal.Now.instant().toString();

      const invoice = {
        invoice_id: invoiceId,
        company_id: billingCycle.company_id,
        billing_cycle_id: billingCycleId,
        invoice_date: Temporal.Now.plainDateISO().toString(),
        due_date: Temporal.Now.plainDateISO().add({ days: 30 }).toString(), // TODO: Use company payment terms
        invoice_number: invoiceNumber,
        status: 'draft' as InvoiceStatus,
        subtotal: 0,
        tax: 0,
        total_amount: 0,
        credit_applied: 0,
        is_manual: false,
        billing_period_start: billingCycle.period_start,
        billing_period_end: billingCycle.period_end,
        tenant,
        created_by: context.userId,
        created_at: now,
        updated_at: now
      };

      await trx('invoices').insert(invoice);

      // Persist billing charges as invoice items
      const subtotal = await invoiceService.persistInvoiceItems(
        trx,
        invoiceId,
        billingResult.charges,
        company,
        session,
        tenant
      );

      // Calculate and distribute tax
      const computedTotalTax = await invoiceService.calculateAndDistributeTax(
        trx,
        invoiceId,
        company,
        this.taxService
      );

      // Update invoice totals and record transaction
      await invoiceService.updateInvoiceTotalsAndRecordTransaction(
        trx,
        invoiceId,
        company,
        tenant,
        invoiceNumber
      );

      // Get final invoice
      const finalInvoice = await trx('invoices')
        .where({ invoice_id: invoiceId })
        .first();

      finalInvoice._links = this.generateHATEOASLinks(finalInvoice, context);

      await auditLog(context.userId, 'invoice:generate', 'Invoice generated from billing cycle', {
        invoice_id: invoiceId,
        billing_cycle_id: billingCycleId,
        invoice_number: invoiceNumber
      });

      await publishEvent('invoice.generated', {
        invoice_id: invoiceId,
        billing_cycle_id: billingCycleId,
        tenant: context.tenant,
        user_id: context.userId
      });

      return finalInvoice;
    });
  }

  /**
   * Create manual invoice
   */
  async generateManualInvoice(
    request: ManualInvoiceRequest,
    context: InvoiceServiceContext
  ): Promise<InvoiceViewModel> {
    await this.validatePermissions(context, 'invoice:create');

    const { session, knex, tenant } = await invoiceService.validateSessionAndTenant();
    
    return withTransaction(knex, async (trx) => {
      const { companyId, items, expirationDate, isPrepayment } = request;

      // Get company details
      const company = await invoiceService.getCompanyDetails(knex, tenant, companyId);
      const currentDate = Temporal.Now.plainDateISO().toString();

      // Generate invoice number and create invoice
      const invoiceNumber = await generateInvoiceNumber();
      const invoiceId = uuidv4();
      const now = Temporal.Now.instant().toString();

      const invoice = {
        invoice_id: invoiceId,
        tenant,
        company_id: companyId,
        invoice_date: currentDate,
        due_date: currentDate, // TODO: Calculate based on payment terms
        invoice_number: invoiceNumber,
        status: 'draft' as InvoiceStatus,
        subtotal: 0,
        tax: 0,
        total_amount: 0,
        credit_applied: 0,
        is_manual: true,
        is_prepayment: isPrepayment || false,
        created_by: context.userId,
        created_at: now,
        updated_at: now
      };

      await trx('invoices').insert(invoice);

      // Persist manual invoice items
      const subtotal = await invoiceService.persistManualInvoiceItems(
        trx,
        invoiceId,
        items,
        company,
        session,
        tenant
      );

      // Calculate and distribute tax
      const computedTotalTax = await invoiceService.calculateAndDistributeTax(
        trx,
        invoiceId,
        company,
        this.taxService
      );

      // Update invoice totals and record transaction
      await invoiceService.updateInvoiceTotalsAndRecordTransaction(
        trx,
        invoiceId,
        company,
        tenant,
        invoiceNumber,
        isPrepayment ? expirationDate : undefined
      );

      // Build invoice view model
      const viewModel = await this.buildInvoiceViewModel(trx, invoiceId, context);

      await auditLog(context.userId, 'invoice:create_manual', 'Manual invoice created', {
        invoice_id: invoiceId,
        company_id: companyId,
        invoice_number: invoiceNumber,
        is_prepayment: isPrepayment
      });

      await publishEvent('invoice.manual_created', {
        invoice_id: invoiceId,
        company_id: companyId,
        tenant: context.tenant,
        user_id: context.userId
      });

      return viewModel;
    });
  }

  /**
   * Preview invoice before generation
   */
  async previewInvoice(
    request: InvoicePreviewRequest,
    context: InvoiceServiceContext
  ): Promise<InvoicePreviewResponse> {
    await this.validatePermissions(context, 'invoice:read');

    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      try {
        const { billing_cycle_id } = request;

        // Get billing cycle
        const billingCycle = await trx('company_billing_cycles')
          .where({ cycle_id: billing_cycle_id, tenant: context.tenant })
          .first();

        if (!billingCycle) {
          return { success: false, error: 'Billing cycle not found' };
        }

        // Get company details
        const company = await invoiceService.getCompanyDetails(knex, context.tenant, billingCycle.company_id);

        // Generate preview charges
        const billingResult = await this.billingEngine.generateCharges({
          companyId: billingCycle.company_id,
          cycleId: billing_cycle_id,
          periodStart: billingCycle.period_start,
          periodEnd: billingCycle.period_end,
          includeUsage: true,
          includeTime: true,
          includeFixed: true
        });

        // Calculate totals
        const subtotal = billingResult.charges.reduce((sum, charge) => sum + charge.total, 0);
        const tax = billingResult.charges.reduce((sum, charge) => sum + (charge.tax_amount || 0), 0);

        const previewData = {
          invoiceNumber: `Preview-${Date.now()}`,
          issueDate: Temporal.Now.plainDateISO().toString(),
          dueDate: Temporal.Now.plainDateISO().add({ days: 30 }).toString(),
          customer: {
            name: company.company_name,
            address: company.billing_address || ''
          },
          tenantCompany: null, // TODO: Get tenant company info
          items: billingResult.charges.map(charge => ({
            id: charge.serviceId || 'unknown',
            description: charge.serviceName,
            quantity: charge.quantity,
            unitPrice: charge.rate,
            total: charge.total
          })),
          subtotal,
          tax,
          total: subtotal + tax
        };

        return { success: true, data: previewData };
      } catch (error) {
        return { 
          success: false, 
          error: error instanceof Error ? error.message : 'Preview generation failed' 
        };
      }
    });
  }

  // ============================================================================
  // Invoice Status Transitions
  // ============================================================================

  /**
   * Finalize invoice (draft → finalized)
   */
  async finalize(
    data: FinalizeInvoice,
    context: InvoiceServiceContext
  ): Promise<IInvoice & { _links?: InvoiceHATEOASLinks }> {
    await this.validatePermissions(context, 'invoice:finalize');

    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      const { invoice_id, finalized_at } = data;

      const invoice = await this.buildBaseQuery(trx, context)
        .where(`${this.primaryKey}`, invoice_id)
        .first();

      if (!invoice) {
        throw new Error('Invoice not found');
      }

      if (invoice.status !== 'draft') {
        throw new Error('Only draft invoices can be finalized');
      }

      const finalizedDate = finalized_at || Temporal.Now.plainDateISO().toString();

      const [updatedInvoice] = await trx(this.tableName)
        .where(this.primaryKey, invoice_id)
        .andWhere(this.tenantColumn, context.tenant)
        .update({
          status: 'pending',
          finalized_at: finalizedDate,
          updated_by: context.userId,
          updated_at: Temporal.Now.instant().toString()
        })
        .returning('*');

      updatedInvoice._links = this.generateHATEOASLinks(updatedInvoice, context);

      await auditLog(context.userId, 'invoice:finalize', 'Invoice finalized', {
        invoice_id,
        invoice_number: invoice.invoice_number,
        finalized_at: finalizedDate
      });

      await publishEvent('invoice.finalized', {
        invoice_id,
        tenant: context.tenant,
        user_id: context.userId
      });

      return updatedInvoice;
    });
  }

  /**
   * Send invoice (finalized → sent)
   */
  async send(
    data: SendInvoice,
    context: InvoiceServiceContext
  ): Promise<{ success: boolean; message: string; sent_at?: string }> {
    await this.validatePermissions(context, 'invoice:send');

    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      const { invoice_id, email_addresses, subject, message, include_pdf } = data;

      const invoice = await this.buildBaseQuery(trx, context)
        .where(`${this.primaryKey}`, invoice_id)
        .first();

      if (!invoice) {
        throw new Error('Invoice not found');
      }

      if (!['pending', 'sent'].includes(invoice.status)) {
        throw new Error('Invoice must be finalized before sending');
      }

      // Generate PDF if requested
      let pdfUrl: string | undefined;
      if (include_pdf) {
        const pdfResult = await this.generatePDF(invoice_id, context);
        pdfUrl = pdfResult.download_url;
      }

      // TODO: Implement email sending service
      // For now, we'll just update the status and log the action

      const sentAt = Temporal.Now.instant().toString();

      await trx(this.tableName)
        .where(this.primaryKey, invoice_id)
        .andWhere(this.tenantColumn, context.tenant)
        .update({
          status: 'sent',
          updated_by: context.userId,
          updated_at: sentAt
        });

      await auditLog(context.userId, 'invoice:send', 'Invoice sent', {
        invoice_id,
        invoice_number: invoice.invoice_number,
        email_addresses,
        include_pdf,
        sent_at: sentAt
      });

      await publishEvent('invoice.sent', {
        invoice_id,
        email_addresses,
        tenant: context.tenant,
        user_id: context.userId
      });

      return {
        success: true,
        message: 'Invoice sent successfully',
        sent_at: sentAt
      };
    });
  }

  /**
   * Approve invoice
   */
  async approve(
    invoiceId: string,
    context: InvoiceServiceContext,
    executionId?: string
  ): Promise<any> {
    await this.validatePermissions(context, 'invoice:approve');

    const result = await approveInvoice(invoiceId, executionId);

    await auditLog(context.userId, 'invoice:approve', 'Invoice approved', {
      invoice_id: invoiceId,
      execution_id: executionId
    });

    await publishEvent('invoice.approved', {
      invoice_id: invoiceId,
      tenant: context.tenant,
      user_id: context.userId
    });

    return result;
  }

  /**
   * Reject invoice
   */
  async reject(
    invoiceId: string,
    reason: string,
    context: InvoiceServiceContext,
    executionId?: string
  ): Promise<any> {
    await this.validatePermissions(context, 'invoice:reject');

    const result = await rejectInvoice(invoiceId, reason, executionId);

    await auditLog(context.userId, 'invoice:reject', 'Invoice rejected', {
      invoice_id: invoiceId,
      reason,
      execution_id: executionId
    });

    await publishEvent('invoice.rejected', {
      invoice_id: invoiceId,
      reason,
      tenant: context.tenant,
      user_id: context.userId
    });

    return result;
  }

  // ============================================================================
  // Payment Processing
  // ============================================================================

  /**
   * Record payment against invoice
   */
  async recordPayment(
    data: InvoicePayment,
    context: InvoiceServiceContext
  ): Promise<{ success: boolean; payment_id: string; remaining_balance: number }> {
    await this.validatePermissions(context, 'invoice:payment');

    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      const { 
        invoice_id, 
        payment_amount, 
        payment_method, 
        payment_date, 
        reference_number, 
        notes 
      } = data;

      const invoice = await this.buildBaseQuery(trx, context)
        .where(`${this.primaryKey}`, invoice_id)
        .first();

      if (!invoice) {
        throw new Error('Invoice not found');
      }

      // Calculate remaining balance
      const currentPaid = await trx('transactions')
        .where({ invoice_id, type: 'payment', tenant: context.tenant })
        .sum('amount as total_paid')
        .first();

      const totalPaid = (currentPaid?.total_paid || 0) + payment_amount;
      const remainingBalance = invoice.total_amount - totalPaid;

      // Create payment transaction
      const paymentId = uuidv4();
      const paymentRecord = {
        transaction_id: paymentId,
        invoice_id,
        amount: payment_amount,
        type: 'payment',
        status: 'completed',
        payment_method,
        reference_number,
        description: notes || `Payment for invoice ${invoice.invoice_number}`,
        created_at: payment_date || Temporal.Now.instant().toString(),
        created_by: context.userId,
        tenant: context.tenant
      };

      await trx('transactions').insert(paymentRecord);

      // Update invoice status if fully paid
      const newStatus = remainingBalance <= 0 ? 'paid' : invoice.status;
      
      await trx(this.tableName)
        .where(this.primaryKey, invoice_id)
        .andWhere(this.tenantColumn, context.tenant)
        .update({
          status: newStatus,
          updated_by: context.userId,
          updated_at: Temporal.Now.instant().toString()
        });

      await auditLog(context.userId, 'invoice:payment', 'Payment recorded', {
        invoice_id,
        payment_id: paymentId,
        payment_amount,
        payment_method,
        remaining_balance: remainingBalance
      });

      await publishEvent('invoice.payment_received', {
        invoice_id,
        payment_id: paymentId,
        payment_amount,
        remaining_balance: remainingBalance,
        tenant: context.tenant,
        user_id: context.userId
      });

      return {
        success: true,
        payment_id: paymentId,
        remaining_balance: remainingBalance
      };
    });
  }

  /**
   * Apply credit to invoice
   */
  async applyCredit(
    data: ApplyCredit,
    context: InvoiceServiceContext
  ): Promise<{ success: boolean; credit_applied: number; remaining_balance: number }> {
    await this.validatePermissions(context, 'invoice:credit');

    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      const { invoice_id, credit_amount, transaction_id } = data;

      const invoice = await this.buildBaseQuery(trx, context)
        .where(`${this.primaryKey}`, invoice_id)
        .first();

      if (!invoice) {
        throw new Error('Invoice not found');
      }

      // Apply credit using existing function
      // TODO: Adapt applyCreditToInvoice function to work with our context
      const result = {
        success: true,
        credit_applied: credit_amount,
        remaining_balance: Math.max(0, invoice.total_amount - invoice.credit_applied - credit_amount)
      };

      await auditLog(context.userId, 'invoice:credit_applied', 'Credit applied to invoice', {
        invoice_id,
        credit_amount,
        transaction_id
      });

      await publishEvent('invoice.credit_applied', {
        invoice_id,
        credit_amount,
        tenant: context.tenant,
        user_id: context.userId
      });

      return result;
    });
  }

  // ============================================================================
  // PDF Generation and Document Management
  // ============================================================================

  /**
   * Generate PDF for invoice
   */
  async generatePDF(
    invoiceId: string,
    context: InvoiceServiceContext
  ): Promise<{ file_id: string; download_url?: string }> {
    await this.validatePermissions(context, 'invoice:pdf');

    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      // Get invoice view model
      const viewModel = await this.buildInvoiceViewModel(trx, invoiceId, context);

      // Generate PDF using existing service
      const pdfResult = await this.pdfService.generateInvoicePDF(viewModel);

      await auditLog(context.userId, 'invoice:pdf_generated', 'Invoice PDF generated', {
        invoice_id: invoiceId,
        file_id: pdfResult.fileId
      });

      return {
        file_id: pdfResult.fileId,
        download_url: pdfResult.downloadUrl
      };
    });
  }

  // ============================================================================
  // Tax Calculations
  // ============================================================================

  /**
   * Calculate tax for invoice items
   */
  async calculateTax(
    request: TaxCalculationRequest,
    context: InvoiceServiceContext
  ): Promise<TaxCalculationResponse> {
    await this.validatePermissions(context, 'invoice:tax');

    const { company_id, amount, tax_region, calculation_date } = request;

    const result = await this.taxService.calculateTax(
      company_id,
      amount,
      calculation_date || Temporal.Now.plainDateISO().toString(),
      tax_region
    );

    return {
      tax_amount: result.taxAmount,
      tax_rate: result.taxRate,
      tax_region,
      calculation_date: calculation_date || Temporal.Now.plainDateISO().toString()
    };
  }

  // ============================================================================
  // Bulk Operations
  // ============================================================================

  /**
   * Bulk update invoice status
   */
  async bulkUpdateStatus(
    data: BulkInvoiceStatusUpdate,
    context: InvoiceServiceContext
  ): Promise<{ updated_count: number; errors: string[] }> {
    await this.validatePermissions(context, 'invoice:bulk_update');

    const { knex } = await this.getKnex();
    const { invoice_ids, status, finalized_at } = data;
    const errors: string[] = [];
    let updated_count = 0;

    return withTransaction(knex, async (trx) => {
      for (const invoiceId of invoice_ids) {
        try {
          const invoice = await this.buildBaseQuery(trx, context)
            .where(`${this.primaryKey}`, invoiceId)
            .first();

          if (!invoice) {
            errors.push(`Invoice ${invoiceId} not found`);
            continue;
          }

          if (!this.isStatusTransitionValid(invoice.status, status)) {
            errors.push(`Invalid status transition for invoice ${invoiceId}: ${invoice.status} → ${status}`);
            continue;
          }

          const updateData: any = {
            status,
            updated_by: context.userId,
            updated_at: Temporal.Now.instant().toString()
          };

          if (finalized_at && status === 'pending') {
            updateData.finalized_at = finalized_at;
          }

          await trx(this.tableName)
            .where(this.primaryKey, invoiceId)
            .andWhere(this.tenantColumn, context.tenant)
            .update(updateData);

          updated_count++;
        } catch (error) {
          errors.push(`Error updating invoice ${invoiceId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      await auditLog(context.userId, 'invoice:bulk_status_update', 'Bulk invoice status update', {
        updated_count,
        errors_count: errors.length,
        status
      });

      return { updated_count, errors };
    });
  }

  /**
   * Bulk send invoices
   */
  async bulkSend(
    data: BulkInvoiceSend,
    context: InvoiceServiceContext
  ): Promise<{ sent_count: number; errors: string[] }> {
    await this.validatePermissions(context, 'invoice:bulk_send');

    const { invoice_ids, email_template, include_pdf } = data;
    const errors: string[] = [];
    let sent_count = 0;

    // TODO: Implement bulk sending logic
    // For now, return placeholder response

    await auditLog(context.userId, 'invoice:bulk_send', 'Bulk invoice send', {
      sent_count,
      errors_count: errors.length
    });

    return { sent_count, errors };
  }

  /**
   * Bulk delete invoices
   */
  async bulkDelete(
    data: BulkInvoiceDelete,
    context: InvoiceServiceContext
  ): Promise<{ deleted_count: number; errors: string[] }> {
    await this.validatePermissions(context, 'invoice:bulk_delete');

    const { knex } = await this.getKnex();
    const { ids } = data;
    const errors: string[] = [];
    let deleted_count = 0;

    return withTransaction(knex, async (trx) => {
      for (const invoiceId of ids) {
        try {
          const invoice = await this.buildBaseQuery(trx, context)
            .where(`${this.primaryKey}`, invoiceId)
            .first();

          if (!invoice) {
            errors.push(`Invoice ${invoiceId} not found`);
            continue;
          }

          if (!this.isInvoiceDeletable(invoice)) {
            errors.push(`Invoice ${invoiceId} cannot be deleted in its current state`);
            continue;
          }

          await trx(this.tableName)
            .where(this.primaryKey, invoiceId)
            .andWhere(this.tenantColumn, context.tenant)
            .del();

          deleted_count++;
        } catch (error) {
          errors.push(`Error deleting invoice ${invoiceId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      await auditLog(context.userId, 'invoice:bulk_delete', 'Bulk invoice delete', {
        deleted_count,
        errors_count: errors.length
      });

      return { deleted_count, errors };
    });
  }

  // ============================================================================
  // Search and Analytics
  // ============================================================================

  /**
   * Advanced invoice search
   */
  async search(
    query: string,
    context: InvoiceServiceContext,
    options: ListOptions = {}
  ): Promise<ListResult<IInvoice & { _links?: InvoiceHATEOASLinks }>> {
    await this.validatePermissions(context, 'invoice:read');

    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      let searchQuery = this.buildBaseQuery(trx, context)
        .leftJoin('companies', 'invoices.company_id', 'companies.company_id')
        .where(function() {
          this.where('invoices.invoice_number', 'ilike', `%${query}%`)
            .orWhere('companies.company_name', 'ilike', `%${query}%`)
            .orWhere('invoices.status', 'ilike', `%${query}%`);
        })
        .select('invoices.*', 'companies.company_name');

      const result = await this.executePaginatedQuery(searchQuery, options);

      // Add HATEOAS links
      result.data = result.data.map(invoice => ({
        ...invoice,
        _links: this.generateHATEOASLinks(invoice, context)
      }));

      return result;
    });
  }

  /**
   * Get invoice analytics
   */
  async getAnalytics(
    context: InvoiceServiceContext,
    dateRange?: { from: string; to: string }
  ): Promise<InvoiceAnalytics> {
    await this.validatePermissions(context, 'invoice:analytics');

    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      let baseQuery = this.buildBaseQuery(trx, context);

      if (dateRange) {
        baseQuery = baseQuery.whereBetween('invoice_date', [dateRange.from, dateRange.to]);
      }

      // Total metrics
      const totalMetrics = await baseQuery.clone()
        .select(
          trx.raw('COUNT(*) as total_invoices'),
          trx.raw('SUM(total_amount) as total_amount'),
          trx.raw('AVG(total_amount) as average_amount')
        )
        .first();

      // Status breakdown
      const statusBreakdown = await baseQuery.clone()
        .select('status')
        .count('* as count')
        .groupBy('status');

      // Monthly trends (last 12 months)
      const monthlyTrends = await baseQuery.clone()
        .select(
          trx.raw("DATE_TRUNC('month', invoice_date) as month"),
          trx.raw('COUNT(*) as count'),
          trx.raw('SUM(total_amount) as amount')
        )
        .where('invoice_date', '>=', Temporal.Now.plainDateISO().subtract({ months: 12 }).toString())
        .groupBy(trx.raw("DATE_TRUNC('month', invoice_date)"))
        .orderBy('month');

      // Top companies
      const topCompanies = await baseQuery.clone()
        .leftJoin('companies', 'invoices.company_id', 'companies.company_id')
        .select(
          'invoices.company_id',
          'companies.company_name',
          trx.raw('SUM(total_amount) as total_amount'),
          trx.raw('COUNT(*) as invoice_count')
        )
        .groupBy('invoices.company_id', 'companies.company_name')
        .orderBy('total_amount', 'desc')
        .limit(10);

      // Overdue metrics
      const overdueMetrics = await baseQuery.clone()
        .where('status', 'overdue')
        .select(
          trx.raw('COUNT(*) as count'),
          trx.raw('SUM(total_amount) as amount'),
          trx.raw('AVG(EXTRACT(days FROM NOW() - due_date)) as average_days_overdue')
        )
        .first();

      return {
        totalInvoices: parseInt(totalMetrics.total_invoices) || 0,
        totalAmount: parseFloat(totalMetrics.total_amount) || 0,
        averageAmount: parseFloat(totalMetrics.average_amount) || 0,
        statusBreakdown: statusBreakdown.reduce((acc, item) => {
          acc[item.status as InvoiceStatus] = parseInt(item.count);
          return acc;
        }, {} as Record<InvoiceStatus, number>),
        monthlyTrends: monthlyTrends.map(item => ({
          month: item.month,
          count: parseInt(item.count),
          amount: parseFloat(item.amount)
        })),
        topCompanies: topCompanies.map(item => ({
          company_id: item.company_id,
          company_name: item.company_name,
          total_amount: parseFloat(item.total_amount),
          invoice_count: parseInt(item.invoice_count)
        })),
        overdueMetrics: {
          count: parseInt(overdueMetrics?.count) || 0,
          amount: parseFloat(overdueMetrics?.amount) || 0,
          averageDaysOverdue: parseFloat(overdueMetrics?.average_days_overdue) || 0
        }
      };
    });
  }

  // ============================================================================
  // Recurring Invoices
  // ============================================================================

  /**
   * Create recurring invoice template
   */
  async createRecurringTemplate(
    data: CreateRecurringInvoiceTemplate,
    context: InvoiceServiceContext
  ): Promise<RecurringInvoiceTemplate> {
    await this.validatePermissions(context, 'invoice:recurring');

    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      const templateId = uuidv4();
      const now = Temporal.Now.instant().toString();

      const template = {
        template_id: templateId,
        tenant: context.tenant,
        created_by: context.userId,
        created_at: now,
        updated_at: now,
        next_generation_date: data.start_date,
        ...data
      };

      const [created] = await trx('recurring_invoice_templates')
        .insert(template)
        .returning('*');

      await auditLog(context.userId, 'invoice:recurring_template_created', 'Recurring invoice template created', {
        template_id: templateId,
        company_id: data.company_id,
        frequency: data.frequency
      });

      return created;
    });
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private async validatePermissions(context: InvoiceServiceContext, permission: string): Promise<void> {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error('User not found');
    }

    const hasPermissionToPerform = await hasPermission(user.user_id, permission);
    if (!hasPermissionToPerform) {
      throw new Error(`Insufficient permissions: ${permission}`);
    }
  }

  private applyInvoiceFilters(query: Knex.QueryBuilder, filters: InvoiceFilter): Knex.QueryBuilder {
    // Status filters
    if (filters.status && filters.status.length > 0) {
      query = query.whereIn('status', filters.status);
    }
    if (filters.exclude_status && filters.exclude_status.length > 0) {
      query = query.whereNotIn('status', filters.exclude_status);
    }

    // Date filters
    if (filters.invoice_date_from) {
      query = query.where('invoice_date', '>=', filters.invoice_date_from);
    }
    if (filters.invoice_date_to) {
      query = query.where('invoice_date', '<=', filters.invoice_date_to);
    }
    if (filters.due_date_from) {
      query = query.where('due_date', '>=', filters.due_date_from);
    }
    if (filters.due_date_to) {
      query = query.where('due_date', '<=', filters.due_date_to);
    }

    // Amount filters
    if (filters.min_amount !== undefined) {
      query = query.where('total_amount', '>=', filters.min_amount);
    }
    if (filters.max_amount !== undefined) {
      query = query.where('total_amount', '<=', filters.max_amount);
    }

    // Company filters
    if (filters.company_id && filters.company_id.length > 0) {
      query = query.whereIn('company_id', filters.company_id);
    }
    if (filters.company_name) {
      query = query.leftJoin('companies', 'invoices.company_id', 'companies.company_id')
        .where('companies.company_name', 'ilike', `%${filters.company_name}%`);
    }

    // Type filters
    if (filters.is_manual !== undefined) {
      query = query.where('is_manual', filters.is_manual);
    }
    if (filters.is_prepayment !== undefined) {
      query = query.where('is_prepayment', filters.is_prepayment);
    }

    // Other filters
    if (filters.invoice_number) {
      query = query.where('invoice_number', 'ilike', `%${filters.invoice_number}%`);
    }
    if (filters.billing_cycle_id) {
      query = query.where('billing_cycle_id', filters.billing_cycle_id);
    }

    return query;
  }

  private generateHATEOASLinks(invoice: IInvoice, context: InvoiceServiceContext): InvoiceHATEOASLinks {
    const baseUrl = `/api/v1/invoices/${invoice.invoice_id}`;
    
    const links: InvoiceHATEOASLinks = {
      self: baseUrl,
      items: `${baseUrl}/items`,
      company: `/api/v1/companies/${invoice.company_id}`,
      pdf: `${baseUrl}/pdf`,
      duplicate: `${baseUrl}/duplicate`
    };

    // Add conditional links based on invoice status and permissions
    if (invoice.billing_cycle_id) {
      links.billing_cycle = `/api/v1/billing-cycles/${invoice.billing_cycle_id}`;
    }

    links.transactions = `${baseUrl}/transactions`;

    // Status-dependent actions
    if (invoice.status === 'draft') {
      links.finalize = `${baseUrl}/finalize`;
    }

    if (['pending', 'sent'].includes(invoice.status)) {
      links.send = `${baseUrl}/send`;
    }

    if (['sent', 'overdue'].includes(invoice.status)) {
      links.payment = `${baseUrl}/payments`;
      links.credit = `${baseUrl}/credits`;
    }

    // Workflow actions (if applicable)
    if (invoice.status === 'pending') {
      links.approve = `${baseUrl}/approve`;
      links.reject = `${baseUrl}/reject`;
    }

    return links;
  }

  private async getInvoiceItems(
    trx: Knex.Transaction,
    invoiceId: string,
    context: InvoiceServiceContext
  ): Promise<IInvoiceItem[]> {
    return trx('invoice_items')
      .where({ invoice_id: invoiceId, tenant: context.tenant })
      .select('*');
  }

  private async getInvoiceTransactions(
    trx: Knex.Transaction,
    invoiceId: string,
    context: InvoiceServiceContext
  ): Promise<any[]> {
    return trx('transactions')
      .where({ invoice_id: invoiceId, tenant: context.tenant })
      .select('*')
      .orderBy('created_at', 'desc');
  }

  private async createInvoiceItems(
    trx: Knex.Transaction,
    invoiceId: string,
    items: any[],
    context: InvoiceServiceContext
  ): Promise<void> {
    const now = Temporal.Now.instant().toString();
    
    const itemsToInsert = items.map(item => ({
      item_id: uuidv4(),
      invoice_id: invoiceId,
      tenant: context.tenant,
      created_by: context.userId,
      created_at: now,
      updated_at: now,
      ...item
    }));

    await trx('invoice_items').insert(itemsToInsert);
  }

  private async buildInvoiceViewModel(
    trx: Knex.Transaction,
    invoiceId: string,
    context: InvoiceServiceContext
  ): Promise<InvoiceViewModel> {
    // Get invoice with company and items
    const invoice = await trx('invoices')
      .leftJoin('companies', 'invoices.company_id', 'companies.company_id')
      .where('invoices.invoice_id', invoiceId)
      .andWhere('invoices.tenant', context.tenant)
      .select(
        'invoices.*',
        'companies.company_name',
        'companies.billing_address'
      )
      .first();

    if (!invoice) {
      throw new Error('Invoice not found');
    }

    const items = await this.getInvoiceItems(trx, invoiceId, context);

    // Build view model (simplified version)
    return {
      invoice_id: invoice.invoice_id,
      invoice_number: invoice.invoice_number,
      company_id: invoice.company_id,
      company: {
        name: invoice.company_name,
        address: invoice.billing_address
      },
      contact: {
        name: invoice.company_name,
        address: invoice.billing_address
      },
      invoice_date: invoice.invoice_date,
      due_date: invoice.due_date,
      status: invoice.status,
      subtotal: invoice.subtotal,
      tax: invoice.tax,
      total: invoice.total_amount,
      total_amount: invoice.total_amount,
      invoice_items: items,
      finalized_at: invoice.finalized_at,
      credit_applied: invoice.credit_applied,
      billing_cycle_id: invoice.billing_cycle_id,
      is_manual: invoice.is_manual
    };
  }

  private isInvoiceEditable(invoice: IInvoice): boolean {
    return ['draft'].includes(invoice.status);
  }

  private isInvoiceDeletable(invoice: IInvoice): boolean {
    return ['draft', 'cancelled'].includes(invoice.status);
  }

  private isStatusTransitionValid(currentStatus: InvoiceStatus, newStatus: InvoiceStatus): boolean {
    const validTransitions: Record<InvoiceStatus, InvoiceStatus[]> = {
      draft: ['pending', 'cancelled'],
      pending: ['sent', 'cancelled'],
      sent: ['paid', 'overdue', 'cancelled'],
      overdue: ['paid', 'cancelled'],
      paid: [],
      cancelled: [],
      prepayment: ['paid', 'cancelled'],
      partially_applied: ['paid', 'cancelled']
    };

    return validTransitions[currentStatus]?.includes(newStatus) || false;
  }

  private async executePaginatedQuery(
    query: Knex.QueryBuilder,
    options: ListOptions
  ): Promise<ListResult<any>> {
    const { page = 1, limit = 50, sort, order = 'desc' } = options;
    
    // Count total
    const countQuery = query.clone().clearSelect().clearOrder().count('* as total').first();
    const totalResult = await countQuery;
    const total = parseInt(totalResult?.total as string) || 0;

    // Apply pagination and sorting
    if (sort) {
      query = query.orderBy(sort, order);
    } else {
      query = query.orderBy(this.defaultSort, this.defaultOrder);
    }

    const offset = (page - 1) * limit;
    const data = await query.offset(offset).limit(limit);

    return {
      data,
      total
    };
  }
}