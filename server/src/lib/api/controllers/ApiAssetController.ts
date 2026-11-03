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
import { guardAssetRead, readAssetGateProjection, readAssetProjection } from './assetReadGuard';
import {
  projectApiResourceRead,
  projectApiResourceReads,
  reprojectUnderDecision,
  reprojectUnderDecisions,
  type AuthorizedProjection,
} from './authorizationKernel';
import {
  ASSET_ASSIGNMENT_SOURCE,
  ASSET_MAINTENANCE_HISTORY_SOURCE,
  ASSET_MAINTENANCE_SCHEDULE_SOURCE,
  ASSET_RECORD_SOURCE,
  ASSET_RELATIONSHIP_SOURCE,
  ASSET_TICKETS_RESPONSE_SOURCE,
} from '@alga-psa/co-managed/recordProjection';
import { resolveAssetAuthorizationRecords } from '@alga-psa/assets/lib/assetReadAuthorization';
import { buildProjectedPage } from '@alga-psa/authorization/pagination';

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
   * Authorizes and redacts asset-shaped rows (list, search, export). Rows the caller may not read, or whose
   * identifier is redacted, are dropped. Everything these routes serialize comes from the returned projections.
   */
  private async projectAssetRows(
    context: ApiContext,
    rows: Record<string, any>[],
  ): Promise<AuthorizedProjection<Record<string, any>>[]> {
    if (rows.length === 0) return [];
    const knex = await getConnection(context.tenant);
    const records = await resolveAssetAuthorizationRecords(knex, context.tenant, rows as any);
    const out: AuthorizedProjection<Record<string, any>>[] = [];
    for (const row of rows) {
      const recordContext = records.get(row.asset_id);
      if (!recordContext) continue;
      const projection = await projectApiResourceRead({
        knex,
        tenant: context.tenant,
        user: context.user,
        apiKeyId: (context as any).apiKeyId,
        kind: 'asset',
        record: row,
        recordContext,
      });
      if (projection) out.push(projection);
    }
    return out;
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
      return createErrorResponse('Invalid query parameters', 400, 'VALIDATION_ERROR', validation.error.issues);
    }

    const { page, limit, sort, order, ...filters } = validation.data;
    const listOptions = { 
      page, 
      limit, 
      sort, 
      order: order as 'asc' | 'desc' | undefined
    };
    
    // Totals exclude rows the caller cannot read, so pagination never reveals how many were hidden.
    const result = await buildProjectedPage<Record<string, any>, AuthorizedProjection<Record<string, any>>>({
      page: page || 1,
      limit: limit || 25,
      fetchPage: (sourcePage, sourceLimit) =>
        this.assetService.list({ ...listOptions, page: sourcePage, limit: sourceLimit }, context, filters),
      projectRecord: async (row) => (await this.projectAssetRows(context, [row]))[0] ?? null,
    });

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
    const context = await this.requireAllowedContext(req);
    // One kernel decision: it authorizes the asset and redacts the detailed record that is serialized.
    const { projection: asset, denied } = await readAssetProjection(
      context,
      params.id,
      this.assetService,
      () => this.assetService.getWithDetails(params.id, context),
    );
    if (denied) return denied;

    const relationships = await this.projectAssetRelationships(context, asset, (asset as any).relationships ?? []);

    return createApiResponse({
      ...asset,
      relationships,
      _links: getHateoasLinks('asset', params.id)
    });
  }

  private async projectAssetRelationships(
    context: ApiContext,
    parentProjection: AuthorizedProjection<Record<string, any>>,
    relationships: Record<string, any>[],
  ): Promise<AuthorizedProjection<Record<string, any>>[]> {
    if (relationships.length === 0) return [];
    const knex = await getConnection(context.tenant);
    const projected: AuthorizedProjection<Record<string, any>>[] = [];
    for (const relationship of relationships) {
      const parentVisible = reprojectUnderDecision(parentProjection, relationship, ASSET_RELATIONSHIP_SOURCE);
      if (!parentVisible || typeof parentVisible.related_asset_id !== 'string') continue;

      const recordContext = await this.assetService.getAuthorizationRecord(
        parentVisible.related_asset_id,
        { ...context, db: knex } as ApiContext,
      );
      if (!recordContext) continue;

      const relatedProjection = await projectApiResourceRead({
        knex,
        tenant: context.tenant,
        user: context.user,
        apiKeyId: (context as any).apiKeyId,
        kind: 'asset',
        record: parentVisible as Record<string, any>,
        recordContext: recordContext as any,
        source: ASSET_RELATIONSHIP_SOURCE,
      });
      if (relatedProjection) projected.push(relatedProjection);
    }
    return projected;
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
      return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.issues);
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
    const context = await this.requireAllowedContext(req);
    const permissionDenied = await this.requirePermissions(context, [{ resource: 'asset', action: 'update' }]);
    if (permissionDenied) return permissionDenied;

    const data = await req.json();
    
    // Validate request body
    const validation = updateAssetSchema.safeParse(data);
    if (!validation.success) {
      return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.issues);
    }

    const result = await this.updateAuthorizedAssets(context, [{ assetId: params.id, data: validation.data }]);
    if (result.denied) return result.denied;
    const [projection] = result.assets;
    
    return createApiResponse({
      ...projection,
      _links: getHateoasLinks('asset', projection.asset_id)
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
    const { projection: parent, denied } = await readAssetProjection(
      context,
      params.id,
      this.assetService,
      async () => ({ asset_id: params.id }),
    );
    if (denied) return denied;

    const relationships = await this.assetService.getAssetRelationships(params.id, context);
    return createApiResponse(await this.projectAssetRelationships(context, parent, relationships));
  }

  /**
   * FR-C8: GET /api/v1/assets/{id}/assignments — the asset's assignment
   * history. An asset of another tenant is a 404, not an empty list, so a probe
   * cannot tell the difference between "no history" and "not yours".
   */
  async listAssignments(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const context = await this.requireAllowedContext(req);
    const { projection: asset, denied } = await readAssetProjection(
      context,
      params.id,
      this.assetService,
      async () => ({ asset_id: params.id }),
    );
    if (denied) return denied;

    const assignments = await this.assetService.getAssetAssignments(params.id, context);
    const projected = assignments
      .map((assignment) => reprojectUnderDecision(asset, assignment, ASSET_ASSIGNMENT_SOURCE))
      .filter((assignment): assignment is AuthorizedProjection<Record<string, any>> => assignment !== null);
    return createApiResponse(projected);
  }

  /** FR-B4: GET /api/v1/asset-statuses — the tenant's status registry. */
  async listStatuses(req: NextRequest): Promise<NextResponse> {
    const context = await this.requireAllowedContext(req);
    const denied = await this.requireReadPermissions(context, ['asset']);
    if (denied) return denied;

    const includeArchived = new URL(req.url).searchParams.get('include_archived') === 'true';
    const statuses = await this.assetService.listAssetStatuses(context, { includeArchived });
    return createApiResponse(statuses);
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

  /** Authorize every target before any mutation; callers must first enforce asset:update RBAC. */
  private async authorizeAssetUpdateTargets(
    context: ApiContext,
    assetIds: readonly string[],
  ): Promise<{
    denied: NextResponse | null;
    gates: Map<string, AuthorizedProjection<Record<string, any>>>;
  }> {
    const knex = await getConnection(context.tenant);
    const uniqueIds = [...new Set(assetIds)];
    const records = await Promise.all(uniqueIds.map((id) => this.assetService.getAuthorizationRecord(id, context)));
    if (records.some((record) => record === null)) {
      return { denied: createErrorResponse('Asset not found', 404, 'NOT_FOUND'), gates: new Map() };
    }

    const gates = await Promise.all(uniqueIds.map((id, index) => projectApiResourceRead({
      knex,
      tenant: context.tenant,
      user: context.user,
      apiKeyId: (context as any).apiKeyId,
      kind: 'asset',
      record: { asset_id: id },
      recordContext: records[index]!,
    })));
    if (gates.some((gate) => gate === null)) {
      return { denied: createErrorResponse('Asset not found', 404, 'NOT_FOUND'), gates: new Map() };
    }

    return {
      denied: null,
      gates: new Map(uniqueIds.map((id, index) => [id, gates[index]!])),
    };
  }

  /** Shared single/bulk write path: all policy gates precede writes, and only projected rows are returned. */
  private async updateAuthorizedAssets(
    context: ApiContext,
    updates: Array<{ assetId: string; data: Record<string, any> }>,
  ): Promise<{
    denied: NextResponse | null;
    assets: AuthorizedProjection<Record<string, any>>[];
  }> {
    const authorization = await this.authorizeAssetUpdateTargets(context, updates.map(({ assetId }) => assetId));
    if (authorization.denied) return { denied: authorization.denied, assets: [] };

    const updatedRows = await Promise.all(updates.map(({ assetId, data }) =>
      this.assetService.update(assetId, data, context)));
    if (updatedRows.some((row) => row === null)) {
      return { denied: createErrorResponse('Asset not found', 404, 'NOT_FOUND'), assets: [] };
    }

    const assets = updatedRows.map((row, index) => {
      const gate = authorization.gates.get(updates[index].assetId);
      return gate && row ? reprojectUnderDecision(gate, row, ASSET_RECORD_SOURCE) : null;
    });
    if (assets.some((asset) => asset === null)) {
      return { denied: createErrorResponse('Asset not found', 404, 'NOT_FOUND'), assets: [] };
    }
    return { denied: null, assets: assets as AuthorizedProjection<Record<string, any>>[] };
  }

  /**
   * GET /api/v1/assets/{id}/tickets - List tickets linked to an asset
   */
  async listTickets(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const context = await this.requireAllowedContext(req);

    // Response joins ticket data onto an asset — require read on both resources.
    const { projection: assetGate, denied } = await readAssetGateProjection(
      context, params.id, this.assetService, ['ticket'],
    );
    if (denied) return denied;

    // Ticket-owned fields: each ticket is redacted under the caller's ticket policy; hidden tickets are dropped.
    const tickets = await this.assetService.getAssetTickets(params.id, context);
    const knex = await getConnection(context.tenant);
    const ticketProjections = await projectApiResourceReads({
      knex,
      tenant: context.tenant,
      user: context.user,
      apiKeyId: (context as any).apiKeyId,
      kind: 'ticket',
      records: tickets,
    });
    const projectionsByTicketId = new Map(ticketProjections.map((projection) => [projection.ticket_id, projection]));
    const visible = tickets.flatMap((ticket) => {
      const ticketProjection = projectionsByTicketId.get(ticket.ticket_id);
      if (!ticketProjection) return [];
      const projection = reprojectUnderDecisions(
        [assetGate, ticketProjection], ticket, ASSET_TICKETS_RESPONSE_SOURCE,
      );
      return projection ? [projection] : [];
    });

    return createApiResponse(visible);
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
      return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.issues);
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
      return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.issues);
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
    const { projection, denied } = await readAssetProjection(
      context,
      params.id,
      this.assetService,
      async () => ({
        asset_id: params.id,
        documents: await this.assetService.getAssetDocuments(params.id, context),
      }),
    );
    if (denied) return denied;

    return createApiResponse(projection.documents ?? []);
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
      return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.issues);
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
    const { projection: asset, denied } = await readAssetProjection(
      context,
      params.id,
      this.assetService,
      async () => ({ asset_id: params.id }),
    );
    if (denied) return denied;

    const schedules = await this.assetService.getMaintenanceSchedules(params.id, context);
    const projected = schedules
      .map((schedule) => reprojectUnderDecision(asset, schedule, ASSET_MAINTENANCE_SCHEDULE_SOURCE))
      .filter((schedule): schedule is AuthorizedProjection<Record<string, any>> => schedule !== null);
    return createApiResponse(projected);
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
      return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.issues);
    }

    const schedule = await this.assetService.createMaintenanceSchedule(params.id, validation.data, context);
    
    return createApiResponse(schedule, 201);
  }

  /**
   * PUT /api/v2/assets/maintenance/{scheduleId} - Update maintenance schedule
   */
  async updateMaintenanceSchedule(req: NextRequest, params: { scheduleId: string }): Promise<NextResponse> {
    const context = await this.requireAllowedContext(req);
    const permissionDenied = await this.requirePermissions(context, [{ resource: 'asset', action: 'update' }]);
    if (permissionDenied) return permissionDenied;

    const data = await req.json();
    
    // Validate request body
    const validation = updateMaintenanceScheduleSchema.safeParse(data);
    if (!validation.success) {
      return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.issues);
    }

    const existing = await this.assetService.getMaintenanceScheduleForUpdate(params.scheduleId, context);
    if (!existing) return createErrorResponse('Maintenance schedule not found', 404, 'NOT_FOUND');
    const authorization = await this.authorizeAssetUpdateTargets(context, [existing.asset_id]);
    if (authorization.denied) return authorization.denied;
    const assetGate = authorization.gates.get(existing.asset_id);
    const existingProjection = assetGate
      ? reprojectUnderDecision(assetGate, existing, ASSET_MAINTENANCE_SCHEDULE_SOURCE)
      : null;
    if (!existingProjection) return createErrorResponse('Maintenance schedule not found', 404, 'NOT_FOUND');

    const schedule = await this.assetService.updateMaintenanceSchedule(params.scheduleId, validation.data, context);
    const projection = reprojectUnderDecision(assetGate!, schedule, ASSET_MAINTENANCE_SCHEDULE_SOURCE);
    if (!projection) return createErrorResponse('Maintenance schedule not found', 404, 'NOT_FOUND');

    return createApiResponse(projection);
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
      return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.issues);
    }

    const maintenance = await this.assetService.recordMaintenance(params.id, validation.data, context);
    
    return createApiResponse(maintenance, 201);
  }

  /**
   * GET /api/v2/assets/{id}/history - Get maintenance history
   */
  async getMaintenanceHistory(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const context = await this.requireAllowedContext(req);
    const { projection: asset, denied } = await readAssetProjection(
      context,
      params.id,
      this.assetService,
      async () => ({ asset_id: params.id }),
    );
    if (denied) return denied;

    const history = await this.assetService.getMaintenanceHistory(params.id, context);
    const projected = history
      .map((entry) => reprojectUnderDecision(asset, entry, ASSET_MAINTENANCE_HISTORY_SOURCE))
      .filter((entry): entry is AuthorizedProjection<Record<string, any>> => entry !== null);
    return createApiResponse(projected);
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
      return createErrorResponse('Invalid query parameters', 400, 'VALIDATION_ERROR', validation.error.issues);
    }

    const assets = await this.projectAssetRows(context, await this.assetService.search(validation.data, context));

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

    // Project before filtering/serializing: nothing below sees a field or row the caller may not read.
    const projected: Record<string, any>[] = await this.projectAssetRows(context, rows);
    rows = projected;

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
    if (!context.user) return createErrorResponse('User context required', 401, 'UNAUTHORIZED');

    const knex = await getConnection(context.tenant);
    if (!(await hasPermission(context.user, 'asset', 'read', knex))) {
      return createErrorResponse('Permission denied: Cannot read asset', 403, 'FORBIDDEN');
    }

    // Page tenant rows and authorize each record before it can contribute to an aggregate.
    const pageSize = 200;
    const assets: AuthorizedProjection<Record<string, any>>[] = [];
    let page = 1;
    let fetched = 0;
    let sourceTotal = Number.POSITIVE_INFINITY;
    while (fetched < sourceTotal) {
      const result = await this.assetService.list({ page, limit: pageSize }, context);
      fetched += result.data.length;
      sourceTotal = result.total;
      assets.push(...await this.projectAssetRows(context, result.data));
      if (result.data.length < pageSize) break;
      page += 1;
    }

    const visibleAssetIds = assets.map((asset) => String(asset.asset_id));
    const [deployableStatusSlugs, maintenanceRows] = await Promise.all([
      this.assetService.getDeployableStatusSlugs(context),
      this.assetService.getMaintenanceSchedulesForAssets(context, visibleAssetIds),
    ]);
    const schedulesByAsset = new Map<string, Array<Record<string, any>>>();
    for (const schedule of maintenanceRows) {
      const schedules = schedulesByAsset.get(schedule.asset_id) ?? [];
      schedules.push(schedule);
      schedulesByAsset.set(schedule.asset_id, schedules);
    }

    // Related schedules are projected under each asset's original decision before aggregate logic sees them.
    const projectionsWithSchedules: Record<string, any>[] = [];
    for (const asset of assets) {
      const projection = reprojectUnderDecision(asset, {
        ...asset,
        maintenance_schedules: schedulesByAsset.get(String(asset.asset_id)) ?? [],
      }, ASSET_RECORD_SOURCE);
      if (projection) projectionsWithSchedules.push(projection);
    }

    return createApiResponse(this.assetService.getStatisticsFromProjections(
      projectionsWithSchedules,
      deployableStatusSlugs,
    ));
  }

  /**
   * PUT /api/v2/assets/bulk-update - Bulk update assets
   */
  async bulkUpdate(req: NextRequest): Promise<NextResponse> {
    const context = await this.requireAllowedContext(req);
    const permissionDenied = await this.requirePermissions(context, [{ resource: 'asset', action: 'update' }]);
    if (permissionDenied) return permissionDenied;

    const data = await req.json();
    
    // Validate request body
    const validation = bulkUpdateAssetSchema.safeParse(data);
    if (!validation.success) {
      return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.issues);
    }

    const result = await this.updateAuthorizedAssets(context, validation.data.assets.map(({ asset_id, data: updateData }) =>
      ({ assetId: asset_id, data: updateData })));
    if (result.denied) return result.denied;

    return createApiResponse(result.assets, 200, { message: `Updated ${result.assets.length} assets` });
  }

  /**
   * PUT /api/v2/assets/bulk-status - Bulk update asset status
   */
  async bulkStatusUpdate(req: NextRequest): Promise<NextResponse> {
    const context = await this.requireAllowedContext(req);
    const permissionDenied = await this.requirePermissions(context, [{ resource: 'asset', action: 'update' }]);
    if (permissionDenied) return permissionDenied;

    const data = await req.json();
    
    // Validate request body
    const validation = bulkAssetStatusSchema.safeParse(data);
    if (!validation.success) {
      return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', validation.error.issues);
    }

    const result = await this.updateAuthorizedAssets(context, validation.data.asset_ids.map((assetId: string) =>
      ({ assetId, data: { status: validation.data.status } })));
    if (result.denied) return result.denied;

    return createApiResponse(result.assets, 200, { message: `Updated status for ${result.assets.length} assets` });
  }

  // Helper method to convert data to CSV
  private convertToCSV(data: any[]): string {
    if (data.length === 0) return '';
    
    // Redactions can differ per row, so the header set is the union of the projected rows' keys.
    const headers = Array.from(new Set(data.flatMap((row) => Object.keys(row))));
    const csvHeaders = headers.join(',');
    const csvRows = data.map(row => 
      headers.map(header => {
        const value = row[header];
        // Escape quotes and wrap in quotes if contains comma
        if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value ?? '';
      }).join(',')
    );
    
    return [csvHeaders, ...csvRows].join('\n');
  }
}
