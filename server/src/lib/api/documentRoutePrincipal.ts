import { NextResponse, type NextRequest } from 'next/server';
import type { IUser } from '@alga-psa/types';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { findUserByIdForApi } from '@alga-psa/users/actions';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';
import { assertApiPrincipal } from '@/lib/api/middleware/apiMiddleware';

export type DocumentRoutePrincipal =
  | { ok: true; tenant: string; user: IUser }
  | { ok: false; response: NextResponse };

const unauthorized = (): DocumentRoutePrincipal => ({
  ok: false,
  response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
});

/**
 * The one authentication step shared by the `/api/documents/*` byte and content routes.
 * Session first (callers with a session take exactly the branch they always took), then an
 * `x-api-key` (internal users only: `assertApiPrincipal` refuses client-portal keys), else 401.
 * Callers still run `coManagedWorkspaceDenial` and their own document gates afterwards.
 */
export async function resolveDocumentRoutePrincipal(request: NextRequest): Promise<DocumentRoutePrincipal> {
  const sessionUser = await getCurrentUser();
  if (sessionUser?.tenant) {
    return { ok: true, tenant: sessionUser.tenant, user: sessionUser as IUser };
  }

  const apiKey = request.headers.get('x-api-key');
  if (!apiKey) return unauthorized();

  const keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
  if (!keyRecord?.tenant) return unauthorized();

  const apiUser = await findUserByIdForApi(keyRecord.user_id, keyRecord.tenant);
  try {
    assertApiPrincipal(apiUser);
  } catch {
    return unauthorized();
  }
  return { ok: true, tenant: keyRecord.tenant, user: apiUser as unknown as IUser };
}
