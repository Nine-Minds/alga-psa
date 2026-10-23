/**
 * Read guard for asset REST endpoints (C3 / alga-2026-0002683).
 *
 * Order: asset:read RBAC (403, before any load so it reveals nothing about the
 * record) -> tenant-scoped load -> record-level authorization. A missing record
 * and a record-level denial both answer the SAME 404, so the record-level check
 * cannot be used to probe asset ids.
 */
import type { NextResponse } from 'next/server';
import { getCurrentUser } from '@alga-psa/auth';
import { AssetService } from '../services/AssetService';
import { runWithApiKeyOrSession } from '../middleware/runWithApiKeyOrSession';
import { createErrorResponse } from '../utils/response';
import type { ApiContext } from '../middleware/apiMiddleware';
import { hasPermission } from '../../auth/rbac';
import { getConnection } from '../../db/db';
import { authorizeApiResourceRead } from './authorizationKernel';

export const ASSET_NOT_FOUND_MESSAGE = 'Asset not found';

export interface AssetAuthorizationLoader {
  getAuthorizationRecord(
    id: string,
    context: ApiContext,
  ): Promise<Record<string, any> | null>;
}

export function assetNotFoundResponse(): NextResponse {
  return createErrorResponse(ASSET_NOT_FOUND_MESSAGE, 404, 'NOT_FOUND');
}

/** Returns an error response when the caller may not read the asset, else null. */
export async function guardAssetRead(
  context: ApiContext,
  assetId: string,
  loader: AssetAuthorizationLoader,
  extraReadResources: Array<'ticket'> = [],
): Promise<NextResponse | null> {
  if (!context.user) {
    return createErrorResponse('User context required', 401, 'UNAUTHORIZED');
  }
  const knex = await getConnection(context.tenant);

  for (const resource of ['asset', ...extraReadResources] as const) {
    if (!(await hasPermission(context.user, resource, 'read', knex))) {
      return createErrorResponse(`Permission denied: Cannot read ${resource}`, 403, 'FORBIDDEN');
    }
  }

  // LEVERAGE: friction guard-needs-db-in-context — the API-key path has no
  // ambient tenant, so the loader's getDbForContext() would throw unless the
  // connection we already hold is handed in explicitly.
  const record = await loader.getAuthorizationRecord(assetId, { ...context, db: knex } as ApiContext);
  if (!record) {
    return assetNotFoundResponse();
  }

  const allowed = await authorizeApiResourceRead({
    knex,
    tenant: context.tenant,
    user: context.user,
    apiKeyId: (context as any).apiKeyId,
    resource: 'asset',
    recordContext: record as any,
  });
  return allowed ? null : assetNotFoundResponse();
}

/**
 * Guard for routes that delegate to `withAuth` server actions instead of the
 * controller (asset software, notes). Resolves the caller the same way those
 * actions do (API key via runWithApiKeyOrSession, else the session).
 */
export async function guardAssetReadForRequest(
  request: Request,
  assetId: string,
): Promise<NextResponse | null> {
  return runWithApiKeyOrSession(request, async () => {
    const user = await getCurrentUser();
    if (!user) {
      return createErrorResponse('User context required', 401, 'UNAUTHORIZED');
    }
    return guardAssetRead({ tenant: user.tenant, user } as ApiContext, assetId, new AssetService());
  });
}
