/**
 * API Time Entry Controller V2
 * Simplified version with proper API key authentication
 */

import { NextRequest, NextResponse } from 'next/server';
import { ApiBaseController } from './ApiBaseController';
import { TimeEntryService } from '../services/TimeEntryService';
import { 
  createTimeEntrySchema,
  updateTimeEntrySchema,
  timeEntryListQuerySchema,
  timeEntrySearchSchema,
  timeEntryExportQuerySchema,
  startTimeTrackingSchema,
  stopTimeTrackingSchema,
  approveTimeEntriesSchema,
  requestTimeEntryChangesSchema,
  bulkTimeEntrySchema,
  bulkUpdateTimeEntrySchema,
  bulkDeleteTimeEntrySchema
} from '../schemas/timeEntry';
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
  createSuccessResponse,
  createPaginatedResponse,
  handleApiError
} from '../middleware/apiMiddleware';
import { ZodError } from 'zod';

export class ApiTimeEntryController extends ApiBaseController {
  private timeEntryService: TimeEntryService;

  constructor() {
    const timeEntryService = new TimeEntryService();
    
    super(timeEntryService, {
      resource: 'time_entry',
      createSchema: createTimeEntrySchema,
      updateSchema: updateTimeEntrySchema,
      querySchema: timeEntryListQuerySchema,
      permissions: {
        create: 'create',
        read: 'read',
        update: 'update',
        delete: 'delete',
        list: 'read'
      }
    });
    
    this.timeEntryService = timeEntryService;
  }

  /**
   * Search time entries
   */
  search() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiKey = req.headers.get('x-api-key');
        
        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

        // Extract tenant ID
        let tenantId = req.headers.get('x-tenant-id');
        let keyRecord;

        if (tenantId) {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
        } else {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
          if (keyRecord) {
            tenantId = keyRecord.tenant;
          }
        }
        
        if (!keyRecord) {
          throw new UnauthorizedError('Invalid API key');
        }

        // Get user
        const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasReadPermission = await hasPermission(
          user,
          'time_entry',
          'read',
          db
        );

        if (!hasReadPermission) {
          throw new ForbiddenError('Permission denied: Cannot read time entries');
        }

        // Validate query parameters
        const url = new URL(req.url);
        const queryParams = Object.fromEntries(url.searchParams);
        
        let searchParams;
        try {
          searchParams = timeEntrySearchSchema.parse(queryParams);
        } catch (error) {
          if (error instanceof ZodError) {
            throw new ValidationError('Invalid search parameters', error.errors);
          }
          throw error;
        }

        // Search within tenant context
        const results = await runWithTenant(tenantId!, async () => {
          return await this.timeEntryService.searchTimeEntries(searchParams, {
            userId: user.user_id,
            user,
            tenant: tenantId!,
          });
        });

        const page = 1; // Search doesn't support pagination
        const limit = searchParams.limit || 25;
        return createPaginatedResponse(
          results.data,
          results.total,
          page,
          limit
        );
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get time entry statistics
   */
  stats() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiKey = req.headers.get('x-api-key');
        
        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

        // Extract tenant ID
        let tenantId = req.headers.get('x-tenant-id');
        let keyRecord;

        if (tenantId) {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
        } else {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
          if (keyRecord) {
            tenantId = keyRecord.tenant;
          }
        }
        
        if (!keyRecord) {
          throw new UnauthorizedError('Invalid API key');
        }

        // Get user
        const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasReadPermission = await hasPermission(
          user,
          'time_entry',
          'read',
          db
        );

        if (!hasReadPermission) {
          throw new ForbiddenError('Permission denied: Cannot read time entry statistics');
        }

        // Get query parameters
        const url = new URL(req.url);
        const queryParams = Object.fromEntries(url.searchParams);

        // Get statistics within tenant context
        const stats = await runWithTenant(tenantId!, async () => {
          return await this.timeEntryService.getTimeEntryStatistics(queryParams, {
            userId: user.user_id,
            user,
            tenant: tenantId!,
          });
        });

        return createSuccessResponse(stats);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Export time entries
   */
  export() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiKey = req.headers.get('x-api-key');
        
        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

