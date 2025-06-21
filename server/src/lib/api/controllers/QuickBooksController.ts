/**
 * QuickBooks Integration Controller
 * Comprehensive REST API controller for QuickBooks Online integration operations including:
 * - OAuth flow management (initiate, callback, disconnect)
 * - Connection status and testing
 * - Customer synchronization and mappings
 * - Invoice export/import operations
 * - Payment synchronization
 * - Account and tax mapping configuration
 * - Sync status and history tracking
 * - Bulk synchronization operations
 * - Health monitoring and diagnostics
 * - Data mapping configuration
 * - Error handling and recovery
 */

import { NextRequest, NextResponse } from 'next/server';
import { BaseController } from './BaseController';
import { QuickBooksService } from '../services/QuickBooksService';
import {
  // OAuth and connection schemas
  qboOAuthRequestSchema,
  qboOAuthCallbackSchema,
  qboConnectionTestSchema,
  QboOAuthRequest,
  QboOAuthCallback,
  QboConnectionTest,
  
  // Customer synchronization schemas
  customerSyncRequestSchema,
  customerMappingSchema,
  CustomerSyncRequest,
  CustomerMapping,
  
  // Invoice schemas
  invoiceExportRequestSchema,
  invoiceImportRequestSchema,
  InvoiceExportRequest,
  InvoiceImportRequest,
  
  // Payment schemas
  paymentSyncRequestSchema,
  PaymentSyncRequest,
  
  // Account and tax mapping schemas
  accountMappingRequestSchema,
  taxMappingRequestSchema,
  AccountMappingRequest,
  TaxMappingRequest,
  
  // Sync status schemas
  syncStatusQuerySchema,
  syncIdParamSchema,
  SyncStatusQuery,
  
  // Data mapping schemas
  mappingConfigRequestSchema,
  mappingIdParamSchema,
  MappingConfigRequest,
  
  // Bulk operation schemas
  bulkSyncRequestSchema,
  BulkSyncRequest,
  
  // Health monitoring schemas
  healthMonitoringConfigSchema,
  HealthMonitoringConfig,
  
  // Filter and query schemas
  qboEntityFilterSchema,
  syncHistoryFilterSchema,
  QboEntityFilterData,
  
  // Parameter schemas
  qboEntityIdParamSchema
} from '../schemas/quickbooksSchemas';

import { 
  withAuth, 
  withPermission, 
  withValidation, 
  withQueryValidation,
  createSuccessResponse,
  createPaginatedResponse,
  createErrorResponse,
  NotFoundError,
  ValidationError,
  ApiRequest,
  compose
} from '../middleware/apiMiddleware';

/**
 * QuickBooks Integration Controller
 * Handles all QuickBooks Online integration operations with proper authentication,
 * validation, and error handling
 */
export class QuickBooksController extends BaseController {
  private qbService: QuickBooksService;

  constructor(quickBooksService: QuickBooksService) {
    super(quickBooksService as any, {
      resource: 'quickbooks',
      permissions: {
        read: 'quickbooks:read',
        create: 'quickbooks:write',
        update: 'quickbooks:write',
        delete: 'quickbooks:admin'
      }
    });
    this.qbService = quickBooksService;
  }

  // ============================================================================
  // OAUTH FLOW MANAGEMENT
  // ============================================================================

  /**
   * POST /api/v1/quickbooks/oauth/initiate
   * Initiate OAuth authorization flow with QuickBooks
   */
  initiateOAuth() {
    const middleware = compose(
      withAuth,
      withPermission('quickbooks', 'write'),
      withValidation(qboOAuthRequestSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: QboOAuthRequest) => {
      try {
        const result = await this.qbService.initiateOAuthFlow(
          validatedData,
          req.context!.tenant,
          req.context!.userId
        );

        return createSuccessResponse(result.data, 200, {
          links: {
            self: `${req.url}`,
            authorize: result.data.authorization_url,
            callback: '/api/v1/quickbooks/oauth/callback',
            status: '/api/v1/quickbooks/connection/status'
          }
        });
      } catch (error) {
        throw error;
      }
    });
  }

