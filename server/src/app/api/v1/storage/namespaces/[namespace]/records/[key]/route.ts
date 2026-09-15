import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getStorageServiceForTenant } from '@/lib/storage/api/factory';
import { appendRateLimitHeaders } from '@/lib/api/rateLimit/responseHeaders';
import { ensureStoragePermission, mapStorageError, resolveStorageAuthContext } from '../../../../utils';

const deleteQuerySchema = z.object({
  ifRevision: z.coerce.number().int().nonnegative().optional(),
});

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ namespace: string; key: string }> },
) {
  try {
    const resolvedParams = await params;
    const authContext = await resolveStorageAuthContext(req);
    const { service, knex } = await getStorageServiceForTenant(authContext.tenantId);
    await ensureStoragePermission('read', authContext, knex);

    const ifRevisionHeader = req.headers.get('if-revision-match');
    const result = await service.get({
      namespace: resolvedParams.namespace,
      key: resolvedParams.key,
      ifRevision: ifRevisionHeader ? Number(ifRevisionHeader) : undefined,
    });
    const headers = {
      'Cache-Control': 'no-store',
      Vary: 'authorization,x-api-key,if-revision-match',
    };
    return appendRateLimitHeaders(NextResponse.json(result, { status: 200, headers }), req as any);
  } catch (error) {
    return mapStorageError(error);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ namespace: string; key: string }> },
) {
  try {
    const resolvedParams = await params;
    const body = await req.json();
    const authContext = await resolveStorageAuthContext(req);
    const { service, knex } = await getStorageServiceForTenant(authContext.tenantId);
    await ensureStoragePermission('write', authContext, knex);

    const result = await service.put({
      namespace: resolvedParams.namespace,
      key: resolvedParams.key,
      value: body.value,
      metadata: body.metadata,
      ttlSeconds: body.ttlSeconds,
      ifRevision: body.ifRevision,
      schemaVersion: body.schemaVersion,
    });

    const headers = {
      'Cache-Control': 'no-store',
      Vary: 'authorization,x-api-key',
    };
    return appendRateLimitHeaders(NextResponse.json(result, { status: 200, headers }), req as any);
  } catch (error) {
    return mapStorageError(error);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ namespace: string; key: string }> },
) {
  try {
    const resolvedParams = await params;
    const url = new URL(req.url);
    const search = Object.fromEntries(url.searchParams.entries());
    const input = deleteQuerySchema.parse(search);

    const authContext = await resolveStorageAuthContext(req);
    const { service, knex } = await getStorageServiceForTenant(authContext.tenantId);
    await ensureStoragePermission('write', authContext, knex);

    await service.delete({ namespace: resolvedParams.namespace, key: resolvedParams.key, ifRevision: input.ifRevision });
    return appendRateLimitHeaders(new NextResponse(null, {
      status: 204,
      headers: {
        'Cache-Control': 'no-store',
        Vary: 'authorization,x-api-key,if-revision-match',
      },
    }), req as any);
  } catch (error) {
    return mapStorageError(error);
  }
}
