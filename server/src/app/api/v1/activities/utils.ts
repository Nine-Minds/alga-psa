/**
 * Shared helpers for the v1 User Activities API.
 *
 * Identity bridge: the underlying package actions (`fetchActivities`, `createAdHocActivity`,
 * …) are `withAuth`-wrapped and resolve the user from the NextAuth session, which is `null`
 * under API-key auth. These routes instead resolve the identity explicitly — session first,
 * then API key — and call the package's identity-explicit `*ForApi` cores under
 * `runWithTenant`. Modeled on `server/src/app/api/v1/storage/utils.ts`
 * (`resolveStorageAuthContext`).
 */

import type { NextRequest } from 'next/server';
import type { IUserWithRoles } from '@alga-psa/types';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { authenticateApiKeyRequest } from '@/lib/api/middleware/apiAuthMiddleware';
import {
  UnauthorizedError,
  NotFoundError,
  ForbiddenError,
  ValidationError,
} from '@/lib/api/middleware/apiMiddleware';

export interface ActivityAuthContext {
  tenant: string;
  user: IUserWithRoles;
}

/**
 * Resolve the caller's identity for an activities route. Tries the NextAuth session first
 * (web/SSR callers), then falls back to API-key auth (mobile + integrations). Throws
 * `UnauthorizedError` (mapped to 401 by `handleApiError`) when neither is present.
 */
export async function resolveActivityAuthContext(req: NextRequest): Promise<ActivityAuthContext> {
  const sessionUser = await getCurrentUser();
  if (sessionUser) {
    if (!sessionUser.tenant) {
      throw new UnauthorizedError('Tenant not provided');
    }
    return { tenant: sessionUser.tenant, user: sessionUser as IUserWithRoles };
  }

  const apiKey = req.headers.get('x-api-key');
  if (apiKey) {
    const apiRequest = await authenticateApiKeyRequest(req);
    const ctx = apiRequest.context;
    return { tenant: ctx.tenant, user: ctx.user as unknown as IUserWithRoles };
  }

  throw new UnauthorizedError('Authentication required');
}

/**
 * The package cores throw plain `Error`s for business-rule failures. Re-classify the known
 * messages into typed API errors so `handleApiError` maps them to the right HTTP status
 * (404 not found, 403 permission denied, 400 validation). Anything else (including already
 * typed errors with a `statusCode`, ZodErrors, and unknown failures) is returned untouched.
 */
export function classifyActivityError(error: unknown): unknown {
  if (error instanceof Error && typeof (error as { statusCode?: unknown }).statusCode !== 'number') {
    const message = error.message || '';
    if (/not found/i.test(message)) {
      return new NotFoundError(message);
    }
    if (/permission denied/i.test(message)) {
      return new ForbiddenError(message);
    }
    if (/required|must be after|invalid/i.test(message)) {
      return new ValidationError(message);
    }
  }
  return error;
}
