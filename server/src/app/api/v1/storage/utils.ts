import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { Knex } from 'knex';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import { findUserByIdForApi } from '@/lib/actions/user-actions/findUserByIdForApi';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';
import { hasPermission } from '@/lib/auth/rbac';
import { runWithTenant } from '@/lib/db';
import { StorageServiceError, StorageValidationError } from '@/lib/storage/api/errors';

export interface StorageAuthContext {
  tenantId: string;
  currentUser: Awaited<ReturnType<typeof getCurrentUser>> | Awaited<ReturnType<typeof findUserByIdForApi>>;
  authType: 'session' | 'api-key';
}

export async function resolveStorageAuthContext(req: NextRequest): Promise<StorageAuthContext> {
  const apiKey = req.headers.get('x-api-key');

  const sessionUser = await getCurrentUser();
  const sessionTenant = sessionUser?.tenant ?? null;

  if (sessionUser) {
    if (!sessionTenant) {
      throw new StorageServiceError('UNAUTHORIZED', 'Tenant not provided');
    }
    const tenantId = sessionTenant;
    return { tenantId, currentUser: sessionUser, authType: 'session' };
  }

  if (apiKey) {
    let keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
    if (!keyRecord) {
      throw new StorageServiceError('UNAUTHORIZED', 'Invalid API key');
    }
    const tenantId = keyRecord.tenant;
    if (!tenantId) {
      throw new StorageServiceError('UNAUTHORIZED', 'Tenant not found for API key');
    }

    const user = await findUserByIdForApi(keyRecord.user_id, tenantId);
    if (!user) {
      throw new StorageServiceError('UNAUTHORIZED', 'User not found for API key');
    }

    return { tenantId, currentUser: user, authType: 'api-key' };
  }

  if (process.env.NODE_ENV !== 'production') {
    return { tenantId: 'tenant-dev', currentUser: null, authType: 'session' };
  }

  throw new StorageServiceError('UNAUTHORIZED', 'Authentication required');
}

export async function ensureStoragePermission(
  requiredAction: 'read' | 'write',
  authContext: StorageAuthContext,
  knex: Knex,
): Promise<void> {
  const { currentUser, tenantId } = authContext;

  if (!currentUser || !currentUser.tenant) {
    throw new StorageServiceError('UNAUTHORIZED', 'Authentication required');
  }

  if (currentUser.tenant !== tenantId) {
    throw new StorageServiceError('UNAUTHORIZED', 'Tenant mismatch');
  }

  const allowed = await runWithTenant(tenantId, async () =>
    hasPermission(currentUser, 'storage', requiredAction, knex),
  );
  if (!allowed) {
    throw new StorageServiceError('UNAUTHORIZED', 'Storage access denied');
  }
}

const DEFAULT_ERROR_HEADERS = {
  'Cache-Control': 'no-store',
  Vary: 'authorization,x-api-key,if-revision-match',
};

export function mapStorageError(error: unknown): NextResponse {
  if (error instanceof StorageServiceError || error instanceof StorageValidationError) {
    const status = (() => {
      switch (error.code) {
        case 'VALIDATION_FAILED':
        case 'LIMIT_EXCEEDED':
          return 400;
        case 'UNAUTHORIZED':
          return 401;
        case 'NAMESPACE_DENIED':
          return 403;
        case 'NOT_FOUND':
          return 404;
        case 'REVISION_MISMATCH':
          return 409;
        case 'QUOTA_EXCEEDED':
        case 'RATE_LIMITED':
          return 429;
        default:
          return 500;
      }
    })();

    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          details: error.details ?? null,
        },
      },
      { status, headers: DEFAULT_ERROR_HEADERS },
    );
  }

  if (error instanceof z.ZodError) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation error',
          details: error.flatten(),
        },
      },
      { status: 400, headers: DEFAULT_ERROR_HEADERS },
    );
  }

  console.error('[storage-api] unexpected error', error);
  return NextResponse.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal error',
      },
    },
    { status: 500, headers: DEFAULT_ERROR_HEADERS },
  );
}
