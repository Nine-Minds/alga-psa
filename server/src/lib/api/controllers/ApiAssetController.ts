/**
 * Asset API Controller V2
 * Handles HTTP requests for asset-related operations
 */

import { NextRequest, NextResponse } from 'next/server';
import { AssetService } from '../services/AssetService';
import { 
  createAssetWithExtensionSchema,
  updateAssetSchema,
  assetListQuerySchema,
  createAssetRelationshipSchema,
  createAssetDocumentSchema,
  createMaintenanceScheduleSchema,
  updateMaintenanceScheduleSchema,
  recordMaintenanceSchema,
  assetSearchSchema,
  bulkUpdateAssetSchema,
  bulkAssetStatusSchema,
  linkAssetTicketSchema
} from '../schemas/asset';
import { z } from 'zod';
import { createApiResponse, createErrorResponse, createPaginatedResponse } from '../utils/response';
import { getHateoasLinks } from '../utils/hateoas';
import { requireRequestContext } from '../utils/requestContext';
import { ApiContext } from '../middleware/apiMiddleware';
import { ProductAccessError, getTenantProduct } from '@/lib/productAccess';
import { resolveProductApiBehavior } from '@/lib/productSurfaceRegistry';
import { hasPermission } from '../../auth/rbac';
import { getConnection } from '../../db/db';

export class ApiAssetController {
  private assetService: AssetService;

  constructor() {
    this.assetService = new AssetService();
  }

  private async requireAllowedContext(req: NextRequest): Promise<ApiContext> {
    const context = requireRequestContext(req);
    const pathname = new URL(req.url).pathname;
    const productCode = await getTenantProduct(context.tenant);
    const behavior = resolveProductApiBehavior(productCode, pathname);

    if (behavior === 'denied') {
      throw new ProductAccessError(`api_route:${pathname}`, productCode);
    }

    return context;
  }

  /**
   * GET /api/v2/assets - List assets
   */
  async list(req: NextRequest): Promise<NextResponse> {
    const query = Object.fromEntries(new URL(req.url).searchParams.entries());
    const context = await this.requireAllowedContext(req);
    
    // Validate query parameters
    const validation = assetListQuerySchema.safeParse(query);
    if (!validation.success) {
      return createErrorResponse('Invalid query parameters', 400, 'VALIDATION_ERROR', validation.error.errors);
    }

    const { page, limit, sort, order, ...filters } = validation.data;
    const listOptions = { 
      page: page ? parseInt(page) : undefined, 
      limit: limit ? parseInt(limit) : undefined, 
      sort, 
      order: order as 'asc' | 'desc' | undefined
    };
    
    const result = await this.assetService.list(listOptions, context, filters);
    
    // Add HATEOAS links to each asset
    const assetsWithLinks = result.data.map(asset => ({
      ...asset,
      _links: getHateoasLinks('asset', asset.asset_id)
    }));

    return createPaginatedResponse(assetsWithLinks, {
      page: parseInt(page as string) || 1,
      limit: parseInt(limit as string) || 25,
      total: result.total
    });
  }

  /**
   * GET /api/v2/assets/{id} - Get asset details
   */
  async getById(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const context = await this.requireAllowedContext(req);
    
    const asset = await this.assetService.getWithDetails(params.id, context);
    
    if (!asset) {
      return createErrorResponse('Asset not found', 404);
    }

    return createApiResponse({
      ...asset,
      _links: getHateoasLinks('asset', asset.asset_id)
    });
  }

  /**
   * POST /api/v2/assets - Create new asset
   */
  async create(req: NextRequest): Promise<NextResponse> {
    const data = await req.json();
    const context = await this.requireAllowedContext(req);
    
    // Validate request body
    const validation = createAssetWithExtensionSchema.safeParse(data);
    if (!validation.success) {
      return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
    }

    const asset = await this.assetService.create(validation.data, context);
    
    return createApiResponse({
      ...asset,
      _links: getHateoasLinks('asset', asset.asset_id)
    }, 201);
  }

