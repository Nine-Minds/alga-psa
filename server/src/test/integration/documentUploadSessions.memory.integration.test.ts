/**
 * Memory is flat for a large chunked upload: drives the route handlers directly with a generated
 * stream, one 8 MiB chunk per request, to MinIO, and reports the peak RSS growth.
 *
 * Always registered (the integration lane starts MinIO; an empty file fails the test inventory).
 * The default 256 MiB is well over the 100 MiB ceiling, so a buffering regression fails it; set
 * ALGA_UPLOAD_MEMORY_MIB=600 for the full-size measurement.
 *
 *   TEST_DB_NAME=up47_test DB_HOST=127.0.0.1 DB_PORT=55747 \
 *   STORAGE_S3_ENDPOINT=http://127.0.0.1:59747 \
 *   npx vitest run src/test/integration/documentUploadSessions.memory.integration.test.ts
 *
 * ALGA_UPLOAD_MEMORY_REPORT=<file> also writes the measurements as JSON.
 * Size and ceiling are overridable: ALGA_UPLOAD_MEMORY_MIB (default 256), ALGA_UPLOAD_MEMORY_CEILING_MIB (default 100).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import type { Knex } from 'knex';

vi.hoisted(() => { process.env.EDITION = 'enterprise'; });

const auth = vi.hoisted(() => ({ user: null as any }));
vi.mock('@alga-psa/core/jobRunnerAccessor', () => ({ getJobRunner: async () => ({ scheduleJob: async () => ({ jobId: 'job' }) }) }));
vi.mock('@alga-psa/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/auth')>();
  return {
  ...actual,
  // The session boundary: the signed-in test user, or the real AuthenticationError.
  withAuth: (fn: any) => async (...args: unknown[]) => {
    if (!auth.user) throw new actual.AuthenticationError();
    return fn(auth.user, { tenant: auth.user.tenant }, ...args);
  },
  hasPermission: async () => true,
  checkMultiplePermissions: async (_user: unknown, checks: { resource: string; action: string }[]) => checks.map((c) => ({ ...c, granted: true })),
  };
});
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: async () => true,
  checkMultiplePermissions: async (_user: unknown, checks: { resource: string; action: string }[]) => checks.map((c) => ({ ...c, granted: true })),
}));
vi.mock('@/lib/auth/rbac', () => ({ hasPermission: async () => true }));

import { tenantDb } from '@alga-psa/db';
import { CreateBucketCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { StorageProviderFactory } from '@alga-psa/storage/StorageProviderFactory';
import { clearCachedStorageConfig } from '@alga-psa/storage/config/storage';
import { completeUploadHandler, createUploadHandler, putChunkHandler } from '@/lib/api/documentUploads/handlers';
import { MiB, contentRange, createUploadFixture, dropUploadFixture, generatedBody, request, type UploadFixture } from './support/documentUploadHarness';

const TOTAL_MIB = Number(process.env.ALGA_UPLOAD_MEMORY_MIB || 256);
const CEILING_MIB = Number(process.env.ALGA_UPLOAD_MEMORY_CEILING_MIB || 100);

describe('chunked upload memory', () => {
  let db: Knex;
  let fx: UploadFixture;
  let s3: S3Client;

  beforeAll(async () => {
    process.env.STORAGE_DEFAULT_PROVIDER = 's3';
    process.env.STORAGE_S3_REGION ||= 'us-east-1';
    process.env.STORAGE_S3_BUCKET ||= 'alga-upload-sessions-test';
    process.env.STORAGE_S3_ENDPOINT ||= 'http://127.0.0.1:9000';
    process.env.STORAGE_S3_ACCESS_KEY ||= 'minioadmin';
    process.env.STORAGE_S3_SECRET_KEY ||= 'minioadmin';
    // The provider limit is configuration; this test needs room for the whole file.
    process.env.STORAGE_S3_MAX_FILE_SIZE = String((TOTAL_MIB + 100) * MiB);
    clearCachedStorageConfig();
    StorageProviderFactory.clearProvider();
    s3 = new S3Client({
      region: process.env.STORAGE_S3_REGION, endpoint: process.env.STORAGE_S3_ENDPOINT, forcePathStyle: true,
      credentials: { accessKeyId: process.env.STORAGE_S3_ACCESS_KEY!, secretAccessKey: process.env.STORAGE_S3_SECRET_KEY! },
    });
    await s3.send(new CreateBucketCommand({ Bucket: process.env.STORAGE_S3_BUCKET! })).catch((e) => {
      if (!/BucketAlreadyOwnedByYou|BucketAlreadyExists/.test(String(e?.name ?? e))) throw e;
    });
    db = await createTestDbConnection();
    fx = await createUploadFixture(db);
    auth.user = { user_id: fx.uploader, tenant: fx.tenant, user_type: 'internal', roles: [] };
  }, 600_000);

  afterAll(async () => {
    await dropUploadFixture(db, fx).catch(() => undefined);
    await db?.destroy().catch(() => undefined);
  }, 600_000);

  it(`uploads ${TOTAL_MIB} MiB in chunks with flat memory`, async () => {
    const total = TOTAL_MIB * MiB;
    const created = await createUploadHandler(request('POST', '/api/documents/uploads', {
      json: { fileName: 'huge.bin', mimeType: 'application/octet-stream', size: total, entityType: 'ticket', entityId: fx.ticket },
    }));
    expect(created.status).toBe(201);
    const { sessionId, chunkSize } = await created.json();

    (global as any).gc?.();
    const baseline = process.memoryUsage();
    let peakRss = baseline.rss;
    let peakHeap = baseline.heapUsed;
    const timer = setInterval(() => {
      const m = process.memoryUsage();
      peakRss = Math.max(peakRss, m.rss);
      peakHeap = Math.max(peakHeap, m.heapUsed);
    }, 20);
    const started = Date.now();
    let chunks = 0;
    try {
      for (let offset = 0; offset < total; offset += chunkSize) {
        const length = Math.min(chunkSize, total - offset);
        const response = await putChunkHandler(request('PUT', `/api/documents/uploads/${sessionId}`, {
          headers: contentRange(offset, length, total),
          body: generatedBody(length).body,
        }), sessionId);
        expect(response.status).toBe(200);
        chunks += 1;
      }
      const completed = await completeUploadHandler(request('POST', `/api/documents/uploads/${sessionId}/complete`), sessionId);
      expect(completed.status).toBe(200);
      const { document } = await completed.json();
      expect(document.file_size).toBe(total);
      const stored = await tenantDb(db, fx.tenant).table('documents').where({ document_id: document.document_id }).first();
      const head = await s3.send(new HeadObjectCommand({ Bucket: process.env.STORAGE_S3_BUCKET!, Key: stored.storage_path }));
      expect(head.ContentLength).toBe(total);
    } finally {
      clearInterval(timer);
    }
    const m = process.memoryUsage();
    peakRss = Math.max(peakRss, m.rss);
    const result = {
      totalMiB: TOTAL_MIB,
      chunkMiB: chunkSize / MiB,
      chunks,
      baselineRssMiB: +(baseline.rss / MiB).toFixed(1),
      peakRssMiB: +(peakRss / MiB).toFixed(1),
      rssGrowthMiB: +((peakRss - baseline.rss) / MiB).toFixed(1),
      heapGrowthMiB: +((peakHeap - baseline.heapUsed) / MiB).toFixed(1),
      seconds: +((Date.now() - started) / 1000).toFixed(1),
    };
    console.log('[upload memory]', JSON.stringify(result));
    if (process.env.ALGA_UPLOAD_MEMORY_REPORT) writeFileSync(process.env.ALGA_UPLOAD_MEMORY_REPORT, JSON.stringify(result, null, 2));
    expect(result.rssGrowthMiB).toBeLessThan(CEILING_MIB);
  }, 1_800_000);
});
