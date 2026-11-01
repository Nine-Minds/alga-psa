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
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../middleware/apiErrors';
import { hasPermission } from '../../auth/rbac';
import { getConnection } from '../../db/db';
import { projectApiResourceRead, reprojectUnderDecision, type AuthorizedProjection } from './authorizationKernel';
import { ASSET_RECORD_SOURCE } from '@alga-psa/co-managed/recordProjection';

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
 * Throw-based core of the asset read guard, shared by REST routes (via guardAssetRead / readAssetProjectionResponse)
 * and callers that must throw (e.g. document attach adapters). Throws UnauthorizedError (401), ForbiddenError (403)
 * or NotFoundError (404; both a missing record and a record-level denial or suppression).
 *
 * Returns the redacted projection. By default that is the authorization record (callers that only gate ignore it);
 * with `serialize` it is the record that function loads (only after access is allowed), projected under the SAME
 * single kernel decision.
 */
export async function assertAssetRecordAccess<S extends Record<string, any> = Record<string, any>>(
  context: ApiContext,
  assetId: string,
  loader: AssetAuthorizationLoader,
  extraReadResources: Array<'ticket'> = [],
  serialize?: () => Promise<S | null>,
): Promise<AuthorizedProjection<S>> {
  if (!context.user) {
    throw new UnauthorizedError('User context required');
  }
  const knex = await getConnection(context.tenant);

  for (const resource of ['asset', ...extraReadResources] as const) {
    if (!(await hasPermission(context.user, resource, 'read', knex))) {
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

  // A denied or suppressed asset answers the same 404 as a missing one.
  const gate = await projectApiResourceRead({
    knex,
    tenant: context.tenant,
    user: context.user,
    apiKeyId: (context as any).apiKeyId,
    kind: 'asset',
    record: record as Record<string, any>,
    recordContext: record as any,
  });
  if (gate === null) {
    throw new NotFoundError(ASSET_NOT_FOUND_MESSAGE);
  }
  if (!serialize) {
    return gate as unknown as AuthorizedProjection<S>;
  }

  // Nothing is read for the response until the decision allows it; the detailed record is then redacted under that
  // same decision (no second kernel call).
  const detail = await serialize();
  const projection = detail ? reprojectUnderDecision(gate, detail, ASSET_RECORD_SOURCE) : null;
  if (projection === null) {
    throw new NotFoundError(ASSET_NOT_FOUND_MESSAGE);
  }
  return projection;
}

function errorToResponse(error: unknown): NextResponse {
  if (error instanceof UnauthorizedError) {
    return createErrorResponse('User context required', 401, 'UNAUTHORIZED');
  }
  if (error instanceof ForbiddenError) {
    return createErrorResponse(error.message, 403, 'FORBIDDEN');
  }
  if (error instanceof NotFoundError) {
    return assetNotFoundResponse();
  }
  throw error;
}

/** Gate only: an error response when the caller may not read the asset, else null. Nothing is serialized from it. */
export async function guardAssetRead(
  context: ApiContext,
  assetId: string,
  loader: AssetAuthorizationLoader,
  extraReadResources: Array<'ticket'> = [],
): Promise<NextResponse | null> {
  try {
    await assertAssetRecordAccess(context, assetId, loader, extraReadResources);
    return null;
  } catch (error) {
    return errorToResponse(error);
  }
}

/** Routes that return the asset's own fields: the redacted projection of `serialize()`'s record, or an error response. */
export async function readAssetProjection<S extends Record<string, any>>(
  context: ApiContext,
  assetId: string,
  loader: AssetAuthorizationLoader,
  serialize: () => Promise<S | null>,
  extraReadResources: Array<'ticket'> = [],
): Promise<{ projection: AuthorizedProjection<S>; denied: null } | { projection: null; denied: NextResponse }> {
  try {
    return { projection: await assertAssetRecordAccess(context, assetId, loader, extraReadResources, serialize), denied: null };
  } catch (error) {
    return { projection: null, denied: errorToResponse(error) };
  }
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
