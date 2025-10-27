/**
 * Asset API Controller V2
 * Handles HTTP requests for asset-related operations
 */

import { NextRequest, NextResponse } from 'next/server';
import { AssetService } from '@product/api/services/AssetService';
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
  assetExportQuerySchema,
  bulkUpdateAssetSchema,
  bulkAssetStatusSchema
} from '@product/api/schemas/asset';
import { z } from 'zod';
import { createApiResponse, createErrorResponse } from '@product/api/utils/response';
import { getHateoasLinks } from '@product/api/utils/hateoas';
import { requireRequestContext } from '@product/api/utils/requestContext';

export class ApiAssetController {
  private assetService: AssetService;

  constructor() {
    this.assetService = new AssetService();
  }

  /**
   * GET /api/v2/assets - List assets
   */
  async list(req: NextRequest): Promise<NextResponse> {
    const query = Object.fromEntries(new URL(req.url).searchParams.entries());
    const context = requireRequestContext(req);
    
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

    const response = createApiResponse({
      data: assetsWithLinks,
      pagination: {
        page: parseInt(page as string) || 1,
        limit: parseInt(limit as string) || 25,
        total: result.total,
        totalPages: Math.ceil(result.total / (parseInt(limit as string) || 25))
      },
      _links: {
        self: { href: `/api/v2/assets` },
        create: { href: `/api/v2/assets`, method: 'POST' },
        search: { href: `/api/v2/assets/search` },
        export: { href: `/api/v2/assets/export` },
        stats: { href: `/api/v2/assets/stats` }
      }
    });

    return NextResponse.json(response);
  }

  /**
   * GET /api/v2/assets/{id} - Get asset details
   */
  async getById(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const context = requireRequestContext(req);
    
    const asset = await this.assetService.getWithDetails(params.id, context);
    
    if (!asset) {
      return createErrorResponse('Asset not found', 404);
    }

    const response = createApiResponse({
      data: {
        ...asset,
        _links: getHateoasLinks('asset', asset.asset_id)
      }
    });

    return NextResponse.json(response);
  }

  /**
   * POST /api/v2/assets - Create new asset
   */
  async create(req: NextRequest): Promise<NextResponse> {
    const data = await req.json();
    const context = requireRequestContext(req);
    
    // Validate request body
    const validation = createAssetWithExtensionSchema.safeParse(data);
    if (!validation.success) {
      return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
    }

    const asset = await this.assetService.create(validation.data, context);
    
    const response = createApiResponse({
      data: {
        ...asset,
        _links: getHateoasLinks('asset', asset.asset_id)
      }
    }, 201);

    return NextResponse.json(response);
  }

  /**
   * PUT /api/v2/assets/{id} - Update asset
   */
  async update(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const data = await req.json();
    const context = requireRequestContext(req);
    
    // Validate request body
    const validation = updateAssetSchema.safeParse(data);
    if (!validation.success) {
      return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
    }

    const asset = await this.assetService.update(params.id, validation.data, context);
    
    const response = createApiResponse({
      data: {
        ...asset,
        _links: getHateoasLinks('asset', asset.asset_id)
      }
    });

    return NextResponse.json(response);
  }

  /**
   * DELETE /api/v2/assets/{id} - Delete asset
   */
  async delete(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const context = requireRequestContext(req);
    
    await this.assetService.delete(params.id, context);
    
    return NextResponse.json(createApiResponse(null, 204));
  }

  /**
   * GET /api/v2/assets/{id}/relationships - List asset relationships
   */
  async listRelationships(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const context = requireRequestContext(req);
    
    const relationships = await this.assetService.getAssetRelationships(params.id, context);
    
    const response = createApiResponse({
      data: relationships,
      _links: {
        self: { href: `/api/v2/assets/${params.id}/relationships` },
        create: { href: `/api/v2/assets/${params.id}/relationships`, method: 'POST' },
        parent: { href: `/api/v2/assets/${params.id}` }
      }
    });

    return NextResponse.json(response);
  }

