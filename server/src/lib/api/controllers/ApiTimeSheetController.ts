/**
 * API Time Sheet Controller V2
 * Simplified version with proper API key authentication
 */

import { NextRequest, NextResponse } from 'next/server';
import { ApiBaseController } from './ApiBaseController';
import { TimeSheetService } from '../services/TimeSheetService';
import { 
  createTimeSheetSchema,
  updateTimeSheetSchema,
  timeSheetListQuerySchema,
  createTimePeriodSchema,
  updateTimePeriodSchema,
  createTimePeriodSettingsSchema,
  updateTimePeriodSettingsSchema,
  createTimeSheetCommentSchema,
  submitTimeSheetSchema,
  approveTimeSheetSchema,
  requestChangesTimeSheetSchema,
  bulkApproveTimeSheetSchema,
  reverseApprovalSchema,
  timeSheetSearchSchema,
  timeSheetExportQuerySchema,
  generateTimePeriodsSchema,
  createScheduleEntrySchema,
  updateScheduleEntrySchema
} from '../schemas/timeSheet';
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

export class ApiTimeSheetController extends ApiBaseController {
  private timeSheetService: TimeSheetService;

  constructor() {
    const timeSheetService = new TimeSheetService();
    
    super(timeSheetService, {
      resource: 'time_sheet',
      createSchema: createTimeSheetSchema,
      updateSchema: updateTimeSheetSchema,
      querySchema: timeSheetListQuerySchema,
      permissions: {
        create: 'create',
        read: 'read',
        update: 'update',
        delete: 'delete',
        list: 'read'
      }
    });
    
    this.timeSheetService = timeSheetService;
  }

  /**
   * Get time sheet with details
   */
  getWithDetails() {
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
          'time_sheet',
          'read',
          db
        );

        if (!hasReadPermission) {
          throw new ForbiddenError('Permission denied: Cannot read time sheets');
        }

        // Extract ID from path
        const pathParts = req.url.split('/');
        const id = pathParts[pathParts.length - 1];

        // Get time sheet with details within tenant context
        const timeSheet = await runWithTenant(tenantId!, async () => {
          return await this.timeSheetService.getWithDetails(id, {
            userId: user.user_id,
            user,
            tenant: tenantId!,
          });
        });

        if (!timeSheet) {
          throw new NotFoundError('Time sheet not found');
        }

        return createSuccessResponse(timeSheet);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Submit time sheet for approval
   */
  submit() {
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
          'time_sheet',
          'update',
          db
        );

        if (!hasUpdatePermission) {
          throw new ForbiddenError('Permission denied: Cannot update time sheets');
        }

        // Extract ID from path
        const pathParts = req.url.split('/');
        const submitIndex = pathParts.findIndex(part => part === 'submit');
        const id = pathParts[submitIndex - 1];

        // Parse and validate request body
        const body = await req.json();
        let submitData;
        try {
          submitData = submitTimeSheetSchema.parse(body);
        } catch (error) {
          if (error instanceof ZodError) {
            throw new ValidationError('Invalid submit data', error.errors);
          }
          throw error;
        }

        // Submit time sheet within tenant context
        const timeSheet = await runWithTenant(tenantId!, async () => {
          return await this.timeSheetService.submitTimeSheet(id, submitData, {
            userId: user.user_id,
            user,
            tenant: tenantId!,
          });
        });

