import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getStorageServiceForInstall } from '@/lib/extensions/storage/v2/factory';
import {
  StorageServiceError,
  StorageValidationError,
} from '@/lib/extensions/storage/v2/errors';

export const dynamic = 'force-dynamic';

const baseSchema = z.object({
  operation: z.enum(['put', 'get', 'list', 'delete', 'bulkPut']),
  namespace: z.string().min(1).max(128),
});

const putSchema = baseSchema.extend({
  key: z.string().min(1).max(256),
  value: z.any(),
  metadata: z.record(z.any()).optional(),
  ttlSeconds: z.number().int().positive().optional(),
  ifRevision: z.number().int().nonnegative().optional(),
  schemaVersion: z.number().int().positive().optional(),
});

const getSchema = baseSchema.extend({
  key: z.string().min(1).max(256),
  ifRevision: z.number().int().nonnegative().optional(),
});

const deleteSchema = baseSchema.extend({
  key: z.string().min(1).max(256),
  ifRevision: z.number().int().nonnegative().optional(),
});

const listSchema = baseSchema.extend({
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
  keyPrefix: z.string().max(256).optional(),
  includeValues: z.boolean().optional(),
  includeMetadata: z.boolean().optional(),
});

const bulkPutSchema = baseSchema.extend({
  items: z
    .array(
      z.object({
        key: z.string().min(1).max(256),
        value: z.any(),
        metadata: z.record(z.any()).optional(),
        ttlSeconds: z.number().int().positive().optional(),
        ifRevision: z.number().int().nonnegative().optional(),
        schemaVersion: z.number().int().positive().optional(),
      })
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
      { error: error.message, code: error.code, details: error.details ?? null },
      { status }
    );
  }

  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { error: 'Validation error', details: error.flatten() },
      { status: 400 }
    );
  }

  console.error('[ext-storage-internal] unexpected error', error);
  return NextResponse.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, { status: 500 });
}

function ensureRunnerAuth(req: NextRequest): void {
  const expected = process.env.RUNNER_STORAGE_API_TOKEN;
  if (!expected) {
    throw new StorageServiceError('UNAUTHORIZED', 'Runner token not configured');
  }
  const provided = req.headers.get('x-runner-auth');
  if (!provided || provided !== expected) {
    throw new StorageServiceError('UNAUTHORIZED', 'Invalid runner token');
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { installId: string } }
) {
  try {
    ensureRunnerAuth(req);

    const raw = await req.json();
    const base = baseSchema.parse(raw);
    const { service } = await getStorageServiceForInstall(params.installId);

    switch (base.operation) {
      case 'put': {
        const input = putSchema.parse(raw);
        const result = await service.put({
          namespace: input.namespace,
          key: input.key,
          value: input.value,
          metadata: input.metadata,
          ttlSeconds: input.ttlSeconds,
          ifRevision: input.ifRevision,
          schemaVersion: input.schemaVersion,
        });
        return NextResponse.json(result, { status: 200 });
      }
      case 'get': {
        const input = getSchema.parse(raw);
        const result = await service.get({
          namespace: input.namespace,
          key: input.key,
          ifRevision: input.ifRevision,
        });
        return NextResponse.json(result, { status: 200 });
      }
      case 'delete': {
        const input = deleteSchema.parse(raw);
        const success = await service.delete({
          namespace: input.namespace,
          key: input.key,
          ifRevision: input.ifRevision,
        });
        return NextResponse.json({ success }, { status: 200 });
      }
      case 'list': {
        const input = listSchema.parse(raw);
        const result = await service.list({
          namespace: input.namespace,
          limit: input.limit,
          cursor: input.cursor,
          keyPrefix: input.keyPrefix,
          includeValues: input.includeValues,
          includeMetadata: input.includeMetadata,
        });
        return NextResponse.json(result, { status: 200 });
      }
      case 'bulkPut': {
        const input = bulkPutSchema.parse(raw);
        const result = await service.bulkPut({
          namespace: input.namespace,
          items: input.items,
        });
        return NextResponse.json(result, { status: 200 });
      }
      default:
        return NextResponse.json({ error: 'Unsupported operation' }, { status: 400 });
    }
  } catch (error) {
    return mapError(error);
  }
}
