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
 */

import { BaseService, ServiceContext, ListResult } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { ListOptions } from '../controllers/types';
import { hasPermission } from '../../auth/rbac';
import { auditLog } from '../../logging/auditLog';
import { TaxService } from '../../services/taxService';
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

import { BillingEngine as BillingEngineClass } from '../../billing/billingEngine';

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
  private billingEngine: BillingEngineClass;

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
    this.billingEngine = new BillingEngineClass();
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
      const lastTransaction = await trx('transactions')
        .where({ client_id: data.client_id, tenant: context.tenant })
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
        await trx('clients')
          .where({ client_id: data.client_id, tenant: context.tenant })
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
    
    const transaction = await knex('transactions')
      .where({
        transaction_id: transactionId,
        tenant: context.tenant
      })
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

    let dataQuery = knex('transactions as t')
      .leftJoin('clients as c', 't.client_id', 'c.client_id')
      .leftJoin('invoices as i', 't.invoice_id', 'i.invoice_id')
      .where('t.tenant', context.tenant);

    let countQuery = knex('transactions')
      .where('tenant', context.tenant);

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
      const invoice = await trx('invoices')
        .where({ invoice_id: request.invoice_id, tenant })
        .select('credit_applied', 'currency_code', 'subtotal', 'tax', 'total_amount')
        .first();

      if (!invoice) {
        throw new Error(`Invoice ${request.invoice_id} not found`);
      }

      const invoiceCurrency = invoice.currency_code || 'USD';

      // Check already-applied credit
      const existingAllocations = await trx('credit_allocations')
        .where({ invoice_id: request.invoice_id, tenant })
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
      const [client] = await trx('clients')
        .where({ client_id: request.client_id, tenant })
        .select('credit_balance')
        .forUpdate();
      const availableCredit = client.credit_balance || 0;

      if (availableCredit <= 0) {
        return { data: { success: true, appliedAmount: 0 }, links: [] };
      }

      // Get active credit entries in the same currency (FIFO by expiration, locked for update)
      const now = new Date().toISOString();
      const creditEntries = await trx('credit_tracking')
        .where({ client_id: request.client_id, tenant, is_expired: false, currency_code: invoiceCurrency })
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

        await trx('credit_tracking')
          .where({ credit_id: credit.credit_id, tenant })
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
      const currentInvoice = await trx('invoices')
        .where({ invoice_id: request.invoice_id, tenant })
        .select('credit_applied', 'total_amount')
        .forUpdate()
        .first();
      await trx('invoices')
        .where({ invoice_id: request.invoice_id, tenant })
        .update({
          credit_applied: Number(currentInvoice.credit_applied || 0) + totalApplied,
          total_amount: Number(currentInvoice.total_amount) - totalApplied
        });

      // Update client balance
      await trx('clients')
        .where({ client_id: request.client_id, tenant })
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
    const client = await knex('clients')
      .where({ client_id: request.client_id, tenant })
      .first();
    if (!client) {
      throw new Error('Client not found');
    }

    const createdInvoice = await withTransaction(knex, async (trx) => {
      const now = new Date().toISOString();
      const clientCurrency = client.default_currency_code || 'USD';

      // Determine credit expiration settings
      const clientSettings = await trx('client_billing_settings')
        .where({ client_id: request.client_id, tenant })
        .first();
      const defaultSettings = await trx('default_billing_settings')
        .where({ tenant })
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
          billing_period_start: now,
          billing_period_end: now,
          credit_applied: 0,
          currency_code: clientCurrency
        })
        .returning('*');

      // Get current balance
      const lastTx = await trx('transactions')
        .where({ client_id: request.client_id, tenant })
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
      const sourceCredit = await trx('credit_tracking')
        .where({ credit_id: request.source_credit_id, tenant })
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
      const targetClient = await trx('clients')
        .where({ client_id: request.target_client_id, tenant })
        .first();
      if (!targetClient) {
        throw new Error(`Target client with ID ${request.target_client_id} not found`);
      }

      const now = new Date().toISOString();

      // 1. Reduce source credit remaining amount
      const newSourceRemaining = Number(sourceCredit.remaining_amount) - request.amount;
      await trx('credit_tracking')
        .where({ credit_id: request.source_credit_id, tenant })
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
      const [sourceClient] = await trx('clients')
        .where({ client_id: sourceCredit.client_id, tenant })
        .select('credit_balance');
      const newSourceBalance = Number(sourceClient.credit_balance) - request.amount;
      await trx('clients')
        .where({ client_id: sourceCredit.client_id, tenant })
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
      await trx('clients')
        .where({ client_id: request.target_client_id, tenant })
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
    let baseQuery = knex('credit_tracking')
      .where({ 'credit_tracking.client_id': client_id, 'credit_tracking.tenant': tenant });

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
    const transactions = await knex('transactions')
      .where({ client_id: clientId, tenant })
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
    const client = await knex('clients')
      .where({ client_id: clientId, tenant })
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
    billingCycleId?: string,
    context?: ServiceContext
  ): Promise<FinancialResponse<BillingCalculationResult>> {
    if (context) {
      await this.validatePermissions('read', 'billing', context);
    }
    
    const result = await this.billingEngine.calculateBilling(
      clientId,
      periodStart,
      periodEnd,
      billingCycleId!
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
        await trx('payment_methods')
          .where({
            client_id: data.client_id,
            tenant: context.tenant
          })
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
    
    const { knex } = await this.getKnex();
    const reportDate = asOfDate || new Date().toISOString();
    
    // Get current credit balance
    const client = await knex('clients')
      .where({
        client_id: clientId,
        tenant: context?.tenant || await this.getKnex().then(({tenant}) => tenant)
      })
      .first();

    if (!client) {
      throw new Error('Client not found');
    }

    // Get available (non-expired) credits
    const now = new Date().toISOString();
    const availableCredits = await knex('credit_tracking')
      .where({
        client_id: clientId,
        tenant: client.tenant,
        is_expired: false
      })
      .where(function() {
        this.whereNull('expiration_date')
            .orWhere('expiration_date', '>', now);
      })
      .sum('remaining_amount as total');

    // Get expired credits
    const expiredCredits = await knex('credit_tracking')
      .where({
        client_id: clientId,
        tenant: client.tenant,
        is_expired: true
      })
      .sum('amount as total');

    // Get pending invoices
    const pendingInvoices = await knex('invoices')
      .where({
        client_id: clientId,
        tenant: client.tenant,
        status: 'sent'
      })
      .sum('total_amount as total');

    // Get overdue invoices
    const overdueInvoices = await knex('invoices')
      .where({
        client_id: clientId,
        tenant: client.tenant,
        status: 'overdue'
      })
      .sum('total_amount as total');

    // Get last payment
    const lastPayment = await knex('transactions')
      .where({
        client_id: clientId,
        tenant: client.tenant,
        type: 'payment'
      })
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
    
    const { knex } = await this.getKnex();
    const tenant = context?.tenant || await this.getKnex().then(({tenant}) => tenant);
    const reportDate = new Date().toISOString();
    const now = new Date();

    let query = knex('invoices as i')
      .join('clients as c', 'i.client_id', 'c.client_id')
      .where('i.tenant', tenant)
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
    let revenueQuery = knex('invoices')
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
      .where('tenant', context.tenant)
      .whereIn('status', ['sent', 'paid'])
      .modify((qb) => {
        if (date_from && date_to) {
          qb.whereBetween('created_at', [date_from, date_to]);
        }
      })
      .groupBy(knex.raw(dateGrouping))
      .orderBy('period');

    // Credit analytics
    let creditQuery = knex('transactions')
      .select(
        knex.raw(`${dateGrouping} as period`),
        knex.raw('SUM(CASE WHEN type IN (\'credit_issuance\', \'credit_issuance_from_negative_invoice\') THEN amount ELSE 0 END) as credits_issued'),
        knex.raw('SUM(CASE WHEN type = \'credit_application\' THEN ABS(amount) ELSE 0 END) as credits_applied'),
        knex.raw('SUM(CASE WHEN type = \'credit_expiration\' THEN ABS(amount) ELSE 0 END) as credits_expired')
      )
      .where('tenant', context.tenant)
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
        const balanceQuery = knex('clients')
          .sum('credit_balance as total_balance')
          .where('tenant', context.tenant);
        
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

    const { knex } = await this.getKnex();
    const tenant = context?.tenant || (await this.getKnex()).tenant;
    const userId = context?.userId || 'system';

    const resolvedReport = await withTransaction(knex, async (trx) => {
      // Get the report
      const report = await trx('credit_reconciliation_reports')
        .where({ report_id: reportId, tenant })
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
      await trx('clients')
        .where({ client_id: report.client_id, tenant })
        .update({ credit_balance: report.expected_balance, updated_at: now });

      // Resolve the report
      const [resolved] = await trx('credit_reconciliation_reports')
        .where({ report_id: reportId, tenant })
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

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  /**
   * Get payment terms list
   */
  async getPaymentTerms(context?: ServiceContext): Promise<FinancialResponse<Array<{ id: string; name: string }>>> {
    const { knex } = await this.getKnex();

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