  /**
   * PUT /api/v2/assets/{id} - Update asset
   */
  async update(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const data = await req.json();
    const context = await this.requireAllowedContext(req);
    
    // Validate request body
    const validation = updateAssetSchema.safeParse(data);
    if (!validation.success) {
      return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
    }

    const asset = await this.assetService.update(params.id, validation.data, context);
    
    return createApiResponse({
      ...asset,
      _links: getHateoasLinks('asset', asset.asset_id)
    });
  }

  /**
   * DELETE /api/v2/assets/{id} - Delete asset
   */
  async delete(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const context = await this.requireAllowedContext(req);
    
    await this.assetService.delete(params.id, context);
    
    return new NextResponse(null, { status: 204 });
  }

  /**
   * GET /api/v2/assets/{id}/relationships - List asset relationships
   */
  async listRelationships(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const context = await this.requireAllowedContext(req);
    
    const relationships = await this.assetService.getAssetRelationships(params.id, context);
    
    return createApiResponse(relationships);
  }

  // Enforce read permission for each resource the caller's response exposes.
  // Returns a 403 error response on the first denial, or null when allowed.
  private async requireReadPermissions(
    context: ApiContext,
    resources: Array<'asset' | 'ticket'>,
  ): Promise<NextResponse | null> {
    if (!context.user) {
      return createErrorResponse('User context required', 401, 'UNAUTHORIZED');
    }
    const knex = await getConnection(context.tenant);
    for (const resource of resources) {
      const allowed = await hasPermission(context.user, resource, 'read', knex);
      if (!allowed) {
        return createErrorResponse(`Permission denied: Cannot read ${resource}`, 403, 'FORBIDDEN');
      }
    }
    return null;
  }

  // Enforce a specific action per resource. Returns a 403 on the first denial,
  // or null when all checks pass.
  private async requirePermissions(
    context: ApiContext,
    checks: Array<{ resource: 'asset' | 'ticket'; action: string }>,
  ): Promise<NextResponse | null> {
    if (!context.user) {
      return createErrorResponse('User context required', 401, 'UNAUTHORIZED');
    }
    const knex = await getConnection(context.tenant);
    for (const { resource, action } of checks) {
      const allowed = await hasPermission(context.user, resource, action, knex);
      if (!allowed) {
        return createErrorResponse(`Permission denied: Cannot ${action} ${resource}`, 403, 'FORBIDDEN');
      }
    }
    return null;
  }

  /**
   * GET /api/v1/assets/{id}/tickets - List tickets linked to an asset
   */
  async listTickets(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const context = await this.requireAllowedContext(req);

    // Response joins ticket data onto an asset — require read on both resources.
    const denied = await this.requireReadPermissions(context, ['asset', 'ticket']);
    if (denied) return denied;

    const tickets = await this.assetService.getAssetTickets(params.id, context);

    return createApiResponse(tickets);
  }

  /**
   * POST /api/v1/assets/{id}/tickets - Link a ticket to an asset
   */
  async linkTicket(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const context = await this.requireAllowedContext(req);

    // Mutating the asset's associations needs asset:update; the ticket is only
    // referenced, so ticket:read is enough.
    const denied = await this.requirePermissions(context, [
      { resource: 'asset', action: 'update' },
      { resource: 'ticket', action: 'read' },
    ]);
    if (denied) return denied;

    const data = await req.json();
    const validation = linkAssetTicketSchema.safeParse(data);
    if (!validation.success) {
      return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
    }

    const association = await this.assetService.linkTicket(params.id, validation.data, context);

    return createApiResponse(association, 201);
  }

  /**
   * DELETE /api/v1/assets/{id}/tickets/{ticketId} - Unlink a ticket from an asset
   */
  async unlinkTicket(req: NextRequest, params: { id: string; ticketId: string }): Promise<NextResponse> {
    const context = await this.requireAllowedContext(req);

    const denied = await this.requirePermissions(context, [
      { resource: 'asset', action: 'update' },
      { resource: 'ticket', action: 'read' },
    ]);
    if (denied) return denied;

    await this.assetService.unlinkTicket(params.id, params.ticketId, context);

    return new NextResponse(null, { status: 204 });
  }

  /**
   * POST /api/v2/assets/{id}/relationships - Create asset relationship
   */
  async createRelationship(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const data = await req.json();
    const context = await this.requireAllowedContext(req);
    
    // Validate request body
    const validation = createAssetRelationshipSchema.safeParse(data);
    if (!validation.success) {
      return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
    }

    const relationship = await this.assetService.createRelationship(params.id, validation.data, context);
    
    return createApiResponse(relationship, 201);
  }

