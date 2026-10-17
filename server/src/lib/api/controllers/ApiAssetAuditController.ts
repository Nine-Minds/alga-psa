/**
 * Site audit API controller (mobile 2.0 FR17).
 *
 * Reading an audit needs asset:read; starting, marking, completing and
 * cancelling need asset:update, because an audit writes asset history and the
 * asset's last-audit columns.
 */

import { NextRequest, NextResponse } from 'next/server';
import { AssetAuditService } from '../services/AssetAuditService';
import {
  assetAuditListQuerySchema,
  createAssetAuditSchema,
  markAssetAuditItemSchema,
} from '../schemas/assetAudit';
import { createApiResponse, createErrorResponse, createPaginatedResponse } from '../utils/response';
import { requireRequestContext } from '../utils/requestContext';
import { ApiContext } from '../middleware/apiMiddleware';
import { ProductAccessError, getTenantProduct } from '@/lib/productAccess';
import { resolveProductApiBehavior } from '@/lib/productSurfaceRegistry';
import { hasPermission } from '../../auth/rbac';
import { getConnection } from '../../db/db';

export class ApiAssetAuditController {
  private auditService: AssetAuditService;

  constructor() {
    this.auditService = new AssetAuditService();
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

  private async requireAssetPermission(
    context: ApiContext,
    action: 'read' | 'update',
  ): Promise<NextResponse | null> {
    if (!context.user) {
      return createErrorResponse('User context required', 401, 'UNAUTHORIZED');
    }
    const knex = await getConnection(context.tenant);
    const allowed = await hasPermission(context.user, 'asset', action, knex);
    if (!allowed) {
      return createErrorResponse(`Permission denied: Cannot ${action} asset`, 403, 'FORBIDDEN');
    }
    return null;
  }

  private serviceContext(context: ApiContext) {
    return { tenant: context.tenant, userId: context.userId, user: context.user ?? undefined } as never;
  }

  /** POST /api/v1/asset-audits */
  async create(req: NextRequest): Promise<NextResponse> {
    const context = await this.requireAllowedContext(req);
    const denied = await this.requireAssetPermission(context, 'update');
    if (denied) return denied;

    const validation = createAssetAuditSchema.safeParse(await req.json());
    if (!validation.success) {
      return createErrorResponse('Invalid request body', 400, 'VALIDATION_ERROR', validation.error.errors);
    }

    const audit = await this.auditService.start(validation.data, this.serviceContext(context));
    return createApiResponse(audit, 201);
  }

  /** GET /api/v1/asset-audits */
  async list(req: NextRequest): Promise<NextResponse> {
    const context = await this.requireAllowedContext(req);
    const denied = await this.requireAssetPermission(context, 'read');
    if (denied) return denied;

    const query = Object.fromEntries(new URL(req.url).searchParams.entries());
    const validation = assetAuditListQuerySchema.safeParse(query);
    if (!validation.success) {
      return createErrorResponse('Invalid query parameters', 400, 'VALIDATION_ERROR', validation.error.errors);
    }

    const { page = 1, limit = 25, client_id } = validation.data;
    const result = await this.auditService.list({ page, limit, client_id }, this.serviceContext(context));
    return createPaginatedResponse(result.data, { page, limit, total: result.total });
  }

  /** GET /api/v1/asset-audits/{id} */
  async getById(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const context = await this.requireAllowedContext(req);
    const denied = await this.requireAssetPermission(context, 'read');
    if (denied) return denied;

    const audit = await this.auditService.get(params.id, this.serviceContext(context));
    return createApiResponse(audit);
  }

  /** POST /api/v1/asset-audits/{id}/items */
  async markItem(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const context = await this.requireAllowedContext(req);
    const denied = await this.requireAssetPermission(context, 'update');
    if (denied) return denied;

    const validation = markAssetAuditItemSchema.safeParse(await req.json());
    if (!validation.success) {
      return createErrorResponse('Invalid request body', 400, 'VALIDATION_ERROR', validation.error.errors);
    }

    const audit = await this.auditService.markItem(params.id, validation.data, this.serviceContext(context));
    return createApiResponse(audit);
  }

  /** DELETE /api/v1/asset-audits/{id}/items/{assetId} */
  async unmarkItem(req: NextRequest, params: { id: string; assetId: string }): Promise<NextResponse> {
    const context = await this.requireAllowedContext(req);
    const denied = await this.requireAssetPermission(context, 'update');
    if (denied) return denied;

    const audit = await this.auditService.unmarkItem(params.id, params.assetId, this.serviceContext(context));
    return createApiResponse(audit);
  }

  /** POST /api/v1/asset-audits/{id}/complete */
  async complete(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const context = await this.requireAllowedContext(req);
    const denied = await this.requireAssetPermission(context, 'update');
    if (denied) return denied;

    const audit = await this.auditService.complete(params.id, this.serviceContext(context));
    return createApiResponse(audit);
  }

  /** POST /api/v1/asset-audits/{id}/cancel */
  async cancel(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const context = await this.requireAllowedContext(req);
    const denied = await this.requireAssetPermission(context, 'update');
    if (denied) return denied;

    const audit = await this.auditService.cancel(params.id, this.serviceContext(context));
    return createApiResponse(audit);
  }
}
