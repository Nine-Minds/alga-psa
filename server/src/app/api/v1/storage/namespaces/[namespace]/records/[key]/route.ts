import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getStorageServiceForTenant } from '@/lib/storage/api/factory';
import { ensureStoragePermission, mapStorageError, resolveStorageAuthContext } from '../../../../utils';

const deleteQuerySchema = z.object({
  ifRevision: z.coerce.number().int().nonnegative().optional(),
});

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { namespace: string; key: string } },
) {
  try {
    const authContext = await resolveStorageAuthContext(req);
    const { service, knex } = await getStorageServiceForTenant(authContext.tenantId);
    await ensureStoragePermission('read', authContext, knex);

    const ifRevisionHeader = req.headers.get('if-revision-match');
    const result = await service.get({
      namespace: params.namespace,
      key: params.key,
      ifRevision: ifRevisionHeader ? Number(ifRevisionHeader) : undefined,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return mapStorageError(error);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { namespace: string; key: string } },
) {
  try {
    const body = await req.json();
    const authContext = await resolveStorageAuthContext(req);
    const { service, knex } = await getStorageServiceForTenant(authContext.tenantId);
    await ensureStoragePermission('write', authContext, knex);

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
    return mapStorageError(error);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { namespace: string; key: string } },
) {
  try {
    const url = new URL(req.url);
    const search = Object.fromEntries(url.searchParams.entries());
    const input = deleteQuerySchema.parse(search);

    const authContext = await resolveStorageAuthContext(req);
    const { service, knex } = await getStorageServiceForTenant(authContext.tenantId);
    await ensureStoragePermission('write', authContext, knex);

    await service.delete({ namespace: params.namespace, key: params.key, ifRevision: input.ifRevision });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return mapStorageError(error);
  }
}
