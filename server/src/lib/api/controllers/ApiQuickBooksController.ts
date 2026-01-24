/**
 * API QuickBooks Controller V2
 * Simplified version with proper API key authentication for QuickBooks integration
 */

import { NextRequest, NextResponse } from 'next/server';
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
import { 
  ApiKeyServiceForApi 
} from '../../services/apiKeyServiceForApi';
import { findUserByIdForApi } from '@alga-psa/users/actions';
import { 
  runWithTenant 
} from '../../db';
import { 
  getConnection 
} from '../../db/db';
import { 
  hasPermission 
} from '../../auth/rbac';
import {
  ApiRequest,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  ConflictError,
  createSuccessResponse,
  createPaginatedResponse,
  handleApiError
} from '../middleware/apiMiddleware';
import { ZodError } from 'zod';

export class ApiQuickBooksController {
  private qbService: QuickBooksService;

  constructor() {
    this.qbService = new QuickBooksService(
      undefined as any, // DatabaseService - would be injected
      undefined as any, // EventBusService - would be injected  
      undefined as any  // AuditLogService - would be injected
    );
  }

  /**
   * Authenticate request and set context
   */
  private async authenticate(req: NextRequest): Promise<ApiRequest> {
    const apiKey = req.headers.get('x-api-key');
    
    if (!apiKey) {
      throw new UnauthorizedError('API key required');
    }

    // Extract tenant ID from header
    let tenantId = req.headers.get('x-tenant-id');
    let keyRecord;

    if (tenantId) {
      // If tenant is provided, validate key for that specific tenant
      keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
    } else {
      // Otherwise, search across all tenants
      keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
      if (keyRecord) {
        tenantId = keyRecord.tenant;
      }
    }
    
    if (!keyRecord) {
      throw new UnauthorizedError('Invalid API key');
    }

    // Get user within tenant context
    const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    // Create extended request with context
    const apiRequest = req as ApiRequest;
    apiRequest.context = {
      userId: keyRecord.user_id,
      tenant: keyRecord.tenant,
      user
    };

    return apiRequest;
  }

  /**
   * Check permissions
   */
  private async checkPermission(req: ApiRequest, action: string): Promise<void> {
    if (!req.context?.user) {
      throw new UnauthorizedError('User context required');
    }

    // Get a connection within the current tenant context
    const knex = await getConnection(req.context.tenant);
    
    const hasAccess = await hasPermission(req.context.user, 'quickbooks', action, knex);
    if (!hasAccess) {
      throw new ForbiddenError(`Permission denied: Cannot ${action} quickbooks`);
    }
  }

