/**
 * Asset API Controller V2
 * Handles HTTP requests for asset-related operations
 */

import { hasApiContextPermission } from '../middleware/apiContextPermission';
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
import { createApiResponse, createErrorResponse, createPaginatedResponse } from '../utils/response';
import { getHateoasLinks } from '../utils/hateoas';
import { requireRequestContext } from '../utils/requestContext';
import { ApiContext } from '../middleware/apiMiddleware';
import { ProductAccessError, getTenantProduct } from '@/lib/productAccess';
import { resolveProductApiBehavior } from '@/lib/productSurfaceRegistry';
import { getConnection } from '../../db/db';
import { authorizeAssetRecordAccess, guardAssetRead } from './assetReadGuard';
import { projectApiRecord } from './apiRecordProjection';
import { authorizeApiResource } from './authorizationKernel';
import type { AuthorizationRecord } from '@alga-psa/authorization/kernel';

type AssetAction = { resource: 'asset' | 'ticket'; action: 'read' | 'create' | 'update' | 'delete' };
type AssetChecks = readonly [AssetAction, ...AssetAction[]];
const ASSET_READ = [{ resource: 'asset', action: 'read' }] as const satisfies AssetChecks;
const ASSET_CREATE = [{ resource: 'asset', action: 'create' }] as const satisfies AssetChecks;
const ASSET_UPDATE = [{ resource: 'asset', action: 'update' }] as const satisfies AssetChecks;
const ASSET_UPDATE_RELATED_READ = [...ASSET_UPDATE, ...ASSET_READ] as const satisfies AssetChecks;
const ASSET_DELETE = [{ resource: 'asset', action: 'delete' }] as const satisfies AssetChecks;
const ASSET_TICKET_READ = [...ASSET_READ, { resource: 'ticket', action: 'read' }] as const satisfies AssetChecks;
const ASSET_TICKET_LINK = [{ resource: 'asset', action: 'update' }, { resource: 'ticket', action: 'update' }] as const satisfies AssetChecks;

export class ApiAssetController {
  private assetService: AssetService;

  constructor() {
    this.assetService = new AssetService();
  }

  private async authorize<T = never>(
    req: NextRequest,
    checks: AssetChecks,
    resolveBeforeAuthorization?: (context: ApiContext) => Promise<T | null>,
  ): Promise<{ context: ApiContext; denied: NextResponse | null; resolved?: T | null }> {
    const context = requireRequestContext(req);
    const pathname = new URL(req.url).pathname;
    const productCode = await getTenantProduct(context.tenant);
    const behavior = resolveProductApiBehavior(productCode, pathname);

    if (behavior === 'denied') {
      throw new ProductAccessError(`api_route:${pathname}`, productCode);
    }
    if (!context.user) return { context, denied: createErrorResponse('User context required', 401, 'UNAUTHORIZED') };
    // Association-ID routes must hide missing and foreign-tenant associations
    // before evaluating the caller's resource permissions.
    const resolved = resolveBeforeAuthorization ? await resolveBeforeAuthorization(context) : undefined;
    const knex = await getConnection(context.tenant);
    for (const { resource, action } of checks) {
      if (!await hasApiContextPermission(context, resource, action, knex)) {
        return { context, denied: createErrorResponse(`Permission denied: Cannot ${action} ${resource}`, 403, 'FORBIDDEN'), resolved };
      }
    }
    return { context, denied: null, resolved };
  }

  private async authorizeRecord(
    context: ApiContext,
    assetId: string,
    action: 'read' | 'update' | 'delete',
    proposedChanges?: AuthorizationRecord,
  ): Promise<NextResponse | null> {
    const record = await this.resolveAuthorizationRecord(context, assetId);
    if (!record) return createErrorResponse('Asset not found', 404, 'NOT_FOUND');
    // A transition must be allowed at both ends. Retain relationships when
    // projecting changes so ownership/team rules still apply to the destination.
    const records = proposedChanges ? [record, { ...record, ...proposedChanges }] : [record];
    for (const recordContext of records) {
      const denied = await this.authorizeRecordContext(context, action, recordContext);
      if (denied) return denied;
    }
    return null;
  }

  private async resolveAuthorizationRecord(
    context: ApiContext,
    assetId: string,
  ): Promise<AuthorizationRecord | null> {
    return this.assetService.getAuthorizationRecord(assetId, context);
  }

