import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { StorageServiceError, StorageValidationError } from '@/lib/extensions/storage/v2/errors';
import { getStorageServiceForInstall } from '@/lib/extensions/storage/v2/factory';
import type { StorageBulkPutRequest, StorageListRequest } from '@/lib/extensions/storage/v2/types';
import { isStorageApiEnabled } from '@/lib/extensions/storage/v2/config';

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
    return NextResponse.json({ error: error.message, code: error.code, details: error.details ?? null }, { status });
  }

  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { error: 'Validation error', details: error.flatten() },
      { status: 400 },
    );
  }

  console.error('[ext-storage] unexpected error', error);
  return NextResponse.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, { status: 500 });
}

async function getTenantIdFromAuth(_req: NextRequest): Promise<string | null> {
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

export async function GET(
  req: NextRequest,
  { params }: { params: { installId: string; namespace: string } },
) {
  try {
    if (!isStorageApiEnabled()) {
      return NextResponse.json({ error: 'Storage API disabled' }, { status: 404 });
    }
    const search = listQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams.entries()));
    const { service, tenantId } = await getStorageServiceForInstall(params.installId);
    await ensureTenantAccess(req, tenantId);

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
    if (!isStorageApiEnabled()) {
      return NextResponse.json({ error: 'Storage API disabled' }, { status: 404 });
    }
    const body = bulkPutSchema.parse(await req.json());
    const { service, tenantId } = await getStorageServiceForInstall(params.installId);
    await ensureTenantAccess(req, tenantId);

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
