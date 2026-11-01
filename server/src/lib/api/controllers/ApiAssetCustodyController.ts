/**
 * Equipment custody REST controller (alga-2026-0002683, C4).
 *
 * No new RBAC resource: reads need `asset:read`, writes `asset:update`, plus the asset record-level check.
 * A caller who cannot read the asset (or an asset that does not exist) gets the same 404 with no data.
 * All behavior lives in `@alga-psa/assets/lib/custody/service`, shared with the server actions. Intake never
 * touches stock, billing or time.
 */
import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import {
  custodyEventInputSchema,
  custodyQueueFiltersSchema,
  openCustodyInputSchema,
} from '@alga-psa/assets/lib/schemas/assetCustody.schema';
import {
  getAssetCustodyService,
  listCustodyEventsService,
  listCustodyQueueService,
  openCustodyService,
  recordCustodyEventService,
  resolveCustodyToday,
} from '@alga-psa/assets/lib/custody/service';
import { isCustodyError, type CustodyErrorCode } from '@alga-psa/assets/lib/custody/errors';
import { ProductAccessError, getTenantProduct } from '@/lib/productAccess';
import { resolveProductApiBehavior } from '@/lib/productSurfaceRegistry';
import { AssetService } from '../services/AssetService';
import { createApiResponse, createErrorResponse } from '../utils/response';
import { requireRequestContext } from '../utils/requestContext';
import type { ApiContext } from '../middleware/apiMiddleware';
import { hasPermission } from '../../auth/rbac';
import { getConnection } from '../../db/db';
import { guardAssetRead } from './assetReadGuard';

const STATUS_BY_CODE: Record<CustodyErrorCode, number> = {
  not_found: 404,
  asset_not_found: 404,
  ticket_not_found: 404,
  ticket_has_no_client: 400,
  client_mismatch: 400,
  open_episode_exists: 409,
  episode_closed: 409,
  invalid_transition: 409,
  location_inactive: 400,
  holder_invalid: 400,
  no_change: 400,
  invalid_date: 400,
  tag_generation_failed: 409,
  permission_denied: 403,
};

export class ApiAssetCustodyController {
  private assetService = new AssetService();

  private async requireAllowedContext(req: NextRequest): Promise<ApiContext> {
    const context = requireRequestContext(req);
    const pathname = new URL(req.url).pathname;
    const productCode = await getTenantProduct(context.tenant);
    if (resolveProductApiBehavior(productCode, pathname) === 'denied') {
      throw new ProductAccessError(`api_route:${pathname}`, productCode);
    }
    return context;
  }

  // LEVERAGE: pattern api-user-to-asset-auth-user — the ApiContext user -> AssetAuthUser mapping is re-written per
  // asset-aware controller/route; a shared helper beside assetReadGuard would remove it.
  private authUser(context: ApiContext) {
    const user = context.user as any;
    return {
      user_id: user.user_id,
      user_type: user.user_type as 'internal' | 'client',
      clientId: user.clientId ?? null,
      roles: user.roles,
    };
  }

  /** 401 unless a user, 403 without asset:<action>. Runs BEFORE any record load. */
  private async requirePermission(context: ApiContext, action: 'read' | 'update'): Promise<NextResponse | null> {
    if (!context.user) return createErrorResponse('User context required', 401, 'UNAUTHORIZED');
    const knex = await getConnection(context.tenant);
    if (!(await hasPermission(context.user, 'asset', action, knex))) {
      return createErrorResponse(`Permission denied: Cannot ${action} asset`, 403, 'FORBIDDEN');
    }
    return null;
  }

  private fail(error: unknown): NextResponse {
    if (isCustodyError(error)) {
      return createErrorResponse(error.message, STATUS_BY_CODE[error.code] ?? 400, error.code.toUpperCase());
    }
    if (error instanceof ZodError) {
      return createErrorResponse('Invalid request data', 400, 'VALIDATION_ERROR', error.issues);
    }
    throw error;
  }

