import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getStorageServiceForTenant } from '@/lib/storage/api/factory';
import type { StorageBulkPutRequest, StorageListRequest } from '@/lib/storage/api/types';
import { ensureStoragePermission, mapStorageError, resolveStorageAuthContext } from '../../../utils';

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

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { namespace: string } }) {
  try {
    const search = listQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams.entries()));
    const authContext = await resolveStorageAuthContext(req);
    const { service, knex } = await getStorageServiceForTenant(authContext.tenantId);
    await ensureStoragePermission('read', authContext, knex);

    const request: StorageListRequest = {
      namespace: params.namespace,
      limit: search.limit,
      cursor: search.cursor,
      keyPrefix: search.keyPrefix,
      includeValues: search.includeValues,
      includeMetadata: search.includeMetadata,
    };

    const result = await service.list(request);
    return NextResponse.json(result, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        Vary: 'authorization,x-api-key',
      },
    });
  } catch (error) {
    return mapStorageError(error);
  }
}

export async function POST(req: NextRequest, { params }: { params: { namespace: string } }) {
  try {
    const body = bulkPutSchema.parse(await req.json());
    const authContext = await resolveStorageAuthContext(req);
    const { service, knex } = await getStorageServiceForTenant(authContext.tenantId);
    await ensureStoragePermission('write', authContext, knex);

    const request: StorageBulkPutRequest = {
      namespace: params.namespace,
      items: body.items as StorageBulkPutRequest['items'],
    };

    const result = await service.bulkPut(request);
    return NextResponse.json(result, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        Vary: 'authorization,x-api-key',
      },
    });
  } catch (error) {
    return mapStorageError(error);
  }
}