  /**
   * POST /api/v1/quickbooks/oauth/callback
   * Handle OAuth callback from QuickBooks authorization
   */
  handleOAuthCallback() {
    const middleware = compose(
      withAuth,
      withPermission('quickbooks', 'write'),
      withValidation(qboOAuthCallbackSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: QboOAuthCallback) => {
      try {
        if (validatedData.error) {
          throw new ValidationError(`OAuth error: ${validatedData.error_description || validatedData.error}`);
        }

        const result = await this.qbService.handleOAuthCallback(
          validatedData,
          req.context!.tenant,
          req.context!.userId
        );

        return createSuccessResponse(result.data, 200, {
          links: {
            self: `${req.url}`,
            status: '/api/v1/quickbooks/connection/status',
            test: '/api/v1/quickbooks/connection/test',
            disconnect: '/api/v1/quickbooks/oauth/disconnect'
          }
        });
      } catch (error) {
        throw error;
      }
    });
  }

  /**
   * DELETE /api/v1/quickbooks/oauth/disconnect
   * Disconnect QuickBooks integration and revoke tokens
   */
  disconnectOAuth() {
    const middleware = compose(
      withAuth,
      withPermission('quickbooks', 'admin')
    );

    return middleware(async (req: ApiRequest) => {
      try {
        await this.qbService.disconnectOAuthConnection(
          req.context!.tenant,
          req.context!.userId
        );

        return new NextResponse(null, { 
          status: 204,
          headers: {
            'Location': '/api/v1/quickbooks/connection/status'
          }
        });
      } catch (error) {
        throw error;
      }
    });
  }

  // ============================================================================
  // CONNECTION STATUS AND TESTING
  // ============================================================================

  /**
   * GET /api/v1/quickbooks/connection/status
   * Get current QuickBooks connection status
   */
  getConnectionStatus() {
    const middleware = compose(
      withAuth,
      withPermission('quickbooks', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      try {
        const status = await this.qbService.getConnectionStatus(req.context!.tenant);

        return createSuccessResponse(status, 200, {
          links: {
            self: `${req.url}`,
            test: '/api/v1/quickbooks/connection/test',
            health: '/api/v1/quickbooks/health',
            ...(status.connected ? {
              disconnect: '/api/v1/quickbooks/oauth/disconnect',
              sync: '/api/v1/quickbooks/sync'
            } : {
              connect: '/api/v1/quickbooks/oauth/initiate'
            })
          }
        });
      } catch (error) {
        throw error;
      }
    });
  }

  /**
   * POST /api/v1/quickbooks/connection/test
   * Test QuickBooks connection with various diagnostic checks
   */
  testConnection() {
    const middleware = compose(
      withAuth,
      withPermission('quickbooks', 'read'),
      withValidation(qboConnectionTestSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: QboConnectionTest) => {
      try {
        const result = await this.qbService.testConnection(
          validatedData,
          req.context!.tenant
        );

        return createSuccessResponse(result.data, 200, {
          links: {
            self: `${req.url}`,
            status: '/api/v1/quickbooks/connection/status',
            health: '/api/v1/quickbooks/health'
          }
        });
      } catch (error) {
        throw error;
      }
    });
  }

  // ============================================================================
  // CUSTOMER SYNCHRONIZATION
  // ============================================================================

  /**
   * POST /api/v1/quickbooks/customers/sync
   * Synchronize customers between Alga PSA and QuickBooks
   */
  syncCustomers() {
    const middleware = compose(
      withAuth,
      withPermission('quickbooks', 'write'),
      withValidation(customerSyncRequestSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: CustomerSyncRequest) => {
      try {
        const result = await this.qbService.syncCustomers(
          validatedData,
          req.context!.tenant,
          req.context!.userId
        );

        return createSuccessResponse(result.data, 200, {
          links: {
            self: `${req.url}`,
            mappings: '/api/v1/quickbooks/customers/mappings',
            status: `/api/v1/quickbooks/sync/status`,
            history: '/api/v1/quickbooks/sync/history?operation_type=customer_sync'
          }
        });
      } catch (error) {
        throw error;
      }
    });
  }