  /**
   * POST /api/v2/assets/{id}/relationships - Create asset relationship
   */
  async createRelationship(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const data = await req.json();
    const context = requireRequestContext(req);
    
    // Validate request body
    const validation = createAssetRelationshipSchema.safeParse(data);
    if (!validation.success) {
      return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
    }

    const relationship = await this.assetService.createRelationship(params.id, validation.data, context);
    
    const response = createApiResponse({ data: relationship }, 201);
    return NextResponse.json(response);
  }

  /**
   * DELETE /api/v2/assets/relationships/{relationshipId} - Delete asset relationship
   */
  async deleteRelationship(req: NextRequest, params: { relationshipId: string }): Promise<NextResponse> {
    const context = requireRequestContext(req);
    
    await this.assetService.deleteRelationship(params.relationshipId, context);
    
    return NextResponse.json(createApiResponse(null, 204));
  }

  /**
   * GET /api/v2/assets/{id}/documents - List asset documents
   */
  async listDocuments(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const context = requireRequestContext(req);
    
    const documents = await this.assetService.getAssetDocuments(params.id, context);
    
    const response = createApiResponse({
      data: documents,
      _links: {
        self: { href: `/api/v2/assets/${params.id}/documents` },
        create: { href: `/api/v2/assets/${params.id}/documents`, method: 'POST' },
        parent: { href: `/api/v2/assets/${params.id}` }
      }
    });

    return NextResponse.json(response);
  }

  /**
   * POST /api/v2/assets/{id}/documents - Associate document with asset
   */
  async associateDocument(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const data = await req.json();
    const context = requireRequestContext(req);
    
    // Validate request body
    const validation = createAssetDocumentSchema.safeParse(data);
    if (!validation.success) {
      return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
    }

    const association = await this.assetService.associateDocument(params.id, validation.data, context);
    
    const response = createApiResponse({ data: association }, 201);
    return NextResponse.json(response);
  }

  /**
   * DELETE /api/v2/assets/documents/{associationId} - Remove document association
   */
  async removeDocumentAssociation(req: NextRequest, params: { associationId: string }): Promise<NextResponse> {
    const context = requireRequestContext(req);
    
    await this.assetService.removeDocumentAssociation(params.associationId, context);
    
    return NextResponse.json(createApiResponse(null, 204));
  }

  /**
   * GET /api/v2/assets/{id}/maintenance - List maintenance schedules
   */
  async listMaintenanceSchedules(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const context = requireRequestContext(req);
    
    const schedules = await this.assetService.getMaintenanceSchedules(params.id, context);
    
    const response = createApiResponse({
      data: schedules,
      _links: {
        self: { href: `/api/v2/assets/${params.id}/maintenance` },
        create: { href: `/api/v2/assets/${params.id}/maintenance`, method: 'POST' },
        history: { href: `/api/v2/assets/${params.id}/history` },
        parent: { href: `/api/v2/assets/${params.id}` }
      }
    });

    return NextResponse.json(response);
  }

  /**
   * POST /api/v2/assets/{id}/maintenance - Create maintenance schedule
   */
  async createMaintenanceSchedule(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const data = await req.json();
    const context = requireRequestContext(req);
    
    // Validate request body
    const validation = createMaintenanceScheduleSchema.safeParse(data);
    if (!validation.success) {
      return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
    }

    const schedule = await this.assetService.createMaintenanceSchedule(params.id, validation.data, context);
    
    const response = createApiResponse({ data: schedule }, 201);
    return NextResponse.json(response);
  }

  /**
   * PUT /api/v2/assets/maintenance/{scheduleId} - Update maintenance schedule
   */
  async updateMaintenanceSchedule(req: NextRequest, params: { scheduleId: string }): Promise<NextResponse> {
    const data = await req.json();
    const context = requireRequestContext(req);
    
    // Validate request body
    const validation = updateMaintenanceScheduleSchema.safeParse(data);
    if (!validation.success) {
      return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
    }

    const schedule = await this.assetService.updateMaintenanceSchedule(params.scheduleId, validation.data, context);
    
    const response = createApiResponse({ data: schedule });
    return NextResponse.json(response);
  }

