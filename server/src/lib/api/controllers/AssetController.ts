/**
 * Asset API Controller
 * Handles HTTP requests for asset-related operations
 */

import { NextRequest, NextResponse } from 'next/server';
import { BaseController } from './BaseController';
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
  assetExportQuerySchema,
  bulkUpdateAssetSchema,
  bulkAssetStatusSchema
} from '../schemas/asset';
import { z } from 'zod';
import { compose } from '../middleware/compose';
import { withAuth } from '../middleware/apiMiddleware';
import { withPermission } from '../middleware/permissionMiddleware';
import { withValidation } from '../middleware/validationMiddleware';
import { createApiResponse, createErrorResponse } from '../utils/response';
import { getHateoasLinks } from '../utils/hateoas';

export class AssetController extends BaseController {
  private assetService: AssetService;

  constructor() {
    super(null as any, null as any);
    this.assetService = new AssetService();
  }

  /**
   * GET /api/v1/assets - List assets
   */
  list() {
    const middleware = compose(
      withAuth as any,
      withPermission('asset', 'read') as any as any,
      withValidation(assetListQuerySchema, 'query') as any
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
          self: { href: `/api/v1/assets` },
          create: { href: `/api/v1/assets`, method: 'POST' },
          search: { href: `/api/v1/assets/search` },
          export: { href: `/api/v1/assets/export` },
          stats: { href: `/api/v1/assets/stats` }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * GET /api/v1/assets/{id} - Get asset details
   */
  getById() {
    const middleware = compose(
      withAuth as any,
      withPermission('asset', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const asset = await this.assetService.getWithDetails(id, context);
      
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
    });
  }

  /**
   * POST /api/v1/assets - Create new asset
   */
  create() {
    const middleware = compose(
      withAuth as any,
      withPermission('asset', 'create') as any,
      withValidation(createAssetWithExtensionSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const asset = await this.assetService.create(data, context);
      
      const response = createApiResponse({
        data: {
          ...asset,
          _links: getHateoasLinks('asset', asset.asset_id)
        }
      }, 201);

      return NextResponse.json(response);
    });
  }

  /**
   * PUT /api/v1/assets/{id} - Update asset
   */
  update() {
    const middleware = compose(
      withAuth as any,
      withPermission('asset', 'update') as any as any,
      withValidation(updateAssetSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const asset = await this.assetService.update(id, data, context);
      
      const response = createApiResponse({
        data: {
          ...asset,
          _links: getHateoasLinks('asset', asset.asset_id)
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * DELETE /api/v1/assets/{id} - Delete asset
   */
  delete() {
    const middleware = compose(
      withAuth as any,
      withPermission('asset', 'delete') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      await this.assetService.delete(id, context);
      
      return NextResponse.json(createApiResponse(null, 204));
    });
  }

  /**
   * GET /api/v1/assets/{id}/relationships - List asset relationships
   */
  listRelationships() {
    const middleware = compose(
      withAuth as any,
      withPermission('asset', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const relationships = await this.assetService.getAssetRelationships(id, context);
      
      const response = createApiResponse({
        data: relationships,
        _links: {
          self: { href: `/api/v1/assets/${id}/relationships` },
          create: { href: `/api/v1/assets/${id}/relationships`, method: 'POST' },
          parent: { href: `/api/v1/assets/${id}` }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/assets/{id}/relationships - Create asset relationship
   */
  createRelationship() {
    const middleware = compose(
      withAuth as any,
      withPermission('asset', 'update') as any as any,
      withValidation(createAssetRelationshipSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const relationship = await this.assetService.createRelationship(id, data, context);
      
      const response = createApiResponse({ data: relationship }, 201);
      return NextResponse.json(response);
    });
  }

  /**
   * DELETE /api/v1/assets/relationships/{relationshipId} - Delete asset relationship
   */
  deleteRelationship() {
    const middleware = compose(
      withAuth as any,
      withPermission('asset', 'update') as any
    );

    return middleware(async (req: NextRequest) => {
      const { relationshipId } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      await this.assetService.deleteRelationship(relationshipId, context);
      
      return NextResponse.json(createApiResponse(null, 204));
    });
  }

  /**
   * GET /api/v1/assets/{id}/documents - List asset documents
   */
  listDocuments() {
    const middleware = compose(
      withAuth as any,
      withPermission('asset', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const documents = await this.assetService.getAssetDocuments(id, context);
      
      const response = createApiResponse({
        data: documents,
        _links: {
          self: { href: `/api/v1/assets/${id}/documents` },
          create: { href: `/api/v1/assets/${id}/documents`, method: 'POST' },
          parent: { href: `/api/v1/assets/${id}` }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/assets/{id}/documents - Associate document with asset
   */
  associateDocument() {
    const middleware = compose(
      withAuth as any,
      withPermission('asset', 'update') as any as any,
      withValidation(createAssetDocumentSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const association = await this.assetService.associateDocument(id, data, context);
      
      const response = createApiResponse({ data: association }, 201);
      return NextResponse.json(response);
    });
  }

  /**
   * DELETE /api/v1/assets/documents/{associationId} - Remove document association
   */
  removeDocumentAssociation() {
    const middleware = compose(
      withAuth as any,
      withPermission('asset', 'update') as any
    );

    return middleware(async (req: NextRequest) => {
      const { associationId } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      await this.assetService.removeDocumentAssociation(associationId, context);
      
      return NextResponse.json(createApiResponse(null, 204));
    });
  }

  /**
   * GET /api/v1/assets/{id}/maintenance - List maintenance schedules
   */
  listMaintenanceSchedules() {
    const middleware = compose(
      withAuth as any,
      withPermission('asset', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const schedules = await this.assetService.getMaintenanceSchedules(id, context);
      
      const response = createApiResponse({
        data: schedules,
        _links: {
          self: { href: `/api/v1/assets/${id}/maintenance` },
          create: { href: `/api/v1/assets/${id}/maintenance`, method: 'POST' },
          history: { href: `/api/v1/assets/${id}/history` },
          parent: { href: `/api/v1/assets/${id}` }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * POST /api/v1/assets/{id}/maintenance - Create maintenance schedule
   */
  createMaintenanceSchedule() {
    const middleware = compose(
      withAuth as any,
      withPermission('asset', 'update') as any as any,
      withValidation(createMaintenanceScheduleSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const schedule = await this.assetService.createMaintenanceSchedule(id, data, context);
      
      const response = createApiResponse({ data: schedule }, 201);
      return NextResponse.json(response);
    });
  }

  /**
   * PUT /api/v1/assets/maintenance/{scheduleId} - Update maintenance schedule
   */
  updateMaintenanceSchedule() {
    const middleware = compose(
      withAuth as any,
      withPermission('asset', 'update') as any as any,
      withValidation(updateMaintenanceScheduleSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const { scheduleId } = (req as any).params || {};
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const schedule = await this.assetService.updateMaintenanceSchedule(scheduleId, data, context);
      
      const response = createApiResponse({ data: schedule });
      return NextResponse.json(response);
    });
  }

  /**
   * DELETE /api/v1/assets/maintenance/{scheduleId} - Delete maintenance schedule
   */
  deleteMaintenanceSchedule() {
    const middleware = compose(
      withAuth as any,
      withPermission('asset', 'delete') as any
    );

    return middleware(async (req: NextRequest) => {
      const { scheduleId } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      await this.assetService.deleteMaintenanceSchedule(scheduleId, context);
      
      return NextResponse.json(createApiResponse(null, 204));
    });
  }

  /**
   * POST /api/v1/assets/{id}/maintenance/record - Record maintenance performed
   */
  recordMaintenance() {
    const middleware = compose(
      withAuth as any,
      withPermission('asset', 'update') as any as any,
      withValidation(recordMaintenanceSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const maintenance = await this.assetService.recordMaintenance(id, data, context);
      
      const response = createApiResponse({ data: maintenance }, 201);
      return NextResponse.json(response);
    });
  }

  /**
   * GET /api/v1/assets/{id}/history - Get maintenance history
   */
  getMaintenanceHistory() {
    const middleware = compose(
      withAuth as any,
      withPermission('asset', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      const { id } = (req as any).params || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const history = await this.assetService.getMaintenanceHistory(id, context);
      
      const response = createApiResponse({
        data: history,
        _links: {
          self: { href: `/api/v1/assets/${id}/history` },
          schedules: { href: `/api/v1/assets/${id}/maintenance` },
          parent: { href: `/api/v1/assets/${id}` }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * GET /api/v1/assets/search - Search assets
   */
  search() {
    const middleware = compose(
      withAuth as any,
      withPermission('asset', 'read') as any,
      withValidation(assetSearchSchema, 'query') as any
    );

    return middleware(async (req: NextRequest) => {
      const query = Object.fromEntries(new URL(req.url).searchParams.entries());
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      // Cast to AssetSearchData since validation middleware already validated it
      const assets = await this.assetService.search(query as any, context);
      
      const assetsWithLinks = assets.map(asset => ({
        ...asset,
        _links: getHateoasLinks('asset', asset.asset_id)
      }));

      const response = createApiResponse({
        data: assetsWithLinks,
        _links: {
          self: { href: `/api/v1/assets/search` }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * GET /api/v1/assets/export - Export assets
   */
  export() {
    const middleware = compose(
      withAuth as any,
      withPermission('asset', 'read') as any,
      withValidation(assetExportQuerySchema, 'query') as any
    );

    return middleware(async (req: NextRequest) => {
      const query = Object.fromEntries(new URL(req.url).searchParams.entries());
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      // For now, just return the assets as JSON
      // In a real implementation, you'd generate CSV/Excel based on format
      const assets = await this.assetService.list({}, context);
      
      if (query.format === 'csv') {
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
    });
  }

  /**
   * GET /api/v1/assets/stats - Get asset statistics
   */
  getStatistics() {
    const middleware = compose(
      withAuth as any,
      withPermission('asset', 'read') as any
    );

    return middleware(async (req: NextRequest) => {
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const stats = await this.assetService.getStatistics(context);
      
      const response = createApiResponse({
        data: stats,
        _links: {
          self: { href: `/api/v1/assets/stats` },
          assets: { href: `/api/v1/assets` }
        }
      });

      return NextResponse.json(response);
    });
  }

  /**
   * PUT /api/v1/assets/bulk-update - Bulk update assets
   */
  bulkUpdate() {
    const middleware = compose(
      withAuth as any,
      withPermission('asset', 'update') as any as any,
      withValidation(bulkUpdateAssetSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const results = await Promise.all(
        data.assets.map(({ asset_id, data: updateData }: any) =>
          this.assetService.update(asset_id, updateData, context)
        )
      );

      const response = createApiResponse({
        data: results,
        message: `Updated ${results.length} assets`
      });

      return NextResponse.json(response);
    });
  }

  /**
   * PUT /api/v1/assets/bulk-status - Bulk update asset status
   */
  bulkStatusUpdate() {
    const middleware = compose(
      withAuth as any,
      withPermission('asset', 'update') as any as any,
      withValidation(bulkAssetStatusSchema, 'body') as any
    );

    return middleware(async (req: NextRequest) => {
      const data = await req.json() || {};
      const context = { userId: (req as any).user?.id || "unknown", tenant: (req as any).user?.tenant || "default" };
      
      const results = await Promise.all(
        data.asset_ids.map((assetId: string) =>
          this.assetService.update(assetId, { status: data.status }, context)
        )
      );

      const response = createApiResponse({
        data: results,
        message: `Updated status for ${results.length} assets`
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