/**
 * Financial Management Service
 * Comprehensive service layer for financial operations including:
 * - Payment processing and tracking
 * - Credit management and application
 * - Financial adjustments and corrections
 * - Account balance calculations and aging reports
 * - Tax management and calculations
 * - Financial reporting and analytics
 * - Payment method management
 * - Transaction history and auditing
 * - Financial reconciliation processes
 * - Bulk financial operations
 *
 * Financial analytics intentionally stay on invoice / transaction document
 * dates for financial-operational questions; coverage-based metrics belong in recurring readers
 * that are explicitly service-period aware.
 */

import { BaseService, ServiceContext, ListResult, createTenantScopedQuery } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { ListOptions } from '../controllers/types';
import { hasPermission } from '../../auth/rbac';
import { auditLog } from '../../logging/auditLog';
import { TaxService } from '@alga-psa/billing/services/taxService';
import { v4 as uuidv4 } from 'uuid';
import { SharedNumberingService } from '@shared/services/numberingService';
import { runScheduledCreditBalanceValidation } from '@alga-psa/billing/actions/creditReconciliationActions';

// Import types from schemas and interfaces
import {
  // Transaction types
  CreateTransactionRequest,
  UpdateTransactionRequest,
  TransactionResponse,
  TransactionListQuery,
  
  // Credit types
  CreateCreditTrackingRequest,
  UpdateCreditTrackingRequest,
  CreditTrackingResponse,
  CreditListQuery,
  ApplyCreditToInvoiceRequest,
  CreatePrepaymentInvoiceRequest,
  TransferCreditRequest,
  
  // Invoice types
  CreateInvoiceRequest,
  UpdateInvoiceRequest,
  InvoiceResponse,
  InvoiceListQuery,
  
  // Payment method types
  CreatePaymentMethodRequest,
  UpdatePaymentMethodRequest,
  PaymentMethodResponse,
  PaymentMethodListQuery,
  
  // Contract Line types
  CreateContractLineRequest,
  UpdateContractLineRequest,
  ContractLineResponse,
  
  // Tax types
  CreateTaxRateRequest,
  UpdateTaxRateRequest,
  TaxRateResponse,
  
  // Reconciliation types
  CreateCreditReconciliationReportRequest,
  CreditReconciliationReportResponse,
  
  // Reporting types
  AccountBalanceReport,
  AgingReport,
  FinancialAnalyticsQuery,
  
  // Bulk operation types
  BulkInvoiceOperation,
  BulkTransactionOperation,
  BulkCreditOperation,
  BulkOperationResult,
  
  // Validation types
  CreditValidationResult,
  BillingCalculationResult,
  
  // Enums
  TransactionType,
  InvoiceStatus,
  ReconciliationStatus
} from '../schemas/financialSchemas';

import {
  ITransaction,
  ICreditTracking,
  PaymentMethod,
  IContractLine,
  ITaxRate,
  ICreditReconciliationReport,
  IDefaultBillingSettings,
  IClientContractLineSettings
} from '../../../interfaces/billing.interfaces';

import { BillingEngine as BillingEngineClass } from '@alga-psa/billing/services';

/**
 * HATEOAS Link interface for API discoverability
 */
interface HATEOASLink {
  rel: string;
  href: string;
  method: string;
  description?: string;
}

/**
 * Enhanced response interface with HATEOAS links
 */
interface FinancialResponse<T> {
  data: T;
  links?: HATEOASLink[];
}

/**
 * Financial analytics aggregation result
 */
interface FinancialAnalytics {
  revenue: {
    period: string;
    total_revenue: number;
    recurring_revenue: number;
    one_time_revenue: number;
    credit_applied: number;
    net_revenue: number;
    invoice_count: number;
    average_invoice_value: number;
  }[];
  credits: {
    period: string;
    credits_issued: number;
    credits_applied: number;
    credits_expired: number;
    credit_balance: number;
    utilization_rate: number;
    average_credit_age: number;
  }[];
}

/**
 * Comprehensive Financial Management Service
 */
export class FinancialService extends BaseService<ITransaction> {
  private taxService: TaxService;

  constructor() {
    super({
      tableName: 'transactions',
      primaryKey: 'transaction_id',
      tenantColumn: 'tenant',
      searchableFields: ['description', 'reference_number'],
      defaultSort: 'created_at',
      defaultOrder: 'desc'
    });
    
    this.taxService = new TaxService();
  }

  /**
   * Generate HATEOAS links for financial resources
   */
  private generateHATEOASLinks(
    resourceType: string,
    resourceId: string,
    context: ServiceContext
  ): HATEOASLink[] {
    const baseUrl = `/api/v1/financial`;
    
    const links: HATEOASLink[] = [
      {
        rel: 'self',
        href: `${baseUrl}/${resourceType}/${resourceId}`,
        method: 'GET',
        description: `Get ${resourceType} details`
      }
    ];

    // Add resource-specific links
    switch (resourceType) {
      case 'transactions':
        links.push(
          {
            rel: 'update',
            href: `${baseUrl}/transactions/${resourceId}`,
            method: 'PUT',
            description: 'Update transaction'
          },
          {
            rel: 'related',
            href: `${baseUrl}/transactions/${resourceId}/related`,
            method: 'GET',
            description: 'Get related transactions'
          }
        );
        break;
      
      case 'credits':
        links.push(
          {
            rel: 'apply',
            href: `${baseUrl}/credits/${resourceId}/apply`,
            method: 'POST',
            description: 'Apply credit to invoice'
          },
          {
            rel: 'transfer',
            href: `${baseUrl}/credits/${resourceId}/transfer`,
            method: 'POST',
            description: 'Transfer credit to another client'
          },
          {
            rel: 'expire',
            href: `${baseUrl}/credits/${resourceId}/expire`,
            method: 'POST',
            description: 'Manually expire credit'
          }
        );
        break;
      
      case 'invoices':
        links.push(
          {
            rel: 'finalize',
            href: `${baseUrl}/invoices/${resourceId}/finalize`,
            method: 'POST',
            description: 'Finalize invoice'
          },
          {
            rel: 'apply-credit',
            href: `${baseUrl}/invoices/${resourceId}/apply-credit`,
            method: 'POST',
            description: 'Apply credit to invoice'
          },
          {
            rel: 'items',
            href: `${baseUrl}/invoices/${resourceId}/items`,
            method: 'GET',
            description: 'Get invoice items'
          }
        );
        break;
    }

    return links;
  }

  /**
   * Validate user permissions for financial operations
   */
  private async validatePermissions(
    operation: string,
    resource: string,
    context: ServiceContext
  ): Promise<void> {
    if (!context.user) {
      throw new Error('Authentication required');
    }

    if (!await hasPermission(context.user, resource, operation)) {
      throw new Error(`Permission denied: Cannot ${operation} ${resource}`);
    }
  }

  // ============================================================================
  // TRANSACTION MANAGEMENT
  // ============================================================================