  /**
   * DELETE /api/v2/assets/maintenance/{scheduleId} - Delete maintenance schedule
   */
  async deleteMaintenanceSchedule(req: NextRequest, params: { scheduleId: string }): Promise<NextResponse> {
    const context = requireRequestContext(req);
    
    await this.assetService.deleteMaintenanceSchedule(params.scheduleId, context);
    
    return NextResponse.json(createApiResponse(null, 204));
  }

  /**
   * POST /api/v2/assets/{id}/maintenance/record - Record maintenance performed
   */
  async recordMaintenance(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const data = await req.json();
    const context = requireRequestContext(req);
    
    // Validate request body
    const validation = recordMaintenanceSchema.safeParse(data);
    if (!validation.success) {
      return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.errors);
    }

    const maintenance = await this.assetService.recordMaintenance(params.id, validation.data, context);
    
    const response = createApiResponse({ data: maintenance }, 201);
    return NextResponse.json(response);
  }

  /**
   * GET /api/v2/assets/{id}/history - Get maintenance history
   */
  async getMaintenanceHistory(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const context = requireRequestContext(req);
    
    const history = await this.assetService.getMaintenanceHistory(params.id, context);
    
    const response = createApiResponse({
      data: history,
      _links: {
        self: { href: `/api/v2/assets/${params.id}/history` },
        schedules: { href: `/api/v2/assets/${params.id}/maintenance` },
        parent: { href: `/api/v2/assets/${params.id}` }
      }
    });

    return NextResponse.json(response);
  }

  /**
   * GET /api/v2/assets/search - Search assets
   */
  async search(req: NextRequest): Promise<NextResponse> {
    const query = Object.fromEntries(new URL(req.url).searchParams.entries());
    const context = requireRequestContext(req);
    
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

    const response = createApiResponse({
      data: assetsWithLinks,
      _links: {
        self: { href: `/api/v2/assets/search` }
      }
    });

    return NextResponse.json(response);
  }

  /**
   * GET /api/v2/assets/export - Export assets
   */
  async export(req: NextRequest): Promise<NextResponse> {
    const query = Object.fromEntries(new URL(req.url).searchParams.entries());
    const context = requireRequestContext(req);
    
    // Validate query parameters
    const validation = assetExportQuerySchema.safeParse(query);
    if (!validation.success) {
      return createErrorResponse('Invalid query parameters', 400, 'VALIDATION_ERROR', validation.error.errors);
    }

    // For now, just return the assets as JSON
    // In a real implementation, you'd generate CSV/Excel based on format
    const assets = await this.assetService.list({}, context);
    
    if (validation.data.format === 'csv') {
      // Convert to CSV format
      const csvData = this.convertToCSV(assets.data);
      return new NextResponse(csvData, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename=assets.csv'
        }
      });
    }

    return NextResponse.json(createApiResponse({ data: assets.data }));
  }

  /**
   * GET /api/v2/assets/stats - Get asset statistics
   */
  async getStatistics(req: NextRequest): Promise<NextResponse> {
    const context = requireRequestContext(req);
    
    const stats = await this.assetService.getStatistics(context);
    
    const response = createApiResponse({
      data: stats,
      _links: {
        self: { href: `/api/v2/assets/stats` },
        assets: { href: `/api/v2/assets` }
      }
    });

    return NextResponse.json(response);
  }

  /**
   * PUT /api/v2/assets/bulk-update - Bulk update assets
   */
  async bulkUpdate(req: NextRequest): Promise<NextResponse> {
    const data = await req.json();
    const context = requireRequestContext(req);
    
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

    const response = createApiResponse({
      data: results,
      message: `Updated ${results.length} assets`
    });

    return NextResponse.json(response);
  }

  /**
   * PUT /api/v2/assets/bulk-status - Bulk update asset status
   */
  async bulkStatusUpdate(req: NextRequest): Promise<NextResponse> {
    const data = await req.json();
    const context = requireRequestContext(req);
    
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

    const response = createApiResponse({
      data: results,
      message: `Updated status for ${results.length} assets`
    });

    return NextResponse.json(response);
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