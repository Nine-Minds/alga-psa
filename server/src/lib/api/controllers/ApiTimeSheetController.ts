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
  createScheduleEntrySchema,
  updateScheduleEntrySchema,
  scheduleEntryListQuerySchema,
  scheduleEntrySearchQuerySchema,
  calendarListQuerySchema
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
  assertInternalApiUser,
  AuthenticatedApiRequest,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  createSuccessResponse,
  createPaginatedResponse,
  handleApiError
} from '../middleware/apiMiddleware';
import {
  canAssignUser,
  evaluateEntryAccess,
  resolveCalendarAccess,
} from '@alga-psa/scheduling/lib/calendarAccess';
import { ZodError } from 'zod';
import { uuidSchema } from '../schemas/common';

export class ApiTimeSheetController extends ApiBaseController {
  private timeSheetService: TimeSheetService;

  /**
   * Shared-calendar access for the caller, resolved exactly as the schedule server actions do
   * (user_schedule:update is the global escalation, not a prerequisite).
   */
  private async resolveScheduleAccess(user: any, tenantId: string, db: any) {
    const canUpdateGlobally = await hasPermission(user, 'user_schedule', 'update', db);
    return resolveCalendarAccess(db, tenantId, user, canUpdateGlobally);
  }

  private async assertManualProductAccess(
    req: NextRequest,
    keyRecord: { user_id: string; tenant: string; api_key_id?: string },
    user: AuthenticatedApiRequest['context']['user'],
  ): Promise<AuthenticatedApiRequest> {
    const apiRequest = req as AuthenticatedApiRequest;
    apiRequest.context = {
      userId: keyRecord.user_id,
      tenant: keyRecord.tenant,
      user,
      apiKeyId: keyRecord.api_key_id,
    };
    await this.assertProductApiAccess(apiRequest);
    return apiRequest;
  }

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

        assertInternalApiUser(user);

        await this.assertManualProductAccess(req, keyRecord, user);

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
   * Get the time entries of one time sheet (GET /time-sheets/{id}/entries)
   */
  // LEVERAGE: pattern api-controller-auth-preamble — same auth/tenant/permission sequence as getWithDetails()
  getEntries() {
    return this.perSheetRead((id, ctx) => this.timeSheetService.getTimeSheetEntries(id, ctx));
  }

  /**
   * Get the summary of one time sheet (GET /time-sheets/{id}/summary)
   */
  // LEVERAGE: pattern api-controller-auth-preamble — same auth/tenant/permission sequence as getWithDetails()
  getSummary() {
    return this.perSheetRead((id, ctx) => this.timeSheetService.getTimeSheetSummary(id, ctx));
  }

