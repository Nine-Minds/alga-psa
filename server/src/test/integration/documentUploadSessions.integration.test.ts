/**
 * Resumable chunked document uploads, end to end: route handlers -> session service -> storage
 * write sessions -> document creation, against a migrated PostgreSQL and a real object store.
 *
 * Runs once per storage provider: `s3` against MinIO (STORAGE_S3_* from the environment; the
 * MinIO lane) and `local` against a temp directory. Nothing is skipped.
 *
 *   TEST_DB_NAME=up47_test DB_HOST=127.0.0.1 DB_PORT=55747 DB_PASSWORD_ADMIN=postgres \
 *   DB_PASSWORD_SERVER=postgres STORAGE_S3_ENDPOINT=http://127.0.0.1:59747 \
 *   npx vitest run src/test/integration/documentUploadSessions.integration.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Knex } from 'knex';

// S3 is an enterprise-edition provider; the factory reads this when the class loads.
vi.hoisted(() => { process.env.EDITION = 'enterprise'; });

const auth = vi.hoisted(() => ({ user: null as any, denied: new Set<string>() }));
const jobs = vi.hoisted(() => ({ scheduleJob: vi.fn(async () => ({ jobId: 'job-1' })) }));

vi.mock('@alga-psa/core/jobRunnerAccessor', () => ({ getJobRunner: async () => ({ scheduleJob: jobs.scheduleJob }) }));
vi.mock('@alga-psa/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/auth')>();
  return {
  ...actual,
  // The session boundary: the signed-in test user, or the real AuthenticationError.
  withAuth: (fn: any) => async (...args: unknown[]) => {
    if (!auth.user) throw new actual.AuthenticationError();
    return fn(auth.user, { tenant: auth.user.tenant }, ...args);
  },
  hasPermission: async (_user: unknown, resource: string, action: string) => !auth.denied.has(`${resource}:${action}`),
  checkMultiplePermissions: async (_user: unknown, checks: { resource: string; action: string }[]) =>
    checks.map((check) => ({ ...check, granted: !auth.denied.has(`${check.resource}:${check.action}`) })),
  };
});
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: async (_user: unknown, resource: string, action: string) => !auth.denied.has(`${resource}:${action}`),
  checkMultiplePermissions: async (_user: unknown, checks: { resource: string; action: string }[]) =>
    checks.map((check) => ({ ...check, granted: !auth.denied.has(`${check.resource}:${check.action}`) })),
}));
vi.mock('@/lib/auth/rbac', () => ({ hasPermission: async (_user: unknown, resource: string, action: string) => !auth.denied.has(`${resource}:${action}`) }));

import { tenantDb } from '@alga-psa/db';
import { CreateBucketCommand, ListMultipartUploadsCommand, S3Client } from '@aws-sdk/client-s3';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { StorageProviderFactory } from '@alga-psa/storage/StorageProviderFactory';
import { clearCachedStorageConfig, getUploadPolicy } from '@alga-psa/storage/config/storage';
import type { StorageProviderInterface } from '@alga-psa/storage/providers/StorageProvider';
import { expireUploadSessions } from '@alga-psa/documents/lib/documentUploadSessions';
import {
  abortUploadHandler,
  completeUploadHandler,
  createUploadHandler,
  getUploadHandler,
  putChunkHandler,
} from '@/lib/api/documentUploads/handlers';
import {
  MiB,
  contentRange,
  createUploadFixture,
  dropUploadFixture,
  generatedBody,
  matchesPattern,
  request,
  type UploadFixture,
} from './support/documentUploadHarness';

const HOOK_TIMEOUT = 600_000;
const MIME = 'application/octet-stream';

type Provider = 's3' | 'local';

async function configureProvider(provider: Provider, localDir: string): Promise<void> {
  process.env.STORAGE_DEFAULT_PROVIDER = provider;
  process.env.STORAGE_LOCAL_BASE_PATH = localDir;
  process.env.STORAGE_S3_REGION ||= 'us-east-1';
  process.env.STORAGE_S3_BUCKET ||= 'alga-upload-sessions-test';
  process.env.STORAGE_S3_ENDPOINT ||= 'http://127.0.0.1:9000';
  process.env.STORAGE_S3_ACCESS_KEY ||= 'minioadmin';
  process.env.STORAGE_S3_SECRET_KEY ||= 'minioadmin';
  clearCachedStorageConfig();
  StorageProviderFactory.clearProvider();
  if (provider === 's3') {
    const client = new S3Client({
      region: process.env.STORAGE_S3_REGION,
      endpoint: process.env.STORAGE_S3_ENDPOINT,
      forcePathStyle: true,
      credentials: { accessKeyId: process.env.STORAGE_S3_ACCESS_KEY!, secretAccessKey: process.env.STORAGE_S3_SECRET_KEY! },
    });
    await client.send(new CreateBucketCommand({ Bucket: process.env.STORAGE_S3_BUCKET! })).catch((error) => {
      if (!/BucketAlreadyOwnedByYou|BucketAlreadyExists/.test(String(error?.name ?? error))) throw error;
    });
    s3 = client;
  }
}
let s3: S3Client | undefined;

describe.each<Provider>(['s3', 'local'])('resumable document uploads (%s storage)', (providerType) => {
  let db: Knex;
  let fx: UploadFixture;
  let localDir: string;

  const asUploader = () => { auth.user = { user_id: fx.uploader, tenant: fx.tenant, user_type: 'internal', roles: [] }; };
  const row = async (sessionId: string) => await tenantDb(db, fx.tenant).table('document_upload_sessions').where({ session_id: sessionId }).first();

  const storedDocument = async (documentId: string) =>
    await tenantDb(db, fx.tenant).table('documents').where({ document_id: documentId }).first();

  async function create(size: number, extra: Record<string, unknown> = {}) {
    const response = await createUploadHandler(request('POST', '/api/documents/uploads', {
      json: { fileName: 'big.bin', mimeType: MIME, size, entityType: 'ticket', entityId: fx.ticket, ...extra },
    }));
    return { response, json: await response.clone().json() };
  }
  const put = (sessionId: string, start: number, length: number, total: number, body = generatedBody(length), headers?: Record<string, string>) =>
    putChunkHandler(request('PUT', `/api/documents/uploads/${sessionId}`, {
      headers: { ...contentRange(start, length, total), ...headers },
      body: body.body,
    }), sessionId);
  const head = (sessionId: string) => getUploadHandler(request('HEAD', `/api/documents/uploads/${sessionId}`), sessionId, { head: true });
  const complete = (sessionId: string) => completeUploadHandler(request('POST', `/api/documents/uploads/${sessionId}/complete`), sessionId);
  const abort = (sessionId: string) => abortUploadHandler(request('DELETE', `/api/documents/uploads/${sessionId}`), sessionId);

  /** Uploads a 13 MiB file in 5 + 5 + 3 MiB chunks. */
  async function uploadAll(sessionId: string, sizes = [5 * MiB, 5 * MiB, 3 * MiB]) {
    const total = sizes.reduce((a, b) => a + b, 0);
    let offset = 0;
    for (const size of sizes) {
      const response = await put(sessionId, offset, size, total);
      expect(response.status).toBe(200);
      offset += size;
    }
    return total;
  }

  beforeAll(async () => {
    localDir = mkdtempSync(join(tmpdir(), 'alga-uploads-'));
    await configureProvider(providerType, localDir);
    db = await createTestDbConnection();
    fx = await createUploadFixture(db);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await dropUploadFixture(db, fx).catch((error) => console.warn('fixture cleanup skipped:', error?.message));
    await db?.destroy().catch(() => undefined);
    rmSync(localDir, { recursive: true, force: true });
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    asUploader();
    auth.denied.clear();
    jobs.scheduleJob.mockClear();
    await configureProvider(providerType, localDir);
  });

  it('creates a session with the provider limit and a chunk size of 8-16 MiB', async () => {
    const { response, json } = await create(13 * MiB);
    expect(response.status).toBe(201);
    const policy = await getUploadPolicy();
    expect(json.maxFileSize).toBe(policy.maxFileSize);
    expect(json.chunkSize).toBeGreaterThanOrEqual(8 * MiB);
    expect(json.chunkSize).toBeLessThanOrEqual(16 * MiB);
    const stored = await row(json.sessionId);
    expect(stored).toMatchObject({ status: 'active', uploaded_by: fx.uploader, entity_type: 'ticket', entity_id: fx.ticket });
    expect(Number(stored.committed_offset)).toBe(0);
    expect(stored.write_handle.provider).toBe(providerType);
  });

  it('accepts a session with no target entity, and refuses half a target', async () => {
    const unattached = await createUploadHandler(request('POST', '/api/documents/uploads', {
      json: { fileName: 'loose.bin', mimeType: MIME, size: 10 },
    }));
    expect(unattached.status).toBe(201);
    const stored = await row((await unattached.json()).sessionId);
    expect(stored).toMatchObject({ entity_type: null, entity_id: null, status: 'active' });

    const half = await createUploadHandler(request('POST', '/api/documents/uploads', {
      json: { fileName: 'loose.bin', mimeType: MIME, size: 10, entityId: fx.ticket },
    }));
    expect(half.status).toBe(400);
  });

  it('refuses a declared size over the provider limit and a type outside the allowlist', async () => {
    const policy = await getUploadPolicy();
    const tooBig = await create(policy.maxFileSize + 1);
    expect(tooBig.response.status).toBe(413);
    expect(tooBig.json.error.code).toBe('UPLOAD_TOO_LARGE');
    // The browser learns the limit from the refusal itself, before it sends any bytes.
    expect(tooBig.json.error.maxFileSize).toBe(policy.maxFileSize);
    const badBody = await createUploadHandler(request('POST', '/api/documents/uploads', {
      json: { fileName: 'x', mimeType: '', size: 10, entityType: 'ticket', entityId: fx.ticket },
    }));
    expect(badBody.status).toBe(400);
  });

  it('streams a file in several chunks, reporting the offset after each, and the bytes arrive intact', async () => {
    const { json } = await create(13 * MiB);
    const id = json.sessionId;
    const sizes = [5 * MiB, 5 * MiB, 3 * MiB];
    let offset = 0;
    for (const size of sizes) {
      const response = await put(id, offset, size, 13 * MiB);
      expect(response.status).toBe(200);
      offset += size;
      expect(response.headers.get('Upload-Offset')).toBe(String(offset));
      const status = await head(id);
      expect(status.status).toBe(200);
      expect(status.headers.get('Upload-Offset')).toBe(String(offset));
    }
    const stored = await row(id);
    expect(stored.parts).toHaveLength(3);
    expect(stored.parts.map((p: any) => p.size)).toEqual(sizes);

    const completed = await complete(id);
    expect(completed.status).toBe(200);
    const { document } = await completed.json();
    // The summary names the stored file, so a caller can list or link it without another read.
    expect(document.file_id).toBe((await storedDocument(document.document_id)).file_id);
    const provider = await StorageProviderFactory.createProvider();
    const bytes = await provider.download((await storedDocument(document.document_id)).storage_path);
    expect(bytes.length).toBe(13 * MiB);
    expect(matchesPattern(bytes)).toBe(true);
  }, HOOK_TIMEOUT);

  it('resumes after a dropped chunk: HEAD reports the committed offset and the resent chunk succeeds', async () => {
    const { json } = await create(13 * MiB);
    const id = json.sessionId;
    expect((await put(id, 0, 5 * MiB, 13 * MiB)).status).toBe(200);

    // The connection dies 1 MiB into the second chunk.
    const dropped = await put(id, 5 * MiB, 5 * MiB, 13 * MiB, generatedBody(5 * MiB, { failAfter: MiB }));
    expect(dropped.status).toBeGreaterThanOrEqual(400);

    const status = await head(id);
    expect(status.headers.get('Upload-Offset')).toBe(String(5 * MiB));
    const stored = await row(id);
    expect(stored.parts).toHaveLength(1);
    expect(stored.chunk_claim_token).toBeNull();

    // Resume from where the server says it is (the pattern is positional, so offset must match).
    const resumed = await putChunkHandler(request('PUT', `/api/documents/uploads/${id}`, {
      headers: contentRange(5 * MiB, 5 * MiB, 13 * MiB),
      body: generatedBody(5 * MiB).body,
    }), id);
    expect(resumed.status).toBe(200);
    expect((await put(id, 10 * MiB, 3 * MiB, 13 * MiB)).status).toBe(200);
    const completed = await complete(id);
    expect(completed.status).toBe(200);
    const { document } = await completed.json();
    const provider = await StorageProviderFactory.createProvider();
    expect(matchesPattern(await provider.download((await storedDocument(document.document_id)).storage_path))).toBe(true);
  }, HOOK_TIMEOUT);

  it('rejects a chunk sent out of order with 409 and the current offset, committing nothing', async () => {
    const { json } = await create(13 * MiB);
    const id = json.sessionId;
    const response = await put(id, 5 * MiB, 5 * MiB, 13 * MiB);
    expect(response.status).toBe(409);
    expect(response.headers.get('Upload-Offset')).toBe('0');
    expect((await response.json()).error.code).toBe('OFFSET_MISMATCH');
    const stored = await row(id);
    expect(Number(stored.committed_offset)).toBe(0);
    expect(stored.parts).toHaveLength(0);
  });

  it('rejects a range that disagrees with the header or the body with 400', async () => {
    const { json } = await create(13 * MiB);
    const id = json.sessionId;
    // Content-Length says 5 MiB, Content-Range says 6 MiB.
    const lengthMismatch = await put(id, 0, 6 * MiB, 13 * MiB, generatedBody(5 * MiB), { 'content-length': String(5 * MiB) });
    expect(lengthMismatch.status).toBe(400);
    // Body is shorter than the range it claims.
    const short = await putChunkHandler(request('PUT', `/api/documents/uploads/${id}`, {
      headers: { 'content-range': `bytes 0-${5 * MiB - 1}/${13 * MiB}` },
      body: generatedBody(4 * MiB).body,
    }), id);
    expect(short.status).toBe(400);
    expect((await short.json()).error.code).toBe('BODY_LENGTH_MISMATCH');
    // Body longer than the range it claims.
    const long = await putChunkHandler(request('PUT', `/api/documents/uploads/${id}`, {
      headers: { 'content-range': `bytes 0-${5 * MiB - 1}/${13 * MiB}` },
      body: generatedBody(7 * MiB).body,
    }), id);
    expect(long.status).toBe(400);
    expect((await put(id, 0, 5 * MiB, 99 * MiB)).status).toBe(400); // wrong declared total
    const stored = await row(id);
    expect(Number(stored.committed_offset)).toBe(0);
    expect(stored.parts).toHaveLength(0);
  });

  it('stops mid-stream with 413 when a chunk goes over the declared size, and commits nothing', async () => {
    const declared = 5 * MiB;
    const { json } = await create(declared);
    const id = json.sessionId;
    // The header claims the whole file, but the body keeps coming: 64 MiB on offer.
    const oversized = generatedBody(64 * MiB);
    const response = await put(id, 0, declared, declared, oversized);
    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBe('UPLOAD_TOO_LARGE');
    // Abandoned mid-stream: nowhere near the 64 MiB offered was read.
    expect(oversized.state.pulled).toBeLessThan(declared + 8 * MiB);

    const stored = await row(id);
    expect(Number(stored.committed_offset)).toBe(0);
    expect(stored.parts).toHaveLength(0);
    expect(stored.status).toBe('active');
    expect(stored.chunk_claim_token).toBeNull();
    if (providerType === 's3') {
      const client = s3!;
      // The upload still exists but holds no part from the rejected chunk.
      const handle = stored.write_handle;
      const parts = await client.send(new (await import('@aws-sdk/client-s3')).ListPartsCommand({
        Bucket: handle.bucket, Key: handle.key, UploadId: handle.uploadId,
      }));
      expect(parts.Parts ?? []).toHaveLength(0);
    }

    // A header that already claims bytes past the declared size is refused before reading anything.
    const early = generatedBody(MiB);
    const pre = await put(id, 0, 6 * MiB, declared, early);
    expect(pre.status).toBe(413);
    expect(early.state.pulled).toBe(0);
  }, HOOK_TIMEOUT);

  it('lets only one of two racing chunks at the same offset win', async () => {
    const { json } = await create(13 * MiB);
    const id = json.sessionId;
    const results = await Promise.all([put(id, 0, 5 * MiB, 13 * MiB), put(id, 0, 5 * MiB, 13 * MiB)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    const stored = await row(id);
    expect(Number(stored.committed_offset)).toBe(5 * MiB);
    expect(stored.parts).toHaveLength(1);
  }, HOOK_TIMEOUT);

  it('treats another tenant or another uploader as not found (404)', async () => {
    const { json } = await create(13 * MiB);
    const id = json.sessionId;
    auth.user = { user_id: fx.otherUser, tenant: fx.tenant, user_type: 'internal', roles: [] };
    expect((await head(id)).status).toBe(404);
    expect((await put(id, 0, 5 * MiB, 13 * MiB)).status).toBe(404);
    expect((await complete(id)).status).toBe(404);
    expect((await abort(id)).status).toBe(404);

    const other = await createUploadFixture(db);
    try {
      auth.user = { user_id: other.uploader, tenant: other.tenant, user_type: 'internal', roles: [] };
      expect((await head(id)).status).toBe(404);
      expect((await put(id, 0, 5 * MiB, 13 * MiB)).status).toBe(404);
    } finally {
      await dropUploadFixture(db, other).catch(() => undefined);
    }
    asUploader();
    expect((await row(id)).status).toBe('active');
    auth.user = null;
    expect((await head(id)).status).toBe(401);
  });

  it('denies a user who may not attach to the ticket, with the same message as uploadDocument', async () => {
    const sessionCount = async () => Number((await tenantDb(db, fx.tenant).table('document_upload_sessions').count('* as n').first())?.n);
    const before = await sessionCount();
    auth.denied.add('ticket:update');
    const draft = await create(13 * MiB, { commentAttachmentDraft: true });
    expect(draft.response.status).toBe(403);
    expect(draft.json.error.message).toBe('Permission denied: Cannot attach files to this ticket');

    auth.denied.clear();
    auth.denied.add('document:create');
    auth.denied.add('ticket_attachment:create');
    const plain = await create(13 * MiB);
    expect(plain.response.status).toBe(403);
    expect(plain.json.error.message).toBe('Permission denied: Cannot create documents');
    expect(await sessionCount()).toBe(before); // a denial opens no provider session and stores no row
  });

  it('completes into a ticket document with its association, queuing previews once', async () => {
    const { json } = await create(13 * MiB);
    const id = json.sessionId;
    await uploadAll(id);

    const completed = await complete(id);
    expect(completed.status).toBe(200);
    const body = await completed.json();
    expect(body.alreadyCompleted).toBe(false);
    const document = body.document;
    expect(document).toMatchObject({ document_name: 'big.bin', mime_type: MIME, file_size: 13 * MiB });
    expect(await storedDocument(document.document_id)).toMatchObject({ created_by: fx.uploader, tenant: fx.tenant });

    const association = await tenantDb(db, fx.tenant).table('document_associations')
      .where({ document_id: document.document_id }).first();
    expect(association).toMatchObject({ entity_type: 'ticket', entity_id: fx.ticket });
    const storedDoc = await storedDocument(document.document_id);
    const file = await tenantDb(db, fx.tenant).table('external_files').where({ file_id: storedDoc.file_id }).first();
    expect(Number(file.file_size)).toBe(13 * MiB);
    expect(file.storage_path).toBe(storedDoc.storage_path);

    const stored = await row(id);
    expect(stored.status).toBe('completed');
    expect(stored.document_id).toBe(document.document_id);
    expect(jobs.scheduleJob).toHaveBeenCalledTimes(1);
    expect(jobs.scheduleJob).toHaveBeenCalledWith(
      'generate-document-previews',
      { tenantId: fx.tenant, documentId: document.document_id },
      { userId: fx.uploader },
    );

    // A completed upload accepts no more chunks and cannot be aborted.
    expect((await put(id, 0, 5 * MiB, 13 * MiB)).status).toBe(409);
    expect((await abort(id)).status).toBe(409);
  }, HOOK_TIMEOUT);

  it('creates no second document when complete is repeated or raced', async () => {
    const { json } = await create(13 * MiB);
    const id = json.sessionId;
    await uploadAll(id);

    const [a, b] = await Promise.all([complete(id), complete(id)]);
    const outcomes = [a, b];
    const okBodies = await Promise.all(outcomes.filter((r) => r.status === 200).map((r) => r.json()));
    expect(okBodies.length).toBeGreaterThanOrEqual(1);
    for (const r of outcomes.filter((x) => x.status !== 200)) expect(r.status).toBe(409);

    const again = await complete(id);
    expect(again.status).toBe(200);
    const againBody = await again.json();
    expect(againBody.alreadyCompleted).toBe(true);
    for (const ok of okBodies) expect(ok.document.document_id).toBe(againBody.document.document_id);

    const stored = await row(id);
    const docs = await tenantDb(db, fx.tenant).table('documents').where({ file_id: (await storedDocument(againBody.document.document_id)).file_id });
    expect(docs).toHaveLength(1);
    expect(stored.document_id).toBe(againBody.document.document_id);
    expect(jobs.scheduleJob).toHaveBeenCalledTimes(1);
  }, HOOK_TIMEOUT);

  it('refuses to complete an upload that is not fully committed', async () => {
    const { json } = await create(13 * MiB);
    const id = json.sessionId;
    expect((await put(id, 0, 5 * MiB, 13 * MiB)).status).toBe(200);
    const response = await complete(id);
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('UPLOAD_INCOMPLETE');
    expect((await row(id)).status).toBe('active');
  }, HOOK_TIMEOUT);

  it('aborts: the provider session is gone, the row is aborted, and repeating DELETE is safe', async () => {
    const { json } = await create(13 * MiB);
    const id = json.sessionId;
    expect((await put(id, 0, 5 * MiB, 13 * MiB)).status).toBe(200);

    expect((await abort(id)).status).toBe(204);
    expect((await row(id)).status).toBe('aborted');
    expect((await abort(id)).status).toBe(204);
    expect((await abort(id)).status).toBe(204);

    expect((await head(id)).status).toBe(410);
    expect((await put(id, 5 * MiB, 5 * MiB, 13 * MiB)).status).toBe(410);
    expect((await complete(id)).status).toBe(410);
    if (providerType === 's3') {
      const handle = (await row(id)).write_handle;
      const listed = await s3!.send(new ListMultipartUploadsCommand({ Bucket: handle.bucket, Prefix: handle.key }));
      expect((listed.Uploads ?? []).filter((u) => u.UploadId === handle.uploadId)).toHaveLength(0);
    }
  }, HOOK_TIMEOUT);

  it('sweeps an expired session: marks it expired and aborts the provider session', async () => {
    const { json } = await create(13 * MiB);
    const id = json.sessionId;
    expect((await put(id, 0, 5 * MiB, 13 * MiB)).status).toBe(200);
    const { json: fresh } = await create(13 * MiB);

    await tenantDb(db, fx.tenant).table('document_upload_sessions')
      .where({ session_id: id }).update({ expires_at: new Date(Date.now() - 60_000) });
    const result = await expireUploadSessions(db, fx.tenant);
    expect(result.expired).toBe(1);

    expect((await row(id)).status).toBe('expired');
    expect((await row(fresh.sessionId)).status).toBe('active');
    expect((await head(id)).status).toBe(410);
    expect((await put(id, 5 * MiB, 5 * MiB, 13 * MiB)).status).toBe(410);
    if (providerType === 's3') {
      const handle = (await row(id)).write_handle;
      const listed = await s3!.send(new ListMultipartUploadsCommand({ Bucket: handle.bucket, Prefix: handle.key }));
      expect((listed.Uploads ?? []).filter((u) => u.UploadId === handle.uploadId)).toHaveLength(0);
    }
    // Sweeping again finds nothing.
    expect((await expireUploadSessions(db, fx.tenant)).expired).toBe(0);
  }, HOOK_TIMEOUT);

  it('logs provider abort errors and keeps sweeping', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await create(13 * MiB)).json.sessionId);
    await tenantDb(db, fx.tenant).table('document_upload_sessions')
      .whereIn('session_id', ids).update({ expires_at: new Date(Date.now() - 60_000) });
    const real = await StorageProviderFactory.createProvider();
    let calls = 0;
    const flaky = new Proxy(real, {
      get(target, prop, receiver) {
        if (prop === 'abortWrite') {
          return async (handle: any) => {
            calls += 1;
            if (calls === 1) throw new Error('storage unavailable');
            return target.abortWrite(handle);
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as StorageProviderInterface;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await expireUploadSessions(db, fx.tenant, { provider: flaky });
    errors.mockRestore();
    expect(result).toEqual({ expired: 3, abortFailures: 1 });
    for (const id of ids) expect((await row(id)).status).toBe('expired');
    expect(calls).toBe(3);
  }, HOOK_TIMEOUT);
});
