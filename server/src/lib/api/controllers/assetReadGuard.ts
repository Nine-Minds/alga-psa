/**
 * Read guard for asset REST endpoints (C3 / alga-2026-0002683).
 *
 * Order: asset:read RBAC (403, before any load so it reveals nothing about the
 * record) -> tenant-scoped load -> record-level authorization. A missing record
 * and a record-level denial both answer the SAME 404, so the record-level check
 * cannot be used to probe asset ids.
 */
import { hasApiContextPermission } from '../middleware/apiContextPermission';
import type { NextResponse } from 'next/server';
import { getCurrentUser } from '@alga-psa/auth';
import { AssetService } from '../services/AssetService';
import { runWithApiKeyOrSession } from '../middleware/runWithApiKeyOrSession';
import { createErrorResponse } from '../utils/response';
import type { ApiContext } from '../middleware/apiMiddleware';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../middleware/apiErrors';
import { getConnection } from '../../db/db';
import { authorizeApiResourceRead } from './authorizationKernel';
import { projectApiRecord } from './apiRecordProjection';

export interface AssetReadAuthorization {
  record: Record<string, any>;
  redactedFields: string[];
}

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

/**
 * Throw-based core of the asset read guard, shared by REST routes (via
 * guardAssetRead) and callers that must throw (e.g. document attach adapters).
 * Throws UnauthorizedError (401), ForbiddenError (403) or NotFoundError (404;
 * both a missing record and a record-level denial).
 */
export async function assertAssetRecordAccess(
  context: ApiContext,
  assetId: string,
  loader: AssetAuthorizationLoader,
  extraReadResources: Array<'ticket'> = [],
): Promise<AssetReadAuthorization> {
  if (!context.user) {
    throw new UnauthorizedError('User context required');
  }
  const knex = await getConnection(context.tenant);

  for (const resource of ['asset', ...extraReadResources] as const) {
    if (!(await hasApiContextPermission(context, resource, 'read', knex))) {
      throw new ForbiddenError(`Permission denied: Cannot read ${resource}`);
    }
  }

  // LEVERAGE: friction guard-needs-db-in-context — the API-key path has no
  // ambient tenant, so the loader's getDbForContext() would throw unless the
  // connection we already hold is handed in explicitly.
  const record = await loader.getAuthorizationRecord(assetId, { ...context, db: knex } as ApiContext);
  if (!record) {
    throw new NotFoundError(ASSET_NOT_FOUND_MESSAGE);
  }

  const decision = await authorizeApiResourceRead({
    knex,
    tenant: context.tenant,
    user: context.user,
    apiKeyId: (context as any).apiKeyId,
    resource: 'asset',
    recordContext: record as any,
  });
  if (!decision.allowed) {
    throw new NotFoundError(ASSET_NOT_FOUND_MESSAGE);
  }
  const projected = projectApiRecord('asset', record, decision.redactedFields);
  if (!projected) throw new NotFoundError(ASSET_NOT_FOUND_MESSAGE);
  return { record: projected as Record<string, any>, redactedFields: decision.redactedFields };
}

export async function authorizeAssetRecordAccess(
  context: ApiContext,
  assetId: string,
  loader: AssetAuthorizationLoader,
  extraReadResources: Array<'ticket'> = [],
): Promise<AssetReadAuthorization | NextResponse> {
  try {
    return await assertAssetRecordAccess(context, assetId, loader, extraReadResources);
  } catch (error) {
    if (error instanceof UnauthorizedError) return createErrorResponse('User context required', 401, 'UNAUTHORIZED');
    if (error instanceof ForbiddenError) return createErrorResponse(error.message, 403, 'FORBIDDEN');
    if (error instanceof NotFoundError) return assetNotFoundResponse();
    throw error;
  }
}

/** Returns an error response when the caller may not read the asset, else null. */
export async function guardAssetRead(
  context: ApiContext,
  assetId: string,
  loader: AssetAuthorizationLoader,
  extraReadResources: Array<'ticket'> = [],
): Promise<NextResponse | null> {
  const authorization = await authorizeAssetRecordAccess(context, assetId, loader, extraReadResources);
  return 'record' in authorization ? null : authorization;
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
