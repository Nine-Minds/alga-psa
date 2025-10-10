import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { StorageServiceError, StorageValidationError } from '../../../ee/server/src/lib/extensions/storage/v2/errors';
import { getStorageServiceForInstall } from '../../../ee/server/src/lib/extensions/storage/v2/factory';
import { isStorageApiEnabled } from '../../../ee/server/src/lib/extensions/storage/v2/config';
import { getCurrentUser } from '../../../server/src/lib/actions/user-actions/userActions';
import { hasPermission } from '../../../server/src/lib/auth/rbac';
import type { Knex } from 'knex';

const deleteQuerySchema = z.object({
  ifRevision: z.coerce.number().int().nonnegative().optional(),
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

export async function GET(req: NextRequest, { params }: { params: { installId: string; namespace: string; key: string } }) {
  if (!isStorageApiEnabled()) {
    return NextResponse.json({ error: 'Storage API disabled' }, { status: 404 });
  }
  try {
    const { service, tenantId, knex } = await getStorageServiceForInstall(params.installId);
    await ensureTenantAccess(req, tenantId);
    await ensureExtensionPermission('read', tenantId, knex);
    const result = await service.get({ namespace: params.namespace, key: params.key });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return mapError(error);
  }
}

export async function PUT(req: NextRequest, { params }: { params: { installId: string; namespace: string; key: string } }) {
  if (!isStorageApiEnabled()) {
    return NextResponse.json({ error: 'Storage API disabled' }, { status: 404 });
  }
  try {
    const body = await req.json();
    const { service, tenantId, knex } = await getStorageServiceForInstall(params.installId);
    await ensureTenantAccess(req, tenantId);
    await ensureExtensionPermission('write', tenantId, knex);
    const result = await service.put({
      namespace: params.namespace,
      key: params.key,
      value: body.value,
      metadata: body.metadata,
      ttlSeconds: body.ttlSeconds,
      ifRevision: body.ifRevision,
      schemaVersion: body.schemaVersion,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return mapError(error);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { installId: string; namespace: string; key: string } }) {
  if (!isStorageApiEnabled()) {
    return NextResponse.json({ error: 'Storage API disabled' }, { status: 404 });
  }
  try {
    const url = new URL(req.url);
    const search = Object.fromEntries(url.searchParams.entries());
    const input = deleteQuerySchema.parse(search);
    const { service, tenantId, knex } = await getStorageServiceForInstall(params.installId);
    await ensureTenantAccess(req, tenantId);
    await ensureExtensionPermission('write', tenantId, knex);
    await service.delete({ namespace: params.namespace, key: params.key, ifRevision: input.ifRevision });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return mapError(error);
  }
}

export const dynamic = 'force-dynamic';