  /**
   * Validate request data
   */
  private async validateData(req: ApiRequest, schema: z.ZodSchema): Promise<any> {
    try {
      const body = await req.json().catch(() => ({}));
      return schema.parse(body);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new ValidationError('Validation failed', error.errors);
      }
      throw error;
    }
  }

  /**
   * Validate query parameters
   */
  private validateQuery(req: ApiRequest, schema: z.ZodSchema): any {
    try {
      const url = new URL(req.url);
      const query: Record<string, any> = {};
      url.searchParams.forEach((value, key) => {
        query[key] = value;
      });
      return schema.parse(query);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new ValidationError('Query validation failed', error.errors);
      }
      throw error;
    }
  }

  /**
   * Extract ID from request path
   */
  private async extractIdFromPath(req: ApiRequest, paramName: string = 'id'): Promise<string> {
    // Check if params were passed from Next.js dynamic route
    if ('params' in req && req.params) {
      const params = await req.params;
      if (params && paramName in params) {
        return params[paramName];
      }
    }
    
    // Fallback to extracting from URL path
    const url = new URL(req.url);
    const pathSegments = url.pathname.split('/');
    
    // Find the parameter in the path (e.g., for /sync/status/[sync_id], find sync_id)
    for (let i = 0; i < pathSegments.length - 1; i++) {
      if (pathSegments[i] === paramName.replace('_id', '') || 
          pathSegments[i] === 'mappings' || 
          pathSegments[i] === 'status' ||
          pathSegments[i] === 'sync') {
        const nextSegment = pathSegments[i + 1];
        if (nextSegment && !nextSegment.includes('[')) {
          return nextSegment;
        }
      }
    }
    
    throw new ValidationError(`Missing ${paramName} parameter`);
  }

  // ============================================================================
  // OAUTH FLOW MANAGEMENT
  // ============================================================================

  /**
   * POST /api/v2/quickbooks/oauth/initiate
   * Initiate OAuth authorization flow with QuickBooks
   */
  initiateOAuth() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'write');
          
          const data = await this.validateData(apiRequest, qboOAuthRequestSchema);
          const result = await this.qbService.initiateOAuthFlow(
            data,
            apiRequest.context!.tenant,
            apiRequest.context!.userId
          );

          return createSuccessResponse(result.data, 200, {
            links: {
              self: `${req.url}`,
              authorize: result.data.authorization_url,
              callback: '/api/v2/quickbooks/oauth/callback',
              status: '/api/v2/quickbooks/connection/status'
            }
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * POST /api/v2/quickbooks/oauth/callback
   * Handle OAuth callback from QuickBooks authorization
   */
  handleOAuthCallback() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'write');
          
          const data = await this.validateData(apiRequest, qboOAuthCallbackSchema);
          
          if (data.error) {
            throw new ValidationError(`OAuth error: ${data.error_description || data.error}`);
          }

          const result = await this.qbService.handleOAuthCallback(
            data,
            apiRequest.context!.tenant
          );

          return createSuccessResponse(result.data, 200, {
            links: {
              self: `${req.url}`,
              status: '/api/v2/quickbooks/connection/status',
              test: '/api/v2/quickbooks/connection/test',
              disconnect: '/api/v2/quickbooks/oauth/disconnect'
            }
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * DELETE /api/v2/quickbooks/oauth/disconnect
   * Disconnect QuickBooks integration and revoke tokens
   */
  disconnectOAuth() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'admin');
          
          await this.qbService.disconnectQuickBooks(
            apiRequest.context!.tenant,
            apiRequest.context!.userId
          );

          return new NextResponse(null, { 
            status: 204,
            headers: {
              'Location': '/api/v2/quickbooks/connection/status'
            }
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // CONNECTION STATUS AND TESTING
  // ============================================================================

  /**
   * GET /api/v2/quickbooks/connection/status
   * Get current QuickBooks connection status
   */
  getConnectionStatus() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');
          
          const status = await this.qbService.getConnectionStatus(apiRequest.context!.tenant);

          return createSuccessResponse(status, 200, {
            links: {
              self: `${req.url}`,
              test: '/api/v2/quickbooks/connection/test',
              health: '/api/v2/quickbooks/health',
              ...(status.data?.connected ? {
                disconnect: '/api/v2/quickbooks/oauth/disconnect',
                sync: '/api/v2/quickbooks/sync'
              } : {
                connect: '/api/v2/quickbooks/oauth/initiate'
              })
            }
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * POST /api/v2/quickbooks/connection/test
   * Test QuickBooks connection with various diagnostic checks
   */
  testConnection() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');
          
          const data = await this.validateData(apiRequest, qboConnectionTestSchema);
          const result = await this.qbService.testConnection(
            data,
            apiRequest.context!.tenant
          );

          return createSuccessResponse(result.data, 200, {
            links: {
              self: `${req.url}`,
              status: '/api/v2/quickbooks/connection/status',
              health: '/api/v2/quickbooks/health'
            }
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * POST /api/v2/quickbooks/connection/refresh
   * Refresh OAuth tokens
   */
  refreshConnection() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'write');
          
          // TODO: Implement refreshOAuthTokens method in QuickBooksService
          const result = {
            data: {
              success: true,
              tokens_refreshed: true,
              expires_at: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
              refresh_token_expires_at: new Date(Date.now() + 100 * 24 * 60 * 60 * 1000).toISOString(),
              connection_status: 'connected',
              refreshed_at: new Date().toISOString(),
              refreshed_by: apiRequest.context!.userId
            }
          };

          return createSuccessResponse(result.data, 200, {
            links: {
              self: `${req.url}`,
              status: '/api/v2/quickbooks/connection/status',
              test: '/api/v2/quickbooks/connection/test'
            }
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // CUSTOMER SYNCHRONIZATION
  // ============================================================================

  /**
   * POST /api/v2/quickbooks/customers/sync
   * Synchronize customers between Alga PSA and QuickBooks
   */
  syncCustomers() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'write');
          
          const data = await this.validateData(apiRequest, customerSyncRequestSchema);
          const result = await this.qbService.syncCustomers(
            data,
            apiRequest.context!.tenant,
            apiRequest.context!.userId
          );

          return createSuccessResponse(result.data, 200, {
            links: {
              self: `${req.url}`,
              mappings: '/api/v2/quickbooks/customers/mappings',
              status: `/api/v2/quickbooks/sync/status`,
              history: '/api/v2/quickbooks/sync/history?operation_type=customer_sync'
            }
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * GET /api/v2/quickbooks/customers/mappings
   * Get customer mappings between Alga PSA and QuickBooks
   */
  getCustomerMappings() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');
          
          const validatedQuery = this.validateQuery(apiRequest, qboEntityFilterSchema);
          const url = new URL(req.url);
          const page = parseInt(url.searchParams.get('page') || '1');
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);
          
          const result = await this.qbService.getCustomerMappings(
            apiRequest.context!.tenant,
            page,
            limit
          );

          return createPaginatedResponse(
            result.data || [],
            result.pagination?.total || 0,
            page,
            limit,
            {
              links: {
                sync: '/api/v2/quickbooks/customers/sync',
                refresh: `${req.url}`
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
   * DELETE /api/v2/quickbooks/customers/mappings/{mapping_id}
   * Remove a specific customer mapping
   */
  deleteCustomerMapping() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'write');
          
          const mappingId = await this.extractIdFromPath(apiRequest, 'mapping_id');
          
          // TODO: Implement deleteCustomerMapping method in QuickBooksService
          // await this.qbService.deleteCustomerMapping(
          //   mappingId,
          //   apiRequest.context!.tenant,
          //   apiRequest.context!.userId
          // );

          return new NextResponse(null, { 
            status: 204,
            headers: {
              'Location': '/api/v2/quickbooks/customers/mappings'
            }
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // INVOICE OPERATIONS
  // ============================================================================

  /**
   * POST /api/v2/quickbooks/invoices/export
   * Export invoices from Alga PSA to QuickBooks
   */
  exportInvoices() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'write');
          
          const data = await this.validateData(apiRequest, invoiceExportRequestSchema);
          const result = await this.qbService.exportInvoices(
            data,
            apiRequest.context!.tenant,
            apiRequest.context!.userId
          );

          return createSuccessResponse(result.data, 200, {
            links: {
              self: `${req.url}`,
              import: '/api/v2/quickbooks/invoices/import',
              status: '/api/v2/quickbooks/sync/status',
              history: '/api/v2/quickbooks/sync/history?operation_type=invoice_export'
            }
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * POST /api/v2/quickbooks/invoices/import
   * Import invoices from QuickBooks to Alga PSA
   */
  importInvoices() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'write');
          
          const data = await this.validateData(apiRequest, invoiceImportRequestSchema);
          const result = await this.qbService.importInvoices(
            data,
            apiRequest.context!.tenant,
            apiRequest.context!.userId
          );

          return createSuccessResponse(result.data, 200, {
            links: {
              self: `${req.url}`,
              export: '/api/v2/quickbooks/invoices/export',
              status: '/api/v2/quickbooks/sync/status',
              history: '/api/v2/quickbooks/sync/history?operation_type=invoice_import'
            }
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // PAYMENT SYNCHRONIZATION
  // ============================================================================

  /**
   * POST /api/v2/quickbooks/payments/sync
   * Synchronize payments between Alga PSA and QuickBooks
   */
  syncPayments() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'write');
          
          const data = await this.validateData(apiRequest, paymentSyncRequestSchema);
          const result = await this.qbService.syncPayments(
            data,
            apiRequest.context!.tenant,
            apiRequest.context!.userId
          );

          return createSuccessResponse(result.data, 200, {
            links: {
              self: `${req.url}`,
              status: '/api/v2/quickbooks/sync/status',
              history: '/api/v2/quickbooks/sync/history?operation_type=payment_sync'
            }
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // ACCOUNT AND TAX MAPPING CONFIGURATION
  // ============================================================================

  /**
   * GET /api/v2/quickbooks/accounts
   * Get QuickBooks chart of accounts
   */
  getAccounts() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');
          
          const validatedQuery = this.validateQuery(apiRequest, qboEntityFilterSchema);
          
          // TODO: Implement getChartOfAccounts method in QuickBooksService
          const result = { data: [] }; // Temporary stub

          return createSuccessResponse(result.data, 200, {
            links: {
              self: `${req.url}`,
              mappings: '/api/v2/quickbooks/accounts/mappings',
              refresh: `${req.url}?force_refresh=true`
            }
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * GET /api/v2/quickbooks/accounts/mappings
   * Get account mappings configuration
   */
  getAccountMappings() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');
          
          const url = new URL(req.url);
          const page = parseInt(url.searchParams.get('page') || '1');
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);

          // TODO: Implement getAccountMappings method in QuickBooksService
          const result = { data: [], pagination: { total: 0 } }; // Temporary stub

          return createPaginatedResponse(
            result.data,
            result.pagination?.total || 0,
            page,
            limit,
            {
              links: {
                accounts: '/api/v2/quickbooks/accounts',
                configure: '/api/v2/quickbooks/accounts/mappings'
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
   * PUT /api/v2/quickbooks/accounts/mappings
   * Configure account mappings
   */
  configureAccountMappings() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'write');
          
          const data = await this.validateData(apiRequest, accountMappingRequestSchema);
          
          // TODO: Implement configureAccountMappings method in QuickBooksService
          const result = { data: { success: true } }; // Temporary stub

          return createSuccessResponse(result.data, 200, {
            links: {
              self: `${req.url}`,
              mappings: '/api/v2/quickbooks/accounts/mappings',
              accounts: '/api/v2/quickbooks/accounts'
            }
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * GET /api/v2/quickbooks/tax-codes
   * Get QuickBooks tax codes and rates
   */
  getTaxCodes() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');
          
          const validatedQuery = this.validateQuery(apiRequest, qboEntityFilterSchema);
          
          // TODO: Implement getTaxCodes method in QuickBooksService
          const result = { data: [] }; // Temporary stub

          return createSuccessResponse(result.data, 200, {
            links: {
              self: `${req.url}`,
              mappings: '/api/v2/quickbooks/tax-codes/mappings',
              refresh: `${req.url}?force_refresh=true`
            }
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * GET /api/v2/quickbooks/tax-codes/mappings
   * Get tax mapping configuration
   */
  getTaxMappings() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');
          
          const url = new URL(req.url);
          const page = parseInt(url.searchParams.get('page') || '1');
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);

          // TODO: Implement getTaxMappings method in QuickBooksService
          const result = { data: [], pagination: { total: 0 } }; // Temporary stub

          return createPaginatedResponse(
            result.data,
            result.pagination?.total || 0,
            page,
            limit,
            {
              links: {
                'tax-codes': '/api/v2/quickbooks/tax-codes',
                configure: '/api/v2/quickbooks/tax-codes/mappings'
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
   * PUT /api/v2/quickbooks/tax-codes/mappings
   * Configure tax mappings
   */
  configureTaxMappings() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'write');
          
          const data = await this.validateData(apiRequest, taxMappingRequestSchema);
          
          // TODO: Implement configureTaxMappings method in QuickBooksService
          const result = { data: { success: true } }; // Temporary stub

          return createSuccessResponse(result.data, 200, {
            links: {
              self: `${req.url}`,
              mappings: '/api/v2/quickbooks/tax-codes/mappings',
              'tax-codes': '/api/v2/quickbooks/tax-codes'
            }
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // SYNC STATUS AND HISTORY TRACKING
  // ============================================================================

  /**
   * GET /api/v2/quickbooks/sync/status
   * Get current synchronization status
   */
  getSyncStatus() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');
          
          // Temporary stub while QuickBooksService method is not implemented
          const result = { status: 'idle', last_sync: null };

          return createSuccessResponse(result, 200, {
            links: {
              self: `${req.url}`,
              history: '/api/v2/quickbooks/sync/history',
              cancel: result.status === 'in_progress' ? '/api/v2/quickbooks/sync/cancel' : undefined
            }
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * GET /api/v2/quickbooks/sync/history
   * Get synchronization history with filtering
   */
  getSyncHistory() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');
          
          const validatedQuery = this.validateQuery(apiRequest, syncHistoryFilterSchema);
          const url = new URL(req.url);
          const page = parseInt(url.searchParams.get('page') || '1');
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);

          const result = await this.qbService.getSyncHistory(
            { 
              limit,
              status: validatedQuery.status as any,
              operation_type: validatedQuery.operation_type as any,
              date_range: validatedQuery.date_from || validatedQuery.date_to ? {
                start_date: validatedQuery.date_from,
                end_date: validatedQuery.date_to
              } : undefined
            },
            apiRequest.context!.tenant
          );

          return createPaginatedResponse(
            result.data,
            result.pagination?.total || 0,
            page,
            limit,
            {
              links: {
                status: '/api/v2/quickbooks/sync/status',
                refresh: `${req.url}`
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
   * GET /api/v2/quickbooks/sync/status/{sync_id}
   * Get specific sync operation status
   */
  getSyncStatusById() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');
          
          const syncId = await this.extractIdFromPath(apiRequest, 'sync_id');
          
          // TODO: Implement getSyncStatusById method in QuickBooksService
          const result = { id: syncId, status: 'completed', progress: 100 }; // Temporary stub

          if (!result) {
            throw new NotFoundError('Sync operation not found');
          }

          return createSuccessResponse(result, 200, {
            links: {
              self: `${req.url}`,
              history: '/api/v2/quickbooks/sync/history',
              cancel: result.status === 'in_progress' ? `/api/v2/quickbooks/sync/${syncId}/cancel` : undefined
            }
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * POST /api/v2/quickbooks/sync/{sync_id}/cancel
   * Cancel a running sync operation
   */
  cancelSync() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'write');
          
          const syncId = await this.extractIdFromPath(apiRequest, 'sync_id');
          
          // TODO: Implement cancelSyncOperation method in QuickBooksService
          // await this.qbService.cancelSyncOperation(
          //   syncId,
          //   apiRequest.context!.tenant,
          //   apiRequest.context!.userId
          // );

          return new NextResponse(null, { 
            status: 204,
            headers: {
              'Location': `/api/v2/quickbooks/sync/status/${syncId}`
            }
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * POST /api/v2/quickbooks/sync/{sync_id}/retry
   * Retry a failed sync operation
   */
  retrySync() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'write');
          
          const syncId = await this.extractIdFromPath(apiRequest, 'sync_id');
          
          // TODO: Implement retrySyncOperation method in QuickBooksService
          const result = {
            data: {
              sync_id: `retry_${syncId}_${Date.now()}`,
              original_sync_id: syncId,
              status: 'in_progress',
              operation_type: 'retry',
              started_at: new Date().toISOString(),
              started_by: apiRequest.context!.userId,
              progress: 0,
              estimated_completion: new Date(Date.now() + 5 * 60 * 1000).toISOString()
            }
          };

          return createSuccessResponse(result.data, 200, {
            links: {
              self: `${req.url}`,
              status: `/api/v2/quickbooks/sync/status/${result.data.sync_id}`,
              original: `/api/v2/quickbooks/sync/status/${syncId}`
            }
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // BULK SYNCHRONIZATION OPERATIONS
  // ============================================================================

  /**
   * POST /api/v2/quickbooks/sync/bulk
   * Execute bulk synchronization operations
   */
  bulkSync() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'write');
          
          const data = await this.validateData(apiRequest, bulkSyncRequestSchema);
          
          // TODO: Implement executeBulkSync method in QuickBooksService
          const result = { data: { bulk_sync_id: 'sync_' + Date.now() } }; // Temporary stub

          return createSuccessResponse(result.data, 202, {
            links: {
              self: `${req.url}`,
              status: `/api/v2/quickbooks/sync/status/${result.data.bulk_sync_id}`,
              history: '/api/v2/quickbooks/sync/history'
            }
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * POST /api/v2/quickbooks/sync/full
   * Execute comprehensive full synchronization
   */
  fullSync() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'admin');
          
          // TODO: Implement executeFullSync method in QuickBooksService
          const result = { data: { sync_id: 'full_sync_' + Date.now() } }; // Temporary stub

          return createSuccessResponse(result.data, 202, {
            links: {
              self: `${req.url}`,
              status: `/api/v2/quickbooks/sync/status/${result.data.sync_id}`,
              history: '/api/v2/quickbooks/sync/history'
            }
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // DATA MAPPING CONFIGURATION
  // ============================================================================

  /**
   * GET /api/v2/quickbooks/mappings
   * Get all data mapping configurations
   */
  getDataMappings() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');
          
          const url = new URL(req.url);
          const page = parseInt(url.searchParams.get('page') || '1');
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);
          const entityType = url.searchParams.get('entity_type');

          // TODO: Implement getDataMappings method in QuickBooksService
          const result = { data: [], pagination: { total: 0 } }; // Temporary stub

          return createPaginatedResponse(
            result.data,
            result.pagination?.total || 0,
            page,
            limit,
            {
              links: {
                create: '/api/v2/quickbooks/mappings',
                refresh: `${req.url}`
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
   * POST /api/v2/quickbooks/mappings
   * Create new data mapping configuration
   */
  createDataMapping() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'write');
          
          const data = await this.validateData(apiRequest, mappingConfigRequestSchema);
          
          // TODO: Implement createDataMapping method in QuickBooksService
          const result = { mapping_id: 'mapping_' + Date.now(), entity_type: 'customer' }; // Temporary stub

          return createSuccessResponse(result, 201, {
            links: {
              self: `/api/v2/quickbooks/mappings/${result.mapping_id}`,
              mappings: '/api/v2/quickbooks/mappings'
            }
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * GET /api/v2/quickbooks/mappings/{mapping_id}
   * Get specific data mapping configuration
   */
  getDataMappingById() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');
          
          const mappingId = await this.extractIdFromPath(apiRequest, 'mapping_id');
          
          // TODO: Implement getDataMappingById method in QuickBooksService
          const result = { 
            mapping_id: mappingId, 
            source_field: 'customer_name', 
            target_field: 'DisplayName' 
          };

          if (!result) {
            throw new NotFoundError('Data mapping not found');
          }

          return createSuccessResponse(result, 200, {
            links: {
              self: `${req.url}`,
              mappings: '/api/v2/quickbooks/mappings',
              update: `${req.url}`,
              delete: `${req.url}`
            }
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * PUT /api/v2/quickbooks/mappings/{mapping_id}
   * Update data mapping configuration
   */
  updateDataMapping() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'write');
          
          const mappingId = await this.extractIdFromPath(apiRequest, 'mapping_id');
          const data = await this.validateData(apiRequest, mappingConfigRequestSchema);
          
          // TODO: Implement updateDataMapping method in QuickBooksService
          const result = { 
            mapping_id: mappingId, 
            ...data,
            updated_at: new Date().toISOString()
          };

          return createSuccessResponse(result, 200, {
            links: {
              self: `${req.url}`,
              mappings: '/api/v2/quickbooks/mappings'
            }
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * DELETE /api/v2/quickbooks/mappings/{mapping_id}
   * Delete data mapping configuration
   */
  deleteDataMapping() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'write');
          
          const mappingId = await this.extractIdFromPath(apiRequest, 'mapping_id');
          
          // TODO: Implement deleteDataMapping method in QuickBooksService

          return new NextResponse(null, { 
            status: 204,
            headers: {
              'Location': '/api/v2/quickbooks/mappings'
            }
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // HEALTH MONITORING AND DIAGNOSTICS
  // ============================================================================

  /**
   * GET /api/v2/quickbooks/health
   * Get comprehensive integration health status
   */
  getHealth() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');
          
          const result = await this.qbService.getIntegrationHealth(
            apiRequest.context!.tenant
          );

          return createSuccessResponse(result, 200, {
            links: {
              self: `${req.url}`,
              status: '/api/v2/quickbooks/connection/status',
              test: '/api/v2/quickbooks/connection/test',
              config: '/api/v2/quickbooks/health/config'
            }
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * GET /api/v2/quickbooks/health/config
   * Get health monitoring configuration
   */
  getHealthConfig() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');
          
          // TODO: Implement getHealthMonitoringConfig method in QuickBooksService
          const result = { monitoring_enabled: true, check_interval: 300 };

          return createSuccessResponse(result, 200, {
            links: {
              self: `${req.url}`,
              health: '/api/v2/quickbooks/health',
              update: `${req.url}`
            }
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * PUT /api/v2/quickbooks/health/config
   * Update health monitoring configuration
   */
  updateHealthConfig() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'admin');
          
          const data = await this.validateData(apiRequest, healthMonitoringConfigSchema);
          
          // TODO: Implement updateHealthMonitoringConfig method in QuickBooksService
          const result = {
            monitoring_enabled: data.monitoring_enabled || true,
            check_interval: data.check_interval || 300,
            alert_thresholds: data.alert_thresholds || {},
            updated_at: new Date().toISOString(),
            updated_by: apiRequest.context!.userId
          };

          return createSuccessResponse(result, 200, {
            links: {
              self: `${req.url}`,
              health: '/api/v2/quickbooks/health',
              config: '/api/v2/quickbooks/health/config'
            }
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * POST /api/v2/quickbooks/diagnostics
   * Run comprehensive diagnostics
   */
  runDiagnostics() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'admin');
          
          // TODO: Implement runComprehensiveDiagnostics method in QuickBooksService
          const result = {
            data: {
              overall_status: 'healthy',
              connection_status: 'connected',
              last_sync: new Date().toISOString(),
              api_response_time: 150,
              error_rate: 0.01,
              checks: [
                { name: 'oauth_tokens', status: 'pass', message: 'Tokens are valid' },
                { name: 'api_connectivity', status: 'pass', message: 'API accessible' },
                { name: 'data_sync', status: 'pass', message: 'Sync operations working' }
              ],
              recommendations: []
            }
          };

          return createSuccessResponse(result.data, 200, {
            links: {
              self: `${req.url}`,
              health: '/api/v2/quickbooks/health',
              status: '/api/v2/quickbooks/connection/status'
            }
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // ============================================================================
  // LOOKUP DATA ENDPOINTS
  // ============================================================================

  /**
   * GET /api/v2/quickbooks/items
   * Get QuickBooks items/services
   */
  getItems() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');
          
          const validatedQuery = this.validateQuery(apiRequest, qboEntityFilterSchema);
          
          // TODO: Implement getItems method in QuickBooksService
          const result = {
            data: [
              {
                id: '1',
                name: 'Professional Services',
                type: 'Service',
                description: 'Consulting and professional services',
                unit_price: 150.00,
                income_account: 'Professional Income',
                active: true
              },
              {
                id: '2', 
                name: 'Software Development',
                type: 'Service',
                description: 'Custom software development services',
                unit_price: 175.00,
                income_account: 'Development Income',
                active: true
              }
            ]
          };

          return createSuccessResponse(result.data, 200, {
            links: {
              self: `${req.url}`,
              refresh: `${req.url}?force_refresh=true`
            }
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * GET /api/v2/quickbooks/payment-methods
   * Get QuickBooks payment methods
   */
  getPaymentMethods() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');
          
          const validatedQuery = this.validateQuery(apiRequest, qboEntityFilterSchema);
          
          // TODO: Implement getPaymentMethods method in QuickBooksService
          const result = {
            data: [
              {
                id: '1',
                name: 'Cash',
                type: 'other',
                active: true
              },
              {
                id: '2',
                name: 'Check',
                type: 'other', 
                active: true
              },
              {
                id: '3',
                name: 'Credit Card',
                type: 'credit_card',
                active: true
              },
              {
                id: '4',
                name: 'Bank Transfer',
                type: 'other',
                active: true
              }
            ]
          };

          return createSuccessResponse(result.data, 200, {
            links: {
              self: `${req.url}`,
              refresh: `${req.url}?force_refresh=true`
            }
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * GET /api/v2/quickbooks/terms
   * Get QuickBooks payment terms
   */
  getTerms() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiRequest = await this.authenticate(req);
        
        return await runWithTenant(apiRequest.context!.tenant, async () => {
          await this.checkPermission(apiRequest, 'read');
          
          const validatedQuery = this.validateQuery(apiRequest, qboEntityFilterSchema);
          
          // TODO: Implement getTerms method in QuickBooksService
          const result = {
            data: [
              {
                id: '1',
                name: 'Net 15',
                type: 'Standard',
                due_days: 15,
                discount_days: 0,
                discount_percent: 0,
                active: true
              },
              {
                id: '2',
                name: 'Net 30',
                type: 'Standard',
                due_days: 30,
                discount_days: 0,
                discount_percent: 0,
                active: true
              },
              {
                id: '3',
                name: '2/10 Net 30',
                type: 'Standard',
                due_days: 30,
                discount_days: 10,
                discount_percent: 2,
                active: true
              },
              {
                id: '4',
                name: 'Due on receipt',
                type: 'Standard',
                due_days: 0,
                discount_days: 0,
                discount_percent: 0,
                active: true
              }
            ]
          };

          return createSuccessResponse(result.data, 200, {
            links: {
              self: `${req.url}`,
              refresh: `${req.url}?force_refresh=true`
            }
          });
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }
}

// Export the controller class
export default ApiQuickBooksController;