  /**
   * DELETE /api/v2/assets/relationships/{relationshipId} - Delete asset relationship
   */
  async deleteRelationship(req: NextRequest, params: { relationshipId: string }): Promise<NextResponse> {
    const context = await this.requireAllowedContext(req);
    
    await this.assetService.deleteRelationship(params.relationshipId, context);
    
    return new NextResponse(null, { status: 204 });
  }

  /**
   * GET /api/v2/assets/{id}/documents - List asset documents
   */
  async listDocuments(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const context = await this.requireAllowedContext(req);
    
    const documents = await this.assetService.getAssetDocuments(params.id, context);
    
    return createApiResponse(documents);
  }

  /**
   * POST /api/v2/assets/{id}/documents - Associate document with asset
   */
  async associateDocument(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const data = await req.json();
    const context = await this.requireAllowedContext(req);
    
    // Validate request body
    const validation = createAssetDocumentSchema.safeParse(data);
    if (!validation.success) {
      return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
    }

    const association = await this.assetService.associateDocument(params.id, validation.data, context);
    
    return createApiResponse(association, 201);
  }

  /**
   * DELETE /api/v2/assets/documents/{associationId} - Remove document association
   */
  async removeDocumentAssociation(req: NextRequest, params: { associationId: string }): Promise<NextResponse> {
    const context = await this.requireAllowedContext(req);
    
    await this.assetService.removeDocumentAssociation(params.associationId, context);
    
    return new NextResponse(null, { status: 204 });
  }

  /**
   * GET /api/v2/assets/{id}/maintenance - List maintenance schedules
   */
  async listMaintenanceSchedules(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const context = await this.requireAllowedContext(req);
    
    const schedules = await this.assetService.getMaintenanceSchedules(params.id, context);
    
    return createApiResponse(schedules);
  }

  /**
   * POST /api/v2/assets/{id}/maintenance - Create maintenance schedule
   */
  async createMaintenanceSchedule(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const data = await req.json();
    const context = await this.requireAllowedContext(req);
    
    // Validate request body
    const validation = createMaintenanceScheduleSchema.safeParse(data);
    if (!validation.success) {
      return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
    }

    const schedule = await this.assetService.createMaintenanceSchedule(params.id, validation.data, context);
    
    return createApiResponse(schedule, 201);
  }

  /**
   * PUT /api/v2/assets/maintenance/{scheduleId} - Update maintenance schedule
   */
  async updateMaintenanceSchedule(req: NextRequest, params: { scheduleId: string }): Promise<NextResponse> {
    const data = await req.json();
    const context = await this.requireAllowedContext(req);
    
    // Validate request body
    const validation = updateMaintenanceScheduleSchema.safeParse(data);
    if (!validation.success) {
      return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
    }

    const schedule = await this.assetService.updateMaintenanceSchedule(params.scheduleId, validation.data, context);
    
    return createApiResponse(schedule);
  }

  /**
   * DELETE /api/v2/assets/maintenance/{scheduleId} - Delete maintenance schedule
   */
  async deleteMaintenanceSchedule(req: NextRequest, params: { scheduleId: string }): Promise<NextResponse> {
    const context = await this.requireAllowedContext(req);
    
    await this.assetService.deleteMaintenanceSchedule(params.scheduleId, context);
    
    return new NextResponse(null, { status: 204 });
  }

  /**
   * POST /api/v2/assets/{id}/maintenance/record - Record maintenance performed
   */
  async recordMaintenance(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const data = await req.json();
    const context = await this.requireAllowedContext(req);
    
    // Validate request body
    const validation = recordMaintenanceSchema.safeParse(data);
    if (!validation.success) {
      return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
    }

    const maintenance = await this.assetService.recordMaintenance(params.id, validation.data, context);
    
    return createApiResponse(maintenance, 201);
  }

  /**
   * GET /api/v2/assets/{id}/history - Get maintenance history
   */
  async getMaintenanceHistory(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const context = await this.requireAllowedContext(req);
    
    const history = await this.assetService.getMaintenanceHistory(params.id, context);
    
    return createApiResponse(history);
  }