  private async authorizeRecordContext(
    context: ApiContext,
    action: AssetAction['action'],
    recordContext: AuthorizationRecord,
  ): Promise<NextResponse | null> {
    const allowed = await authorizeApiResource({
      knex: await getConnection(context.tenant),
      tenant: context.tenant,
      user: context.user,
      apiKeyId: context.apiKeyId,
      resource: 'asset',
      action,
      recordContext,
    });
    return allowed ? null : createErrorResponse('Asset not found', 404, 'NOT_FOUND');
  }

  /**
   * GET /api/v2/assets - List assets
   */
  async list(req: NextRequest): Promise<NextResponse> {
    const { context, denied: authDenied } = await this.authorize(req, ASSET_READ);
    if (authDenied) return authDenied;
    const query = Object.fromEntries(new URL(req.url).searchParams.entries());

    // Validate query parameters
    const validation = assetListQuerySchema.safeParse(query);
    if (!validation.success) {
      return createErrorResponse('Invalid query parameters', 400, 'VALIDATION_ERROR', validation.error.issues);
    }

    const { page, limit, sort, order, ...filters } = validation.data;
    const listOptions = {
      page,
      limit,
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
      page: page || 1,
      limit: limit || 25,
      total: result.total
    });
  }

  /**
   * GET /api/v2/assets/{id} - Get asset details
   */
  async getById(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const { context, denied: authDenied } = await this.authorize(req, ASSET_READ);
    if (authDenied) return authDenied;
    const authorization = await authorizeAssetRecordAccess(context, params.id, this.assetService);
    if (!('record' in authorization)) return authorization;

    const asset = await this.assetService.getWithDetails(params.id, context);

    if (!asset) {
      return createErrorResponse('Asset not found', 404);
    }

    const projected = projectApiRecord('asset', asset as Record<string, any>, authorization.redactedFields);
    if (!projected) return createErrorResponse('Asset not found', 404);

    return createApiResponse({
      ...projected,
      _links: getHateoasLinks('asset', String(projected.asset_id))
    });
  }

  /**
   * POST /api/v2/assets - Create new asset
   */
  async create(req: NextRequest): Promise<NextResponse> {
    const { context, denied: authDenied } = await this.authorize(req, ASSET_CREATE);
    if (authDenied) return authDenied;
    const data = await req.json();

    // Validate request body
    const validation = createAssetWithExtensionSchema.safeParse(data);
    if (!validation.success) {
      return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.issues);
    }

    const recordDenied = await this.authorizeRecordContext(context, 'create', { clientId: validation.data.client_id });
    if (recordDenied) return recordDenied;
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
    const { context, denied: authDenied } = await this.authorize(req, ASSET_UPDATE);
    if (authDenied) return authDenied;
    const data = await req.json();

    // Validate request body
    const validation = updateAssetSchema.safeParse(data);
    if (!validation.success) {
      return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.issues);
    }

    const proposedChanges = validation.data.client_id === undefined ? undefined : { clientId: validation.data.client_id };
    const recordDenied = await this.authorizeRecord(context, params.id, 'update', proposedChanges);
    if (recordDenied) return recordDenied;
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
    const { context, denied: authDenied } = await this.authorize(req, ASSET_DELETE);
    if (authDenied) return authDenied;

    const recordDenied = await this.authorizeRecord(context, params.id, 'delete');
    if (recordDenied) return recordDenied;
    await this.assetService.delete(params.id, context);

    return new NextResponse(null, { status: 204 });
  }

  /**
   * GET /api/v2/assets/{id}/relationships - List asset relationships
   */
  async listRelationships(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const { context, denied: authDenied } = await this.authorize(req, ASSET_READ);
    if (authDenied) return authDenied;

    const recordDenied = await this.authorizeRecord(context, params.id, 'read');
    if (recordDenied) return recordDenied;
    const relationships = await this.assetService.getAssetRelationships(params.id, context);

    return createApiResponse(relationships);
  }

  /**
   * FR-C8: GET /api/v1/assets/{id}/assignments — the asset's assignment
   * history. An asset of another tenant is a 404, not an empty list, so a probe
   * cannot tell the difference between "no history" and "not yours".
   */
  async listAssignments(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const { context, denied: authDenied } = await this.authorize(req, ASSET_TICKET_READ);
    if (authDenied) return authDenied;
    const recordDenied = await this.authorizeRecord(context, params.id, 'read');
    if (recordDenied) return recordDenied;

    const asset = await this.assetService.getById(params.id, context);
    if (!asset) {
      return createErrorResponse('Asset not found', 404, 'NOT_FOUND');
    }

    const assignments = await this.assetService.getAssetAssignments(params.id, context);
    return createApiResponse(assignments);
  }

  /** FR-B4: GET /api/v1/asset-statuses — the tenant's status registry. */
  async listStatuses(req: NextRequest): Promise<NextResponse> {
    const { context, denied: authDenied } = await this.authorize(req, ASSET_TICKET_READ);
    if (authDenied) return authDenied;

    const includeArchived = new URL(req.url).searchParams.get('include_archived') === 'true';
    const statuses = await this.assetService.listAssetStatuses(context, { includeArchived });
    return createApiResponse(statuses);
  }

  /**
   * GET /api/v1/assets/{id}/tickets - List tickets linked to an asset
   */
  async listTickets(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const { context, denied: authDenied } = await this.authorize(req, ASSET_TICKET_READ);
    if (authDenied) return authDenied;

    // Response joins ticket data onto an asset — require read on both resources.
    const denied = await this.authorizeRecord(context, params.id, 'read');
    if (denied) return denied;

    const tickets = await this.assetService.getAssetTickets(params.id, context);

    return createApiResponse(tickets);
  }

  /**
   * POST /api/v1/assets/{id}/tickets - Link a ticket to an asset
   */
  async linkTicket(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const { context, denied: authDenied } = await this.authorize(req, ASSET_TICKET_LINK);
    if (authDenied) return authDenied;

    // Linking a ticket changes the ticket's related-asset association, so both
    // the asset and ticket mutation permissions are required.
    const denied = await this.authorizeRecord(context, params.id, 'update');
    if (denied) return denied;

    const data = await req.json();
    const validation = linkAssetTicketSchema.safeParse(data);
    if (!validation.success) {
      return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.issues);
    }

    const association = await this.assetService.linkTicket(params.id, validation.data, context);

    return createApiResponse(association, 201);
  }

  /**
   * DELETE /api/v1/assets/{id}/tickets/{ticketId} - Unlink a ticket from an asset
   */
  async unlinkTicket(req: NextRequest, params: { id: string; ticketId: string }): Promise<NextResponse> {
    const { context, denied: authDenied } = await this.authorize(req, ASSET_TICKET_LINK);
    if (authDenied) return authDenied;

    const denied = await this.authorizeRecord(context, params.id, 'update');
    if (denied) return denied;

    await this.assetService.unlinkTicket(params.id, params.ticketId, context);

    return new NextResponse(null, { status: 204 });
  }

  /**
   * POST /api/v2/assets/{id}/relationships - Create asset relationship
   */
  async createRelationship(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const { context, denied: authDenied } = await this.authorize(req, ASSET_UPDATE_RELATED_READ);
    if (authDenied) return authDenied;
    const data = await req.json();

    // Validate request body
    const validation = createAssetRelationshipSchema.safeParse(data);
    if (!validation.success) {
      return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.issues);
    }

    const denied = await this.authorizeRecord(context, params.id, 'update');
    if (denied) return denied;
    const relatedDenied = await this.authorizeRecord(context, validation.data.related_asset_id, 'read');
    if (relatedDenied) return relatedDenied;
    const relationship = await this.assetService.createRelationship(params.id, validation.data, context);

    return createApiResponse(relationship, 201);
  }

  /**
   * DELETE /api/v2/assets/relationships/{relationshipId} - Delete asset relationship
   */
  async deleteRelationship(req: NextRequest, params: { relationshipId: string }): Promise<NextResponse> {
    const { context, denied: authDenied, resolved: assetIds } = await this.authorize(
      req,
      ASSET_UPDATE_RELATED_READ,
      async (authorizationContext) => {
        const ids = await this.assetService.getRelationshipAssetIds(params.relationshipId, authorizationContext);
        if (!ids) return null;
        const records = await Promise.all(ids.map((id) => this.resolveAuthorizationRecord(authorizationContext, id)));
        if (records.some((record) => record === null)) return null;
        return { records: records as AuthorizationRecord[] };
      },
    );
    if (!assetIds) return createErrorResponse('Asset relationship not found', 404, 'NOT_FOUND');
    if (authDenied) return authDenied;

    const targetDenied = await this.authorizeRecordContext(context, 'update', assetIds.records[0]);
    if (targetDenied) return targetDenied;
    const relatedDenied = await this.authorizeRecordContext(context, 'read', assetIds.records[1]);
    if (relatedDenied) return relatedDenied;
    await this.assetService.deleteRelationship(params.relationshipId, context);

    return new NextResponse(null, { status: 204 });
  }

  /**
   * GET /api/v2/assets/{id}/documents - List asset documents
   */
  async listDocuments(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const { context, denied: authDenied } = await this.authorize(req, ASSET_READ);
    if (authDenied) return authDenied;

    const denied = await this.authorizeRecord(context, params.id, 'read');
    if (denied) return denied;
    const documents = await this.assetService.getAssetDocuments(params.id, context);

    return createApiResponse(documents);
  }

  /**
   * POST /api/v2/assets/{id}/documents - Associate document with asset
   */
  async associateDocument(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const { context, denied: authDenied } = await this.authorize(req, ASSET_UPDATE);
    if (authDenied) return authDenied;
    const data = await req.json();

    // Validate request body
    const validation = createAssetDocumentSchema.safeParse(data);
    if (!validation.success) {
      return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.issues);
    }

    const denied = await this.authorizeRecord(context, params.id, 'update');
    if (denied) return denied;
    const association = await this.assetService.associateDocument(params.id, validation.data, context);

    return createApiResponse(association, 201);
  }

  /**
   * DELETE /api/v2/assets/documents/{associationId} - Remove document association
   */
  async removeDocumentAssociation(req: NextRequest, params: { associationId: string }): Promise<NextResponse> {
    const { context, denied: authDenied, resolved: assetId } = await this.authorize(
      req,
      ASSET_UPDATE,
      async (authorizationContext) => {
        const id = await this.assetService.getDocumentAssociationAssetId(params.associationId, authorizationContext);
        if (!id) return null;
        const record = await this.resolveAuthorizationRecord(authorizationContext, id);
        return record ? { id, record } : null;
      },
    );
    if (!assetId) return createErrorResponse('Asset document association not found', 404, 'NOT_FOUND');
    if (authDenied) return authDenied;

    const denied = await this.authorizeRecordContext(context, 'update', assetId.record);
    if (denied) return denied;
    await this.assetService.removeDocumentAssociation(params.associationId, context);

    return new NextResponse(null, { status: 204 });
  }

  /**
   * GET /api/v2/assets/{id}/maintenance - List maintenance schedules
   */
  async listMaintenanceSchedules(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const { context, denied: authDenied } = await this.authorize(req, ASSET_READ);
    if (authDenied) return authDenied;
    const denied = await this.authorizeRecord(context, params.id, 'read');
    if (denied) return denied;

    const schedules = await this.assetService.getMaintenanceSchedules(params.id, context);

    return createApiResponse(schedules);
  }

  /**
   * POST /api/v2/assets/{id}/maintenance - Create maintenance schedule
   */
  async createMaintenanceSchedule(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const { context, denied: authDenied } = await this.authorize(req, ASSET_UPDATE);
    if (authDenied) return authDenied;
    const data = await req.json();

    // Validate request body
    const validation = createMaintenanceScheduleSchema.safeParse(data);
    if (!validation.success) {
      return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.issues);
    }

    const denied = await this.authorizeRecord(context, params.id, 'update');
    if (denied) return denied;
    const schedule = await this.assetService.createMaintenanceSchedule(params.id, validation.data, context);

    return createApiResponse(schedule, 201);
  }

  /**
   * PUT /api/v2/assets/maintenance/{scheduleId} - Update maintenance schedule
   */
  async updateMaintenanceSchedule(req: NextRequest, params: { scheduleId: string }): Promise<NextResponse> {
    const { context, denied: authDenied } = await this.authorize(req, ASSET_UPDATE);
    if (authDenied) return authDenied;
    const data = await req.json();

    // Validate request body
    const validation = updateMaintenanceScheduleSchema.safeParse(data);
    if (!validation.success) {
      return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.issues);
    }

    const assetId = await this.assetService.getMaintenanceScheduleAssetId(params.scheduleId, context);
    if (!assetId) return createErrorResponse('Maintenance schedule not found', 404, 'NOT_FOUND');
    const denied = await this.authorizeRecord(context, assetId, 'update');
    if (denied) return denied;
    const schedule = await this.assetService.updateMaintenanceSchedule(params.scheduleId, validation.data, context);

    return createApiResponse(schedule);
  }

  /**
   * DELETE /api/v2/assets/maintenance/{scheduleId} - Delete maintenance schedule
   */
  async deleteMaintenanceSchedule(req: NextRequest, params: { scheduleId: string }): Promise<NextResponse> {
    const { context, denied: authDenied } = await this.authorize(req, ASSET_UPDATE);
    if (authDenied) return authDenied;

    const assetId = await this.assetService.getMaintenanceScheduleAssetId(params.scheduleId, context);
    if (!assetId) return createErrorResponse('Maintenance schedule not found', 404, 'NOT_FOUND');
    const denied = await this.authorizeRecord(context, assetId, 'update');
    if (denied) return denied;
    await this.assetService.deleteMaintenanceSchedule(params.scheduleId, context);

    return new NextResponse(null, { status: 204 });
  }

  /**
   * POST /api/v2/assets/{id}/maintenance/record - Record maintenance performed
   */
  async recordMaintenance(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const { context, denied: authDenied } = await this.authorize(req, ASSET_UPDATE);
    if (authDenied) return authDenied;
    const data = await req.json();

    // Validate request body
    const validation = recordMaintenanceSchema.safeParse(data);
    if (!validation.success) {
      return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.issues);
    }

    const denied = await this.authorizeRecord(context, params.id, 'update');
    if (denied) return denied;
    const maintenance = await this.assetService.recordMaintenance(params.id, validation.data, context);

    return createApiResponse(maintenance, 201);
  }

  /**
   * GET /api/v2/assets/{id}/history - Get maintenance history
   */
  async getMaintenanceHistory(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const { context, denied: authDenied } = await this.authorize(req, ASSET_READ);
    if (authDenied) return authDenied;
    const denied = await this.authorizeRecord(context, params.id, 'read');
    if (denied) return denied;

    const history = await this.assetService.getMaintenanceHistory(params.id, context);

    return createApiResponse(history);
  }

  /**
   * GET /api/v2/assets/search - Search assets
   */
  async search(req: NextRequest): Promise<NextResponse> {
    const { context, denied: authDenied } = await this.authorize(req, ASSET_READ);
    if (authDenied) return authDenied;
    const query = Object.fromEntries(new URL(req.url).searchParams.entries());

    // Validate query parameters
    const validation = assetSearchSchema.safeParse(query);
    if (!validation.success) {
      return createErrorResponse('Invalid query parameters', 400, 'VALIDATION_ERROR', validation.error.issues);
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
    const { context, denied: authDenied } = await this.authorize(req, ASSET_READ);
    if (authDenied) return authDenied;
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
    const { context, denied: authDenied } = await this.authorize(req, ASSET_READ);
    if (authDenied) return authDenied;

    const stats = await this.assetService.getStatistics(context);

    return createApiResponse(stats);
  }

  /**
   * PUT /api/v2/assets/bulk-update - Bulk update assets
   */
  async bulkUpdate(req: NextRequest): Promise<NextResponse> {
    const { context, denied: authDenied } = await this.authorize(req, ASSET_UPDATE);
    if (authDenied) return authDenied;
    const data = await req.json();

    // Validate request body
    const validation = bulkUpdateAssetSchema.safeParse(data);
    if (!validation.success) {
      return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.issues);
    }

    for (const { asset_id, data: updateData } of validation.data.assets) {
      const proposedChanges = updateData.client_id === undefined ? undefined : { clientId: updateData.client_id };
      const denied = await this.authorizeRecord(context, asset_id, 'update', proposedChanges);
      if (denied) return denied;
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
    const { context, denied: authDenied } = await this.authorize(req, ASSET_UPDATE);
    if (authDenied) return authDenied;
    const data = await req.json();

    // Validate request body
    const validation = bulkAssetStatusSchema.safeParse(data);
    if (!validation.success) {
      return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.issues);
    }

    for (const assetId of validation.data.asset_ids) {
      const denied = await this.authorizeRecord(context, assetId, 'update');
      if (denied) return denied;
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