  private async guardedAsset(
    req: NextRequest,
    assetId: string,
    action: 'read' | 'update'
  ): Promise<{ context: ApiContext } | { denied: NextResponse }> {
    const context = await this.requireAllowedContext(req);
    const noPermission = await this.requirePermission(context, action);
    if (noPermission) return { denied: noPermission };
    const denied = await guardAssetRead(context, assetId, this.assetService);
    return denied ? { denied } : { context };
  }

  /** GET /api/v1/assets/{id}/custody - the open episode and the episode history. */
  async get(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const g = await this.guardedAsset(req, params.id, 'read');
    if ('denied' in g) return g.denied;
    try {
      const knex = await getConnection(g.context.tenant);
      const [state, events] = await Promise.all([
        getAssetCustodyService(knex, g.context.tenant, this.authUser(g.context), params.id),
        listCustodyEventsService(knex, g.context.tenant, this.authUser(g.context), params.id),
      ]);
      return createApiResponse({ open: state.open, episodes: state.episodes, events });
    } catch (error) {
      return this.fail(error);
    }
  }

  /** POST /api/v1/assets/{id}/custody - receive an existing asset into custody (opens an episode). */
  async open(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const g = await this.guardedAsset(req, params.id, 'update');
    if ('denied' in g) return g.denied;
    try {
      const body = await req.json().catch(() => ({}));
      const input = openCustodyInputSchema.parse({ ...body, asset_id: params.id });
      const knex = await getConnection(g.context.tenant);
      const result = await openCustodyService(knex, g.context.tenant, this.authUser(g.context), input);
      return createApiResponse({ custody: result.custody, event: result.event }, 201);
    } catch (error) {
      return this.fail(error);
    }
  }

  /** POST /api/v1/assets/{id}/custody/events - moved / handed_off / shipped / received / returned. */
  async recordEvent(req: NextRequest, params: { id: string }): Promise<NextResponse> {
    const g = await this.guardedAsset(req, params.id, 'update');
    if ('denied' in g) return g.denied;
    try {
      const input = custodyEventInputSchema.parse(await req.json().catch(() => ({})));
      const knex = await getConnection(g.context.tenant);
      const user = this.authUser(g.context);
      const { open } = await getAssetCustodyService(knex, g.context.tenant, user, params.id);
      if (!open) {
        return createErrorResponse('This asset is not in custody.', 409, 'NOT_IN_CUSTODY');
      }
      const result = await recordCustodyEventService(knex, g.context.tenant, user, open.custody_id, input);
      return createApiResponse({ custody: result.custody, event: result.event }, 201);
    } catch (error) {
      return this.fail(error);
    }
  }

  /** GET /api/v1/asset-custody - the "Equipment in custody" queue (record-level filtered). */
  async queue(req: NextRequest): Promise<NextResponse> {
    const context = await this.requireAllowedContext(req);
    const noPermission = await this.requirePermission(context, 'read');
    if (noPermission) return noPermission;
    try {
      const q = new URL(req.url).searchParams;
      const num = (k: string) => (q.get(k) ? Number(q.get(k)) : undefined);
      const filters = custodyQueueFiltersSchema.parse({
        tab: q.get('tab') ?? undefined,
        client_id: q.get('client_id') ?? undefined,
        location_id: q.get('location_id') ?? undefined,
        holder_user_id: q.get('holder_user_id') ?? undefined,
        purpose: q.get('purpose') ?? undefined,
        next_action_party: q.get('next_action_party') ?? undefined,
        mine: q.get('mine') ? q.get('mine') === 'true' : undefined,
        page: num('page'),
        pageSize: num('pageSize'),
      });
      const knex = await getConnection(context.tenant);
      const authUser = this.authUser(context);
      const today = await resolveCustodyToday(knex, context.tenant, authUser.user_id);
      const page = await listCustodyQueueService(knex, context.tenant, authUser, filters, { today });
      return createApiResponse(page);
    } catch (error) {
      return this.fail(error);
    }
  }
}