        return createSuccessResponse(timeSheet);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Approve time sheet
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
          'time_sheet',
          'approve',
          db
        );

        if (!hasApprovePermission) {
          throw new ForbiddenError('Permission denied: Cannot approve time sheets');
        }

        // Extract ID from path
        const pathParts = req.url.split('/');
        const approveIndex = pathParts.findIndex(part => part === 'approve');
        const id = pathParts[approveIndex - 1];

        // Parse and validate request body
        const body = await req.json();
        let approveData;
        try {
          approveData = approveTimeSheetSchema.parse(body);
        } catch (error) {
          if (error instanceof ZodError) {
            throw new ValidationError('Invalid approve data', error.errors);
          }
          throw error;
        }

        // Approve time sheet within tenant context
        const timeSheet = await runWithTenant(tenantId!, async () => {
          return await this.timeSheetService.approveTimeSheet(id, approveData, {
            userId: user.user_id,
            user,
            tenant: tenantId!,
          });
        });

        return createSuccessResponse(timeSheet);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Request changes to time sheet
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
          'time_sheet',
          'approve',
          db
        );

        if (!hasApprovePermission) {
          throw new ForbiddenError('Permission denied: Cannot request changes to time sheets');
        }

        // Extract ID from path
        const pathParts = req.url.split('/');
        const requestChangesIndex = pathParts.findIndex(part => part === 'request-changes');
        const id = pathParts[requestChangesIndex - 1];

        // Parse and validate request body
        const body = await req.json();
        let requestChangesData;
        try {
          requestChangesData = requestChangesTimeSheetSchema.parse(body);
        } catch (error) {
          if (error instanceof ZodError) {
            throw new ValidationError('Invalid request changes data', error.errors);
          }
          throw error;
        }

        // Request changes within tenant context
        const timeSheet = await runWithTenant(tenantId!, async () => {
          return await this.timeSheetService.requestChanges(id, requestChangesData, {
            userId: user.user_id,
            user,
            tenant: tenantId!,
          });
        });

        return createSuccessResponse(timeSheet);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Reverse time sheet approval
   */
  reverseApproval() {
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
        const hasManagePermission = await hasPermission(
          user,
          'time_sheet',
          'manage',
          db
        );

        if (!hasManagePermission) {
          throw new ForbiddenError('Permission denied: Cannot manage time sheets');
        }

        // Extract ID from path
        const pathParts = req.url.split('/');
        const reverseIndex = pathParts.findIndex(part => part === 'reverse-approval');
        const id = pathParts[reverseIndex - 1];

        // Parse and validate request body
        const body = await req.json();
        let reverseData;
        try {
          reverseData = reverseApprovalSchema.parse(body);
        } catch (error) {
          if (error instanceof ZodError) {
            throw new ValidationError('Invalid reverse approval data', error.errors);
          }
          throw error;
        }

        // Reverse approval within tenant context
        const timeSheet = await runWithTenant(tenantId!, async () => {
          return await this.timeSheetService.reverseApproval(id, reverseData, {
            userId: user.user_id,
            user,
            tenant: tenantId!,
          });
        });

        return createSuccessResponse(timeSheet);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Bulk approve time sheets
   */
  bulkApprove() {
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
          'time_sheet',
          'approve',
          db
        );

        if (!hasApprovePermission) {
          throw new ForbiddenError('Permission denied: Cannot approve time sheets');
        }

        // Parse and validate request body
        const body = await req.json();
        let bulkApproveData;
        try {
          bulkApproveData = bulkApproveTimeSheetSchema.parse(body);
        } catch (error) {
          if (error instanceof ZodError) {
            throw new ValidationError('Invalid bulk approve data', error.errors);
          }
          throw error;
        }

        // Bulk approve within tenant context
        const results = await runWithTenant(tenantId!, async () => {
          return await this.timeSheetService.bulkApprove(bulkApproveData, {
            userId: user.user_id,
            user,
            tenant: tenantId!,
          });
        });

        return createSuccessResponse({
          results,
          message: `Processed ${results.length} time sheet approvals`
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get time sheet comments
   */
  getComments() {
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
          'time_sheet',
          'read',
          db
        );

        if (!hasReadPermission) {
          throw new ForbiddenError('Permission denied: Cannot read time sheet comments');
        }

        // Extract ID from path
        const pathParts = req.url.split('/');
        const commentsIndex = pathParts.findIndex(part => part === 'comments');
        const id = pathParts[commentsIndex - 1];

        // Get comments within tenant context
        const comments = await runWithTenant(tenantId!, async () => {
          return await this.timeSheetService.getTimeSheetComments(id, {
            userId: user.user_id,
            user,
            tenant: tenantId!,
          });
        });

        return createSuccessResponse(comments);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Add comment to time sheet
   */
  addComment() {
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
          'time_sheet',
          'update',
          db
        );

        if (!hasUpdatePermission) {
          throw new ForbiddenError('Permission denied: Cannot update time sheets');
        }

        // Extract ID from path
        const pathParts = req.url.split('/');
        const commentsIndex = pathParts.findIndex(part => part === 'comments');
        const id = pathParts[commentsIndex - 1];

        // Parse and validate request body
        const body = await req.json();
        let commentData;
        try {
          commentData = createTimeSheetCommentSchema.parse(body);
        } catch (error) {
          if (error instanceof ZodError) {
            throw new ValidationError('Invalid comment data', error.errors);
          }
          throw error;
        }

        // Add comment within tenant context
        const comment = await runWithTenant(tenantId!, async () => {
          return await this.timeSheetService.addComment(id, commentData, {
            userId: user.user_id,
            user,
            tenant: tenantId!,
          });
        });

        return createSuccessResponse(comment, 201);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Search time sheets
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
          'time_sheet',
          'read',
          db
        );

        if (!hasReadPermission) {
          throw new ForbiddenError('Permission denied: Cannot read time sheets');
        }

        // Validate query parameters
        const url = new URL(req.url);
        const queryParams = Object.fromEntries(url.searchParams);
        
        let searchParams;
        try {
          searchParams = timeSheetSearchSchema.parse(queryParams);
        } catch (error) {
          if (error instanceof ZodError) {
            throw new ValidationError('Invalid search parameters', error.errors);
          }
          throw error;
        }

        // Search within tenant context
        const timeSheets = await runWithTenant(tenantId!, async () => {
          return await this.timeSheetService.search(searchParams as any, {
            userId: user.user_id,
            user,
            tenant: tenantId!,
          });
        });

        return createSuccessResponse(timeSheets);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Export time sheets
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
          'time_sheet',
          'read',
          db
        );

        if (!hasReadPermission) {
          throw new ForbiddenError('Permission denied: Cannot export time sheets');
        }

        // Validate query parameters
        const url = new URL(req.url);
        const queryParams = Object.fromEntries(url.searchParams);
        
        let exportParams;
        try {
          exportParams = timeSheetExportQuerySchema.parse(queryParams);
        } catch (error) {
          if (error instanceof ZodError) {
            throw new ValidationError('Invalid export parameters', error.errors);
          }
          throw error;
        }

        // Export within tenant context
        const result = await runWithTenant(tenantId!, async () => {
          const timeSheets = await this.timeSheetService.list({}, {
            userId: user.user_id,
            user,
            tenant: tenantId!,
          });
          return timeSheets.data;
        });

        // Return appropriate response based on format
        if (exportParams.format === 'csv') {
          const csvData = this.convertToCSV(result);
          return new NextResponse(csvData, {
            headers: {
              'Content-Type': 'text/csv',
              'Content-Disposition': 'attachment; filename="time-sheets.csv"'
            }
          });
        } else {
          return createSuccessResponse(result);
        }
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get time sheet statistics
   */
  getStatistics() {
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
          'time_sheet',
          'read',
          db
        );

        if (!hasReadPermission) {
          throw new ForbiddenError('Permission denied: Cannot read time sheet statistics');
        }

        // Get statistics within tenant context
        const stats = await runWithTenant(tenantId!, async () => {
          return await this.timeSheetService.getStatistics({
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

  // Time Period Management

  /**
   * List time periods
   */
  listTimePeriods() {
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
          'time_period',
          'read',
          db
        );

        if (!hasReadPermission) {
          throw new ForbiddenError('Permission denied: Cannot read time periods');
        }

        // Get time periods within tenant context
        const periods = await runWithTenant(tenantId!, async () => {
          return await this.timeSheetService.getTimePeriods({
            userId: user.user_id,
            user,
            tenant: tenantId!,
          });
        });

        return createSuccessResponse(periods);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get time period details
   */
  getTimePeriod() {
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
          'time_period',
          'read',
          db
        );

        if (!hasReadPermission) {
          throw new ForbiddenError('Permission denied: Cannot read time periods');
        }

        // Extract ID from path
        const pathParts = req.url.split('/');
        const id = pathParts[pathParts.length - 1];

        // Get time period within tenant context
        const period = await runWithTenant(tenantId!, async () => {
          return await this.timeSheetService.getTimePeriod(id, {
            userId: user.user_id,
            user,
            tenant: tenantId!,
          });
        });

        if (!period) {
          throw new NotFoundError('Time period not found');
        }

        return createSuccessResponse(period);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Create time period
   */
  createTimePeriod() {
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
          'time_period',
          'create',
          db
        );

        if (!hasCreatePermission) {
          throw new ForbiddenError('Permission denied: Cannot create time periods');
        }

        // Parse and validate request body
        const body = await req.json();
        let periodData;
        try {
          periodData = createTimePeriodSchema.parse(body);
        } catch (error) {
          if (error instanceof ZodError) {
            throw new ValidationError('Invalid time period data', error.errors);
          }
          throw error;
        }

        // Create time period within tenant context
        const period = await runWithTenant(tenantId!, async () => {
          return await this.timeSheetService.createTimePeriod(periodData, {
            userId: user.user_id,
            user,
            tenant: tenantId!,
          });
        });

        return createSuccessResponse(period, 201);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Update time period
   */
  updateTimePeriod() {
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
          'time_period',
          'update',
          db
        );

        if (!hasUpdatePermission) {
          throw new ForbiddenError('Permission denied: Cannot update time periods');
        }

        // Extract ID from path
        const pathParts = req.url.split('/');
        const id = pathParts[pathParts.length - 1];

        // Parse and validate request body
        const body = await req.json();
        let periodData;
        try {
          periodData = updateTimePeriodSchema.parse(body);
        } catch (error) {
          if (error instanceof ZodError) {
            throw new ValidationError('Invalid time period data', error.errors);
          }
          throw error;
        }

        // Update time period within tenant context
        const period = await runWithTenant(tenantId!, async () => {
          return await this.timeSheetService.updateTimePeriod(id, periodData, {
            userId: user.user_id,
            user,
            tenant: tenantId!,
          });
        });

        return createSuccessResponse(period);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Delete time period
   */
  deleteTimePeriod() {
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
          'time_period',
          'delete',
          db
        );

        if (!hasDeletePermission) {
          throw new ForbiddenError('Permission denied: Cannot delete time periods');
        }

        // Extract ID from path
        const pathParts = req.url.split('/');
        const id = pathParts[pathParts.length - 1];

        // Delete time period within tenant context
        await runWithTenant(tenantId!, async () => {
          return await this.timeSheetService.deleteTimePeriod(id, {
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

  /**
   * Generate multiple time periods
   */
  generateTimePeriods() {
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
          'time_period',
          'create',
          db
        );

        if (!hasCreatePermission) {
          throw new ForbiddenError('Permission denied: Cannot create time periods');
        }

        // Parse and validate request body
        const body = await req.json();
        let generateData;
        try {
          generateData = generateTimePeriodsSchema.parse(body);
        } catch (error) {
          if (error instanceof ZodError) {
            throw new ValidationError('Invalid generate data', error.errors);
          }
          throw error;
        }

        // Generate time periods within tenant context
        const periods = await runWithTenant(tenantId!, async () => {
          return await this.timeSheetService.generateTimePeriods(generateData, {
            userId: user.user_id,
            user,
            tenant: tenantId!,
          });
        });

        return createSuccessResponse({
          periods,
          message: `Generated ${periods.length} time periods`
        });
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get time period settings
   */
  getTimePeriodSettings() {
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
          'time_period',
          'read',
          db
        );

        if (!hasReadPermission) {
          throw new ForbiddenError('Permission denied: Cannot read time period settings');
        }

        // Get settings within tenant context
        const settings = await runWithTenant(tenantId!, async () => {
          return await this.timeSheetService.getTimePeriodSettings({
            userId: user.user_id,
            user,
            tenant: tenantId!,
          });
        });

        return createSuccessResponse(settings);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Create time period settings
   */
  createTimePeriodSettings() {
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
        const hasManagePermission = await hasPermission(
          user,
          'time_period',
          'manage',
          db
        );

        if (!hasManagePermission) {
          throw new ForbiddenError('Permission denied: Cannot manage time period settings');
        }

        // Parse and validate request body
        const body = await req.json();
        let settingsData;
        try {
          settingsData = createTimePeriodSettingsSchema.parse(body);
        } catch (error) {
          if (error instanceof ZodError) {
            throw new ValidationError('Invalid settings data', error.errors);
          }
          throw error;
        }

        // Create settings within tenant context
        const settings = await runWithTenant(tenantId!, async () => {
          return await this.timeSheetService.createTimePeriodSettings(settingsData, {
            userId: user.user_id,
            user,
            tenant: tenantId!,
          });
        });

        return createSuccessResponse(settings, 201);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Update time period settings
   */
  updateTimePeriodSettings() {
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
        const hasManagePermission = await hasPermission(
          user,
          'time_period',
          'manage',
          db
        );

        if (!hasManagePermission) {
          throw new ForbiddenError('Permission denied: Cannot manage time period settings');
        }

        // Extract ID from path
        const pathParts = req.url.split('/');
        const id = pathParts[pathParts.length - 1];

        // Parse and validate request body
        const body = await req.json();
        let settingsData;
        try {
          settingsData = updateTimePeriodSettingsSchema.parse(body);
        } catch (error) {
          if (error instanceof ZodError) {
            throw new ValidationError('Invalid settings data', error.errors);
          }
          throw error;
        }

        // Update settings within tenant context
        const settings = await runWithTenant(tenantId!, async () => {
          return await this.timeSheetService.updateTimePeriodSettings(id, settingsData, {
            userId: user.user_id,
            user,
            tenant: tenantId!,
          });
        });

        return createSuccessResponse(settings);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  // Schedule Management

  /**
   * List schedule entries
   */
  listScheduleEntries() {
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
          'schedule',
          'read',
          db
        );

        if (!hasReadPermission) {
          throw new ForbiddenError('Permission denied: Cannot read schedules');
        }

        // Get filter parameters from query string
        const url = new URL(req.url);
        const filters = {
          start_date: url.searchParams.get('start_date') || undefined,
          end_date: url.searchParams.get('end_date') || undefined,
          user_id: url.searchParams.get('user_id') || undefined
        };

        // Get schedule entries within tenant context
        const entries = await runWithTenant(tenantId!, async () => {
          return await this.timeSheetService.getScheduleEntries({
            userId: user.user_id,
            user,
            tenant: tenantId!,
          }, filters);
        });

        return createSuccessResponse(entries);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Create schedule entry
   */
  createScheduleEntry() {
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
          'schedule',
          'create',
          db
        );

        if (!hasCreatePermission) {
          throw new ForbiddenError('Permission denied: Cannot create schedules');
        }

        // Parse and validate request body
        const body = await req.json();
        let scheduleData;
        try {
          scheduleData = createScheduleEntrySchema.parse(body);
        } catch (error) {
          if (error instanceof ZodError) {
            throw new ValidationError('Invalid schedule data', error.errors);
          }
          throw error;
        }

        // Create schedule entry within tenant context
        const entry = await runWithTenant(tenantId!, async () => {
          return await this.timeSheetService.createScheduleEntry(scheduleData, {
            userId: user.user_id,
            user,
            tenant: tenantId!,
          });
        });

        return createSuccessResponse(entry, 201);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Update schedule entry
   */
  updateScheduleEntry() {
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
          'schedule',
          'update',
          db
        );

        if (!hasUpdatePermission) {
          throw new ForbiddenError('Permission denied: Cannot update schedules');
        }

        // Extract ID from path
        const pathParts = req.url.split('/');
        const id = pathParts[pathParts.length - 1];

        // Parse and validate request body
        const body = await req.json();
        let scheduleData;
        try {
          scheduleData = updateScheduleEntrySchema.parse(body);
        } catch (error) {
          if (error instanceof ZodError) {
            throw new ValidationError('Invalid schedule data', error.errors);
          }
          throw error;
        }

        // Update schedule entry within tenant context
        const entry = await runWithTenant(tenantId!, async () => {
          return await this.timeSheetService.updateScheduleEntry(id, scheduleData, {
            userId: user.user_id,
            user,
            tenant: tenantId!,
          });
        });

        return createSuccessResponse(entry);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Delete schedule entry
   */
  deleteScheduleEntry() {
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
          'schedule',
          'delete',
          db
        );

        if (!hasDeletePermission) {
          throw new ForbiddenError('Permission denied: Cannot delete schedules');
        }

        // Extract ID from path
        const pathParts = req.url.split('/');
        const id = pathParts[pathParts.length - 1];

        // Delete schedule entry within tenant context
        await runWithTenant(tenantId!, async () => {
          return await this.timeSheetService.deleteScheduleEntry(id, {
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

  // Helper method to convert data to CSV
  private convertToCSV(data: any[]): string {
    if (data.length === 0) return '';
    
    const headers = Object.keys(data[0]);
    const csvHeaders = headers.join(',');
    const csvRows = data.map(row => 
      headers.map(header => {
        const value = row[header];
        // Escape quotes and wrap in quotes if contains comma
        if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      }).join(',')
    );
    
    return [csvHeaders, ...csvRows].join('\n');
  }
}