        // Extract tenant ID
        let tenantId = req.headers.get('x-tenant-id');
        let keyRecord;

        if (tenantId) {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
        } else {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
          if (keyRecord) {
            tenantId = keyRecord.tenant;
          }
        }
        
        if (!keyRecord) {
          throw new UnauthorizedError('Invalid API key');
        }

        // Get user
        const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasReadPermission = await hasPermission(
          user,
          'time_entry',
          'read',
          db
        );

        if (!hasReadPermission) {
          throw new ForbiddenError('Permission denied: Cannot export time entries');
        }

        // Validate query parameters
        const url = new URL(req.url);
        const queryParams = Object.fromEntries(url.searchParams);
        
        let exportParams;
        try {
          exportParams = timeEntryExportQuerySchema.parse(queryParams);
        } catch (error) {
          if (error instanceof ZodError) {
            throw new ValidationError('Invalid export parameters', error.errors);
          }
          throw error;
        }

        // Export within tenant context
        const exportData = await runWithTenant(tenantId!, async () => {
          return await this.timeEntryService.exportTimeEntries(exportParams, {
            userId: user.user_id,
            user,
            tenant: tenantId!,
          });
        });

        // Return appropriate response based on format
        if (exportParams.format === 'csv') {
          return new NextResponse(exportData as string, {
            headers: {
              'Content-Type': 'text/csv',
              'Content-Disposition': 'attachment; filename="time-entries.csv"'
            }
          });
        } else {
          return createSuccessResponse(exportData);
        }
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Start time tracking
   */
  startTracking() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiKey = req.headers.get('x-api-key');
        
        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

        // Extract tenant ID
        let tenantId = req.headers.get('x-tenant-id');
        let keyRecord;

        if (tenantId) {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
        } else {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
          if (keyRecord) {
            tenantId = keyRecord.tenant;
          }
        }
        
        if (!keyRecord) {
          throw new UnauthorizedError('Invalid API key');
        }

        // Get user
        const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasCreatePermission = await hasPermission(
          user,
          'time_entry',
          'create',
          db
        );

        if (!hasCreatePermission) {
          throw new ForbiddenError('Permission denied: Cannot create time entries');
        }

        // Parse and validate request body
        const body = await req.json();
        let trackingData;
        try {
          trackingData = startTimeTrackingSchema.parse(body);
        } catch (error) {
          if (error instanceof ZodError) {
            throw new ValidationError('Invalid tracking data', error.errors);
          }
          throw error;
        }

        // Start tracking within tenant context
        const session = await runWithTenant(tenantId!, async () => {
          return await this.timeEntryService.startTimeTracking(trackingData, {
            userId: user.user_id,
            user,
            tenant: tenantId!,
          });
        });

        return createSuccessResponse(session, 201);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Stop time tracking
   */
  stopTracking() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiKey = req.headers.get('x-api-key');
        
        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

        // Extract tenant ID
        let tenantId = req.headers.get('x-tenant-id');
        let keyRecord;

        if (tenantId) {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
        } else {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
          if (keyRecord) {
            tenantId = keyRecord.tenant;
          }
        }
        
        if (!keyRecord) {
          throw new UnauthorizedError('Invalid API key');
        }

        // Get user
        const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        // Extract session ID from path
        const pathParts = req.url.split('/');
        const stopIndex = pathParts.findIndex(part => part === 'stop-tracking');
        const sessionId = pathParts[stopIndex + 1];

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasUpdatePermission = await hasPermission(
          user,
          'time_entry',
          'update',
          db
        );

        if (!hasUpdatePermission) {
          throw new ForbiddenError('Permission denied: Cannot update time entries');
        }

        // Parse and validate request body
        const body = await req.json();
        let stopData;
        try {
          stopData = stopTimeTrackingSchema.parse(body);
        } catch (error) {
          if (error instanceof ZodError) {
            throw new ValidationError('Invalid stop data', error.errors);
          }
          throw error;
        }

