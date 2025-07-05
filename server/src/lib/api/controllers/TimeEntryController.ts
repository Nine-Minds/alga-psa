/**
 * Time Entry API Controller
 * Handles HTTP requests for time entry-related operations
 */

import { NextRequest, NextResponse } from 'next/server';
import { BaseController } from './BaseController';
import { TimeEntryService } from '../services/TimeEntryService';
import { 
  createTimeEntrySchema,
  updateTimeEntrySchema,
  timeEntryListQuerySchema,
  bulkTimeEntrySchema,
  bulkUpdateTimeEntrySchema,
  bulkDeleteTimeEntrySchema,
  createTimeTemplateSchema,
  timeEntrySearchSchema,
  timeEntryExportQuerySchema,
  startTimeTrackingSchema,
  stopTimeTrackingSchema,
  approveTimeEntriesSchema,
  requestTimeEntryChangesSchema
} from '../schemas/timeEntry';
import { z } from 'zod';
import { compose } from '../middleware/compose';
import { withAuth } from '../middleware/apiMiddleware';
import { withPermission } from '../middleware/permissionMiddleware';
import { withValidation } from '../middleware/validationMiddleware';
import { createApiResponse, createErrorResponse } from '../utils/response';
import { getHateoasLinks } from '../utils/hateoas';

export class TimeEntryController extends BaseController {
  private timeEntryService: TimeEntryService;

  constructor() {
    super(null as any, null as any);
    this.timeEntryService = new TimeEntryService();
  }

  /**
   * GET /api/v1/time-entries - List time entries
   */
  list() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_entry', 'read') as any as any,
      withValidation(timeEntryListQuerySchema, 'query') as any
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
      
      const result = await this.timeEntryService.list({ ...listOptions, filters }, context);
      
      // Add HATEOAS links to each time entry
      const entriesWithLinks = result.data.map(entry => ({
        ...entry,
        _links: getHateoasLinks('time-entry', entry.entry_id)
      }));

