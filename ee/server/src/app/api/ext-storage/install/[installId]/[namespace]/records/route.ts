import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { StorageServiceError, StorageValidationError } from '@/lib/extensions/storage/v2/errors';
import { getStorageServiceForInstall } from '@/lib/extensions/storage/v2/factory';
import type { StorageBulkPutRequest, StorageListRequest } from '@/lib/extensions/storage/v2/types';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';
import type { Knex } from 'knex';

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
  keyPrefix: z.string().max(256).optional(),
  includeValues: z.coerce.boolean().optional(),
  includeMetadata: z.coerce.boolean().optional(),
});

const bulkPutSchema = z.object({
  items: z
    .array(
      z.object({
        key: z.string().min(1).max(256),
        value: z.any(),
        metadata: z.record(z.any()).optional(),
        ttlSeconds: z.number().int().positive().optional(),
        ifRevision: z.number().int().nonnegative().optional(),
        schemaVersion: z.number().int().positive().optional(),
      }),
    )
    .min(1),
});

function mapError(error: unknown): NextResponse {
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
      { status },
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
      { status: 400 },
    );
  }

  console.error('[ext-storage] unexpected error', error);
  return NextResponse.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal error',
      },
    },
    { status: 500 },
  );
}

async function getTenantIdFromAuth(req: NextRequest): Promise<string | null> {
  const headerTenant = req.headers.get('x-tenant-id') ?? req.headers.get('x-tenant');
  if (headerTenant && headerTenant.trim().length > 0) {
    return headerTenant;
  }
  if (process.env.NODE_ENV !== 'production') {
    return 'tenant-dev';
  }
  // TODO: integrate real auth/session resolution for tenant context
  return null;
}

async function ensureTenantAccess(req: NextRequest, tenantId: string): Promise<void> {
  const callerTenant = await getTenantIdFromAuth(req);
  if (!callerTenant) {
    throw new StorageServiceError('UNAUTHORIZED', 'Authentication required');
  }
  if (callerTenant !== tenantId) {
    throw new StorageServiceError('UNAUTHORIZED', 'Tenant mismatch');
  }
}

async function ensureExtensionPermission(requiredAction: 'read' | 'write', tenantId: string, knex: Knex): Promise<void> {
  const currentUser = await getCurrentUser();
  if (!currentUser || !currentUser.tenant) {
    throw new StorageServiceError('UNAUTHORIZED', 'Authentication required');
  }
  if (currentUser.tenant !== tenantId) {
    throw new StorageServiceError('UNAUTHORIZED', 'Tenant mismatch');
  }
  const allowed = await hasPermission(currentUser, 'extension', requiredAction, knex);
  if (!allowed) {
    throw new StorageServiceError('UNAUTHORIZED', 'Extension access denied');
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { installId: string; namespace: string } },
) {
  try {
    const search = listQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams.entries()));
    const { service, tenantId, knex } = await getStorageServiceForInstall(params.installId);
    await ensureTenantAccess(req, tenantId);
    await ensureExtensionPermission('read', tenantId, knex);

    const request: StorageListRequest = {
      namespace: params.namespace,
      limit: search.limit,
      cursor: search.cursor,
      keyPrefix: search.keyPrefix,
      includeValues: search.includeValues,
      includeMetadata: search.includeMetadata,
    };

    const result = await service.list(request);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return mapError(error);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { installId: string; namespace: string } },
) {
  try {
    const body = bulkPutSchema.parse(await req.json());
    const { service, tenantId, knex } = await getStorageServiceForInstall(params.installId);
    await ensureTenantAccess(req, tenantId);
    await ensureExtensionPermission('write', tenantId, knex);

    const request: StorageBulkPutRequest = {
      namespace: params.namespace,
      items: body.items,
    };

    const result = await service.bulkPut(request);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return mapError(error);
  }
}
export const dynamic = 'force-dynamic';
