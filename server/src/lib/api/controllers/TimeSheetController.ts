/**
 * Time Sheet API Controller
 * Handles HTTP requests for time sheet-related operations
 */

import { NextRequest, NextResponse } from 'next/server';
import { BaseController } from './BaseController';
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
import { z } from 'zod';
import { compose } from '../middleware/compose';
import { withAuth } from '../middleware/apiMiddleware';
import { withPermission } from '../middleware/permissionMiddleware';
import { withValidation } from '../middleware/validationMiddleware';
import { createApiResponse, createErrorResponse } from '../utils/response';
import { getHateoasLinks } from '../utils/hateoas';

export class TimeSheetController extends BaseController {
  private timeSheetService: TimeSheetService;

  constructor() {
    super(null as any, null as any);
    this.timeSheetService = new TimeSheetService(null as any);
  }

  /**
   * GET /api/v1/time-sheets - List time sheets
   */
  list() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_sheet', 'read') as any as any,
      withValidation(timeSheetListQuerySchema, 'query') as any
    );

    return middleware(async (req: NextRequest) => {
      const query = Object.fromEntries(new URL(req.url).searchParams.entries());
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const { page, limit, sort, order, ...filters } = query;
      const listOptions = { 
        page: page ? parseInt(page) : undefined, 
        limit: limit ? parseInt(limit) : undefined, 
        sort, 
        order: order as 'asc' | 'desc' | undefined
      };
      
      const result = await this.timeSheetService.list(listOptions, context, filters);
      
      // Add HATEOAS links to each time sheet
      const timeSheetsWithLinks = result.data.map(timeSheet => ({
        ...timeSheet,
        _links: getHateoasLinks('time-sheet', timeSheet.id)
      }));

      const response = createApiResponse({
        data: timeSheetsWithLinks,
        pagination: {
          page: parseInt(page as string) || 1,
          limit: parseInt(limit as string) || 25,
          total: result.total,
          totalPages: Math.ceil(result.total / (parseInt(limit as string) || 25))
        },
        _links: {
          self: { href: `/api/v1/time-sheets` },
          create: { href: `/api/v1/time-sheets`, method: 'POST' },
          search: { href: `/api/v1/time-sheets/search` },
          export: { href: `/api/v1/time-sheets/export` },
          stats: { href: `/api/v1/time-sheets/stats` },
          periods: { href: `/api/v1/time-periods` }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * GET /api/v1/time-sheets/{id} - Get time sheet details
   */
  getById() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_sheet', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const timeSheet = await this.timeSheetService.getWithDetails(id, context);
      
      if (!timeSheet) {
        return createErrorResponse('Time sheet not found', 404);
      }

      const response = createApiResponse({
        data: {
          ...timeSheet,
          _links: {
            ...getHateoasLinks('time-sheet', timeSheet.id),
            submit: timeSheet.approval_status === 'DRAFT' || timeSheet.approval_status === 'CHANGES_REQUESTED' 
              ? { href: `/api/v1/time-sheets/${id}/submit`, method: 'POST' } 
              : undefined,
            approve: timeSheet.approval_status === 'SUBMITTED' 
              ? { href: `/api/v1/time-sheets/${id}/approve`, method: 'POST' } 
              : undefined,
            'request-changes': timeSheet.approval_status === 'SUBMITTED' 
              ? { href: `/api/v1/time-sheets/${id}/request-changes`, method: 'POST' } 
              : undefined,
            'reverse-approval': timeSheet.approval_status === 'APPROVED' 
              ? { href: `/api/v1/time-sheets/${id}/reverse-approval`, method: 'POST' } 
              : undefined,
            comments: { href: `/api/v1/time-sheets/${id}/comments` }
          }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/time-sheets - Create new time sheet
   */
  create() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_sheet', 'create') as any,
      withValidation(createTimeSheetSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const timeSheet = await this.timeSheetService.create(data, context);
      
      const response = createApiResponse({
        data: {
          ...timeSheet,
          _links: getHateoasLinks('time-sheet', timeSheet.id)
        }
      }, 201);

      return NextResponse.json(response);
    });
  }

  /**
   * PUT /api/v1/time-sheets/{id} - Update time sheet
   */
  update() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_sheet', 'update') as any,
      withValidation(updateTimeSheetSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const timeSheet = await this.timeSheetService.update(id, data, context);
      
      const response = createApiResponse({
        data: {
          ...timeSheet,
          _links: getHateoasLinks('time-sheet', timeSheet.id)
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * DELETE /api/v1/time-sheets/{id} - Delete time sheet
   */
  delete() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_sheet', 'delete') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      await this.timeSheetService.delete(id, context);
      
      return NextResponse.json(createApiResponse(null, 204));
    });
  }

  /**
   * POST /api/v1/time-sheets/{id}/submit - Submit time sheet for approval
   */
  submit() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_sheet', 'update') as any,
      withValidation(submitTimeSheetSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const timeSheet = await this.timeSheetService.submitTimeSheet(id, data, context);
      
      const response = createApiResponse({
        data: {
          ...timeSheet,
          _links: getHateoasLinks('time-sheet', timeSheet.id)
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/time-sheets/{id}/approve - Approve time sheet
   */
  approve() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_sheet', 'approve') as any,
      withValidation(approveTimeSheetSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const timeSheet = await this.timeSheetService.approveTimeSheet(id, data, context);
      
      const response = createApiResponse({
        data: {
          ...timeSheet,
          _links: getHateoasLinks('time-sheet', timeSheet.id)
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/time-sheets/{id}/request-changes - Request changes to time sheet
   */
  requestChanges() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_sheet', 'approve') as any,
      withValidation(requestChangesTimeSheetSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const timeSheet = await this.timeSheetService.requestChanges(id, data, context);
      
      const response = createApiResponse({
        data: {
          ...timeSheet,
          _links: getHateoasLinks('time-sheet', timeSheet.id)
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/time-sheets/{id}/reverse-approval - Reverse time sheet approval
   */
  reverseApproval() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_sheet', 'manage') as any,
      withValidation(reverseApprovalSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const timeSheet = await this.timeSheetService.reverseApproval(id, data, context);
      
      const response = createApiResponse({
        data: {
          ...timeSheet,
          _links: getHateoasLinks('time-sheet', timeSheet.id)
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/time-sheets/bulk-approve - Bulk approve time sheets
   */
  bulkApprove() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_sheet', 'approve') as any,
      withValidation(bulkApproveTimeSheetSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const results = await this.timeSheetService.bulkApprove(data, context);
      
      const response = createApiResponse({
        data: results,
        message: `Processed ${results.length} time sheet approvals`
      });

      return NextResponse.json(response);
    });
  }

  /**
   * GET /api/v1/time-sheets/{id}/comments - Get time sheet comments
   */
  getComments() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_sheet', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const comments = await this.timeSheetService.getTimeSheetComments(id, context);
      
      const response = createApiResponse({
        data: comments,
        _links: {
          self: { href: `/api/v1/time-sheets/${id}/comments` },
          create: { href: `/api/v1/time-sheets/${id}/comments`, method: 'POST' },
          parent: { href: `/api/v1/time-sheets/${id}` }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/time-sheets/{id}/comments - Add comment to time sheet
   */
  addComment() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_sheet', 'update') as any,
      withValidation(createTimeSheetCommentSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const comment = await this.timeSheetService.addComment(id, data, context);
      
      const response = createApiResponse({ data: comment }, 201);
      return NextResponse.json(response);
    });
  }

  /**
   * GET /api/v1/time-sheets/search - Search time sheets
   */
  search() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_sheet', 'read') as any as any,
      withValidation(timeSheetSearchSchema, 'query') as any
    );

    return middleware(async (req: NextRequest) => {
      const query = Object.fromEntries(new URL(req.url).searchParams.entries());
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const timeSheets = await this.timeSheetService.search(query as any, context);
      
      const timeSheetsWithLinks = timeSheets.map(timeSheet => ({
        ...timeSheet,
        _links: getHateoasLinks('time-sheet', timeSheet.id)
      }));

      const response = createApiResponse({
        data: timeSheetsWithLinks,
        _links: {
          self: { href: `/api/v1/time-sheets/search` }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * GET /api/v1/time-sheets/export - Export time sheets
   */
  export() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_sheet', 'read') as any as any,
      withValidation(timeSheetExportQuerySchema, 'query') as any
    );

    return middleware(async (req: NextRequest) => {
      const query = Object.fromEntries(new URL(req.url).searchParams.entries());
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      // For now, just return the time sheets as JSON
      // In a real implementation, you'd generate CSV/Excel based on format
      const timeSheets = await this.timeSheetService.list({}, context);
      
      if (query.format === 'csv') {
        // Convert to CSV format
        const csvData = this.convertToCSV(timeSheets.data);
        return new NextResponse(csvData, {
          headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': 'attachment; filename=time-sheets.csv'
          }
        });
      }

      return NextResponse.json(createApiResponse({ data: timeSheets.data }));
    });
  }

  /**
   * GET /api/v1/time-sheets/stats - Get time sheet statistics
   */
  getStatistics() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_sheet', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const stats = await this.timeSheetService.getStatistics(context);
      
      const response = createApiResponse({
        data: stats,
        _links: {
          self: { href: `/api/v1/time-sheets/stats` },
          'time-sheets': { href: `/api/v1/time-sheets` }
        }
      });

      return NextResponse.json(response);
    });
  }

  // Time Period Management

  /**
   * GET /api/v1/time-periods - List time periods
   */
  listTimePeriods() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_period', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const periods = await this.timeSheetService.getTimePeriods(context);
      
      const response = createApiResponse({
        data: periods,
        _links: {
          self: { href: `/api/v1/time-periods` },
          create: { href: `/api/v1/time-periods`, method: 'POST' },
          generate: { href: `/api/v1/time-periods/generate`, method: 'POST' },
          settings: { href: `/api/v1/time-periods/settings` }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * GET /api/v1/time-periods/{id} - Get time period details
   */
  getTimePeriod() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_period', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const period = await this.timeSheetService.getTimePeriod(id, context);
      
      if (!period) {
        return createErrorResponse('Time period not found', 404);
      }

      const response = createApiResponse({ data: period });
      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/time-periods - Create time period
   */
  createTimePeriod() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_period', 'create') as any,
      withValidation(createTimePeriodSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const period = await this.timeSheetService.createTimePeriod(data, context);
      
      const response = createApiResponse({ data: period }, 201);
      return NextResponse.json(response);
    });
  }

  /**
   * PUT /api/v1/time-periods/{id} - Update time period
   */
  updateTimePeriod() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_period', 'update') as any,
      withValidation(updateTimePeriodSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const period = await this.timeSheetService.updateTimePeriod(id, data, context);
      
      const response = createApiResponse({ data: period });
      return NextResponse.json(response);
    });
  }

  /**
   * DELETE /api/v1/time-periods/{id} - Delete time period
   */
  deleteTimePeriod() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_period', 'delete') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      await this.timeSheetService.deleteTimePeriod(id, context);
      
      return NextResponse.json(createApiResponse(null, 204));
    });
  }

  /**
   * POST /api/v1/time-periods/generate - Generate multiple time periods
   */
  generateTimePeriods() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_period', 'create') as any,
      withValidation(generateTimePeriodsSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const periods = await this.timeSheetService.generateTimePeriods(data, context);
      
      const response = createApiResponse({
        data: periods,
        message: `Generated ${periods.length} time periods`
      });

      return NextResponse.json(response);
    });
  }

  /**
   * GET /api/v1/time-periods/settings - Get time period settings
   */
  getTimePeriodSettings() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_period', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const settings = await this.timeSheetService.getTimePeriodSettings(context);
      
      const response = createApiResponse({
        data: settings,
        _links: {
          self: { href: `/api/v1/time-periods/settings` },
          create: { href: `/api/v1/time-periods/settings`, method: 'POST' }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/time-periods/settings - Create time period settings
   */
  createTimePeriodSettings() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_period', 'manage') as any,
      withValidation(createTimePeriodSettingsSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const settings = await this.timeSheetService.createTimePeriodSettings(data, context);
      
      const response = createApiResponse({ data: settings }, 201);
      return NextResponse.json(response);
    });
  }

  /**
   * PUT /api/v1/time-periods/settings/{id} - Update time period settings
   */
  updateTimePeriodSettings() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_period', 'manage') as any,
      withValidation(updateTimePeriodSettingsSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const settings = await this.timeSheetService.updateTimePeriodSettings(id, data, context);
      
      const response = createApiResponse({ data: settings });
      return NextResponse.json(response);
    });
  }

  // Schedule Management

  /**
   * GET /api/v1/schedules - List schedule entries
   */
  listScheduleEntries() {
    const middleware = compose(
      withAuth as any,
      withPermission('schedule', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      // Get filter parameters from query string
      const url = new URL(req.url);
      const filters = {
        start_date: url.searchParams.get('start_date') || undefined,
        end_date: url.searchParams.get('end_date') || undefined,
        user_id: url.searchParams.get('user_id') || undefined
      };
      
      const entries = await this.timeSheetService.getScheduleEntries(context, filters);
      
      const response = createApiResponse({
        data: entries,
        _links: {
          self: { href: `/api/v1/schedules` },
          create: { href: `/api/v1/schedules`, method: 'POST' }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/schedules - Create schedule entry
   */
  createScheduleEntry() {
    const middleware = compose(
      withAuth as any,
      withPermission('schedule', 'create') as any,
      withValidation(createScheduleEntrySchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const entry = await this.timeSheetService.createScheduleEntry(data, context);
      
      const response = createApiResponse({ data: entry }, 201);
      return NextResponse.json(response);
    });
  }

  /**
   * PUT /api/v1/schedules/{id} - Update schedule entry
   */
  updateScheduleEntry() {
    const middleware = compose(
      withAuth as any,
      withPermission('schedule', 'update') as any,
      withValidation(updateScheduleEntrySchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const entry = await this.timeSheetService.updateScheduleEntry(id, data, context);
      
      const response = createApiResponse({ data: entry });
      return NextResponse.json(response);
    });
  }

  /**
   * DELETE /api/v1/schedules/{id} - Delete schedule entry
   */
  deleteScheduleEntry() {
    const middleware = compose(
      withAuth as any,
      withPermission('schedule', 'delete') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      await this.timeSheetService.deleteScheduleEntry(id, context);
      
      return NextResponse.json(createApiResponse(null, 204));
    });
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