  /**
   * GET /api/v1/quickbooks/customers/mappings
   * Get customer mappings between Alga PSA and QuickBooks
   */
  getCustomerMappings() {
    const middleware = compose(
      withAuth,
      withPermission('quickbooks', 'read'),
      withQueryValidation(qboEntityFilterSchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery?: any) => {
      try {
        const url = new URL(req.url);
        const page = parseInt(url.searchParams.get('page') || '1');
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);

        const result = await this.qbService.getCustomerMappings(
          { page, limit, filters: validatedQuery },
          req.context!.tenant
        );

        return createPaginatedResponse(
          result.data,
          result.total,
          page,
          limit,
          {
            links: {
              sync: '/api/v1/quickbooks/customers/sync',
              refresh: `${req.url}`
            }
          }
        );
      } catch (error) {
        throw error;
      }
    });
  }

  /**
   * DELETE /api/v1/quickbooks/customers/mappings/{mapping_id}
   * Remove a specific customer mapping
   */
  deleteCustomerMapping() {
    const middleware = compose(
      withAuth,
      withPermission('quickbooks', 'write')
    );

    return middleware(async (req: ApiRequest) => {
      try {
        const mappingId = this.extractIdFromPath(req);
        
        await this.qbService.deleteCustomerMapping(
          mappingId,
          req.context!.tenant,
          req.context!.userId
        );

        return new NextResponse(null, { 
          status: 204,
          headers: {
            'Location': '/api/v1/quickbooks/customers/mappings'
          }
        });
      } catch (error) {
        throw error;
      }
    });
  }

  // ============================================================================
  // INVOICE OPERATIONS
  // ============================================================================

  /**
   * POST /api/v1/quickbooks/invoices/export
   * Export invoices from Alga PSA to QuickBooks
   */
  exportInvoices() {
    const middleware = compose(
      withAuth,
      withPermission('quickbooks', 'write'),
      withValidation(invoiceExportRequestSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: InvoiceExportRequest) => {
      try {
        const result = await this.qbService.exportInvoices(
          validatedData,
          req.context!.tenant,
          req.context!.userId
        );

        return createSuccessResponse(result.data, 200, {
          links: {
            self: `${req.url}`,
            import: '/api/v1/quickbooks/invoices/import',
            status: '/api/v1/quickbooks/sync/status',
            history: '/api/v1/quickbooks/sync/history?operation_type=invoice_export'
          }
        });
      } catch (error) {
        throw error;
      }
    });
  }

  /**
   * POST /api/v1/quickbooks/invoices/import
   * Import invoices from QuickBooks to Alga PSA
   */
  importInvoices() {
    const middleware = compose(
      withAuth,
      withPermission('quickbooks', 'write'),
      withValidation(invoiceImportRequestSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: InvoiceImportRequest) => {
      try {
        const result = await this.qbService.importInvoices(
          validatedData,
          req.context!.tenant,
          req.context!.userId
        );

        return createSuccessResponse(result.data, 200, {
          links: {
            self: `${req.url}`,
            export: '/api/v1/quickbooks/invoices/export',
            status: '/api/v1/quickbooks/sync/status',
            history: '/api/v1/quickbooks/sync/history?operation_type=invoice_import'
          }
        });
      } catch (error) {
        throw error;
      }
    });
  }

  // ============================================================================
  // PAYMENT SYNCHRONIZATION
  // ============================================================================

  /**
   * POST /api/v1/quickbooks/payments/sync
   * Synchronize payments between Alga PSA and QuickBooks
   */
  syncPayments() {
    const middleware = compose(
      withAuth,
      withPermission('quickbooks', 'write'),
      withValidation(paymentSyncRequestSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: PaymentSyncRequest) => {
      try {
        const result = await this.qbService.syncPayments(
          validatedData,
          req.context!.tenant,
          req.context!.userId
        );

        return createSuccessResponse(result.data, 200, {
          links: {
            self: `${req.url}`,
            status: '/api/v1/quickbooks/sync/status',
            history: '/api/v1/quickbooks/sync/history?operation_type=payment_sync'
          }
        });
      } catch (error) {
        throw error;
      }
    });
  }

  // ============================================================================
  // ACCOUNT AND TAX MAPPING CONFIGURATION
  // ============================================================================

  /**
   * GET /api/v1/quickbooks/accounts
   * Get QuickBooks chart of accounts
   */
  getAccounts() {
    const middleware = compose(
      withAuth,
      withPermission('quickbooks', 'read'),
      withQueryValidation(qboEntityFilterSchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery?: any) => {
      try {
        const result = await this.qbService.getChartOfAccounts(
          validatedQuery,
          req.context!.tenant
        );

        return createSuccessResponse(result.data, 200, {
          links: {
            self: `${req.url}`,
            mappings: '/api/v1/quickbooks/accounts/mappings',
            refresh: `${req.url}?force_refresh=true`
          }
        });
      } catch (error) {
        throw error;
      }
    });
  }

  /**
   * GET /api/v1/quickbooks/accounts/mappings
   * Get account mappings configuration
   */
  getAccountMappings() {
    const middleware = compose(
      withAuth,
      withPermission('quickbooks', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      try {
        const url = new URL(req.url);
        const page = parseInt(url.searchParams.get('page') || '1');
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);

        const result = await this.qbService.getAccountMappings(
          { page, limit },
          req.context!.tenant
        );

        return createPaginatedResponse(
          result.data,
          result.total,
          page,
          limit,
          {
            links: {
              accounts: '/api/v1/quickbooks/accounts',
              configure: '/api/v1/quickbooks/accounts/mappings'
            }
          }
        );
      } catch (error) {
        throw error;
      }
    });
  }

  /**
   * PUT /api/v1/quickbooks/accounts/mappings
   * Configure account mappings
   */
  configureAccountMappings() {
    const middleware = compose(
      withAuth,
      withPermission('quickbooks', 'write'),
      withValidation(accountMappingRequestSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: AccountMappingRequest) => {
      try {
        const result = await this.qbService.configureAccountMappings(
          validatedData,
          req.context!.tenant,
          req.context!.userId
        );

        return createSuccessResponse(result.data, 200, {
          links: {
            self: `${req.url}`,
            mappings: '/api/v1/quickbooks/accounts/mappings',
            accounts: '/api/v1/quickbooks/accounts'
          }
        });
      } catch (error) {
        throw error;
      }
    });
  }

  /**
   * GET /api/v1/quickbooks/tax-codes
   * Get QuickBooks tax codes and rates
   */
  getTaxCodes() {
    const middleware = compose(
      withAuth,
      withPermission('quickbooks', 'read'),
      withQueryValidation(qboEntityFilterSchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery?: any) => {
      try {
        const result = await this.qbService.getTaxCodes(
          validatedQuery,
          req.context!.tenant
        );

        return createSuccessResponse(result.data, 200, {
          links: {
            self: `${req.url}`,
            mappings: '/api/v1/quickbooks/tax-codes/mappings',
            refresh: `${req.url}?force_refresh=true`
          }
        });
      } catch (error) {
        throw error;
      }
    });
  }

  /**
   * GET /api/v1/quickbooks/tax-codes/mappings
   * Get tax mapping configuration
   */
  getTaxMappings() {
    const middleware = compose(
      withAuth,
      withPermission('quickbooks', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      try {
        const url = new URL(req.url);
        const page = parseInt(url.searchParams.get('page') || '1');
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);

        const result = await this.qbService.getTaxMappings(
          { page, limit },
          req.context!.tenant
        );

        return createPaginatedResponse(
          result.data,
          result.total,
          page,
          limit,
          {
            links: {
              'tax-codes': '/api/v1/quickbooks/tax-codes',
              configure: '/api/v1/quickbooks/tax-codes/mappings'
            }
          }
        );
      } catch (error) {
        throw error;
      }
    });
  }

  /**
   * PUT /api/v1/quickbooks/tax-codes/mappings
   * Configure tax mappings
   */
  configureTaxMappings() {
    const middleware = compose(
      withAuth,
      withPermission('quickbooks', 'write'),
      withValidation(taxMappingRequestSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: TaxMappingRequest) => {
      try {
        const result = await this.qbService.configureTaxMappings(
          validatedData,
          req.context!.tenant,
          req.context!.userId
        );

        return createSuccessResponse(result.data, 200, {
          links: {
            self: `${req.url}`,
            mappings: '/api/v1/quickbooks/tax-codes/mappings',
            'tax-codes': '/api/v1/quickbooks/tax-codes'
          }
        });
      } catch (error) {
        throw error;
      }
    });
  }

  // ============================================================================
  // SYNC STATUS AND HISTORY TRACKING
  // ============================================================================

  /**
   * GET /api/v1/quickbooks/sync/status
   * Get current synchronization status
   */
  getSyncStatus() {
    const middleware = compose(
      withAuth,
      withPermission('quickbooks', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      try {
        const result = await this.qbService.getCurrentSyncStatus(req.context!.tenant);

        return createSuccessResponse(result, 200, {
          links: {
            self: `${req.url}`,
            history: '/api/v1/quickbooks/sync/history',
            cancel: result.status === 'in_progress' ? '/api/v1/quickbooks/sync/cancel' : undefined
          }
        });
      } catch (error) {
        throw error;
      }
    });
  }

  /**
   * GET /api/v1/quickbooks/sync/history
   * Get synchronization history with filtering
   */
  getSyncHistory() {
    const middleware = compose(
      withAuth,
      withPermission('quickbooks', 'read'),
      withQueryValidation(syncHistoryFilterSchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery?: any) => {
      try {
        const url = new URL(req.url);
        const page = parseInt(url.searchParams.get('page') || '1');
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);

        const result = await this.qbService.getSyncHistory(
          { page, limit, filters: validatedQuery },
          req.context!.tenant
        );

        return createPaginatedResponse(
          result.data,
          result.total,
          page,
          limit,
          {
            links: {
              status: '/api/v1/quickbooks/sync/status',
              refresh: `${req.url}`
            }
          }
        );
      } catch (error) {
        throw error;
      }
    });
  }

  /**
   * GET /api/v1/quickbooks/sync/status/{sync_id}
   * Get specific sync operation status
   */
  getSyncStatusById() {
    const middleware = compose(
      withAuth,
      withPermission('quickbooks', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      try {
        const syncId = this.extractIdFromPath(req);
        
        const result = await this.qbService.getSyncStatusById(
          syncId,
          req.context!.tenant
        );

        if (!result) {
          throw new NotFoundError('Sync operation not found');
        }

        return createSuccessResponse(result, 200, {
          links: {
            self: `${req.url}`,
            history: '/api/v1/quickbooks/sync/history',
            cancel: result.status === 'in_progress' ? `/api/v1/quickbooks/sync/${syncId}/cancel` : undefined
          }
        });
      } catch (error) {
        throw error;
      }
    });
  }

  /**
   * POST /api/v1/quickbooks/sync/{sync_id}/cancel
   * Cancel a running sync operation
   */
  cancelSync() {
    const middleware = compose(
      withAuth,
      withPermission('quickbooks', 'write')
    );

    return middleware(async (req: ApiRequest) => {
      try {
        const syncId = this.extractIdFromPath(req);
        
        await this.qbService.cancelSyncOperation(
          syncId,
          req.context!.tenant,
          req.context!.userId
        );

        return new NextResponse(null, { 
          status: 204,
          headers: {
            'Location': `/api/v1/quickbooks/sync/status/${syncId}`
          }
        });
      } catch (error) {
        throw error;
      }
    });
  }

  // ============================================================================
  // BULK SYNCHRONIZATION OPERATIONS
  // ============================================================================

  /**
   * POST /api/v1/quickbooks/sync/bulk
   * Execute bulk synchronization operations
   */
  bulkSync() {
    const middleware = compose(
      withAuth,
      withPermission('quickbooks', 'write'),
      withValidation(bulkSyncRequestSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: BulkSyncRequest) => {
      try {
        const result = await this.qbService.executeBulkSync(
          validatedData,
          req.context!.tenant,
          req.context!.userId
        );

        return createSuccessResponse(result.data, 202, {
          links: {
            self: `${req.url}`,
            status: `/api/v1/quickbooks/sync/status/${result.data.bulk_sync_id}`,
            history: '/api/v1/quickbooks/sync/history'
          }
        });
      } catch (error) {
        throw error;
      }
    });
  }

  /**
   * POST /api/v1/quickbooks/sync/full
   * Execute comprehensive full synchronization
   */
  fullSync() {
    const middleware = compose(
      withAuth,
      withPermission('quickbooks', 'admin')
    );

    return middleware(async (req: ApiRequest) => {
      try {
        const result = await this.qbService.executeFullSync(
          req.context!.tenant,
          req.context!.userId
        );

        return createSuccessResponse(result.data, 202, {
          links: {
            self: `${req.url}`,
            status: `/api/v1/quickbooks/sync/status/${result.data.sync_id}`,
            history: '/api/v1/quickbooks/sync/history'
          }
        });
      } catch (error) {
        throw error;
      }
    });
  }

  // ============================================================================
  // DATA MAPPING CONFIGURATION
  // ============================================================================

  /**
   * GET /api/v1/quickbooks/mappings
   * Get all data mapping configurations
   */
  getDataMappings() {
    const middleware = compose(
      withAuth,
      withPermission('quickbooks', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      try {
        const url = new URL(req.url);
        const page = parseInt(url.searchParams.get('page') || '1');
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);
        const entityType = url.searchParams.get('entity_type');

        const result = await this.qbService.getDataMappings(
          { page, limit, filters: { entity_type: entityType } },
          req.context!.tenant
        );

        return createPaginatedResponse(
          result.data,
          result.total,
          page,
          limit,
          {
            links: {
              create: '/api/v1/quickbooks/mappings',
              refresh: `${req.url}`
            }
          }
        );
      } catch (error) {
        throw error;
      }
    });
  }

  /**
   * POST /api/v1/quickbooks/mappings
   * Create new data mapping configuration
   */
  createDataMapping() {
    const middleware = compose(
      withAuth,
      withPermission('quickbooks', 'write'),
      withValidation(mappingConfigRequestSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: MappingConfigRequest) => {
      try {
        const result = await this.qbService.createDataMapping(
          validatedData,
          req.context!.tenant,
          req.context!.userId
        );

        return createSuccessResponse(result, 201, {
          links: {
            self: `/api/v1/quickbooks/mappings/${result.mapping_id}`,
            mappings: '/api/v1/quickbooks/mappings'
          }
        });
      } catch (error) {
        throw error;
      }
    });
  }

  /**
   * GET /api/v1/quickbooks/mappings/{mapping_id}
   * Get specific data mapping configuration
   */
  getDataMappingById() {
    const middleware = compose(
      withAuth,
      withPermission('quickbooks', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      try {
        const mappingId = this.extractIdFromPath(req);
        
        const result = await this.qbService.getDataMappingById(
          mappingId,
          req.context!.tenant
        );

        if (!result) {
          throw new NotFoundError('Data mapping not found');
        }

        return createSuccessResponse(result, 200, {
          links: {
            self: `${req.url}`,
            mappings: '/api/v1/quickbooks/mappings',
            update: `${req.url}`,
            delete: `${req.url}`
          }
        });
      } catch (error) {
        throw error;
      }
    });
  }

  /**
   * PUT /api/v1/quickbooks/mappings/{mapping_id}
   * Update data mapping configuration
   */
  updateDataMapping() {
    const middleware = compose(
      withAuth,
      withPermission('quickbooks', 'write'),
      withValidation(mappingConfigRequestSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: MappingConfigRequest) => {
      try {
        const mappingId = this.extractIdFromPath(req);
        
        const result = await this.qbService.updateDataMapping(
          mappingId,
          validatedData,
          req.context!.tenant,
          req.context!.userId
        );

        return createSuccessResponse(result, 200, {
          links: {
            self: `${req.url}`,
            mappings: '/api/v1/quickbooks/mappings'
          }
        });
      } catch (error) {
        throw error;
      }
    });
  }

  /**
   * DELETE /api/v1/quickbooks/mappings/{mapping_id}
   * Delete data mapping configuration
   */
  deleteDataMapping() {
    const middleware = compose(
      withAuth,
      withPermission('quickbooks', 'write')
    );

    return middleware(async (req: ApiRequest) => {
      try {
        const mappingId = this.extractIdFromPath(req);
        
        await this.qbService.deleteDataMapping(
          mappingId,
          req.context!.tenant,
          req.context!.userId
        );

        return new NextResponse(null, { 
          status: 204,
          headers: {
            'Location': '/api/v1/quickbooks/mappings'
          }
        });
      } catch (error) {
        throw error;
      }
    });
  }

  // ============================================================================
  // HEALTH MONITORING AND DIAGNOSTICS
  // ============================================================================

  /**
   * GET /api/v1/quickbooks/health
   * Get comprehensive integration health status
   */
  getHealth() {
    const middleware = compose(
      withAuth,
      withPermission('quickbooks', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      try {
        const url = new URL(req.url);
        const checkType = url.searchParams.get('check_type') || 'full';
        
        const result = await this.qbService.getIntegrationHealth(
          checkType as any,
          req.context!.tenant
        );

        return createSuccessResponse(result, 200, {
          links: {
            self: `${req.url}`,
            status: '/api/v1/quickbooks/connection/status',
            test: '/api/v1/quickbooks/connection/test',
            config: '/api/v1/quickbooks/health/config'
          }
        });
      } catch (error) {
        throw error;
      }
    });
  }

  /**
   * GET /api/v1/quickbooks/health/config
   * Get health monitoring configuration
   */
  getHealthConfig() {
    const middleware = compose(
      withAuth,
      withPermission('quickbooks', 'read')
    );

    return middleware(async (req: ApiRequest) => {
      try {
        const result = await this.qbService.getHealthMonitoringConfig(req.context!.tenant);

        return createSuccessResponse(result, 200, {
          links: {
            self: `${req.url}`,
            health: '/api/v1/quickbooks/health',
            update: `${req.url}`
          }
        });
      } catch (error) {
        throw error;
      }
    });
  }

  /**
   * PUT /api/v1/quickbooks/health/config
   * Update health monitoring configuration
   */
  updateHealthConfig() {
    const middleware = compose(
      withAuth,
      withPermission('quickbooks', 'admin'),
      withValidation(healthMonitoringConfigSchema)
    );

    return middleware(async (req: ApiRequest, validatedData: HealthMonitoringConfig) => {
      try {
        const result = await this.qbService.updateHealthMonitoringConfig(
          validatedData,
          req.context!.tenant,
          req.context!.userId
        );

        return createSuccessResponse(result, 200, {
          links: {
            self: `${req.url}`,
            health: '/api/v1/quickbooks/health',
            config: '/api/v1/quickbooks/health/config'
          }
        });
      } catch (error) {
        throw error;
      }
    });
  }

  /**
   * POST /api/v1/quickbooks/diagnostics
   * Run comprehensive diagnostics
   */
  runDiagnostics() {
    const middleware = compose(
      withAuth,
      withPermission('quickbooks', 'admin')
    );

    return middleware(async (req: ApiRequest) => {
      try {
        const result = await this.qbService.runComprehensiveDiagnostics(
          req.context!.tenant,
          req.context!.userId
        );

        return createSuccessResponse(result.data, 200, {
          links: {
            self: `${req.url}`,
            health: '/api/v1/quickbooks/health',
            status: '/api/v1/quickbooks/connection/status'
          }
        });
      } catch (error) {
        throw error;
      }
    });
  }

  // ============================================================================
  // LOOKUP DATA ENDPOINTS
  // ============================================================================

  /**
   * GET /api/v1/quickbooks/items
   * Get QuickBooks items/services
   */
  getItems() {
    const middleware = compose(
      withAuth,
      withPermission('quickbooks', 'read'),
      withQueryValidation(qboEntityFilterSchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery?: any) => {
      try {
        const result = await this.qbService.getItems(
          validatedQuery,
          req.context!.tenant
        );

        return createSuccessResponse(result.data, 200, {
          links: {
            self: `${req.url}`,
            refresh: `${req.url}?force_refresh=true`
          }
        });
      } catch (error) {
        throw error;
      }
    });
  }

  /**
   * GET /api/v1/quickbooks/payment-methods
   * Get QuickBooks payment methods
   */
  getPaymentMethods() {
    const middleware = compose(
      withAuth,
      withPermission('quickbooks', 'read'),
      withQueryValidation(qboEntityFilterSchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery?: any) => {
      try {
        const result = await this.qbService.getPaymentMethods(
          validatedQuery,
          req.context!.tenant
        );

        return createSuccessResponse(result.data, 200, {
          links: {
            self: `${req.url}`,
            refresh: `${req.url}?force_refresh=true`
          }
        });
      } catch (error) {
        throw error;
      }
    });
  }

  /**
   * GET /api/v1/quickbooks/terms
   * Get QuickBooks payment terms
   */
  getTerms() {
    const middleware = compose(
      withAuth,
      withPermission('quickbooks', 'read'),
      withQueryValidation(qboEntityFilterSchema)
    );

    return middleware(async (req: ApiRequest, validatedQuery?: any) => {
      try {
        const result = await this.qbService.getTerms(
          validatedQuery,
          req.context!.tenant
        );

        return createSuccessResponse(result.data, 200, {
          links: {
            self: `${req.url}`,
            refresh: `${req.url}?force_refresh=true`
          }
        });
      } catch (error) {
        throw error;
      }
    });
  }

  // ============================================================================
  // ERROR HANDLING AND RECOVERY
  // ============================================================================

  /**
   * POST /api/v1/quickbooks/sync/{sync_id}/retry
   * Retry a failed sync operation
   */
  retrySync() {
    const middleware = compose(
      withAuth,
      withPermission('quickbooks', 'write')
    );

    return middleware(async (req: ApiRequest) => {
      try {
        const syncId = this.extractIdFromPath(req);
        
        const result = await this.qbService.retrySyncOperation(
          syncId,
          req.context!.tenant,
          req.context!.userId
        );

        return createSuccessResponse(result.data, 200, {
          links: {
            self: `${req.url}`,
            status: `/api/v1/quickbooks/sync/status/${result.data.sync_id}`,
            original: `/api/v1/quickbooks/sync/status/${syncId}`
          }
        });
      } catch (error) {
        throw error;
      }
    });
  }

  /**
   * POST /api/v1/quickbooks/connection/refresh
   * Refresh OAuth tokens
   */
  refreshConnection() {
    const middleware = compose(
      withAuth,
      withPermission('quickbooks', 'write')
    );

    return middleware(async (req: ApiRequest) => {
      try {
        const result = await this.qbService.refreshOAuthTokens(
          req.context!.tenant,
          req.context!.userId
        );

        return createSuccessResponse(result.data, 200, {
          links: {
            self: `${req.url}`,
            status: '/api/v1/quickbooks/connection/status',
            test: '/api/v1/quickbooks/connection/test'
          }
        });
      } catch (error) {
        throw error;
      }
    });
  }
}