  /**
   * GET /api/v2/assets/search - Search assets
   */
  async search(req: NextRequest): Promise<NextResponse> {
    const query = Object.fromEntries(new URL(req.url).searchParams.entries());
    const context = await this.requireAllowedContext(req);
    
    // Validate query parameters
    const validation = assetSearchSchema.safeParse(query);
    if (!validation.success) {
      return createErrorResponse('Invalid query parameters', 400, 'VALIDATION_ERROR', validation.error.errors);
    }

    const assets = await this.assetService.search(validation.data, context);
    
    const assetsWithLinks = assets.map(asset => ({
      ...asset,
      _links: getHateoasLinks('asset', asset.asset_id)
    }));

    return createApiResponse(assetsWithLinks);
  }

  /**
   * GET /api/v2/assets/export - Export assets
   */
  async export(req: NextRequest): Promise<NextResponse> {
    const context = await this.requireAllowedContext(req);
    const sp = new URL(req.url).searchParams;

    const format = sp.get('format') === 'json' ? 'json' : 'csv';
    // Set filters arrive as repeated or comma-separated query params.
    const multi = (key: string) => sp.getAll(key).flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean);
    const assetTypes = multi('asset_types');
    const statuses = multi('statuses');
    const clientIds = multi('client_ids');
    const fields = multi('fields');

    // Page through every asset for the tenant — list() defaults to 25 rows, so
    // an export must paginate rather than take only the first page.
    const pageSize = 200;
    const MAX_ROWS = 50000;
    let page = 1;
    let rows: any[] = [];
    while (rows.length < MAX_ROWS) {
      const result = await this.assetService.list({ page, limit: pageSize }, context);
      rows = rows.concat(result.data);
      if (result.data.length < pageSize || rows.length >= (result.total ?? rows.length)) break;
      page += 1;
    }

    // Apply the export-only set filters in memory (list() takes single-value filters).
    if (assetTypes.length) rows = rows.filter((r) => assetTypes.includes(r.asset_type));
    if (statuses.length) rows = rows.filter((r) => statuses.includes(r.status));
    if (clientIds.length) rows = rows.filter((r) => clientIds.includes(r.client_id));
    if (fields.length) {
      rows = rows.map((r) => Object.fromEntries(fields.filter((k) => k in r).map((k) => [k, r[k]])));
    }

    if (format === 'csv') {
      const csvData = this.convertToCSV(rows);
      return new NextResponse(csvData, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename=assets.csv'
        }
      });
    }

    return createApiResponse(rows);
  }

  /**
   * GET /api/v2/assets/stats - Get asset statistics
   */
  async getStatistics(req: NextRequest): Promise<NextResponse> {
    const context = await this.requireAllowedContext(req);
    
    const stats = await this.assetService.getStatistics(context);
    
    return createApiResponse(stats);
  }

  /**
   * PUT /api/v2/assets/bulk-update - Bulk update assets
   */
  async bulkUpdate(req: NextRequest): Promise<NextResponse> {
    const data = await req.json();
    const context = await this.requireAllowedContext(req);
    
    // Validate request body
    const validation = bulkUpdateAssetSchema.safeParse(data);
    if (!validation.success) {
      return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
    }

    const results = await Promise.all(
      validation.data.assets.map(({ asset_id, data: updateData }) =>
        this.assetService.update(asset_id, updateData, context)
      )
    );

    return createApiResponse(results, 200, { message: `Updated ${results.length} assets` });
  }

  /**
   * PUT /api/v2/assets/bulk-status - Bulk update asset status
   */
  async bulkStatusUpdate(req: NextRequest): Promise<NextResponse> {
    const data = await req.json();
    const context = await this.requireAllowedContext(req);
    
    // Validate request body
    const validation = bulkAssetStatusSchema.safeParse(data);
    if (!validation.success) {
      return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
    }

    const results = await Promise.all(
      validation.data.asset_ids.map((assetId: string) =>
        this.assetService.update(assetId, { status: validation.data.status }, context)
      )
    );

    return createApiResponse(results, 200, { message: `Updated status for ${results.length} assets` });
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
