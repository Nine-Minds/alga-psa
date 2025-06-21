/**
 * Financial Management Controller
 * Comprehensive REST API controller for financial operations including:
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

import { NextRequest, NextResponse } from 'next/server';
import { BaseController } from './BaseController';
import { FinancialService } from '../services/FinancialService';
import {
  // Transaction schemas
  createTransactionSchema,
  updateTransactionSchema,
  transactionListQuerySchema,
  CreateTransactionRequest,
  UpdateTransactionRequest,
  TransactionListQuery,
  
  // Credit schemas
  createCreditTrackingSchema,
  updateCreditTrackingSchema,
  creditListQuerySchema,
  applyCreditToInvoiceSchema,
  createPrepaymentInvoiceSchema,
  transferCreditSchema,
  updateCreditExpirationSchema,
  manuallyExpireCreditSchema,
  CreateCreditTrackingRequest,
  UpdateCreditTrackingRequest,
  CreditListQuery,
  ApplyCreditToInvoiceRequest,
  CreatePrepaymentInvoiceRequest,
  TransferCreditRequest,
  
  // Payment method schemas
  createPaymentMethodSchema,
  updatePaymentMethodSchema,
  paymentMethodListQuerySchema,
  CreatePaymentMethodRequest,
  UpdatePaymentMethodRequest,
  
  // Invoice schemas
  createInvoiceSchema,
  updateInvoiceSchema,
  invoiceListQuerySchema,
  addManualItemsSchema,
  CreateInvoiceRequest,
  UpdateInvoiceRequest,
  InvoiceListQuery,
  
  // Tax schemas
  createTaxRateSchema,
  updateTaxRateSchema,
  taxRateListQuerySchema,
  CreateTaxRateRequest,
  UpdateTaxRateRequest,
  
  // Billing schemas
  createBillingPlanSchema,
  updateBillingPlanSchema,
  billingPlanListQuerySchema,
  CreateBillingPlanRequest,
  UpdateBillingPlanRequest,
  calculateBillingSchema,
  
  // Reconciliation schemas
  createCreditReconciliationReportSchema,
  reconciliationListQuerySchema,
  CreateCreditReconciliationReportRequest,
  
  // Reporting schemas
  financialAnalyticsQuerySchema,
  FinancialAnalyticsQuery,
  
  // Bulk operation schemas
  bulkInvoiceOperationSchema,
  bulkTransactionOperationSchema,
  bulkCreditOperationSchema,
  BulkInvoiceOperation,
  BulkTransactionOperation,
  BulkCreditOperation,
  
  // Utility schemas
  validateCreditBalanceSchema,
  updateBillingSettingsSchema
} from '../schemas/financialSchemas';

import { 
  withAuth, 
  withPermission, 
  withValidation, 
  withQueryValidation,
  createSuccessResponse,
  createPaginatedResponse,
  NotFoundError,
  ValidationError,
  ApiRequest,
  compose
} from '../middleware/apiMiddleware';

import { ApiRegistry } from '../metadata/ApiRegistry';
import { idParamSchema } from '../schemas/common';

export class FinancialController extends BaseController {
  private financialService: FinancialService;

  constructor() {
    const financialService = new FinancialService();
    
    super(financialService, {
      resource: 'financial',
      createSchema: createTransactionSchema,
      updateSchema: updateTransactionSchema,
      querySchema: transactionListQuerySchema,
      permissions: {
        create: 'create',
        read: 'read', 
        update: 'update',
        delete: 'delete',
        list: 'read'
      }
    });

    this.financialService = financialService;
    this.registerEndpoints();
  }

  /**
   * Register all financial endpoints with the API metadata system
   */
  private registerEndpoints(): void {
    // Transaction endpoints
    this.registerTransactionEndpoints();
    
    // Credit management endpoints
    this.registerCreditEndpoints();
    
    // Payment method endpoints
    this.registerPaymentMethodEndpoints();
    
    // Invoice endpoints
    this.registerInvoiceEndpoints();
    
    // Tax management endpoints
    this.registerTaxEndpoints();
    
    // Billing plan endpoints
    this.registerBillingPlanEndpoints();
    
    // Financial reporting endpoints
    this.registerReportingEndpoints();
    
    // Reconciliation endpoints
    this.registerReconciliationEndpoints();
    
    // Bulk operation endpoints
    this.registerBulkOperationEndpoints();
    
    // Utility endpoints
    this.registerUtilityEndpoints();
  }

  // ============================================================================
  // TRANSACTION MANAGEMENT ENDPOINTS
  // ============================================================================

  private registerTransactionEndpoints(): void {
    ApiRegistry.registerEndpoint({
      path: '/api/v1/financial/transactions',
      method: 'GET',
      resource: 'financial',
      action: 'read',
      description: 'List financial transactions with filtering and pagination',
      permissions: { resource: 'transaction', action: 'read' },
      querySchema: transactionListQuerySchema,
      tags: ['financial', 'transactions']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/financial/transactions',
      method: 'POST',
      resource: 'financial',
      action: 'create',
      description: 'Create a new financial transaction',
      permissions: { resource: 'transaction', action: 'create' },
      requestSchema: createTransactionSchema,
      tags: ['financial', 'transactions']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/financial/transactions/{id}',
      method: 'GET',
      resource: 'financial',
      action: 'read',
      description: 'Get transaction details by ID',
      permissions: { resource: 'transaction', action: 'read' },
      tags: ['financial', 'transactions']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/financial/transactions/{id}',
      method: 'PUT',
      resource: 'financial',
      action: 'update',
      description: 'Update transaction information',
      permissions: { resource: 'transaction', action: 'update' },
      requestSchema: updateTransactionSchema,
      tags: ['financial', 'transactions']
    });
  }

  /**
   * GET /api/v1/financial/transactions - List transactions with advanced filtering
   */
  listTransactions() {
    const middleware = compose(
      withAuth,
      withPermission('transaction', 'read'),
      withQueryValidation(transactionListQuerySchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: TransactionListQuery) => {
      const result = await this.financialService.listTransactions(validatedQuery, req.context!);
      
      return createPaginatedResponse(
        result.data,
        result.total,
        validatedQuery.page || 1,
        validatedQuery.limit || 25,
        {
          filters: validatedQuery,
          resource: 'financial/transactions'
        }
      );
    });
  }

  /**
   * POST /api/v1/financial/transactions - Create a new transaction
   */
  createTransaction() {
    const middleware = compose(
      withAuth,
      withPermission('transaction', 'create'),
      withValidation(createTransactionSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: CreateTransactionRequest) => {
      // Add tenant from context
      const transactionData = {
        ...validatedData,
        tenant: req.context!.tenant
      };

      const result = await this.financialService.createTransaction(transactionData, req.context!);
      return createSuccessResponse(result, 201);
    });
  }

  /**
   * GET /api/v1/financial/transactions/{id} - Get transaction by ID
   */
  getTransactionById() {
    const middleware = compose(
      withAuth,
      withPermission('transaction', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const transactionId = this.extractIdFromPath(req);
      const result = await this.financialService.getTransaction(transactionId, req.context!);
      
      if (!result) {
        throw new NotFoundError('Transaction not found');
      }

      return createSuccessResponse(result);
    });
  }

  // ============================================================================
  // CREDIT MANAGEMENT ENDPOINTS
  // ============================================================================

  private registerCreditEndpoints(): void {
    ApiRegistry.registerEndpoint({
      path: '/api/v1/financial/credits',
      method: 'GET',
      resource: 'financial',
      action: 'read',
      description: 'List company credits with filtering',
      permissions: { resource: 'credit', action: 'read' },
      querySchema: creditListQuerySchema,
      tags: ['financial', 'credits']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/financial/credits/apply-to-invoice',
      method: 'POST',
      resource: 'financial',
      action: 'update',
      description: 'Apply credit to an invoice',
      permissions: { resource: 'credit', action: 'update' },
      requestSchema: applyCreditToInvoiceSchema,
      tags: ['financial', 'credits']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/financial/credits/prepayment-invoice',
      method: 'POST',
      resource: 'financial',
      action: 'create',
      description: 'Create a prepayment invoice',
      permissions: { resource: 'credit', action: 'create' },
      requestSchema: createPrepaymentInvoiceSchema,
      tags: ['financial', 'credits']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/financial/credits/transfer',
      method: 'POST',
      resource: 'financial',
      action: 'transfer',
      description: 'Transfer credit between companies',
      permissions: { resource: 'credit', action: 'transfer' },
      requestSchema: transferCreditSchema,
      tags: ['financial', 'credits']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/financial/credits/{id}/expire',
      method: 'POST',
      resource: 'financial',
      action: 'update',
      description: 'Manually expire a credit',
      permissions: { resource: 'credit', action: 'update' },
      requestSchema: manuallyExpireCreditSchema,
      tags: ['financial', 'credits']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/financial/credits/{id}/expiration',
      method: 'PUT',
      resource: 'financial',
      action: 'update',
      description: 'Update credit expiration date',
      permissions: { resource: 'credit', action: 'update' },
      requestSchema: updateCreditExpirationSchema,
      tags: ['financial', 'credits']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/financial/credits/balance/validate',
      method: 'POST',
      resource: 'financial',
      action: 'read',
      description: 'Validate company credit balance',
      permissions: { resource: 'credit', action: 'read' },
      requestSchema: validateCreditBalanceSchema,
      tags: ['financial', 'credits']
    });
  }

  /**
   * GET /api/v1/financial/credits - List company credits
   */
  listCredits() {
    const middleware = compose(
      withAuth,
      withPermission('credit', 'read'),
      withQueryValidation(creditListQuerySchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: CreditListQuery) => {
      const result = await this.financialService.listCompanyCredits(validatedQuery, req.context!);
      
      return createPaginatedResponse(
        result.data,
        result.total,
        validatedQuery.page || 1,
        validatedQuery.limit || 25,
        {
          filters: validatedQuery,
          resource: 'financial/credits'
        }
      );
    });
  }

  /**
   * POST /api/v1/financial/credits/apply-to-invoice - Apply credit to invoice
   */
  applyCreditToInvoice() {
    const middleware = compose(
      withAuth,
      withPermission('credit', 'update'),
      withValidation(applyCreditToInvoiceSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: ApplyCreditToInvoiceRequest) => {
      const result = await this.financialService.applyCreditToInvoice(validatedData, req.context!);
      return createSuccessResponse(result);
    });
  }

  /**
   * POST /api/v1/financial/credits/prepayment-invoice - Create prepayment invoice
   */
  createPrepaymentInvoice() {
    const middleware = compose(
      withAuth,
      withPermission('credit', 'create'),
      withValidation(createPrepaymentInvoiceSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: CreatePrepaymentInvoiceRequest) => {
      const result = await this.financialService.createPrepaymentInvoice(validatedData, req.context!);
      return createSuccessResponse(result, 201);
    });
  }

  /**
   * POST /api/v1/financial/credits/transfer - Transfer credit between companies
   */
  transferCredit() {
    const middleware = compose(
      withAuth,
      withPermission('credit', 'transfer'),
      withValidation(transferCreditSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: TransferCreditRequest) => {
      const result = await this.financialService.transferCredit(validatedData, req.context!);
      return createSuccessResponse(result, 201);
    });
  }

  /**
   * POST /api/v1/financial/credits/balance/validate - Validate credit balance
   */
  validateCreditBalance() {
    const middleware = compose(
      withAuth,
      withPermission('credit', 'read'),
      withValidation(validateCreditBalanceSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: { company_id: string }) => {
      const result = await this.financialService.validateCreditBalance(validatedData.company_id, req.context!);
      return createSuccessResponse(result);
    });
  }

  // ============================================================================
  // PAYMENT METHOD ENDPOINTS
  // ============================================================================

  private registerPaymentMethodEndpoints(): void {
    ApiRegistry.registerEndpoint({
      path: '/api/v1/financial/payment-methods',
      method: 'GET',
      resource: 'financial',
      action: 'read',
      description: 'List payment methods with filtering',
      permissions: { resource: 'payment_method', action: 'read' },
      querySchema: paymentMethodListQuerySchema,
      tags: ['financial', 'payment-methods']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/financial/payment-methods',
      method: 'POST',
      resource: 'financial',
      action: 'create',
      description: 'Create a new payment method',
      permissions: { resource: 'payment_method', action: 'create' },
      requestSchema: createPaymentMethodSchema,
      tags: ['financial', 'payment-methods']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/financial/payment-methods/{id}',
      method: 'GET',
      resource: 'financial',
      action: 'read',
      description: 'Get payment method details by ID',
      permissions: { resource: 'payment_method', action: 'read' },
      tags: ['financial', 'payment-methods']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/financial/payment-methods/{id}',
      method: 'PUT',
      resource: 'financial',
      action: 'update',
      description: 'Update payment method information',
      permissions: { resource: 'payment_method', action: 'update' },
      requestSchema: updatePaymentMethodSchema,
      tags: ['financial', 'payment-methods']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/financial/payment-methods/{id}',
      method: 'DELETE',
      resource: 'financial',
      action: 'delete',
      description: 'Delete a payment method',
      permissions: { resource: 'payment_method', action: 'delete' },
      tags: ['financial', 'payment-methods']
    });
  }

  /**
   * POST /api/v1/financial/payment-methods - Create payment method
   */
  createPaymentMethod() {
    const middleware = compose(
      withAuth,
      withPermission('payment_method', 'create'),
      withValidation(createPaymentMethodSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: CreatePaymentMethodRequest) => {
      // Add tenant from context
      const paymentMethodData = {
        ...validatedData,
        tenant: req.context!.tenant
      };

      const result = await this.financialService.createPaymentMethod(paymentMethodData, req.context!);
      return createSuccessResponse(result, 201);
    });
  }

  // ============================================================================
  // INVOICE ENDPOINTS
  // ============================================================================

  private registerInvoiceEndpoints(): void {
    ApiRegistry.registerEndpoint({
      path: '/api/v1/financial/invoices',
      method: 'GET',
      resource: 'financial',
      action: 'read',
      description: 'List invoices with filtering and pagination',
      permissions: { resource: 'invoice', action: 'read' },
      querySchema: invoiceListQuerySchema,
      tags: ['financial', 'invoices']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/financial/invoices/{id}/items',
      method: 'POST',
      resource: 'financial',
      action: 'update',
      description: 'Add manual items to an invoice',
      permissions: { resource: 'invoice', action: 'update' },
      requestSchema: addManualItemsSchema,
      tags: ['financial', 'invoices']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/financial/invoices/{id}/finalize',
      method: 'POST',
      resource: 'financial',
      action: 'update',
      description: 'Finalize an invoice',
      permissions: { resource: 'invoice', action: 'update' },
      tags: ['financial', 'invoices']
    });
  }

  // ============================================================================
  // TAX MANAGEMENT ENDPOINTS
  // ============================================================================

  private registerTaxEndpoints(): void {
    ApiRegistry.registerEndpoint({
      path: '/api/v1/financial/tax/calculate',
      method: 'POST',
      resource: 'financial',
      action: 'read',
      description: 'Calculate tax for a given amount and region',
      permissions: { resource: 'tax', action: 'read' },
      tags: ['financial', 'tax']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/financial/tax/rates',
      method: 'GET',
      resource: 'financial',
      action: 'read',
      description: 'List tax rates with filtering',
      permissions: { resource: 'tax', action: 'read' },
      querySchema: taxRateListQuerySchema,
      tags: ['financial', 'tax']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/financial/tax/rates',
      method: 'POST',
      resource: 'financial',
      action: 'create',
      description: 'Create a new tax rate',
      permissions: { resource: 'tax', action: 'create' },
      requestSchema: createTaxRateSchema,
      tags: ['financial', 'tax']
    });
  }

  /**
   * POST /api/v1/financial/tax/calculate - Calculate tax
   */
  calculateTax() {
    const middleware = compose(
      withAuth,
      withPermission('tax', 'read'),
      withValidation(z.object({
        company_id: z.string().uuid(),
        amount: z.number().min(0),
        tax_region: z.string(),
        date: z.string().optional()
      }))
    );

    return middleware(async (req: ApiRequest, validatedData: any) => {
      const result = await this.financialService.calculateTax(
        validatedData.company_id,
        validatedData.amount,
        validatedData.tax_region,
        validatedData.date,
        req.context!
      );
      return createSuccessResponse(result);
    });
  }

  // ============================================================================
  // BILLING PLAN ENDPOINTS
  // ============================================================================

  private registerBillingPlanEndpoints(): void {
    ApiRegistry.registerEndpoint({
      path: '/api/v1/financial/billing/calculate',
      method: 'POST',
      resource: 'financial',
      action: 'read',
      description: 'Calculate billing for a company and period',
      permissions: { resource: 'billing', action: 'read' },
      requestSchema: calculateBillingSchema,
      tags: ['financial', 'billing']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/financial/billing/terms',
      method: 'GET',
      resource: 'financial',
      action: 'read',
      description: 'Get available payment terms',
      permissions: { resource: 'billing', action: 'read' },
      tags: ['financial', 'billing']
    });
  }

  /**
   * POST /api/v1/financial/billing/calculate - Calculate billing
   */
  calculateBilling() {
    const middleware = compose(
      withAuth,
      withPermission('billing', 'read'),
      withValidation(calculateBillingSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: any) => {
      const result = await this.financialService.calculateBilling(
        validatedData.company_id,
        validatedData.period_start,
        validatedData.period_end,
        validatedData.billing_cycle_id,
        req.context!
      );
      return createSuccessResponse(result);
    });
  }

  /**
   * GET /api/v1/financial/billing/terms - Get payment terms
   */
  getPaymentTerms() {
    const middleware = compose(
      withAuth,
      withPermission('billing', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const result = await this.financialService.getPaymentTerms(req.context!);
      return createSuccessResponse(result);
    });
  }

  // ============================================================================
  // FINANCIAL REPORTING ENDPOINTS
  // ============================================================================

  private registerReportingEndpoints(): void {
    ApiRegistry.registerEndpoint({
      path: '/api/v1/financial/reports/account-balance',
      method: 'GET',
      resource: 'financial',
      action: 'read',
      description: 'Generate account balance report for a company',
      permissions: { resource: 'financial_report', action: 'read' },
      tags: ['financial', 'reports']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/financial/reports/aging',
      method: 'GET',
      resource: 'financial',
      action: 'read',
      description: 'Generate aging report for outstanding invoices',
      permissions: { resource: 'financial_report', action: 'read' },
      tags: ['financial', 'reports']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/financial/reports/analytics',
      method: 'GET',
      resource: 'financial',
      action: 'read',
      description: 'Get financial analytics with revenue and credit metrics',
      permissions: { resource: 'financial_report', action: 'read' },
      querySchema: financialAnalyticsQuerySchema,
      tags: ['financial', 'reports', 'analytics']
    });
  }

  /**
   * GET /api/v1/financial/reports/account-balance - Account balance report
   */
  getAccountBalanceReport() {
    const middleware = compose(
      withAuth,
      withPermission('financial_report', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const url = new URL(req.url);
      const companyId = url.searchParams.get('company_id');
      const asOfDate = url.searchParams.get('as_of_date') || undefined;

      if (!companyId) {
        throw new ValidationError('company_id parameter is required');
      }

      const result = await this.financialService.getAccountBalanceReport(
        companyId,
        asOfDate,
        req.context!
      );
      return createSuccessResponse(result);
    });
  }

  /**
   * GET /api/v1/financial/reports/aging - Aging report
   */
  getAgingReport() {
    const middleware = compose(
      withAuth,
      withPermission('financial_report', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const url = new URL(req.url);
      const companyId = url.searchParams.get('company_id') || undefined;

      const result = await this.financialService.getAgingReport(companyId, req.context!);
      return createSuccessResponse(result);
    });
  }

  /**
   * GET /api/v1/financial/reports/analytics - Financial analytics
   */
  getFinancialAnalytics() {
    const middleware = compose(
      withAuth,
      withPermission('financial_report', 'read'),
      withQueryValidation(financialAnalyticsQuerySchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: FinancialAnalyticsQuery) => {
      const result = await this.financialService.getFinancialAnalytics(validatedQuery, req.context!);
      return createSuccessResponse(result);
    });
  }

  // ============================================================================
  // RECONCILIATION ENDPOINTS
  // ============================================================================

  private registerReconciliationEndpoints(): void {
    ApiRegistry.registerEndpoint({
      path: '/api/v1/financial/reconciliation',
      method: 'GET',
      resource: 'financial',
      action: 'read',
      description: 'List reconciliation reports with filtering',
      permissions: { resource: 'credit', action: 'read' },
      querySchema: reconciliationListQuerySchema,
      tags: ['financial', 'reconciliation']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/financial/reconciliation/run',
      method: 'POST',
      resource: 'financial',
      action: 'update',
      description: 'Run credit reconciliation for companies',
      permissions: { resource: 'credit', action: 'update' },
      tags: ['financial', 'reconciliation']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/financial/reconciliation/{id}/resolve',
      method: 'POST',
      resource: 'financial',
      action: 'update',
      description: 'Resolve a reconciliation report',
      permissions: { resource: 'credit', action: 'update' },
      tags: ['financial', 'reconciliation']
    });
  }

  /**
   * POST /api/v1/financial/reconciliation/run - Run reconciliation
   */
  runReconciliation() {
    const middleware = compose(
      withAuth,
      withPermission('credit', 'update')
    );

    return middleware(async (req: ApiRequest) => {
      const url = new URL(req.url);
      const companyId = url.searchParams.get('company_id') || undefined;

      const result = await this.financialService.runCreditReconciliation(companyId, req.context!);
      return createSuccessResponse(result);
    });
  }

  /**
   * POST /api/v1/financial/reconciliation/{id}/resolve - Resolve reconciliation report
   */
  resolveReconciliationReport() {
    const middleware = compose(
      withAuth,
      withPermission('credit', 'update'),
      withValidation(z.object({
        notes: z.string().optional()
      }))
    );

    return middleware(async (req: ApiRequest, validatedData: { notes?: string }) => {
      const reportId = this.extractIdFromPath(req);
      const result = await this.financialService.resolveReconciliationReport(
        reportId,
        validatedData.notes,
        req.context!
      );
      return createSuccessResponse(result);
    });
  }

  // ============================================================================
  // BULK OPERATION ENDPOINTS
  // ============================================================================

  private registerBulkOperationEndpoints(): void {
    ApiRegistry.registerEndpoint({
      path: '/api/v1/financial/bulk/invoices',
      method: 'POST',
      resource: 'financial',
      action: 'update',
      description: 'Perform bulk operations on invoices',
      permissions: { resource: 'invoice', action: 'update' },
      requestSchema: bulkInvoiceOperationSchema,
      tags: ['financial', 'bulk-operations']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/financial/bulk/transactions',
      method: 'POST',
      resource: 'financial',
      action: 'update',
      description: 'Perform bulk operations on transactions',
      permissions: { resource: 'transaction', action: 'update' },
      requestSchema: bulkTransactionOperationSchema,
      tags: ['financial', 'bulk-operations']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/financial/bulk/credits',
      method: 'POST',
      resource: 'financial',
      action: 'update',
      description: 'Perform bulk operations on credits',
      permissions: { resource: 'credit', action: 'update' },
      requestSchema: bulkCreditOperationSchema,
      tags: ['financial', 'bulk-operations']
    });
  }

  /**
   * POST /api/v1/financial/bulk/invoices - Bulk invoice operations
   */
  bulkInvoiceOperations() {
    const middleware = compose(
      withAuth,
      withPermission('invoice', 'update'),
      withValidation(bulkInvoiceOperationSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: BulkInvoiceOperation) => {
      const result = await this.financialService.bulkInvoiceOperation(validatedData, req.context!);
      return createSuccessResponse(result);
    });
  }

  // ============================================================================
  // UTILITY ENDPOINTS
  // ============================================================================

  private registerUtilityEndpoints(): void {
    ApiRegistry.registerEndpoint({
      path: '/api/v1/financial/settings/billing',
      method: 'GET',
      resource: 'financial',
      action: 'read',
      description: 'Get billing settings',
      permissions: { resource: 'billing_settings', action: 'read' },
      tags: ['financial', 'settings']
    });

    ApiRegistry.registerEndpoint({
      path: '/api/v1/financial/settings/billing',
      method: 'PUT',
      resource: 'financial',
      action: 'update',
      description: 'Update billing settings',
      permissions: { resource: 'billing_settings', action: 'update' },
      requestSchema: updateBillingSettingsSchema,
      tags: ['financial', 'settings']
    });
  }

  // ============================================================================
  // ENHANCED CRUD OPERATIONS WITH HATEOAS
  // ============================================================================

  /**
   * Enhanced list method with HATEOAS links and metadata
   */
  list() {
    const middleware = compose(
      withAuth,
      withPermission('transaction', 'read'),
      withQueryValidation(transactionListQuerySchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery: TransactionListQuery) => {
      const result = await this.financialService.listTransactions(validatedQuery, req.context!);
      
      // Add HATEOAS links to response
      const enhancedData = result.data.map(item => ({
        ...item,
        _links: {
          self: `/api/v1/financial/transactions/${item.data.transaction_id}`,
          edit: `/api/v1/financial/transactions/${item.data.transaction_id}`,
          related: `/api/v1/financial/transactions/${item.data.transaction_id}/related`,
          company: `/api/v1/companies/${item.data.company_id}`,
          collection: '/api/v1/financial/transactions'
        }
      }));
      
      return createPaginatedResponse(
        enhancedData,
        result.total,
        validatedQuery.page || 1,
        validatedQuery.limit || 25,
        {
          filters: validatedQuery,
          resource: 'financial/transactions',
          _links: {
            reports: '/api/v1/financial/reports',
            credits: '/api/v1/financial/credits',
            invoices: '/api/v1/financial/invoices'
          }
        }
      );
    });
  }

  /**
   * Enhanced getById with HATEOAS links
   */
  getById() {
    const middleware = compose(
      withAuth,
      withPermission('transaction', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      const id = this.extractIdFromPath(req);
      const result = await this.financialService.getTransaction(id, req.context!);
      
      if (!result) {
        throw new NotFoundError('Transaction not found');
      }

      // Add comprehensive HATEOAS links
      const enhancedResult = {
        ...result,
        _links: {
          self: `/api/v1/financial/transactions/${id}`,
          edit: `/api/v1/financial/transactions/${id}`,
          related: `/api/v1/financial/transactions/${id}/related`,
          company: `/api/v1/companies/${result.data.company_id}`,
          collection: '/api/v1/financial/transactions',
          reports: `/api/v1/financial/reports/account-balance?company_id=${result.data.company_id}`,
          ...(result.data.invoice_id && {
            invoice: `/api/v1/financial/invoices/${result.data.invoice_id}`
          })
        }
      };

      return createSuccessResponse(enhancedResult);
    });
  }

  /**
   * Enhanced create with HATEOAS links and comprehensive response
   */
  create() {
    const middleware = compose(
      withAuth,
      withPermission('transaction', 'create'),
      withValidation(createTransactionSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: CreateTransactionRequest) => {
      // Add tenant from context
      const transactionData = {
        ...validatedData,
        tenant: req.context!.tenant
      };

      const result = await this.financialService.createTransaction(transactionData, req.context!);
      
      // Add comprehensive HATEOAS links
      const enhancedResult = {
        ...result,
        _links: {
          self: `/api/v1/financial/transactions/${result.data.transaction_id}`,
          edit: `/api/v1/financial/transactions/${result.data.transaction_id}`,
          company: `/api/v1/companies/${result.data.company_id}`,
          collection: '/api/v1/financial/transactions',
          balance_report: `/api/v1/financial/reports/account-balance?company_id=${result.data.company_id}`,
          ...(result.data.invoice_id && {
            invoice: `/api/v1/financial/invoices/${result.data.invoice_id}`
          })
        }
      };

      return createSuccessResponse(enhancedResult, 201);
    });
  }
}

// Import z for inline validation schemas
import { z } from 'zod';