// Export the controller class and convenience route generators
export default QuickBooksController;

/**
 * Create QuickBooks Controller Routes
 * Convenience function to create controller routes for Next.js API routes
 */
export function createQuickBooksRoutes(quickBooksService: QuickBooksService) {
  const controller = new QuickBooksController(quickBooksService);
  
  return {
    // OAuth routes
    'oauth/initiate': {
      POST: controller.initiateOAuth()
    },
    'oauth/callback': {
      POST: controller.handleOAuthCallback()
    },
    'oauth/disconnect': {
      DELETE: controller.disconnectOAuth()
    },
    
    // Connection routes
    'connection/status': {
      GET: controller.getConnectionStatus()
    },
    'connection/test': {
      POST: controller.testConnection()
    },
    'connection/refresh': {
      POST: controller.refreshConnection()
    },
    
    // Customer routes
    'customers/sync': {
      POST: controller.syncCustomers()
    },
    'customers/mappings': {
      GET: controller.getCustomerMappings()
    },
    'customers/mappings/[mapping_id]': {
      DELETE: controller.deleteCustomerMapping()
    },
    
    // Invoice routes
    'invoices/export': {
      POST: controller.exportInvoices()
    },
    'invoices/import': {
      POST: controller.importInvoices()
    },
    
    // Payment routes
    'payments/sync': {
      POST: controller.syncPayments()
    },
    
    // Account routes
    'accounts': {
      GET: controller.getAccounts()
    },
    'accounts/mappings': {
      GET: controller.getAccountMappings(),
      PUT: controller.configureAccountMappings()
    },
    
    // Tax routes
    'tax-codes': {
      GET: controller.getTaxCodes()
    },
    'tax-codes/mappings': {
      GET: controller.getTaxMappings(),
      PUT: controller.configureTaxMappings()
    },
    
    // Sync status routes
    'sync/status': {
      GET: controller.getSyncStatus()
    },
    'sync/history': {
      GET: controller.getSyncHistory()
    },
    'sync/status/[sync_id]': {
      GET: controller.getSyncStatusById()
    },
    'sync/[sync_id]/cancel': {
      POST: controller.cancelSync()
    },
    'sync/[sync_id]/retry': {
      POST: controller.retrySync()
    },
    'sync/bulk': {
      POST: controller.bulkSync()
    },
    'sync/full': {
      POST: controller.fullSync()
    },
    
    // Data mapping routes
    'mappings': {
      GET: controller.getDataMappings(),
      POST: controller.createDataMapping()
    },
    'mappings/[mapping_id]': {
      GET: controller.getDataMappingById(),
      PUT: controller.updateDataMapping(),
      DELETE: controller.deleteDataMapping()
    },
    
    // Health routes
    'health': {
      GET: controller.getHealth()
    },
    'health/config': {
      GET: controller.getHealthConfig(),
      PUT: controller.updateHealthConfig()
    },
    'diagnostics': {
      POST: controller.runDiagnostics()
    },
    
    // Lookup routes
    'items': {
      GET: controller.getItems()
    },
    'payment-methods': {
      GET: controller.getPaymentMethods()
    },
    'terms': {
      GET: controller.getTerms()
    }
  };
}