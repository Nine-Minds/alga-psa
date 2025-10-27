/**
 * Financial Management Controller V2
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
import { ApiBaseController } from './ApiBaseController';
import { FinancialService } from '@product/api/services/FinancialService';
import { z } from 'zod';
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
  createContractLineSchema,
  updateContractLineSchema,
  contractLineListQuerySchema,
  CreateContractLineRequest,
  UpdateContractLineRequest,
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
} from '@product/api/schemas/financialSchemas';

import {
  ApiRequest,
  NotFoundError,
  ValidationError,
  createSuccessResponse,
  createPaginatedResponse,
  handleApiError
} from '@product/api/middleware/apiMiddleware';

import { runWithTenant } from '@server/lib/db';
import { createErrorResponse } from '@product/api/utils/response';

export class ApiFinancialController extends ApiBaseController {
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
  }

  // ============================================================================
  // TRANSACTION MANAGEMENT ENDPOINTS
  // ============================================================================

  /**
   * GET /api/v1/financial/transactions - List transactions with advanced filtering
   */
  listTransactions() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');

          const url = new URL(apiRequest.url);
          const query: Record<string, any> = {};
          url.searchParams.forEach((value, key) => {
            query[key] = value;
          });

          const validatedQuery = transactionListQuerySchema.parse(query);
          
          const result = await this.financialService.listTransactions(validatedQuery, apiRequest.context!);
          
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
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * POST /api/v1/financial/transactions - Create a new transaction
   */
  createTransaction() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'create');

          const body = await apiRequest.json();
          const validatedData = createTransactionSchema.parse(body);

          // Add tenant from context
          const transactionData = {
            ...validatedData,
            tenant: apiRequest.context!.tenant
          };

          const result = await this.financialService.createTransaction(transactionData, apiRequest.context!);
          return createSuccessResponse(result, 201);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * GET /api/v1/financial/transactions/{id} - Get transaction by ID
   */
  getTransactionById() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');

          const transactionId = await this.extractIdFromPath(apiRequest);
          const result = await this.financialService.getTransaction(transactionId, apiRequest.context!);
          
          if (!result) {
            throw new NotFoundError('Transaction not found');
          }

          return createSuccessResponse(result);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // CREDIT MANAGEMENT ENDPOINTS
  // ============================================================================

  /**
   * GET /api/v1/financial/credits - List client credits
   */
  listCredits() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');

          const url = new URL(apiRequest.url);
          const query: Record<string, any> = {};
          url.searchParams.forEach((value, key) => {
            query[key] = value;
          });

          const validatedQuery = creditListQuerySchema.parse(query);
          
          const result = await this.financialService.listClientCredits(validatedQuery, apiRequest.context!);
          
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
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * POST /api/v1/financial/credits/apply-to-invoice - Apply credit to invoice
   */
  applyCreditToInvoice() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');

          const body = await apiRequest.json();
          const validatedData = applyCreditToInvoiceSchema.parse(body);

          const result = await this.financialService.applyCreditToInvoice(validatedData, apiRequest.context!);
          return createSuccessResponse(result);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * POST /api/v1/financial/credits/prepayment-invoice - Create prepayment invoice
   */
  createPrepaymentInvoice() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'create');

          const body = await apiRequest.json();
          const validatedData = createPrepaymentInvoiceSchema.parse(body);

          const result = await this.financialService.createPrepaymentInvoice(validatedData, apiRequest.context!);
          return createSuccessResponse(result, 201);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * POST /api/v1/financial/credits/transfer - Transfer credit between clients
   */
  transferCredit() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'transfer');

          const body = await apiRequest.json();
          const validatedData = transferCreditSchema.parse(body);

          const result = await this.financialService.transferCredit(validatedData, apiRequest.context!);
          return createSuccessResponse(result, 201);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * POST /api/v1/financial/credits/balance/validate - Validate credit balance
   */
  validateCreditBalance() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');

          const body = await apiRequest.json();
          const validatedData = validateCreditBalanceSchema.parse(body);

          const result = await this.financialService.validateCreditBalance(validatedData.client_id, apiRequest.context!);
          return createSuccessResponse(result);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // PAYMENT METHOD ENDPOINTS
  // ============================================================================

  /**
   * POST /api/v1/financial/payment-methods - Create payment method
   */
  createPaymentMethod() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'create');

          const body = await apiRequest.json();
          const validatedData = createPaymentMethodSchema.parse(body);

          // Add tenant from context
          const paymentMethodData = {
            ...validatedData,
            tenant: apiRequest.context!.tenant
          };

          const result = await this.financialService.createPaymentMethod(paymentMethodData, apiRequest.context!);
          return createSuccessResponse(result, 201);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // TAX MANAGEMENT ENDPOINTS
  // ============================================================================

  /**
   * POST /api/v1/financial/tax/calculate - Calculate tax
   */
  calculateTax() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');

          const body = await apiRequest.json();
          const taxCalculationSchema = z.object({
            client_id: z.string().uuid(),
            amount: z.number().min(0),
            tax_region: z.string(),
            date: z.string().optional()
          });

          const validatedData = taxCalculationSchema.parse(body);

          const result = await this.financialService.calculateTax(
            validatedData.client_id,
            validatedData.amount,
            validatedData.tax_region,
            validatedData.date,
            apiRequest.context!
          );
          return createSuccessResponse(result);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // CONTRACT LINE ENDPOINTS
  // ============================================================================

  /**
   * POST /api/v1/financial/billing/calculate - Calculate billing
   */
  calculateBilling() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');

          const body = await apiRequest.json();
          const validatedData = calculateBillingSchema.parse(body);

          const result = await this.financialService.calculateBilling(
            validatedData.client_id,
            validatedData.period_start!,
            validatedData.period_end!,
            validatedData.billing_cycle_id,
            apiRequest.context!
          );
          return createSuccessResponse(result);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * GET /api/v1/financial/billing/terms - Get payment terms
   */
  getPaymentTerms() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');

          const result = await this.financialService.getPaymentTerms(apiRequest.context!);
          return createSuccessResponse(result);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // FINANCIAL REPORTING ENDPOINTS
  // ============================================================================

  /**
   * GET /api/v1/financial/reports/account-balance - Account balance report
   */
  getAccountBalanceReport() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');

          const url = new URL(apiRequest.url);
          const clientId = url.searchParams.get('client_id');
          const asOfDate = url.searchParams.get('as_of_date') || undefined;

          if (!clientId) {
            throw new ValidationError('client_id parameter is required');
          }

          const result = await this.financialService.getAccountBalanceReport(
            clientId,
            asOfDate,
            apiRequest.context!
          );
          return createSuccessResponse(result);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * GET /api/v1/financial/reports/aging - Aging report
   */
  getAgingReport() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');

          const url = new URL(apiRequest.url);
          const clientId = url.searchParams.get('client_id') || undefined;

          const result = await this.financialService.getAgingReport(clientId, apiRequest.context!);
          return createSuccessResponse(result);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * GET /api/v1/financial/reports/analytics - Financial analytics
   */
  getFinancialAnalytics() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');

          const url = new URL(apiRequest.url);
          const query: Record<string, any> = {};
          url.searchParams.forEach((value, key) => {
            query[key] = value;
          });

          const validatedQuery = financialAnalyticsQuerySchema.parse(query);

          const result = await this.financialService.getFinancialAnalytics(validatedQuery, apiRequest.context!);
          return createSuccessResponse(result);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // RECONCILIATION ENDPOINTS
  // ============================================================================

  /**
   * POST /api/v1/financial/reconciliation/run - Run reconciliation
   */
  runReconciliation() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');

          const url = new URL(apiRequest.url);
          const clientId = url.searchParams.get('client_id') || undefined;

          const result = await this.financialService.runCreditReconciliation(clientId, apiRequest.context!);
          return createSuccessResponse(result);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * POST /api/v1/financial/reconciliation/{id}/resolve - Resolve reconciliation report
   */
  resolveReconciliationReport() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');

          const body = await apiRequest.json();
          const notesSchema = z.object({
            notes: z.string().optional()
          });
          const validatedData = notesSchema.parse(body);

          const reportId = await this.extractIdFromPath(apiRequest);
          const result = await this.financialService.resolveReconciliationReport(
            reportId,
            validatedData.notes,
            apiRequest.context!
          );
          return createSuccessResponse(result);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // BULK OPERATION ENDPOINTS
  // ============================================================================

  /**
   * POST /api/v1/financial/bulk/invoices - Bulk invoice operations
   */
  bulkInvoiceOperations() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');

          const body = await apiRequest.json();
          const validatedData = bulkInvoiceOperationSchema.parse(body);

          const result = await this.financialService.bulkInvoiceOperation(validatedData, apiRequest.context!);
          return createSuccessResponse(result);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * POST /api/v1/financial/bulk/transactions - Bulk transaction operations
   */
  bulkTransactionOperations() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');

          const body = await apiRequest.json();
          const validatedData = bulkTransactionOperationSchema.parse(body);

          // TODO: Implement bulkTransactionOperation in FinancialService
          return createErrorResponse('Not implemented', 501);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * POST /api/v1/financial/bulk/credits - Bulk credit operations
   */
  bulkCreditOperations() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'update');

          const body = await apiRequest.json();
          const validatedData = bulkCreditOperationSchema.parse(body);

          // TODO: Implement bulkCreditOperation in FinancialService
          return createErrorResponse('Not implemented', 501);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // ENHANCED CRUD OPERATIONS WITH HATEOAS
  // ============================================================================

  /**
   * Enhanced list method with HATEOAS links and metadata
   */
  list() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');

          const url = new URL(apiRequest.url);
          const query: Record<string, any> = {};
          url.searchParams.forEach((value, key) => {
            query[key] = value;
          });

          const validatedQuery = transactionListQuerySchema.parse(query);
          
          const result = await this.financialService.listTransactions(validatedQuery, apiRequest.context!);
          
          // Add HATEOAS links to response
          const enhancedData = result.data.map(item => ({
            ...item,
            _links: {
              self: `/api/v1/financial/transactions/${item.data.transaction_id}`,
              edit: `/api/v1/financial/transactions/${item.data.transaction_id}`,
              related: `/api/v1/financial/transactions/${item.data.transaction_id}/related`,
              client: `/api/v1/clients/${item.data.client_id}`,
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
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Enhanced getById with HATEOAS links
   */
  getById() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');

          const id = await this.extractIdFromPath(apiRequest);
          const result = await this.financialService.getTransaction(id, apiRequest.context!);
          
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
              client: `/api/v1/clients/${result.data.client_id}`,
              collection: '/api/v1/financial/transactions',
              reports: `/api/v1/financial/reports/account-balance?client_id=${result.data.client_id}`,
              ...(result.data.invoice_id && {
                invoice: `/api/v1/financial/invoices/${result.data.invoice_id}`
              })
            }
          };

          return createSuccessResponse(enhancedResult);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Enhanced create with HATEOAS links and comprehensive response
   */
  create() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'create');

          const body = await apiRequest.json();
          const validatedData = createTransactionSchema.parse(body);

          // Add tenant from context
          const transactionData = {
            ...validatedData,
            tenant: apiRequest.context!.tenant
          };

          const result = await this.financialService.createTransaction(transactionData, apiRequest.context!);
          
          // Add comprehensive HATEOAS links
          const enhancedResult = {
            ...result,
            _links: {
              self: `/api/v1/financial/transactions/${result.data.transaction_id}`,
              edit: `/api/v1/financial/transactions/${result.data.transaction_id}`,
              client: `/api/v1/clients/${result.data.client_id}`,
              collection: '/api/v1/financial/transactions',
              balance_report: `/api/v1/financial/reports/account-balance?client_id=${result.data.client_id}`,
              ...(result.data.invoice_id && {
                invoice: `/api/v1/financial/invoices/${result.data.invoice_id}`
              })
            }
          };

          return createSuccessResponse(enhancedResult, 201);
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }
}