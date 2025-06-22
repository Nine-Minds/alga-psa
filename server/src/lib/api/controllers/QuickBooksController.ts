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
  
  // Parameter schemas
  qboEntityIdParamSchema
} from '../schemas/quickbooksSchemas';

import { z } from 'zod';
import { compose } from '../middleware/compose';
import { withAuth } from '../middleware/apiMiddleware';
import { withPermission } from '../middleware/permissionMiddleware';
import { withValidation } from '../middleware/validationMiddleware';
import { createApiResponse, createErrorResponse } from '../utils/response';
import { getHateoasLinks } from '../utils/hateoas';
import { createSuccessResponse, createPaginatedResponse, NotFoundError, ValidationError } from '../middleware/apiMiddleware';

/**
 * QuickBooks Integration Controller
 * Handles all QuickBooks Online integration operations with proper authentication,
 * validation, and error handling
 */
export class QuickBooksController extends BaseController {
  private qbService: QuickBooksService;

  constructor() {
    super(null as any, null as any);
    this.qbService = new QuickBooksService(null as any, null as any, null as any);
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
      withAuth as any,
      withPermission('quickbooks', 'write') as any as any,
      withValidation(qboOAuthRequestSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      try {
        const data = await req.json() || {};
        const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
        const result = await this.qbService.initiateOAuthFlow(
          data,
          context.tenant,
          context.userId
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
      withAuth as any,
      withPermission('quickbooks', 'write') as any as any,
      withValidation(qboOAuthCallbackSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      try {
        const data = await req.json() || {};
        const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
        if (data.error) {
          throw new ValidationError(`OAuth error: ${data.error_description || data.error}`);
        }

        const result = await this.qbService.handleOAuthCallback(
          data,
          context.tenant
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
      withAuth as any,
      withPermission('quickbooks', 'admin') as any
    );

    return middleware(async (req: NextRequest) => {
      try {
        const data = await req.json() || {};
        const query = Object.fromEntries(new URL(req.url).searchParams.entries());
        const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
        await this.qbService.disconnectQuickBooks(
          context.tenant,
          context.userId
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
      withAuth as any,
      withPermission('quickbooks', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      try {
        const data = await req.json() || {};
        const query = Object.fromEntries(new URL(req.url).searchParams.entries());
        const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
        const status = await this.qbService.getConnectionStatus(context.tenant);

        return createSuccessResponse(status, 200, {
          links: {
            self: `${req.url}`,
            test: '/api/v1/quickbooks/connection/test',
            health: '/api/v1/quickbooks/health',
            ...(status.data?.connected ? {
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
      withAuth as any,
      withPermission('quickbooks', 'read') as any as any,
      withValidation(qboConnectionTestSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      try {
        const data = await req.json() || {};
        const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
        const result = await this.qbService.testConnection(
          data,
          context.tenant
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
      withAuth as any,
      withPermission('quickbooks', 'write') as any as any,
      withValidation(customerSyncRequestSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      try {
        const data = await req.json() || {};
        const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
        const result = await this.qbService.syncCustomers(
          data,
          context.tenant,
          context.userId
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
      withAuth as any,
      withPermission('quickbooks', 'read') as any as any,
      withValidation(qboEntityFilterSchema, 'query') as any
    );

    return middleware(async (req: NextRequest) => {
      try {
        const data = await req.json() || {};
        const query = Object.fromEntries(new URL(req.url).searchParams.entries());
        const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
        const url = new URL(req.url);
        const page = parseInt(url.searchParams.get('page') || '1');
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);
        const result = await this.qbService.getCustomerMappings(
          context.tenant,
          page,
          limit
        );

        return createPaginatedResponse(
          result.data || [],
          result.total || 0,
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
      withAuth as any,
      withPermission('quickbooks', 'write') as any
    );

    return middleware(async (req: NextRequest) => {
      try {
        const data = await req.json() || {};
        const query = Object.fromEntries(new URL(req.url).searchParams.entries());
        const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
        const { id } = (req as any).params || {};
        
        // TODO: Implement deleteCustomerMapping method in QuickBooksService
        // await this.qbService.deleteCustomerMapping(
        //   id,
        //   context.tenant,
        //   context.userId
        // );

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
      withAuth as any,
      withPermission('quickbooks', 'write') as any as any,
      withValidation(invoiceExportRequestSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      try {
        const data = await req.json() || {};
        const query = Object.fromEntries(new URL(req.url).searchParams.entries());
        const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
        const result = await this.qbService.exportInvoices(
          data,
          context.tenant,
          context.userId
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
      withAuth as any,
      withPermission('quickbooks', 'write') as any as any,
      withValidation(invoiceImportRequestSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      try {
        const data = await req.json() || {};
        const query = Object.fromEntries(new URL(req.url).searchParams.entries());
        const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
        const result = await this.qbService.importInvoices(
          data,
          context.tenant,
          context.userId
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
      withAuth as any,
      withPermission('quickbooks', 'write') as any as any,
      withValidation(paymentSyncRequestSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      try {
        const data = await req.json() || {};
        const query = Object.fromEntries(new URL(req.url).searchParams.entries());
        const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
        const result = await this.qbService.syncPayments(
          data,
          context.tenant,
          context.userId
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
      withAuth as any,
      withPermission('quickbooks', 'read') as any as any,
      withValidation(qboEntityFilterSchema, 'query') as any
    );

    return middleware(async (req: NextRequest) => {
      try {
        const data = await req.json() || {};
        const query = Object.fromEntries(new URL(req.url).searchParams.entries());
        const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
        // TODO: Implement getChartOfAccounts method in QuickBooksService
        //         // const result = await this.qbService.getChartOfAccounts(
        //         //   query,
        //         //   context.tenant
        //         // );
        const result = { data: [] }; // Temporary stub

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
      withAuth as any,
      withPermission('quickbooks', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      try {
        const data = await req.json() || {};
        const query = Object.fromEntries(new URL(req.url).searchParams.entries());
        const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
        const url = new URL(req.url);
        const page = parseInt(url.searchParams.get('page') || '1');
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);

        // TODO: Implement getAccountMappings method in QuickBooksService
        //         // const result = await this.qbService.getAccountMappings(
        //         //   { page, limit },
        //         //   context.tenant
        //         // );
        const result = { data: [], total: 0 }; // Temporary stub

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
      withAuth as any,
      withPermission('quickbooks', 'write') as any as any,
      withValidation(accountMappingRequestSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      try {
        const data = await req.json() || {};
        const query = Object.fromEntries(new URL(req.url).searchParams.entries());
        const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
        // TODO: Implement configureAccountMappings method in QuickBooksService
        //         // const result = await this.qbService.configureAccountMappings(
        //           data,
        //           context.tenant,
        //           context.userId
        //         );
        const result = { data: { success: true } }; // Temporary stub

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
      withAuth as any,
      withPermission('quickbooks', 'read') as any as any,
      withValidation(qboEntityFilterSchema, 'query') as any
    );

    return middleware(async (req: NextRequest) => {
      try {
        const data = await req.json() || {};
        const query = Object.fromEntries(new URL(req.url).searchParams.entries());
        const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
        // TODO: Implement getTaxCodes method in QuickBooksService
        //         // const result = await this.qbService.getTaxCodes(
        //           query,
        //           context.tenant
        //         );
        const result = { data: [] }; // Temporary stub

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
      withAuth as any,
      withPermission('quickbooks', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      try {
        const data = await req.json() || {};
        const query = Object.fromEntries(new URL(req.url).searchParams.entries());
        const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
        const url = new URL(req.url);
        const page = parseInt(url.searchParams.get('page') || '1');
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);

        // TODO: Implement getTaxMappings method in QuickBooksService
        //         // const result = await this.qbService.getTaxMappings(
        //           { page, limit },
        //           context.tenant
        //         );
        const result = { data: [], total: 0 }; // Temporary stub

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
      withAuth as any,
      withPermission('quickbooks', 'write') as any as any,
      withValidation(taxMappingRequestSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      try {
        const data = await req.json() || {};
        const query = Object.fromEntries(new URL(req.url).searchParams.entries());
        const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
        // TODO: Implement configureTaxMappings method in QuickBooksService
        //         // const result = await this.qbService.configureTaxMappings(
        //           data,
        //           context.tenant,
        //           context.userId
        //         );
        const result = { data: { success: true } }; // Temporary stub

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
      withAuth as any,
      withPermission('quickbooks', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      try {
        const data = await req.json() || {};
        const query = Object.fromEntries(new URL(req.url).searchParams.entries());
        const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
        // TODO: Implement getCurrentSyncStatus method in QuickBooksService
        //         // const result = await this.qbService.getCurrentSyncStatus(context.tenant);

        //         return createSuccessResponse(result, 200, {
        //           links: {
        //             self: `${req.url}`,
        //             history: '/api/v1/quickbooks/sync/history',
        //             cancel: result.status === 'in_progress' ? '/api/v1/quickbooks/sync/cancel' : undefined
        //           }
        //         });
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
      withAuth as any,
      withPermission('quickbooks', 'read') as any as any,
      withValidation(syncHistoryFilterSchema, 'query') as any
    );

    return middleware(async (req: NextRequest) => {
      try {
        const data = await req.json() || {};
        const query = Object.fromEntries(new URL(req.url).searchParams.entries());
        const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
        const url = new URL(req.url);
        const page = parseInt(url.searchParams.get('page') || '1');
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);

        const result = await this.qbService.getSyncHistory(
          { page, limit, filters: query },
          context.tenant
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
      withAuth as any,
      withPermission('quickbooks', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      try {
        const data = await req.json() || {};
        const query = Object.fromEntries(new URL(req.url).searchParams.entries());
        const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
        const syncId = this.extractIdFromPath(req);
        
        // TODO: Implement getSyncStatusById method in QuickBooksService
        //         // const result = await this.qbService.getSyncStatusById(
        //           syncId,
        //           context.tenant
        //         );
        const result = { id: syncId, status: 'completed', progress: 100 }; // Temporary stub

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
      withAuth as any,
      withPermission('quickbooks', 'write') as any
    );

    return middleware(async (req: NextRequest) => {
      try {
        const data = await req.json() || {};
        const query = Object.fromEntries(new URL(req.url).searchParams.entries());
        const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
        const syncId = this.extractIdFromPath(req);
        
        // TODO: Implement cancelSyncOperation method in QuickBooksService
        // await this.qbService.cancelSyncOperation(
        //   syncId,
        //   context.tenant,
        //   context.userId
        // );

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
      withAuth as any,
      withPermission('quickbooks', 'write') as any as any,
      withValidation(bulkSyncRequestSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      try {
        const data = await req.json() || {};
        const query = Object.fromEntries(new URL(req.url).searchParams.entries());
        const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
        // TODO: Implement executeBulkSync method in QuickBooksService
        //         // const result = await this.qbService.executeBulkSync(
        //           data,
        //           context.tenant,
        //           context.userId
        //         );
        const result = { data: { bulk_sync_id: 'sync_' + Date.now() } }; // Temporary stub

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
      withAuth as any,
      withPermission('quickbooks', 'admin') as any
    );

    return middleware(async (req: NextRequest) => {
      try {
        const data = await req.json() || {};
        const query = Object.fromEntries(new URL(req.url).searchParams.entries());
        const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
        // TODO: Implement executeFullSync method in QuickBooksService
        //         // const result = await this.qbService.executeFullSync(
        //           context.tenant,
        //           context.userId
        //         );
        const result = { data: { sync_id: 'full_sync_' + Date.now() } }; // Temporary stub

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
      withAuth as any,
      withPermission('quickbooks', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      try {
        const data = await req.json() || {};
        const query = Object.fromEntries(new URL(req.url).searchParams.entries());
        const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
        const url = new URL(req.url);
        const page = parseInt(url.searchParams.get('page') || '1');
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);
        const entityType = url.searchParams.get('entity_type');

        // TODO: Implement getDataMappings method in QuickBooksService
        //         // const result = await this.qbService.getDataMappings(
        //           { page, limit, filters: { entity_type: entityType } },
        //           context.tenant
        //         );
        const result = { data: [], total: 0 }; // Temporary stub

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
      withAuth as any,
      withPermission('quickbooks', 'write') as any as any,
      withValidation(mappingConfigRequestSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      try {
        const data = await req.json() || {};
        const query = Object.fromEntries(new URL(req.url).searchParams.entries());
        const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
        // TODO: Implement createDataMapping method in QuickBooksService
        //         // const result = await this.qbService.createDataMapping(
        //           data,
        //           context.tenant,
        //           context.userId
        //         );
        const result = { mapping_id: 'mapping_' + Date.now(), entity_type: 'customer' }; // Temporary stub

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
      withAuth as any,
      withPermission('quickbooks', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      try {
        const data = await req.json() || {};
        const query = Object.fromEntries(new URL(req.url).searchParams.entries());
        const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
        const mappingId = this.extractIdFromPath(req);
        
        // TODO: Implement getDataMappingById method in QuickBooksService
        //         // const result = await this.qbService.getDataMappingById(
        //           mappingId,
        //           context.tenant
        //         );

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
      withAuth as any,
      withPermission('quickbooks', 'write') as any as any,
      withValidation(mappingConfigRequestSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      try {
        const data = await req.json() || {};
        const query = Object.fromEntries(new URL(req.url).searchParams.entries());
        const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
        const mappingId = this.extractIdFromPath(req);
        
        const result = await this.qbService.updateDataMapping(
          mappingId,
          data,
          context.tenant,
          context.userId
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
      withAuth as any,
      withPermission('quickbooks', 'write') as any
    );

    return middleware(async (req: NextRequest) => {
      try {
        const data = await req.json() || {};
        const query = Object.fromEntries(new URL(req.url).searchParams.entries());
        const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
        const mappingId = this.extractIdFromPath(req);
        
        await this.qbService.deleteDataMapping(
          mappingId,
          context.tenant,
          context.userId
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
      withAuth as any,
      withPermission('quickbooks', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      try {
        const data = await req.json() || {};
        const query = Object.fromEntries(new URL(req.url).searchParams.entries());
        const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
        const url = new URL(req.url);
        const checkType = url.searchParams.get('check_type') || 'full';
        
        const result = await this.qbService.getIntegrationHealth(
          checkType as any,
          context.tenant
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
      withAuth as any,
      withPermission('quickbooks', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      try {
        const data = await req.json() || {};
        const query = Object.fromEntries(new URL(req.url).searchParams.entries());
        const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
        const result = await this.qbService.getHealthMonitoringConfig(context.tenant);

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
      withAuth as any,
      withPermission('quickbooks', 'admin') as any as any,
      withValidation(healthMonitoringConfigSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      try {
        const data = await req.json() || {};
        const query = Object.fromEntries(new URL(req.url).searchParams.entries());
        const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
        const result = await this.qbService.updateHealthMonitoringConfig(
          data,
          context.tenant,
          context.userId
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
      withAuth as any,
      withPermission('quickbooks', 'admin') as any
    );

    return middleware(async (req: NextRequest) => {
      try {
        const data = await req.json() || {};
        const query = Object.fromEntries(new URL(req.url).searchParams.entries());
        const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
        const result = await this.qbService.runComprehensiveDiagnostics(
          context.tenant,
          context.userId
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
      withAuth as any,
      withPermission('quickbooks', 'read') as any as any,
      withValidation(qboEntityFilterSchema, 'query') as any
    );

    return middleware(async (req: NextRequest) => {
      try {
        const data = await req.json() || {};
        const query = Object.fromEntries(new URL(req.url).searchParams.entries());
        const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
        const result = await this.qbService.getItems(
          query,
          context.tenant
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
      withAuth as any,
      withPermission('quickbooks', 'read') as any as any,
      withValidation(qboEntityFilterSchema, 'query') as any
    );

    return middleware(async (req: NextRequest) => {
      try {
        const data = await req.json() || {};
        const query = Object.fromEntries(new URL(req.url).searchParams.entries());
        const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
        const result = await this.qbService.getPaymentMethods(
          query,
          context.tenant
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
      withAuth as any,
      withPermission('quickbooks', 'read') as any as any,
      withValidation(qboEntityFilterSchema, 'query') as any
    );

    return middleware(async (req: NextRequest) => {
      try {
        const data = await req.json() || {};
        const query = Object.fromEntries(new URL(req.url).searchParams.entries());
        const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
        const result = await this.qbService.getTerms(
          query,
          context.tenant
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
      withAuth as any,
      withPermission('quickbooks', 'write') as any
    );

    return middleware(async (req: NextRequest) => {
      try {
        const data = await req.json() || {};
        const query = Object.fromEntries(new URL(req.url).searchParams.entries());
        const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
        const syncId = this.extractIdFromPath(req);
        
        const result = await this.qbService.retrySyncOperation(
          syncId,
          context.tenant,
          context.userId
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
      withAuth as any,
      withPermission('quickbooks', 'write') as any
    );

    return middleware(async (req: NextRequest) => {
      try {
        const data = await req.json() || {};
        const query = Object.fromEntries(new URL(req.url).searchParams.entries());
        const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
        const result = await this.qbService.refreshOAuthTokens(
          context.tenant,
          context.userId
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
  const controller = new QuickBooksController();
  
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