  /**
   * Create a new financial transaction
   */
  async createTransaction(
    data: CreateTransactionRequest,
    context: ServiceContext
  ): Promise<FinancialResponse<TransactionResponse>> {
    await this.validatePermissions('create', 'transaction', context);
    
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      // Calculate balance after transaction
      const lastTransaction = await createTenantScopedQuery(trx, {
        table: 'transactions',
        tenant: context.tenant,
      }).builder
        .where('client_id', data.client_id)
        .orderBy('created_at', 'desc')
        .first();
      
      const balanceAfter = (lastTransaction?.balance_after || 0) + data.amount;
      
      const transactionData = {
        ...data,
        transaction_id: uuidv4(),
        balance_after: balanceAfter,
        status: data.status || 'completed',
        created_at: new Date().toISOString()
      };

      const [transaction] = await trx('transactions')
        .insert(transactionData)
        .returning('*');

      // Update client credit balance if this is a credit-related transaction
      if (['credit_issuance', 'credit_application', 'credit_adjustment'].includes(data.type)) {
        await createTenantScopedQuery(trx, {
          table: 'clients',
          tenant: context.tenant,
        }).builder
          .where('client_id', data.client_id)
          .update({
            credit_balance: balanceAfter,
            updated_at: new Date().toISOString()
          });
      }

      // Audit log
      await auditLog(trx, {
        userId: context.userId,
        operation: 'transaction_created',
        tableName: 'transactions',
        recordId: transaction.transaction_id,
        changedData: transactionData,
        details: { action: 'Created financial transaction', type: data.type }
      });

      return {
        data: transaction,
        links: this.generateHATEOASLinks('transactions', transaction.transaction_id, context)
      };
    });
  }

  /**
   * Get transaction by ID with related information
   */
  async getTransaction(
    transactionId: string,
    context: ServiceContext
  ): Promise<FinancialResponse<TransactionResponse> | null> {
    await this.validatePermissions('read', 'transaction', context);
    
    const { knex } = await this.getKnex();
    
    const transaction = await createTenantScopedQuery(knex, {
      table: 'transactions',
      tenant: context.tenant,
    }).builder
      .where('transaction_id', transactionId)
      .first();

    if (!transaction) return null;

    return {
      data: transaction,
      links: this.generateHATEOASLinks('transactions', transactionId, context)
    };
  }

  /**
   * List transactions with advanced filtering
   */
  async listTransactions(
    query: TransactionListQuery,
    context: ServiceContext
  ): Promise<ListResult<FinancialResponse<TransactionResponse>>> {
    await this.validatePermissions('read', 'transaction', context);
    
    const { knex } = await this.getKnex();
    
    const {
      page = 1,
      limit = 25,
      client_id,
      type,
      status,
      amount_min,
      amount_max,
      has_expiration,
      search,
      sort = 'created_at',
      order = 'desc'
    } = query;

    let dataQuery = createTenantScopedQuery(knex, {
      table: 'transactions as t',
      tenant: context.tenant,
    }).builder
      .leftJoin('clients as c', function joinClients() {
        this.on('t.client_id', '=', 'c.client_id')
          .andOn('t.tenant', '=', 'c.tenant');
      })
      .leftJoin('invoices as i', function joinInvoices() {
        this.on('t.invoice_id', '=', 'i.invoice_id')
          .andOn('t.tenant', '=', 'i.tenant');
      });

    let countQuery = createTenantScopedQuery(knex, {
      table: 'transactions',
      tenant: context.tenant,
    }).builder;

    // Apply filters
    if (client_id) {
      dataQuery = dataQuery.where('t.client_id', client_id);
      countQuery = countQuery.where('client_id', client_id);
    }

    if (type) {
      dataQuery = dataQuery.where('t.type', type);
      countQuery = countQuery.where('type', type);
    }

    if (status) {
      dataQuery = dataQuery.where('t.status', status);
      countQuery = countQuery.where('status', status);
    }

    if (amount_min !== undefined) {
      dataQuery = dataQuery.where('t.amount', '>=', amount_min);
      countQuery = countQuery.where('amount', '>=', amount_min);
    }

    if (amount_max !== undefined) {
      dataQuery = dataQuery.where('t.amount', '<=', amount_max);
      countQuery = countQuery.where('amount', '<=', amount_max);
    }

    if (has_expiration !== undefined) {
      if (has_expiration) {
        dataQuery = dataQuery.whereNotNull('t.expiration_date');
        countQuery = countQuery.whereNotNull('expiration_date');
      } else {
        dataQuery = dataQuery.whereNull('t.expiration_date');
        countQuery = countQuery.whereNull('expiration_date');
      }
    }

    if (search) {
      dataQuery = dataQuery.where(builder => {
        builder.whereILike('t.description', `%${search}%`)
               .orWhereILike('t.reference_number', `%${search}%`)
               .orWhereILike('c.client_name', `%${search}%`);
      });
      countQuery = countQuery.where(builder => {
        builder.whereILike('description', `%${search}%`)
               .orWhereILike('reference_number', `%${search}%`);
      });
    }

    // Sorting and pagination
    dataQuery = dataQuery
      .select(
        't.*',
        'c.client_name',
        'i.invoice_number'
      )
      .orderBy(`t.${sort}`, order)
      .limit(limit)
      .offset((page - 1) * limit);

    const [transactions, [{ count }]] = await Promise.all([
      dataQuery,
      countQuery.count('* as count')
    ]);

    const transactionsWithLinks = transactions.map(transaction => ({
      data: transaction,
      links: this.generateHATEOASLinks('transactions', transaction.transaction_id, context)
    }));

    return {
      data: transactionsWithLinks,
      total: parseInt(count as string)
    };
  }

  /**
   * List invoices for financial operations.
   */
  async listInvoices(
    query: InvoiceListQuery,
    context: ServiceContext
  ): Promise<ListResult<FinancialResponse<InvoiceResponse>>> {
    const { knex } = await this.getKnex();

    const {
      page = 1,
      limit = 25,
      client_id,
      status,
      billing_cycle_id,
      due_date_from,
      due_date_to,
      amount_min,
      amount_max,
      is_manual,
      has_credit_applied,
      search,
      sort = 'created_at',
      order = 'desc',
    } = query;

    const sortableFields = new Set([
      'created_at',
      'updated_at',
      'invoice_number',
      'invoice_date',
      'due_date',
      'total_amount',
      'status',
    ]);
    const sortField = sortableFields.has(String(sort)) ? String(sort) : 'created_at';

    let dataQuery = createTenantScopedQuery(knex, {
      table: 'invoices as i',
      tenant: context.tenant,
    }).builder
      .leftJoin('clients as c', function() {
        this.on('i.client_id', '=', 'c.client_id')
          .andOn('i.tenant', '=', 'c.tenant');
      });

    let countQuery = createTenantScopedQuery(knex, {
      table: 'invoices as i',
      tenant: context.tenant,
    }).builder;

    if (client_id) {
      dataQuery = dataQuery.where('i.client_id', client_id);
      countQuery = countQuery.where('i.client_id', client_id);
    }

    if (status) {
      dataQuery = dataQuery.where('i.status', status);
      countQuery = countQuery.where('i.status', status);
    }

    if (billing_cycle_id) {
      dataQuery = dataQuery.where('i.billing_cycle_id', billing_cycle_id);
      countQuery = countQuery.where('i.billing_cycle_id', billing_cycle_id);
    }

    if (due_date_from) {
      dataQuery = dataQuery.where('i.due_date', '>=', due_date_from);
      countQuery = countQuery.where('i.due_date', '>=', due_date_from);
    }

    if (due_date_to) {
      dataQuery = dataQuery.where('i.due_date', '<=', due_date_to);
      countQuery = countQuery.where('i.due_date', '<=', due_date_to);
    }

    if (amount_min !== undefined) {
      dataQuery = dataQuery.where('i.total_amount', '>=', amount_min);
      countQuery = countQuery.where('i.total_amount', '>=', amount_min);
    }

    if (amount_max !== undefined) {
      dataQuery = dataQuery.where('i.total_amount', '<=', amount_max);
      countQuery = countQuery.where('i.total_amount', '<=', amount_max);
    }

    if (is_manual !== undefined) {
      dataQuery = dataQuery.where('i.is_manual', is_manual);
      countQuery = countQuery.where('i.is_manual', is_manual);
    }

    if (has_credit_applied !== undefined) {
      if (has_credit_applied) {
        dataQuery = dataQuery.where('i.credit_applied', '>', 0);
        countQuery = countQuery.where('i.credit_applied', '>', 0);
      } else {
        dataQuery = dataQuery.where(builder => {
          builder.whereNull('i.credit_applied').orWhere('i.credit_applied', 0);
        });
        countQuery = countQuery.where(builder => {
          builder.whereNull('i.credit_applied').orWhere('i.credit_applied', 0);
        });
      }
    }

    if (search) {
      dataQuery = dataQuery.where(builder => {
        builder.whereILike('i.invoice_number', `%${search}%`)
          .orWhereILike('c.client_name', `%${search}%`);
      });
      countQuery = countQuery.whereILike('i.invoice_number', `%${search}%`);
    }

    const [invoices, [{ count }]] = await Promise.all([
      dataQuery
        .select('i.*', 'c.client_name')
        .orderBy(`i.${sortField}`, order)
        .limit(limit)
        .offset((page - 1) * limit),
      countQuery.count('* as count'),
    ]);

    return {
      data: invoices.map(invoice => ({
        data: invoice,
        links: this.generateHATEOASLinks('invoices', invoice.invoice_id, context),
      })),
      total: parseInt(count as string, 10),
    };
  }

  // ============================================================================
  // CREDIT MANAGEMENT
  // ============================================================================

  /**
   * Apply credit to an invoice using existing credit actions
   */
  async applyCreditToInvoice(
    request: ApplyCreditToInvoiceRequest,
    context: ServiceContext
  ): Promise<FinancialResponse<{ success: boolean; appliedAmount: number }>> {
    await this.validatePermissions('update', 'credit', context);

    const { knex } = await this.getKnex();
    const tenant = context.tenant;

    return withTransaction(knex, async (trx) => {
      // Get the invoice and its currency
      const invoice = await createTenantScopedQuery(trx, {
        table: 'invoices',
        tenant,
      }).builder
        .where('invoice_id', request.invoice_id)
        .select('credit_applied', 'currency_code', 'subtotal', 'tax', 'total_amount')
        .first();

      if (!invoice) {
        throw new Error(`Invoice ${request.invoice_id} not found`);
      }

      const invoiceCurrency = invoice.currency_code || 'USD';

      // Check already-applied credit
      const existingAllocations = await createTenantScopedQuery(trx, {
        table: 'credit_allocations',
        tenant,
      }).builder
        .where('invoice_id', request.invoice_id)
        .sum('amount as total_applied')
        .first();
      const alreadyApplied = Number(existingAllocations?.total_applied || 0);

      const invoiceFullAmount = Number(invoice.subtotal) + Number(invoice.tax);
      const maxAdditional = Math.max(0, invoiceFullAmount - alreadyApplied);
      let requestedAmount = Math.min(request.requested_amount, maxAdditional);

      if (requestedAmount <= 0) {
        return {
          data: { success: true, appliedAmount: 0 },
          links: []
        };
      }

      // Get client credit balance (lock row to prevent concurrent over-application)
      const [client] = await createTenantScopedQuery(trx, {
        table: 'clients',
        tenant,
      }).builder
        .where('client_id', request.client_id)
        .select('credit_balance')
        .forUpdate();
      const availableCredit = client.credit_balance || 0;

      if (availableCredit <= 0) {
        return { data: { success: true, appliedAmount: 0 }, links: [] };
      }

      // Get active credit entries in the same currency (FIFO by expiration, locked for update)
      const now = new Date().toISOString();
      const creditEntries = await createTenantScopedQuery(trx, {
        table: 'credit_tracking',
        tenant,
      }).builder
        .where('client_id', request.client_id)
        .where('is_expired', false)
        .where('currency_code', invoiceCurrency)
        .where(function() {
          this.whereNull('expiration_date').orWhere('expiration_date', '>', now);
        })
        .where('remaining_amount', '>', 0)
        .orderBy([
          { column: 'expiration_date', order: 'asc', nulls: 'last' },
          { column: 'created_at', order: 'asc' }
        ])
        .forUpdate();

      if (creditEntries.length === 0) {
        return { data: { success: true, appliedAmount: 0 }, links: [] };
      }

      let remainingRequested = requestedAmount;
      let totalApplied = 0;

      for (const credit of creditEntries) {
        if (remainingRequested <= 0) break;
        const applyAmount = Math.min(remainingRequested, Number(credit.remaining_amount));
        if (applyAmount <= 0) continue;

        await createTenantScopedQuery(trx, {
          table: 'credit_tracking',
          tenant,
        }).builder
          .where('credit_id', credit.credit_id)
          .update({ remaining_amount: Number(credit.remaining_amount) - applyAmount, updated_at: now });

        totalApplied += applyAmount;
        remainingRequested -= applyAmount;
      }

      if (totalApplied <= 0) {
        return { data: { success: true, appliedAmount: 0 }, links: [] };
      }

      const newBalance = availableCredit - totalApplied;

      // Create credit application transaction
      const [creditTransaction] = await trx('transactions').insert({
        transaction_id: uuidv4(),
        client_id: request.client_id,
        invoice_id: request.invoice_id,
        amount: -totalApplied,
        type: 'credit_application',
        status: 'completed',
        description: `Applied credit to invoice ${request.invoice_id}`,
        created_at: now,
        balance_after: newBalance,
        tenant,
        currency_code: invoiceCurrency
      }).returning('*');

      // Create credit allocation record
      await trx('credit_allocations').insert({
        allocation_id: uuidv4(),
        transaction_id: creditTransaction.transaction_id,
        invoice_id: request.invoice_id,
        amount: totalApplied,
        created_at: now,
        tenant
      });

      // Update invoice (read-then-update to avoid Citus-unsafe SET col = col +/- val)
      const currentInvoice = await createTenantScopedQuery(trx, {
        table: 'invoices',
        tenant,
      }).builder
        .where('invoice_id', request.invoice_id)
        .select('credit_applied', 'total_amount')
        .forUpdate()
        .first();
      await createTenantScopedQuery(trx, {
        table: 'invoices',
        tenant,
      }).builder
        .where('invoice_id', request.invoice_id)
        .update({
          credit_applied: Number(currentInvoice.credit_applied || 0) + totalApplied,
        });

      // Update client balance
      await createTenantScopedQuery(trx, {
        table: 'clients',
        tenant,
      }).builder
        .where('client_id', request.client_id)
        .update({ credit_balance: newBalance, updated_at: now });

      return {
        data: { success: true, appliedAmount: totalApplied },
        links: [
          {
            rel: 'invoice',
            href: `/api/v1/financial/invoices/${request.invoice_id}`,
            method: 'GET',
            description: 'View updated invoice'
          },
          {
            rel: 'client-credits',
            href: `/api/v1/financial/credits?client_id=${request.client_id}`,
            method: 'GET',
            description: 'View client credits'
          }
        ]
      };
    });
  }

  /**
   * Create a prepayment invoice using existing credit actions
   */
  async createPrepaymentInvoice(
    request: CreatePrepaymentInvoiceRequest,
    context: ServiceContext
  ): Promise<FinancialResponse<any>> {
    await this.validatePermissions('create', 'credit', context);

    const { knex } = await this.getKnex();
    const tenant = context.tenant;

    // Verify client exists
    const client = await createTenantScopedQuery(knex, {
      table: 'clients',
      tenant,
    }).builder
      .where('client_id', request.client_id)
      .first();
    if (!client) {
      throw new Error('Client not found');
    }

    const createdInvoice = await withTransaction(knex, async (trx) => {
      const now = new Date().toISOString();
      const clientCurrency = client.default_currency_code || 'USD';

      // Determine credit expiration settings
      const clientSettings = await createTenantScopedQuery(trx, {
        table: 'client_billing_settings',
        tenant,
      }).builder
        .where('client_id', request.client_id)
        .first();
      const defaultSettings = await createTenantScopedQuery(trx, {
        table: 'default_billing_settings',
        tenant,
      }).builder
        .first();

      let isCreditExpirationEnabled = true;
      if (clientSettings?.enable_credit_expiration !== undefined) {
        isCreditExpirationEnabled = clientSettings.enable_credit_expiration;
      } else if (defaultSettings?.enable_credit_expiration !== undefined) {
        isCreditExpirationEnabled = defaultSettings.enable_credit_expiration;
      }

      let expirationDays: number | undefined;
      if (clientSettings?.credit_expiration_days !== undefined) {
        expirationDays = clientSettings.credit_expiration_days;
      } else if (defaultSettings?.credit_expiration_days !== undefined) {
        expirationDays = defaultSettings.credit_expiration_days;
      }

      let expirationDate: string | undefined = request.manual_expiration_date;
      if (isCreditExpirationEnabled && !expirationDate && expirationDays && expirationDays > 0) {
        const expDate = new Date();
        expDate.setDate(expDate.getDate() + expirationDays);
        expirationDate = expDate.toISOString();
      } else if (!isCreditExpirationEnabled) {
        expirationDate = undefined;
      }

      // Generate invoice number
      const invoiceNumber = await SharedNumberingService.getNextNumber('INVOICE', { knex: trx, tenant });

      // Create prepayment invoice
      const [invoice] = await trx('invoices')
        .insert({
          client_id: request.client_id,
          tenant,
          invoice_date: now,
          due_date: now,
          subtotal: request.amount,
          tax: 0,
          total_amount: request.amount,
          status: 'draft',
          invoice_number: invoiceNumber,
          // `billing_period_start/end` stores the invoice window, not a service period.
          // Prepayment credits are not service-backed, so window = "now". Rename pending.
          billing_period_start: now,
          billing_period_end: now,
          credit_applied: 0,
          currency_code: clientCurrency
        })
        .returning('*');

      // Get current balance
      const lastTx = await createTenantScopedQuery(trx, {
        table: 'transactions',
        tenant,
      }).builder
        .where('client_id', request.client_id)
        .orderBy('created_at', 'desc')
        .first();
      const currentBalance = lastTx?.balance_after || 0;
      const newBalance = currentBalance + request.amount;

      // Create credit issuance transaction
      const transactionId = uuidv4();
      await trx('transactions').insert({
        transaction_id: transactionId,
        client_id: request.client_id,
        invoice_id: invoice.invoice_id,
        amount: request.amount,
        type: 'credit_issuance',
        status: 'completed',
        description: 'Credit issued from prepayment',
        created_at: now,
        balance_after: newBalance,
        tenant,
        expiration_date: expirationDate,
        currency_code: clientCurrency
      });

      // Create credit tracking entry
      const creditId = uuidv4();
      await trx('credit_tracking').insert({
        credit_id: creditId,
        tenant,
        client_id: request.client_id,
        transaction_id: transactionId,
        amount: request.amount,
        remaining_amount: request.amount,
        created_at: now,
        expiration_date: expirationDate,
        is_expired: false,
        updated_at: now,
        currency_code: clientCurrency
      });

      return invoice;
    });

    return {
      data: createdInvoice,
      links: this.generateHATEOASLinks('invoices', createdInvoice.invoice_id, context)
    };
  }

  /**
   * Transfer credit between clients
   */
  async transferCredit(
    request: TransferCreditRequest,
    context: ServiceContext
  ): Promise<FinancialResponse<ICreditTracking>> {
    await this.validatePermissions('transfer', 'credit', context);

    const { knex } = await this.getKnex();
    const tenant = context.tenant;

    if (request.amount <= 0) {
      throw new Error('Transfer amount must be greater than zero');
    }

    return withTransaction(knex, async (trx) => {
      // Get source credit
      const sourceCredit = await createTenantScopedQuery(trx, {
        table: 'credit_tracking',
        tenant,
      }).builder
        .where('credit_id', request.source_credit_id)
        .first();

      if (!sourceCredit) {
        throw new Error(`Source credit with ID ${request.source_credit_id} not found`);
      }
      if (sourceCredit.is_expired) {
        throw new Error('Cannot transfer from an expired credit');
      }
      if (Number(sourceCredit.remaining_amount) < request.amount) {
        throw new Error(`Insufficient remaining amount (${sourceCredit.remaining_amount}) for transfer of ${request.amount}`);
      }

      // Verify target client
      const targetClient = await createTenantScopedQuery(trx, {
        table: 'clients',
        tenant,
      }).builder
        .where('client_id', request.target_client_id)
        .first();
      if (!targetClient) {
        throw new Error(`Target client with ID ${request.target_client_id} not found`);
      }

      const now = new Date().toISOString();

      // 1. Reduce source credit remaining amount
      const newSourceRemaining = Number(sourceCredit.remaining_amount) - request.amount;
      await createTenantScopedQuery(trx, {
        table: 'credit_tracking',
        tenant,
      }).builder
        .where('credit_id', request.source_credit_id)
        .update({ remaining_amount: newSourceRemaining, updated_at: now });

      // 2. Create transfer-out transaction for source
      await trx('transactions').insert({
        transaction_id: uuidv4(),
        client_id: sourceCredit.client_id,
        amount: -request.amount,
        type: 'credit_transfer',
        status: 'completed',
        description: request.reason || `Credit transferred to client ${request.target_client_id}`,
        created_at: now,
        tenant,
        related_transaction_id: sourceCredit.transaction_id,
        metadata: { transfer_to: request.target_client_id, transfer_reason: request.reason || 'Administrative transfer' }
      });

      // 3. Update source client balance
      const [sourceClient] = await createTenantScopedQuery(trx, {
        table: 'clients',
        tenant,
      }).builder
        .where('client_id', sourceCredit.client_id)
        .select('credit_balance');
      const newSourceBalance = Number(sourceClient.credit_balance) - request.amount;
      await createTenantScopedQuery(trx, {
        table: 'clients',
        tenant,
      }).builder
        .where('client_id', sourceCredit.client_id)
        .update({ credit_balance: newSourceBalance, updated_at: now });

      // 4. Create transfer-in transaction for target
      const targetTransactionId = uuidv4();
      await trx('transactions').insert({
        transaction_id: targetTransactionId,
        client_id: request.target_client_id,
        amount: request.amount,
        type: 'credit_transfer',
        status: 'completed',
        description: request.reason || `Credit transferred from client ${sourceCredit.client_id}`,
        created_at: now,
        tenant,
        metadata: { transfer_from: sourceCredit.client_id, transfer_reason: request.reason || 'Administrative transfer', source_credit_id: request.source_credit_id }
      });

      // 5. Update target client balance
      const newTargetBalance = Number(targetClient.credit_balance) + request.amount;
      await createTenantScopedQuery(trx, {
        table: 'clients',
        tenant,
      }).builder
        .where('client_id', request.target_client_id)
        .update({ credit_balance: newTargetBalance, updated_at: now });

      // 6. Create new credit tracking for target
      const newCreditId = uuidv4();
      const [newCredit] = await trx('credit_tracking').insert({
        credit_id: newCreditId,
        tenant,
        client_id: request.target_client_id,
        transaction_id: targetTransactionId,
        amount: request.amount,
        remaining_amount: request.amount,
        created_at: now,
        expiration_date: sourceCredit.expiration_date,
        is_expired: false,
        updated_at: now
      }).returning('*');

      return {
        data: newCredit,
        links: this.generateHATEOASLinks('credits', newCredit.credit_id, context)
      };
    });
  }

  /**
   * List client credits with detailed information
   */
  async listClientCredits(
    query: CreditListQuery,
    context: ServiceContext
  ): Promise<ListResult<FinancialResponse<CreditTrackingResponse>>> {
    await this.validatePermissions('read', 'credit', context);

    const {
      page = 1,
      limit = 25,
      client_id,
      include_expired = false,
    } = query;

    if (!client_id) {
      throw new Error('Client ID is required for credit listing');
    }

    const { knex } = await this.getKnex();
    const tenant = context.tenant;
    const offset = (page - 1) * limit;

    // Build base query
    let baseQuery = createTenantScopedQuery(knex, {
      table: 'credit_tracking',
      tenant,
    }).builder
      .where('credit_tracking.client_id', client_id);

    if (!include_expired) {
      baseQuery = baseQuery.where('credit_tracking.is_expired', false);
    }

    // Count
    const [{ count }] = await baseQuery.clone().count('credit_id as count');
    const total = parseInt(count as string);

    // Fetch credits with transaction details
    const credits = await baseQuery
      .clone()
      .select('credit_tracking.*')
      .leftJoin('transactions', function() {
        this.on('credit_tracking.transaction_id', '=', 'transactions.transaction_id')
          .andOn('credit_tracking.tenant', '=', 'transactions.tenant');
      })
      .select(
        'transactions.description as transaction_description',
        'transactions.type as transaction_type',
        'transactions.invoice_id',
        'transactions.created_at as transaction_date'
      )
      .orderBy([
        { column: 'is_expired', order: 'asc' },
        { column: 'expiration_date', order: 'asc', nulls: 'last' },
        { column: 'credit_tracking.created_at', order: 'desc' }
      ])
      .limit(limit)
      .offset(offset);

    const creditsWithLinks = credits.map((credit: any) => ({
      data: credit,
      links: this.generateHATEOASLinks('credits', credit.credit_id, context)
    }));

    return {
      data: creditsWithLinks,
      total
    };
  }

  /**
   * Validate credit balance for a client
   */
  async validateCreditBalance(
    clientId: string,
    context: ServiceContext
  ): Promise<FinancialResponse<CreditValidationResult>> {
    await this.validatePermissions('read', 'credit', context);

    const { knex } = await this.getKnex();
    const tenant = context.tenant;

    // Sum credit-related transactions
    const transactions = await createTenantScopedQuery(knex, {
      table: 'transactions',
      tenant,
    }).builder
      .where('client_id', clientId)
      .whereIn('type', [
        'credit_issuance', 'credit_application', 'credit_adjustment',
        'credit_expiration', 'credit_transfer', 'credit_issuance_from_negative_invoice'
      ])
      .orderBy('created_at', 'asc');

    let calculatedBalance = 0;
    for (const tx of transactions) {
      calculatedBalance += Number(tx.amount);
    }

    // Get client's actual balance
    const client = await createTenantScopedQuery(knex, {
      table: 'clients',
      tenant,
    }).builder
      .where('client_id', clientId)
      .select('credit_balance')
      .first();

    const actualBalance = Number(client?.credit_balance || 0);
    const expectedBalance = calculatedBalance;
    const difference = expectedBalance - actualBalance;
    const isValid = Math.abs(difference) < 0.01;

    const lastTransaction = transactions.length > 0 ? transactions[transactions.length - 1] : undefined;

    return {
      data: {
        is_valid: isValid,
        actual_balance: actualBalance,
        expected_balance: expectedBalance,
        difference,
        last_transaction: lastTransaction ? {
          ...lastTransaction,
          status: lastTransaction.status || 'pending',
          tenant: lastTransaction.tenant || ''
        } as unknown as any : undefined
      },
      links: [
        {
          rel: 'client',
          href: `/api/v1/clients/${clientId}`,
          method: 'GET',
          description: 'View client details'
        },
        {
          rel: 'reconciliation-reports',
          href: `/api/v1/financial/reconciliation?client_id=${clientId}`,
          method: 'GET',
          description: 'View reconciliation reports'
        }
      ]
    };
  }

  // ============================================================================
  // BILLING AND INVOICING
  // ============================================================================

  /**
   * Calculate billing for a client and period
   */
  async calculateBilling(
    clientId: string,
    periodStart: string,
    periodEnd: string,
    context?: ServiceContext
  ): Promise<FinancialResponse<BillingCalculationResult>> {
    if (context) {
      await this.validatePermissions('read', 'billing', context);
    }
    
    const billingEngine = new BillingEngineClass();
    const result = await billingEngine.calculateBillingForExecutionWindow(
      clientId,
      periodStart,
      periodEnd,
    );

    // Calculate tax amounts
    let totalTaxAmount = 0;
    for (const charge of result.charges) {
      if (charge.is_taxable && charge.total > 0) {
        const taxResult = await this.taxService.calculateTax(
          clientId,
          charge.total,
          periodEnd,
          charge.tax_region || 'default'
        );
        totalTaxAmount += taxResult.taxAmount;
      }
    }

    const billingResult: BillingCalculationResult = {
      charges: result.charges.map((charge: any) => ({
        ...charge,
        service_name: charge.service_name || charge.description || 'Service'
      })),
      total_amount: result.charges.reduce((sum, charge) => sum + charge.total, 0),
      tax_amount: totalTaxAmount,
      discounts: [],
      adjustments: [],
      final_amount: result.charges.reduce((sum, charge) => sum + charge.total, 0) + totalTaxAmount,
      period_start: periodStart,
      period_end: periodEnd
    };

    return {
      data: billingResult,
      links: context ? [
        {
          rel: 'generate-invoice',
          href: `/api/v1/financial/invoices`,
          method: 'POST',
          description: 'Generate invoice from billing calculation'
        },
        {
          rel: 'client',
          href: `/api/v1/clients/${clientId}`,
          method: 'GET',
          description: 'View client details'
        }
      ] : []
    };
  }

  // ============================================================================
  // PAYMENT METHODS
  // ============================================================================

  /**
   * Create a new payment method
   */
  async createPaymentMethod(
    data: CreatePaymentMethodRequest,
    context: ServiceContext
  ): Promise<FinancialResponse<PaymentMethodResponse>> {
    await this.validatePermissions('create', 'payment_method', context);
    
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      const paymentMethodData = {
        ...data,
        payment_method_id: uuidv4(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      // If this is set as default, unset other defaults for the client
      if (data.is_default) {
        await createTenantScopedQuery(trx, {
          table: 'payment_methods',
          tenant: context.tenant,
        }).builder
          .where('client_id', data.client_id)
          .update({ is_default: false });
      }

      const [paymentMethod] = await trx('payment_methods')
        .insert(paymentMethodData)
        .returning('*');

      await auditLog(trx, {
        userId: context.userId,
        operation: 'payment_method_created',
        tableName: 'payment_methods',
        recordId: paymentMethod.payment_method_id,
        changedData: paymentMethodData,
        details: { action: 'Created payment method', type: data.type }
      });

      return {
        data: paymentMethod,
        links: [
          {
            rel: 'self',
            href: `/api/v1/financial/payment-methods/${paymentMethod.payment_method_id}`,
            method: 'GET',
            description: 'Get payment method details'
          },
          {
            rel: 'client',
            href: `/api/v1/clients/${data.client_id}`,
            method: 'GET',
            description: 'View client details'
          }
        ]
      };
    });
  }

  /**
   * List payment methods.
   */
  async listPaymentMethods(
    query: PaymentMethodListQuery,
    context: ServiceContext
  ): Promise<ListResult<FinancialResponse<PaymentMethodResponse>>> {
    const { knex } = await this.getKnex();

    const {
      page = 1,
      limit = 25,
      client_id,
      type,
      is_default,
      exclude_deleted = true,
      search,
      sort = 'created_at',
      order = 'desc',
    } = query;

    const sortableFields = new Set(['created_at', 'updated_at', 'type', 'is_default']);
    const sortField = sortableFields.has(String(sort)) ? String(sort) : 'created_at';

    let dataQuery = createTenantScopedQuery(knex, {
      table: 'payment_methods as pm',
      tenant: context.tenant,
    }).builder
      .leftJoin('clients as c', function() {
        this.on('pm.client_id', '=', 'c.client_id')
          .andOn('pm.tenant', '=', 'c.tenant');
      });

    let countQuery = createTenantScopedQuery(knex, {
      table: 'payment_methods as pm',
      tenant: context.tenant,
    }).builder;

    if (client_id) {
      dataQuery = dataQuery.where('pm.client_id', client_id);
      countQuery = countQuery.where('pm.client_id', client_id);
    }

    if (type) {
      dataQuery = dataQuery.where('pm.type', type);
      countQuery = countQuery.where('pm.type', type);
    }

    if (is_default !== undefined) {
      dataQuery = dataQuery.where('pm.is_default', is_default);
      countQuery = countQuery.where('pm.is_default', is_default);
    }

    if (exclude_deleted) {
      dataQuery = dataQuery.where('pm.is_deleted', false);
      countQuery = countQuery.where('pm.is_deleted', false);
    }

    if (search) {
      dataQuery = dataQuery.where(builder => {
        builder.whereILike('c.client_name', `%${search}%`)
          .orWhereILike('pm.last4', `%${search}%`);
      });
      countQuery = countQuery.whereILike('pm.last4', `%${search}%`);
    }

    const [paymentMethods, [{ count }]] = await Promise.all([
      dataQuery
        .select('pm.*', 'c.client_name')
        .orderBy(`pm.${sortField}`, order)
        .limit(limit)
        .offset((page - 1) * limit),
      countQuery.count('* as count'),
    ]);

    return {
      data: paymentMethods.map(paymentMethod => ({
        data: paymentMethod,
        links: [
          {
            rel: 'self',
            href: `/api/v1/financial/payment-methods/${paymentMethod.payment_method_id}`,
            method: 'GET',
            description: 'Get payment method details',
          },
          {
            rel: 'client',
            href: `/api/v1/clients/${paymentMethod.client_id}`,
            method: 'GET',
            description: 'View client details',
          },
        ],
      })),
      total: parseInt(count as string, 10),
    };
  }

  // ============================================================================
  // FINANCIAL REPORTING
  // ============================================================================

  /**
   * Generate account balance report for a client
   */
  async getAccountBalanceReport(
    clientId: string,
    asOfDate?: string,
    context?: ServiceContext
  ): Promise<FinancialResponse<AccountBalanceReport>> {
    if (context) {
      await this.validatePermissions('read', 'financial_report', context);
    }
    
    const { knex, tenant: defaultTenant } = await this.getKnex();
    const tenant = context?.tenant || defaultTenant;
    const reportDate = asOfDate || new Date().toISOString();
    
    // Get current credit balance
    const client = await createTenantScopedQuery(knex, {
      table: 'clients',
      tenant,
    }).builder
      .where('client_id', clientId)
      .first();

    if (!client) {
      throw new Error('Client not found');
    }

    // Get available (non-expired) credits
    const now = new Date().toISOString();
    const availableCredits = await createTenantScopedQuery(knex, {
      table: 'credit_tracking',
      tenant,
    }).builder
      .where('client_id', clientId)
      .where('is_expired', false)
      .where(function() {
        this.whereNull('expiration_date')
            .orWhere('expiration_date', '>', now);
      })
      .sum('remaining_amount as total');

    // Get expired credits
    const expiredCredits = await createTenantScopedQuery(knex, {
      table: 'credit_tracking',
      tenant,
    }).builder
      .where('client_id', clientId)
      .where('is_expired', true)
      .sum('amount as total');

    // Get pending invoices (balance due is derived: total − credit applied)
    const pendingInvoices = (await createTenantScopedQuery(knex, {
      table: 'invoices',
      tenant,
    }).builder
      .where('client_id', clientId)
      .where('status', 'sent')
      .sum(knex.raw('total_amount - COALESCE(credit_applied, 0) as total'))) as Array<{ total: string | number | null }>;

    // Get overdue invoices
    const overdueInvoices = (await createTenantScopedQuery(knex, {
      table: 'invoices',
      tenant,
    }).builder
      .where('client_id', clientId)
      .where('status', 'overdue')
      .sum(knex.raw('total_amount - COALESCE(credit_applied, 0) as total'))) as Array<{ total: string | number | null }>;

    // Get last payment
    const lastPayment = await createTenantScopedQuery(knex, {
      table: 'transactions',
      tenant,
    }).builder
      .where('client_id', clientId)
      .where('type', 'payment')
      .orderBy('created_at', 'desc')
      .first();

    const report: AccountBalanceReport = {
      client_id: clientId,
      current_balance: client.credit_balance || 0,
      available_credit: Number(availableCredits[0]?.total) || 0,
      expired_credit: Number(expiredCredits[0]?.total) || 0,
      pending_invoices: Number(pendingInvoices[0]?.total) || 0,
      overdue_amount: Number(overdueInvoices[0]?.total) || 0,
      last_payment_date: lastPayment?.created_at,
      last_payment_amount: lastPayment?.amount,
      as_of_date: reportDate
    };

    return {
      data: report,
      links: context ? [
        {
          rel: 'client',
          href: `/api/v1/clients/${clientId}`,
          method: 'GET',
          description: 'View client details'
        },
        {
          rel: 'aging-report',
          href: `/api/v1/financial/reports/aging?client_id=${clientId}`,
          method: 'GET',
          description: 'View aging report'
        }
      ] : []
    };
  }

  /**
   * Generate aging report for outstanding invoices
   */
  async getAgingReport(
    clientId?: string,
    context?: ServiceContext
  ): Promise<FinancialResponse<AgingReport>> {
    if (context) {
      await this.validatePermissions('read', 'financial_report', context);
    }
    
    const { knex, tenant: defaultTenant } = await this.getKnex();
    const tenant = context?.tenant || defaultTenant;
    const reportDate = new Date().toISOString();
    const now = new Date();

    let query = createTenantScopedQuery(knex, {
      table: 'invoices as i',
      tenant,
    }).builder
      .join('clients as c', function joinClients() {
        this.on('i.client_id', '=', 'c.client_id')
          .andOn('i.tenant', '=', 'c.tenant');
      })
      .whereIn('i.status', ['sent', 'overdue']);

    if (clientId) {
      query = query.where('i.client_id', clientId);
    }

    const invoices = await query.select(
      'i.*',
      'c.client_name'
    );

    // Group by client and calculate aging buckets
    const clientAging = new Map<string, {
      client_id: string;
      client_name: string;
      current: number;
      days_30: number;
      days_60: number;
      days_90: number;
      days_over_90: number;
      total_outstanding: number;
    }>();

    for (const invoice of invoices) {
      const dueDate = new Date(invoice.due_date);
      const daysPastDue = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
      const amount = invoice.total_amount - (invoice.credit_applied || 0);

      if (!clientAging.has(invoice.client_id)) {
        clientAging.set(invoice.client_id, {
          client_id: invoice.client_id,
          client_name: invoice.client_name,
          current: 0,
          days_30: 0,
          days_60: 0,
          days_90: 0,
          days_over_90: 0,
          total_outstanding: 0
        });
      }

      const aging = clientAging.get(invoice.client_id)!;

      if (daysPastDue <= 0) {
        aging.current += amount;
      } else if (daysPastDue <= 30) {
        aging.days_30 += amount;
      } else if (daysPastDue <= 60) {
        aging.days_60 += amount;
      } else if (daysPastDue <= 90) {
        aging.days_90 += amount;
      } else {
        aging.days_over_90 += amount;
      }

      aging.total_outstanding += amount;
    }

    const clients = Array.from(clientAging.values());
    
    // Calculate summary totals
    const summary = {
      total_current: clients.reduce((sum, c) => sum + c.current, 0),
      total_30_days: clients.reduce((sum, c) => sum + c.days_30, 0),
      total_60_days: clients.reduce((sum, c) => sum + c.days_60, 0),
      total_90_days: clients.reduce((sum, c) => sum + c.days_90, 0),
      total_over_90_days: clients.reduce((sum, c) => sum + c.days_over_90, 0),
      grand_total: clients.reduce((sum, c) => sum + c.total_outstanding, 0)
    };

    const report: AgingReport = {
      report_date: reportDate,
      summary,
      clients
    };

    return {
      data: report,
      links: context ? [
        {
          rel: 'account-balance',
          href: `/api/v1/financial/reports/account-balance${clientId ? `?client_id=${clientId}` : ''}`,
          method: 'GET',
          description: 'View account balance report'
        }
      ] : []
    };
  }

  /**
   * Get financial analytics with revenue and credit metrics
   */
  async getFinancialAnalytics(
    query: FinancialAnalyticsQuery,
    context: ServiceContext
  ): Promise<FinancialResponse<FinancialAnalytics>> {
    await this.validatePermissions('read', 'financial_report', context);
    
    const { knex } = await this.getKnex();
    const { client_id, date_from, date_to, group_by = 'month' } = query;

    // Financial analytics intentionally stay on invoice / transaction document
    // dates (`created_at`, `due_date`, `finalized_at`) rather than recurring
    // service-period dates. Coverage-based metrics belong in recurring readers
    // and reports, not in these collections-style aggregates.
    // Build date grouping based on group_by parameter
    let dateGrouping: string;
    switch (group_by) {
      case 'day':
        dateGrouping = "DATE_TRUNC('day', created_at)";
        break;
      case 'week':
        dateGrouping = "DATE_TRUNC('week', created_at)";
        break;
      case 'month':
      default:
        dateGrouping = "DATE_TRUNC('month', created_at)";
        break;
    }

    // Revenue analytics
    let revenueQuery = createTenantScopedQuery(knex, {
      table: 'invoices',
      tenant: context.tenant,
    }).builder
      .select(
        knex.raw(`${dateGrouping} as period`),
        knex.raw('SUM(total_amount) as total_revenue'),
        knex.raw('SUM(CASE WHEN is_manual = false THEN total_amount ELSE 0 END) as recurring_revenue'),
        knex.raw('SUM(CASE WHEN is_manual = true THEN total_amount ELSE 0 END) as one_time_revenue'),
        knex.raw('SUM(credit_applied) as credit_applied'),
        knex.raw('SUM(total_amount - COALESCE(credit_applied, 0)) as net_revenue'),
        knex.raw('COUNT(*) as invoice_count'),
        knex.raw('AVG(total_amount) as average_invoice_value')
      )
      .whereIn('status', ['sent', 'paid'])
      .modify((qb) => {
        if (date_from && date_to) {
          qb.whereBetween('created_at', [date_from, date_to]);
        }
      })
      .groupBy(knex.raw(dateGrouping))
      .orderBy('period');

    // Credit analytics
    let creditQuery = createTenantScopedQuery(knex, {
      table: 'transactions',
      tenant: context.tenant,
    }).builder
      .select(
        knex.raw(`${dateGrouping} as period`),
        knex.raw('SUM(CASE WHEN type IN (\'credit_issuance\', \'credit_issuance_from_negative_invoice\') THEN amount ELSE 0 END) as credits_issued'),
        knex.raw('SUM(CASE WHEN type = \'credit_application\' THEN ABS(amount) ELSE 0 END) as credits_applied'),
        knex.raw('SUM(CASE WHEN type = \'credit_expiration\' THEN ABS(amount) ELSE 0 END) as credits_expired')
      )
      .whereIn('type', [
        'credit_issuance',
        'credit_issuance_from_negative_invoice',
        'credit_application',
        'credit_expiration'
      ])
      .modify((qb) => {
        if (date_from && date_to) {
          qb.whereBetween('created_at', [date_from, date_to]);
        }
      })
      .groupBy(knex.raw(dateGrouping))
      .orderBy('period');

    if (client_id) {
      revenueQuery = revenueQuery.where('client_id', client_id);
      creditQuery = creditQuery.where('client_id', client_id);
    }

    const [revenueData, creditData] = await Promise.all([
      revenueQuery,
      creditQuery
    ]);

    // Calculate additional credit metrics
    const creditAnalytics = await Promise.all(
      creditData.map(async (period: any) => {
        // Get credit balance at end of period
        const balanceQuery = createTenantScopedQuery(knex, {
          table: 'clients',
          tenant: context.tenant,
        }).builder
          .sum('credit_balance as total_balance');
        
        if (client_id) {
          balanceQuery.where('client_id', client_id);
        }
        
        const balanceResult = await balanceQuery.first();
        const creditBalance = Number(balanceResult?.total_balance) || 0;
        
        // Calculate utilization rate
        const utilizationRate = period.credits_issued > 0 
          ? (period.credits_applied / period.credits_issued) * 100 
          : 0;
        
        // Calculate average credit age (simplified)
        const averageCreditAge = 30; // Placeholder - would need more complex calculation
        
        return {
          period: period.period,
          credits_issued: Number(period.credits_issued) || 0,
          credits_applied: Number(period.credits_applied) || 0,
          credits_expired: Number(period.credits_expired) || 0,
          credit_balance: creditBalance,
          utilization_rate: utilizationRate,
          average_credit_age: averageCreditAge
        };
      })
    );

    const analytics: FinancialAnalytics = {
      revenue: revenueData.map((row: any) => ({
        period: row.period,
        total_revenue: Number(row.total_revenue) || 0,
        recurring_revenue: Number(row.recurring_revenue) || 0,
        one_time_revenue: Number(row.one_time_revenue) || 0,
        credit_applied: Number(row.credit_applied) || 0,
        net_revenue: Number(row.net_revenue) || 0,
        invoice_count: Number(row.invoice_count) || 0,
        average_invoice_value: Number(row.average_invoice_value) || 0
      })),
      credits: creditAnalytics
    };

    return {
      data: analytics,
      links: [
        {
          rel: 'aging-report',
          href: `/api/v1/financial/reports/aging${client_id ? `?client_id=${client_id}` : ''}`,
          method: 'GET',
          description: 'View aging report'
        },
        {
          rel: 'account-balance',
          href: `/api/v1/financial/reports/account-balance${client_id ? `?client_id=${client_id}` : ''}`,
          method: 'GET',
          description: 'View account balance report'
        }
      ]
    };
  }

  // ============================================================================
  // RECONCILIATION MANAGEMENT
  // ============================================================================

  /**
   * Run credit reconciliation for clients
   */
  async runCreditReconciliation(
    clientId?: string,
    context?: ServiceContext
  ): Promise<FinancialResponse<{
    totalClients: number;
    balanceValidCount: number;
    balanceDiscrepancyCount: number;
    missingTrackingCount: number;
    inconsistentTrackingCount: number;
    errorCount: number;
  }>> {
    if (context) {
      await this.validatePermissions('update', 'credit', context);
    }
    
    const userId = context?.userId || 'system';
    const result = await runScheduledCreditBalanceValidation(clientId, userId);

    return {
      data: result,
      links: context ? [
        {
          rel: 'reconciliation-reports',
          href: `/api/v1/financial/reconciliation${clientId ? `?client_id=${clientId}` : ''}`,
          method: 'GET',
          description: 'View reconciliation reports'
        }
      ] : []
    };
  }

  /**
   * Resolve a reconciliation report
   */
  async resolveReconciliationReport(
    reportId: string,
    notes?: string,
    context?: ServiceContext
  ): Promise<FinancialResponse<ICreditReconciliationReport>> {
    if (context) {
      await this.validatePermissions('update', 'credit', context);
    }

    const { knex, tenant: defaultTenant } = await this.getKnex();
    const tenant = context?.tenant || defaultTenant;
    const userId = context?.userId || 'system';

    const resolvedReport = await withTransaction(knex, async (trx) => {
      // Get the report
      const report = await createTenantScopedQuery(trx, {
        table: 'credit_reconciliation_reports',
        tenant,
      }).builder
        .where('report_id', reportId)
        .first();

      if (!report) {
        throw new Error(`Reconciliation report ${reportId} not found`);
      }
      if (report.status === 'resolved') {
        throw new Error(`Reconciliation report ${reportId} is already resolved`);
      }

      const now = new Date().toISOString();

      // Create adjustment transaction
      const transactionId = uuidv4();
      await trx('transactions').insert({
        transaction_id: transactionId,
        client_id: report.client_id,
        amount: report.difference,
        type: 'credit_adjustment',
        status: 'completed',
        description: `Credit balance correction from reconciliation report ${reportId}`,
        created_at: now,
        balance_after: report.expected_balance,
        tenant
      });

      // Update client balance
      await createTenantScopedQuery(trx, {
        table: 'clients',
        tenant,
      }).builder
        .where('client_id', report.client_id)
        .update({ credit_balance: report.expected_balance, updated_at: now });

      // Resolve the report
      const [resolved] = await createTenantScopedQuery(trx, {
        table: 'credit_reconciliation_reports',
        tenant,
      }).builder
        .where('report_id', reportId)
        .update({
          status: 'resolved',
          resolution_date: now,
          resolution_user: userId,
          resolution_notes: notes,
          resolution_transaction_id: transactionId,
          updated_at: now
        })
        .returning('*');

      // Audit log
      await auditLog(trx, {
        userId,
        operation: 'credit_balance_correction',
        tableName: 'clients',
        recordId: report.client_id,
        changedData: {
          previous_balance: report.actual_balance,
          corrected_balance: report.expected_balance
        },
        details: {
          action: 'Credit balance corrected from reconciliation report',
          report_id: reportId,
          difference: report.difference,
          notes: notes || 'No notes provided'
        }
      });

      return resolved;
    });

    return {
      data: resolvedReport,
      links: context ? [
        {
          rel: 'self',
          href: `/api/v1/financial/reconciliation/${reportId}`,
          method: 'GET',
          description: 'View reconciliation report'
        },
        {
          rel: 'client',
          href: `/api/v1/clients/${resolvedReport.client_id}`,
          method: 'GET',
          description: 'View client details'
        }
      ] : []
    };
  }

  // ============================================================================
  // BULK OPERATIONS
  // ============================================================================

  /**
   * Perform bulk operations on invoices
   */
  async bulkInvoiceOperation(
    operation: BulkInvoiceOperation,
    context: ServiceContext
  ): Promise<FinancialResponse<BulkOperationResult>> {
    await this.validatePermissions('update', 'invoice', context);
    
    const { knex } = await this.getKnex();
    
    return withTransaction(knex, async (trx) => {
      const results: Array<{
        id: string;
        success: boolean;
        error?: string;
        result?: any;
      }> = [];

      for (const invoiceId of operation.invoice_ids) {
        try {
          let result: any;
          
          switch (operation.operation) {
            case 'finalize':
              result = await trx('invoices')
                .where({
                  invoice_id: invoiceId,
                  tenant: context.tenant
                })
                .update({
                  status: 'sent',
                  finalized_at: new Date().toISOString()
                })
                .returning('*');
              break;
              
            case 'cancel':
              result = await trx('invoices')
                .where({
                  invoice_id: invoiceId,
                  tenant: context.tenant
                })
                .update({
                  status: 'cancelled'
                })
                .returning('*');
              break;
              
            case 'apply_credit':
              // This would need additional parameters in the operation
              const creditAmount = operation.parameters?.credit_amount || 0;
              const invoice = await trx('invoices')
                .where({
                  invoice_id: invoiceId,
                  tenant: context.tenant
                })
                .first();
              
              if (invoice && creditAmount > 0) {
                // Apply credit logic here
                result = { applied_amount: creditAmount };
              }
              break;
              
            default:
              throw new Error(`Unsupported operation: ${operation.operation}`);
          }
          
          results.push({
            id: invoiceId,
            success: true,
            result
          });
          
        } catch (error) {
          results.push({
            id: invoiceId,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      // Audit log for bulk operation
      await auditLog(trx, {
        userId: context.userId,
        operation: 'bulk_invoice_operation',
        tableName: 'invoices',
        recordId: 'bulk',
        changedData: operation,
        details: {
          action: `Bulk ${operation.operation} operation`,
          total_requested: operation.invoice_ids.length,
          successful: results.filter(r => r.success).length,
          failed: results.filter(r => !r.success).length
        }
      });

      const bulkResult: BulkOperationResult = {
        total_requested: operation.invoice_ids.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results
      };

      return {
        data: bulkResult,
        links: [
          {
            rel: 'invoices',
            href: `/api/v1/financial/invoices`,
            method: 'GET',
            description: 'List invoices'
          }
        ]
      };
    });
  }

  /**
   * Bulk approve / reject / reverse existing transactions.
   *
   * `approve` and `reject` set the transaction status. `reverse` posts a
   * compensating transaction (negated amount, linked to the original via
   * related_transaction_id), recomputes the running balance, marks the original
   * reversed, and keeps the client's credit_balance in sync for credit types.
   * Each id is processed independently; one failure does not abort the rest.
   */
  async bulkTransactionOperation(
    operation: BulkTransactionOperation,
    context: ServiceContext
  ): Promise<FinancialResponse<BulkOperationResult>> {
    await this.validatePermissions('update', 'transaction', context);

    const { knex } = await this.getKnex();
    const CREDIT_TYPES = ['credit_issuance', 'credit_application', 'credit_adjustment', 'credit_transfer', 'credit_expiration'];

    return withTransaction(knex, async (trx) => {
      const results: Array<{ id: string; success: boolean; error?: string; result?: any }> = [];

      for (const transactionId of operation.transaction_ids) {
        try {
          const existing = await trx('transactions')
            .where({ transaction_id: transactionId, tenant: context.tenant })
            .first();
          if (!existing) {
            throw new Error('Transaction not found');
          }

          let result: any;
          switch (operation.operation) {
            case 'approve':
              [result] = await trx('transactions')
                .where({ transaction_id: transactionId, tenant: context.tenant })
                .update({ status: 'completed' })
                .returning('*');
              break;

            case 'reject':
              [result] = await trx('transactions')
                .where({ transaction_id: transactionId, tenant: context.tenant })
                .update({ status: 'rejected' })
                .returning('*');
              break;

            case 'reverse': {
              if (existing.status === 'reversed') {
                throw new Error('Transaction is already reversed');
              }
              const reversalAmount = -Number(existing.amount);
              const lastTransaction = await trx('transactions')
                .where({ client_id: existing.client_id, tenant: context.tenant })
                .orderBy('created_at', 'desc')
                .first();
              const balanceAfter = Number(lastTransaction?.balance_after || 0) + reversalAmount;
              // Mirror the original family so the ledger stays self-describing.
              const reversalType =
                ['payment', 'partial_payment', 'prepayment'].includes(existing.type) ? 'payment_reversal'
                : ['refund_full', 'refund_partial'].includes(existing.type) ? 'refund_reversal'
                : 'credit_adjustment';

              const [reversal] = await trx('transactions')
                .insert({
                  transaction_id: uuidv4(),
                  client_id: existing.client_id,
                  invoice_id: existing.invoice_id ?? null,
                  amount: reversalAmount,
                  type: reversalType,
                  status: 'completed',
                  description: operation.reason || `Reversal of transaction ${transactionId}`,
                  created_at: new Date().toISOString(),
                  balance_after: balanceAfter,
                  tenant: context.tenant,
                  related_transaction_id: transactionId,
                  currency_code: existing.currency_code
                })
                .returning('*');

              await trx('transactions')
                .where({ transaction_id: transactionId, tenant: context.tenant })
                .update({ status: 'reversed' });

              if (CREDIT_TYPES.includes(existing.type)) {
                await trx('clients')
                  .where({ client_id: existing.client_id, tenant: context.tenant })
                  .update({ credit_balance: balanceAfter, updated_at: new Date().toISOString() });
              }
              result = reversal;
              break;
            }

            default:
              throw new Error(`Unsupported operation: ${operation.operation}`);
          }

          results.push({ id: transactionId, success: true, result });
        } catch (error) {
          results.push({
            id: transactionId,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      await auditLog(trx, {
        userId: context.userId,
        operation: 'bulk_transaction_operation',
        tableName: 'transactions',
        recordId: 'bulk',
        changedData: operation,
        details: {
          action: `Bulk ${operation.operation} operation`,
          total_requested: operation.transaction_ids.length,
          successful: results.filter(r => r.success).length,
          failed: results.filter(r => !r.success).length
        }
      });

      const bulkResult: BulkOperationResult = {
        total_requested: operation.transaction_ids.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results
      };

      return {
        data: bulkResult,
        links: [
          { rel: 'transactions', href: `/api/v1/financial/transactions`, method: 'GET', description: 'List transactions' }
        ]
      };
    });
  }

  /**
   * Bulk expire / extend-expiration / transfer existing credits.
   *
   * `expire` forfeits the unused remainder (credit_expiration transaction +
   * client balance reduction) and flags the credit. `extend_expiration` moves
   * the expiration date. `transfer` reuses transferCredit() to move the
   * remaining amount to another client. Each credit is processed in its own
   * transaction so a single failure is isolated (transferCredit manages its own
   * transaction, so the batch must not share one).
   */
  async bulkCreditOperation(
    operation: BulkCreditOperation,
    context: ServiceContext
  ): Promise<FinancialResponse<BulkOperationResult>> {
    await this.validatePermissions('update', 'credit', context);

    const { knex } = await this.getKnex();
    const results: Array<{ id: string; success: boolean; error?: string; result?: any }> = [];

    for (const creditId of operation.credit_ids) {
      try {
        let result: any;

        if (operation.operation === 'transfer') {
          const targetClientId = operation.parameters?.target_client_id;
          if (!targetClientId) {
            throw new Error('target_client_id is required for transfer');
          }
          const credit = await knex('credit_tracking')
            .where({ credit_id: creditId, tenant: context.tenant })
            .first();
          if (!credit) {
            throw new Error('Credit not found');
          }
          const transferred = await this.transferCredit({
            user_id: context.userId,
            source_credit_id: creditId,
            target_client_id: targetClientId,
            amount: Number(credit.remaining_amount),
            reason: operation.parameters?.reason
          }, context);
          result = transferred.data;
        } else {
          result = await withTransaction(knex, async (trx) => {
            const credit = await trx('credit_tracking')
              .where({ credit_id: creditId, tenant: context.tenant })
              .first();
            if (!credit) {
              throw new Error('Credit not found');
            }
            const now = new Date().toISOString();

            if (operation.operation === 'expire') {
              if (credit.is_expired) {
                throw new Error('Credit is already expired');
              }
              const remaining = Number(credit.remaining_amount);
              if (remaining > 0) {
                const [client] = await trx('clients')
                  .where({ client_id: credit.client_id, tenant: context.tenant })
                  .select('credit_balance');
                const newBalance = Number(client?.credit_balance || 0) - remaining;
                await trx('transactions').insert({
                  transaction_id: uuidv4(),
                  client_id: credit.client_id,
                  amount: -remaining,
                  type: 'credit_expiration',
                  status: 'completed',
                  description: operation.parameters?.reason || `Credit ${creditId} expired`,
                  created_at: now,
                  balance_after: newBalance,
                  tenant: context.tenant,
                  related_transaction_id: credit.transaction_id,
                  currency_code: credit.currency_code
                });
                await trx('clients')
                  .where({ client_id: credit.client_id, tenant: context.tenant })
                  .update({ credit_balance: newBalance, updated_at: now });
              }
              const [updated] = await trx('credit_tracking')
                .where({ credit_id: creditId, tenant: context.tenant })
                .update({ is_expired: true, remaining_amount: 0, updated_at: now })
                .returning('*');
              return updated;
            }

            if (operation.operation === 'extend_expiration') {
              const newExpiration = operation.parameters?.expiration_date;
              if (!newExpiration) {
                throw new Error('parameters.expiration_date is required for extend_expiration');
              }
              const [updated] = await trx('credit_tracking')
                .where({ credit_id: creditId, tenant: context.tenant })
                .update({ expiration_date: newExpiration, is_expired: false, updated_at: now })
                .returning('*');
              return updated;
            }

            throw new Error(`Unsupported operation: ${operation.operation}`);
          });
        }

        results.push({ id: creditId, success: true, result });
      } catch (error) {
        results.push({
          id: creditId,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    await withTransaction(knex, async (trx) => {
      await auditLog(trx, {
        userId: context.userId,
        operation: 'bulk_credit_operation',
        tableName: 'credit_tracking',
        recordId: 'bulk',
        changedData: operation,
        details: {
          action: `Bulk ${operation.operation} operation`,
          total_requested: operation.credit_ids.length,
          successful: results.filter(r => r.success).length,
          failed: results.filter(r => !r.success).length
        }
      });
    });

    const bulkResult: BulkOperationResult = {
      total_requested: operation.credit_ids.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results
    };

    return {
      data: bulkResult,
      links: [
        { rel: 'credits', href: `/api/v1/financial/credits`, method: 'GET', description: 'List credits' }
      ]
    };
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  /**
   * Get payment terms list
   */
  async getPaymentTerms(context?: ServiceContext): Promise<FinancialResponse<Array<{ id: string; name: string }>>> {
    const { knex } = await this.getKnex();

    const hasPaymentTermsTable = await knex.schema.hasTable('payment_terms');
    if (!hasPaymentTermsTable) {
      return {
        data: [
          { id: 'due_on_receipt', name: 'Due on receipt' },
          { id: 'net_15', name: 'Net 15' },
          { id: 'net_30', name: 'Net 30' },
        ],
        links: []
      };
    }

    const terms = await knex('payment_terms')
      .select('term_code as id', 'term_name as name')
      .where({ is_active: true })
      .orderBy('sort_order', 'asc');

    return {
      data: terms,
      links: []
    };
  }

  /**
   * Calculate tax for a given amount and region
   */
  async calculateTax(
    clientId: string,
    amount: number,
    taxRegion: string,
    date?: string,
    context?: ServiceContext
  ): Promise<FinancialResponse<{ taxAmount: number; taxRate: number }>> {
    if (context) {
      await this.validatePermissions('read', 'tax', context);
    }
    
    const result = await this.taxService.calculateTax(
      clientId,
      amount,
      date || new Date().toISOString(),
      taxRegion
    );

    return {
      data: result,
      links: context ? [
        {
          rel: 'client',
          href: `/api/v1/clients/${clientId}`,
          method: 'GET',
          description: 'View client details'
        }
      ] : []
    };
  }
}