        // Stop tracking within tenant context
        const timeEntry = await runWithTenant(tenantId!, async () => {
          return await this.timeEntryService.stopTimeTracking(sessionId, stopData, {
            userId: user.user_id,
            user,
            tenant: tenantId!,
          });
        });

        return createSuccessResponse(timeEntry, 201);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get active tracking session
   */
  getActiveSession() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiKey = req.headers.get('x-api-key');
        
        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

        // Extract tenant ID
        let tenantId = req.headers.get('x-tenant-id');
        let keyRecord;

        if (tenantId) {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
        } else {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
          if (keyRecord) {
            tenantId = keyRecord.tenant;
          }
        }
        
        if (!keyRecord) {
          throw new UnauthorizedError('Invalid API key');
        }

        // Get user
        const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        // Get active session within tenant context
        const session = await runWithTenant(tenantId!, async () => {
          return await this.timeEntryService.getActiveSession(user.user_id, {
            userId: user.user_id,
            user,
            tenant: tenantId!,
          });
        });

        return createSuccessResponse(session);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Approve time entries
   */
  approve() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiKey = req.headers.get('x-api-key');
        
        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

        // Extract tenant ID
        let tenantId = req.headers.get('x-tenant-id');
        let keyRecord;

        if (tenantId) {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
        } else {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
          if (keyRecord) {
            tenantId = keyRecord.tenant;
          }
        }
        
        if (!keyRecord) {
          throw new UnauthorizedError('Invalid API key');
        }

        // Get user
        const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasApprovePermission = await hasPermission(
          user,
          'time_entry',
          'approve',
          db
        );

        if (!hasApprovePermission) {
          throw new ForbiddenError('Permission denied: Cannot approve time entries');
        }

        // Parse and validate request body
        const body = await req.json();
        let approvalData;
        try {
          approvalData = approveTimeEntriesSchema.parse(body);
        } catch (error) {
          if (error instanceof ZodError) {
            throw new ValidationError('Invalid approval data', error.errors);
          }
          throw error;
        }

        // Approve entries within tenant context
        const result = await runWithTenant(tenantId!, async () => {
          return await this.timeEntryService.approveTimeEntries(approvalData, {
            userId: user.user_id,
            user,
            tenant: tenantId!,
          });
        });

        return createSuccessResponse(result);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Request changes to time entries
   */
  requestChanges() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiKey = req.headers.get('x-api-key');
        
        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

        // Extract tenant ID
        let tenantId = req.headers.get('x-tenant-id');
        let keyRecord;

        if (tenantId) {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
        } else {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
          if (keyRecord) {
            tenantId = keyRecord.tenant;
          }
        }
        
        if (!keyRecord) {
          throw new UnauthorizedError('Invalid API key');
        }

        // Get user
        const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasApprovePermission = await hasPermission(
          user,
          'time_entry',
          'approve',
          db
        );

        if (!hasApprovePermission) {
          throw new ForbiddenError('Permission denied: Cannot request changes to time entries');
        }

        // Parse and validate request body
        const body = await req.json();
        let changeData;
        try {
          changeData = requestTimeEntryChangesSchema.parse(body);
        } catch (error) {
          if (error instanceof ZodError) {
            throw new ValidationError('Invalid change request data', error.errors);
          }
          throw error;
        }

        // Request changes within tenant context
        const result = await runWithTenant(tenantId!, async () => {
          return await this.timeEntryService.requestChanges(changeData, {
            userId: user.user_id,
            user,
            tenant: tenantId!,
          });
        });

        return createSuccessResponse(result);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get time entry templates
   */
  getTemplates() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiKey = req.headers.get('x-api-key');
        
        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

        // Extract tenant ID
        let tenantId = req.headers.get('x-tenant-id');
        let keyRecord;

        if (tenantId) {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
        } else {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
          if (keyRecord) {
            tenantId = keyRecord.tenant;
          }
        }
        
        if (!keyRecord) {
          throw new UnauthorizedError('Invalid API key');
        }

        // Get user
        const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        // Get templates within tenant context
        const templates = await runWithTenant(tenantId!, async () => {
          return await this.timeEntryService.getTimeEntryTemplates({
            userId: user.user_id,
            user,
            tenant: tenantId!,
          });
        });