      const response = createApiResponse({
        data: entriesWithLinks,
        pagination: {
          page: parseInt(page as string) || 1,
          limit: parseInt(limit as string) || 25,
          total: result.total,
          totalPages: Math.ceil(result.total / (parseInt(limit as string) || 25))
        },
        _links: {
          self: { href: `/api/v1/time-entries` },
          create: { href: `/api/v1/time-entries`, method: 'POST' },
          search: { href: `/api/v1/time-entries/search` },
          export: { href: `/api/v1/time-entries/export` },
          stats: { href: `/api/v1/time-entries/stats` },
          'start-tracking': { href: `/api/v1/time-entries/start-tracking`, method: 'POST' },
          'active-session': { href: `/api/v1/time-entries/active-session` },
          templates: { href: `/api/v1/time-entries/templates` }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * GET /api/v1/time-entries/{id} - Get time entry details
   */
  getById() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_entry', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const timeEntry = await this.timeEntryService.getWithDetails(id, context);
      
      if (!timeEntry) {
        return createErrorResponse('Time entry not found', 404);
      }

      const response = createApiResponse({
        data: {
          ...timeEntry,
          _links: getHateoasLinks('time-entry', timeEntry.entry_id)
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/time-entries - Create new time entry
   */
  create() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_entry', 'create') as any,
      withValidation(createTimeEntrySchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const timeEntry = await this.timeEntryService.create(data, context);
      
      const response = createApiResponse({
        data: {
          ...timeEntry,
          _links: getHateoasLinks('time-entry', timeEntry.entry_id)
        }
      }, 201);

      return NextResponse.json(response);
    });
  }

  /**
   * PUT /api/v1/time-entries/{id} - Update time entry
   */
  update() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_entry', 'update') as any,
      withValidation(updateTimeEntrySchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const timeEntry = await this.timeEntryService.update(id, data, context);
      
      const response = createApiResponse({
        data: {
          ...timeEntry,
          _links: getHateoasLinks('time-entry', timeEntry.entry_id)
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * DELETE /api/v1/time-entries/{id} - Delete time entry
   */
  delete() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_entry', 'delete') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      await this.timeEntryService.delete(id, context);
      
      return NextResponse.json(createApiResponse(null, 204));
    });
  }

  /**
   * POST /api/v1/time-entries/bulk - Bulk create time entries
   */
  bulkCreate() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_entry', 'create') as any,
      withValidation(bulkTimeEntrySchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const results = await this.timeEntryService.bulkCreate(data, context);
      
      const response = createApiResponse({
        data: results,
        message: `Processed ${results.length} time entries`
      });

      return NextResponse.json(response);
    });
  }

  /**
   * PUT /api/v1/time-entries/bulk - Bulk update time entries
   */
  bulkUpdate() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_entry', 'update') as any,
      withValidation(bulkUpdateTimeEntrySchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const results = await this.timeEntryService.bulkUpdate(data, context);
      
      const response = createApiResponse({
        data: results,
        message: `Processed ${results.length} time entry updates`
      });

      return NextResponse.json(response);
    });
  }

  /**
   * DELETE /api/v1/time-entries/bulk - Bulk delete time entries
   */
  bulkDelete() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_entry', 'delete') as any as any,
      withValidation(bulkDeleteTimeEntrySchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const results = await this.timeEntryService.bulkDeleteTimeEntries(data, context);
      
      const response = createApiResponse({
        data: results,
        message: `Processed ${results.length} time entry deletions`
      });

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/time-entries/start-tracking - Start time tracking session
   */
  startTimeTracking() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_entry', 'create') as any,
      withValidation(startTimeTrackingSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const session = await this.timeEntryService.startTimeTracking(data, context);
      
      const response = createApiResponse({
        data: session,
        _links: {
          self: { href: `/api/v1/time-entries/active-session` },
          stop: { href: `/api/v1/time-entries/stop-tracking/${session.session_id}`, method: 'POST' }
        }
      }, 201);

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/time-entries/stop-tracking/{sessionId} - Stop time tracking
   */
  stopTimeTracking() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_entry', 'create') as any,
      withValidation(stopTimeTrackingSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const { sessionId } = (req as any).params || {};
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const timeEntry = await this.timeEntryService.stopTimeTracking(sessionId, data, context);
      
      const response = createApiResponse({
        data: {
          ...timeEntry,
          _links: getHateoasLinks('time-entry', timeEntry.entry_id)
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * GET /api/v1/time-entries/active-session - Get active tracking session
   */
  getActiveSession() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_entry', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const session = await this.timeEntryService.getActiveSession(context);
      
      if (!session) {
        return NextResponse.json(createApiResponse({ data: null }));
      }

      const response = createApiResponse({
        data: session,
        _links: {
          self: { href: `/api/v1/time-entries/active-session` },
          stop: { href: `/api/v1/time-entries/stop-tracking/${session.session_id}`, method: 'POST' }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * GET /api/v1/time-entries/templates - List time entry templates
   */
  listTemplates() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_entry', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const templates = await this.timeEntryService.getTemplates(context);
      
      const response = createApiResponse({
        data: templates,
        _links: {
          self: { href: `/api/v1/time-entries/templates` },
          create: { href: `/api/v1/time-entries/templates`, method: 'POST' }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/time-entries/templates - Create time entry template
   */
  createTemplate() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_entry', 'create') as any,
      withValidation(createTimeTemplateSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const template = await this.timeEntryService.createTemplate(data, context);
      
      const response = createApiResponse({ data: template }, 201);
      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/time-entries/approve - Approve time entries
   */
  approveEntries() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_entry', 'approve') as any,
      withValidation(approveTimeEntriesSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const results = await this.timeEntryService.approveTimeEntries(data, context);
      
      const response = createApiResponse({
        data: results,
        message: `Processed ${results.length} time entry approvals`
      });

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/time-entries/request-changes - Request changes to time entries
   */
  requestChanges() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_entry', 'approve') as any,
      withValidation(requestTimeEntryChangesSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const results = await this.timeEntryService.requestChanges(data, context);
      
      const response = createApiResponse({
        data: results,
        message: `Processed ${results.length} change requests`
      });

      return NextResponse.json(response);
    });
  }

  /**
   * GET /api/v1/time-entries/search - Search time entries
   */
  search() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_entry', 'read') as any as any,
      withValidation(timeEntrySearchSchema, 'query') as any
    );

    return middleware(async (req: NextRequest) => {
      const query = Object.fromEntries(new URL(req.url).searchParams.entries());
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const timeEntries = await this.timeEntryService.search(query as any, context);
      
      const entriesWithLinks = timeEntries.map(entry => ({
        ...entry,
        _links: getHateoasLinks('time-entry', entry.entry_id)
      }));

      const response = createApiResponse({
        data: entriesWithLinks,
        _links: {
          self: { href: `/api/v1/time-entries/search` }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * GET /api/v1/time-entries/export - Export time entries
   */
  export() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_entry', 'read') as any as any,
      withValidation(timeEntryExportQuerySchema, 'query') as any
    );

    return middleware(async (req: NextRequest) => {
      const query = Object.fromEntries(new URL(req.url).searchParams.entries());
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      // For now, just return the time entries as JSON
      // In a real implementation, you'd generate CSV/Excel based on format
      const timeEntries = await this.timeEntryService.list({ filters: {} }, context);
      
      if (query.format === 'csv') {
        // Convert to CSV format
        const csvData = this.convertToCSV(timeEntries.data);
        return new NextResponse(csvData, {
          headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': 'attachment; filename=time-entries.csv'
          }
        });
      }

      return NextResponse.json(createApiResponse({ data: timeEntries.data }));
    });
  }

  /**
   * GET /api/v1/time-entries/stats - Get time entry statistics
   */
  getStatistics() {
    const middleware = compose(
      withAuth as any,
      withPermission('time_entry', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      // Get filter parameters from query string
      const url = new URL(req.url);
      const filters = {
        date_from: url.searchParams.get('date_from') || undefined,
        date_to: url.searchParams.get('date_to') || undefined
      };
      
      const stats = await this.timeEntryService.getStatistics(context, filters);
      
      const response = createApiResponse({
        data: stats,
        _links: {
          self: { href: `/api/v1/time-entries/stats` },
          'time-entries': { href: `/api/v1/time-entries` }
        }
      });

      return NextResponse.json(response);
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