  /**
   * Shared read for /time-sheets/{id}/<sub-resource>: authenticates, checks
   * time_sheet:read, takes the id from route params (never the last URL
   * segment, which is the sub-resource name), 404s unknown or other-tenant
   * sheets via getById(), then runs the reader.
   */
  private perSheetRead(
    reader: (id: string, ctx: { userId: string; user: any; tenant: string }) => Promise<unknown>
  ) {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiKey = req.headers.get('x-api-key');

        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

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

        const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

        assertInternalApiUser(user);

        await this.assertManualProductAccess(req, keyRecord, user);

        const db = await getConnection(tenantId!);
        const hasReadPermission = await hasPermission(user, 'time_sheet', 'read', db);

        if (!hasReadPermission) {
          throw new ForbiddenError('Permission denied: Cannot read time sheets');
        }

        const params = await (req as any).params;
        const parsedId = uuidSchema.safeParse(params?.id);
        if (!parsedId.success) {
          throw new ValidationError('Invalid time sheet id', parsedId.error.issues);
        }
        const id = parsedId.data;

        const ctx = { userId: user.user_id, user, tenant: tenantId! };
        const result = await runWithTenant(tenantId!, async () => {
          const timeSheet = await this.timeSheetService.getById(id, ctx);
          if (!timeSheet) {
            return null;
          }
          return { data: await reader(id, ctx) };
        });

        if (!result) {
          throw new NotFoundError('Time sheet not found');
        }

        return createSuccessResponse(result.data);
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

        assertInternalApiUser(user);

        await this.assertManualProductAccess(req, keyRecord, user);

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
            throw new ValidationError('Invalid submit data', error.issues);
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

        assertInternalApiUser(user);

        await this.assertManualProductAccess(req, keyRecord, user);

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
            throw new ValidationError('Invalid approve data', error.issues);
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

        assertInternalApiUser(user);

        await this.assertManualProductAccess(req, keyRecord, user);

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
            throw new ValidationError('Invalid request changes data', error.issues);
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

        assertInternalApiUser(user);

        await this.assertManualProductAccess(req, keyRecord, user);

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
            throw new ValidationError('Invalid reverse approval data', error.issues);
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

        assertInternalApiUser(user);

        await this.assertManualProductAccess(req, keyRecord, user);

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
            throw new ValidationError('Invalid bulk approve data', error.issues);
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

        assertInternalApiUser(user);

        await this.assertManualProductAccess(req, keyRecord, user);

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

        assertInternalApiUser(user);

        await this.assertManualProductAccess(req, keyRecord, user);

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
            throw new ValidationError('Invalid comment data', error.issues);
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

        assertInternalApiUser(user);

        await this.assertManualProductAccess(req, keyRecord, user);

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
        // Repeated array params (?user_ids=a&user_ids=b) collapse under
        // Object.fromEntries, so collect them explicitly; the schema also
        // splits comma-separated values.
        const queryParams: Record<string, string | string[]> = {};
        for (const key of new Set(url.searchParams.keys())) {
          const values = url.searchParams.getAll(key);
          queryParams[key] = values.length > 1 ? values : values[0];
        }

        let searchParams;
        try {
          searchParams = timeSheetSearchSchema.parse(queryParams);
        } catch (error) {
          if (error instanceof ZodError) {
            throw new ValidationError('Invalid search parameters', error.issues);
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

        assertInternalApiUser(user);

        await this.assertManualProductAccess(req, keyRecord, user);

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
            throw new ValidationError('Invalid export parameters', error.issues);
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

        assertInternalApiUser(user);

        await this.assertManualProductAccess(req, keyRecord, user);

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

        assertInternalApiUser(user);

        await this.assertManualProductAccess(req, keyRecord, user);

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

        assertInternalApiUser(user);

        await this.assertManualProductAccess(req, keyRecord, user);

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
   * Get current time period
   */
  getCurrentTimePeriod() {
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

        assertInternalApiUser(user);

        await this.assertManualProductAccess(req, keyRecord, user);

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

        // Optional reference date (defaults to today in UTC)
        const url = new URL(req.url);
        const date = url.searchParams.get('date') || undefined;

        if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          throw new ValidationError('Invalid date format, expected YYYY-MM-DD');
        }

        // Get current time period within tenant context
        const period = await runWithTenant(tenantId!, async () => {
          return await this.timeSheetService.getCurrentTimePeriod({
            userId: user.user_id,
            user,
            tenant: tenantId!,
          }, date);
        });

        if (!period) {
          throw new NotFoundError('No current time period');
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

        assertInternalApiUser(user);

        await this.assertManualProductAccess(req, keyRecord, user);

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
            throw new ValidationError('Invalid time period data', error.issues);
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

        assertInternalApiUser(user);

        await this.assertManualProductAccess(req, keyRecord, user);

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
            throw new ValidationError('Invalid time period data', error.issues);
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

  // LEVERAGE: pattern api-key-auth-preamble — every method in this controller repeats the same API-key, tenant,
  // user and RBAC preamble (~25 copies); closeTimePeriod/reopenTimePeriod add two more. Extract a shared layer.
  /**
   * Close time period (sets is_closed = true; idempotent)
   */
  closeTimePeriod() {
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

        assertInternalApiUser(user);

        await this.assertManualProductAccess(req, keyRecord, user);

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasUpdatePermission = await hasPermission(
          user,
          'time_period',
          'update',
          db
        );

        if (!hasUpdatePermission) {
          throw new ForbiddenError('Permission denied: Cannot close time periods');
        }

        // The last URL segment is "close" here, so the id must come from the route params
        const { id: rawId } = await (req as any).params;
        const idResult = uuidSchema.safeParse(rawId);
        if (!idResult.success) {
          throw new ValidationError('Invalid time period id', idResult.error.issues);
        }
        const id = idResult.data;

        // No request body is read
        const period = await runWithTenant(tenantId!, async () => {
          return await this.timeSheetService.closeTimePeriod(id, {
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
   * Reopen time period (sets is_closed = false; idempotent)
   */
  reopenTimePeriod() {
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

        assertInternalApiUser(user);

        await this.assertManualProductAccess(req, keyRecord, user);

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasUpdatePermission = await hasPermission(
          user,
          'time_period',
          'update',
          db
        );

        if (!hasUpdatePermission) {
          throw new ForbiddenError('Permission denied: Cannot reopen time periods');
        }

        // The last URL segment is "reopen" here, so the id must come from the route params
        const { id: rawId } = await (req as any).params;
        const idResult = uuidSchema.safeParse(rawId);
        if (!idResult.success) {
          throw new ValidationError('Invalid time period id', idResult.error.issues);
        }
        const id = idResult.data;

        // No request body is read
        const period = await runWithTenant(tenantId!, async () => {
          return await this.timeSheetService.reopenTimePeriod(id, {
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

        assertInternalApiUser(user);

        await this.assertManualProductAccess(req, keyRecord, user);

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

        assertInternalApiUser(user);

        await this.assertManualProductAccess(req, keyRecord, user);

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

        assertInternalApiUser(user);

        await this.assertManualProductAccess(req, keyRecord, user);

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
            throw new ValidationError('Invalid settings data', error.issues);
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

        assertInternalApiUser(user);

        await this.assertManualProductAccess(req, keyRecord, user);

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
            throw new ValidationError('Invalid settings data', error.issues);
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
   * Search schedule entries (GET /api/v1/schedules/search): same auth,
   * permission and visibility path as listScheduleEntries(), but paginated.
   */
  searchScheduleEntries() {
    return this.listScheduleEntries({ paginate: true });
  }

  /**
   * List schedule entries (GET /api/v1/schedules). Unpaginated unless
   * `paginate` is set: shipped mobile clients read the whole result set.
   */
  listScheduleEntries(options: { paginate?: boolean } = {}) {
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

        assertInternalApiUser(user);

        await this.assertManualProductAccess(req, keyRecord, user);

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasReadPermission = await hasPermission(
          user,
          'user_schedule',
          'read',
          db
        );

        if (!hasReadPermission) {
          throw new ForbiddenError('Permission denied: Cannot read schedules');
        }

        // Get filter parameters from query string. Visibility (own, shared
        // and group calendars, or everything for user_schedule:update) is
        // enforced by the service through the shared-calendar resolver, so
        // any user_id may be requested; unshared calendars simply return none.
        const url = new URL(req.url);
        const rawQuery = Object.fromEntries(url.searchParams.entries());
        const parseQuery = <T>(schema: { parse(v: unknown): T }): T => {
          try {
            return schema.parse(rawQuery);
          } catch (error) {
            if (error instanceof ZodError) {
              throw new ValidationError('Invalid schedule query parameters', error.issues);
            }
            throw error;
          }
        };
        const serviceContext = { userId: user.user_id, user, tenant: tenantId! };

        if (!options.paginate) {
          const { filters } = parseQuery(scheduleEntryListQuerySchema);
          const entries = await runWithTenant(tenantId!, async () => {
            return await this.timeSheetService.getScheduleEntries(serviceContext, filters);
          });
          return createSuccessResponse(entries);
        }

        const { page, limit, filters } = parseQuery(scheduleEntrySearchQuerySchema);

        // Paginated after visibility is resolved, so total excludes hidden entries.
        // LEVERAGE: pattern paginated-list-outside-base — ApiBaseController.list() paginates via service.list(); schedule entries need a bespoke paged service method.
        const result = await runWithTenant(tenantId!, async () => {
          return await this.timeSheetService.getScheduleEntriesPage(
            serviceContext, filters, { page, limit });
        });

        return createPaginatedResponse(result.data, result.total, page, limit, undefined, req);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * List the calendars the caller can see (GET /api/v1/calendars).
   * Floor is user_schedule:read; visibility comes from resolveCalendarAccess via the service.
   */
  listCalendars() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        const apiKey = req.headers.get('x-api-key');
        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

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

        const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);
        assertInternalApiUser(user);
        await this.assertManualProductAccess(req, keyRecord, user);

        const db = await getConnection(tenantId!);
        const canRead = await hasPermission(user, 'user_schedule', 'read', db);
        if (!canRead) {
          throw new ForbiddenError('Permission denied: Cannot read schedules');
        }

        const url = new URL(req.url);
        let query;
        try {
          query = calendarListQuerySchema.parse({
            type: url.searchParams.get('type') || undefined,
            include_archived: url.searchParams.get('include_archived') || undefined,
          });
        } catch (error) {
          if (error instanceof ZodError) {
            throw new ValidationError('Invalid query parameters', error.issues);
          }
          throw error;
        }

        const calendars = await runWithTenant(tenantId!, async () => {
          return await this.timeSheetService.listCalendars(
            { userId: user.user_id, user, tenant: tenantId! },
            query
          );
        });

        return createSuccessResponse(calendars);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }

  /**
   * Get schedule entry by ID
   * Overrides the base getById, which is only routed for /api/v1/schedules/[id]
   */
  getById() {
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

        assertInternalApiUser(user);

        await this.assertManualProductAccess(req, keyRecord, user);

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasReadPermission = await hasPermission(
          user,
          'user_schedule',
          'read',
          db
        );

        if (!hasReadPermission) {
          throw new ForbiddenError('Permission denied: Cannot read schedules');
        }

        // Extract ID from path
        const pathParts = new URL(req.url).pathname.split('/');
        const id = pathParts[pathParts.length - 1];

        const entry = await runWithTenant(tenantId!, async () => {
          return await this.timeSheetService.getScheduleEntry(id, {
            userId: user.user_id,
            user,
            tenant: tenantId!,
          });
        });

        // The service applies the shared-calendar resolver: entries the
        // viewer may not see come back null, Busy-level ones come back masked.
        if (!entry) {
          throw new NotFoundError('Schedule entry not found');
        }

        return createSuccessResponse(entry);
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

        assertInternalApiUser(user);

        await this.assertManualProductAccess(req, keyRecord, user);

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasReadPermission = await hasPermission(
          user,
          'user_schedule',
          'read',
          db
        );

        if (!hasReadPermission) {
          throw new ForbiddenError('Permission denied: Cannot create schedules');
        }

        // Parse and validate request body
        const body = await req.json();
        let scheduleData;
        try {
          scheduleData = createScheduleEntrySchema.parse(body);
        } catch (error) {
          if (error instanceof ZodError) {
            throw new ValidationError('Invalid schedule data', error.issues);
          }
          throw error;
        }

        // Same rule as addScheduleEntry: self, user_schedule:update, or an edit share on the
        // assignee's personal calendar. TimeSheetService re-checks this for group calendars.
        const assignedIds: string[] = scheduleData.assigned_user_ids || [];
        if (assignedIds.length > 0) {
          const access = await this.resolveScheduleAccess(user, tenantId!, db);
          if (assignedIds.some((assignedId) => !canAssignUser(assignedId, access))) {
            throw new ForbiddenError('Permission denied: Cannot assign schedules to other users');
          }
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

        assertInternalApiUser(user);

        await this.assertManualProductAccess(req, keyRecord, user);

        // Check permissions
        const db = await getConnection(tenantId!);
        const canReadSchedule = await hasPermission(user, 'user_schedule', 'read', db);
        if (!canReadSchedule) {
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
            throw new ValidationError('Invalid schedule data', error.issues);
          }
          throw error;
        }

        const existing = await runWithTenant(tenantId!, async () => {
          return await this.timeSheetService.getScheduleEntryForAccess(id, {
            userId: user.user_id,
            user,
            tenant: tenantId!,
          });
        });

        if (!existing) {
          throw new NotFoundError('Schedule entry not found');
        }

        // Same rule as the updateScheduleEntry server action.
        const isOwnEntry =
          existing.assigned_user_ids.length === 1 && existing.assigned_user_ids[0] === user.user_id;
        if (existing.is_private && !existing.calendar_id && !isOwnEntry) {
          throw new ForbiddenError('Permission denied: Cannot update a private schedule entry');
        }

        // LEVERAGE: pattern rest-calendar-access — resolve + evaluateEntryAccess block repeated in update/delete (and the service)
        const access = await this.resolveScheduleAccess(user, tenantId!, db);
        const decision = evaluateEntryAccess(existing, access);
        if (decision.access === 'none') {
          throw new NotFoundError('Schedule entry not found');
        }
        if (!decision.canEdit) {
          throw new ForbiddenError('Permission denied: Cannot update this schedule entry');
        }

        if (scheduleData.assigned_user_ids) {
          const addedAssignees = scheduleData.assigned_user_ids.filter(
            (assignedId: string) => !existing.assigned_user_ids.includes(assignedId)
          );
          if (addedAssignees.some((assignedId: string) => !canAssignUser(assignedId, access))) {
            throw new ForbiddenError('Permission denied: Cannot assign schedules to other users');
          }
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

        assertInternalApiUser(user);

        await this.assertManualProductAccess(req, keyRecord, user);

        // Check permissions
        const db = await getConnection(tenantId!);

        // Read is the floor, as in the deleteScheduleEntry server action.
        if (!await hasPermission(user, 'user_schedule', 'read', db)) {
          throw new ForbiddenError('Permission denied: Cannot delete schedules');
        }

        // Extract ID from path
        const pathParts = req.url.split('/');
        const id = pathParts[pathParts.length - 1];

        const existing = await runWithTenant(tenantId!, async () => {
          return await this.timeSheetService.getScheduleEntryForAccess(id, {
            userId: user.user_id,
            user,
            tenant: tenantId!,
          });
        });

        if (!existing) {
          throw new NotFoundError('Schedule entry not found');
        }

        // Same rule as the deleteScheduleEntry server action. Note: the action checks plain
        // is_private here (not `&& !calendar_id` as update does); mirrored as written.
        const isOwnEntry =
          existing.assigned_user_ids.length === 1 && existing.assigned_user_ids[0] === user.user_id;
        if (existing.is_private && !isOwnEntry) {
          throw new ForbiddenError('Permission denied: Cannot delete a private schedule entry');
        }

        // LEVERAGE: pattern rest-calendar-access — resolve + evaluateEntryAccess block repeated in update/delete (and the service)
        const access = await this.resolveScheduleAccess(user, tenantId!, db);
        const decision = evaluateEntryAccess(existing, access);
        if (decision.access === 'none') {
          throw new NotFoundError('Schedule entry not found');
        }
        if (!decision.canEdit) {
          throw new ForbiddenError('Permission denied: Cannot delete this schedule entry');
        }

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