        return createSuccessResponse(templates);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Bulk create time entries
   */
  bulkCreate() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiKey = req.headers.get('x-api-key');
        
        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

        // Extract tenant ID
        let tenantId = req.headers.get('x-tenant-id');
        let keyRecord;

        if (tenantId) {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
        } else {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
          if (keyRecord) {
            tenantId = keyRecord.tenant;
          }
        }
        
        if (!keyRecord) {
          throw new UnauthorizedError('Invalid API key');
        }

        // Get user
        const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasCreatePermission = await hasPermission(
          user,
          'time_entry',
          'create',
          db
        );

        if (!hasCreatePermission) {
          throw new ForbiddenError('Permission denied: Cannot create time entries');
        }

        // Parse and validate request body
        const body = await req.json();
        let bulkData;
        try {
          bulkData = bulkTimeEntrySchema.parse(body);
        } catch (error) {
          if (error instanceof ZodError) {
            throw new ValidationError('Invalid bulk data', error.errors);
          }
          throw error;
        }

        // Create entries within tenant context
        const result = await runWithTenant(tenantId!, async () => {
          return await this.timeEntryService.bulkCreateTimeEntries(bulkData, {
            userId: user.user_id,
            user,
            tenant: tenantId!,
          });
        });

        return createSuccessResponse({ created_count: result.filter(r => r.success).length }, 201);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Bulk update time entries
   */
  bulkUpdate() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiKey = req.headers.get('x-api-key');
        
        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

        // Extract tenant ID
        let tenantId = req.headers.get('x-tenant-id');
        let keyRecord;

        if (tenantId) {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
        } else {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
          if (keyRecord) {
            tenantId = keyRecord.tenant;
          }
        }
        
        if (!keyRecord) {
          throw new UnauthorizedError('Invalid API key');
        }

        // Get user
        const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasUpdatePermission = await hasPermission(
          user,
          'time_entry',
          'update',
          db
        );

        if (!hasUpdatePermission) {
          throw new ForbiddenError('Permission denied: Cannot update time entries');
        }

        // Parse and validate request body
        const body = await req.json();
        let bulkData;
        try {
          bulkData = bulkUpdateTimeEntrySchema.parse(body);
        } catch (error) {
          if (error instanceof ZodError) {
            throw new ValidationError('Invalid bulk data', error.errors);
          }
          throw error;
        }

        // Update entries within tenant context
        const result = await runWithTenant(tenantId!, async () => {
          return await this.timeEntryService.bulkUpdateTimeEntries(bulkData, {
            userId: user.user_id,
            user,
            tenant: tenantId!,
          });
        });

        return createSuccessResponse({ updated_count: result.filter(r => r.success).length });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Bulk delete time entries
   */
  bulkDelete() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiKey = req.headers.get('x-api-key');
        
        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

        // Extract tenant ID
        let tenantId = req.headers.get('x-tenant-id');
        let keyRecord;

        if (tenantId) {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
        } else {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
          if (keyRecord) {
            tenantId = keyRecord.tenant;
          }
        }
        
        if (!keyRecord) {
          throw new UnauthorizedError('Invalid API key');
        }

        // Get user
        const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasDeletePermission = await hasPermission(
          user,
          'time_entry',
          'delete',
          db
        );

        if (!hasDeletePermission) {
          throw new ForbiddenError('Permission denied: Cannot delete time entries');
        }

        // Parse and validate request body
        const body = await req.json();
        let bulkData;
        try {
          bulkData = bulkDeleteTimeEntrySchema.parse(body);
        } catch (error) {
          if (error instanceof ZodError) {
            throw new ValidationError('Invalid bulk data', error.errors);
          }
          throw error;
        }

        // Delete entries within tenant context
        const result = await runWithTenant(tenantId!, async () => {
          return await this.timeEntryService.bulkDeleteTimeEntries(bulkData, {
            userId: user.user_id,
            user,
            tenant: tenantId!,
          });
        });

        return new NextResponse(null, { status: 204 });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }
}
