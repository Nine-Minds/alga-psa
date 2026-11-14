/**
 * attachDocument driven through the real StorageService.uploadFile and ingest pipeline, with a
 * fake storage provider (not a mock of uploadFile): what a url source or a multipart part
 * actually meets when it is oversize, slow or the wrong type.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';

const MiB = 1024 * 1024;

const provider = vi.hoisted(() => ({
  calls: [] as string[],
  beginWrite: vi.fn(),
  writePart: vi.fn(),
  completeWrite: vi.fn(),
  abortWrite: vi.fn(),
}));
const fileStoreCreate = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({ getAppSecret: vi.fn(async () => null) })),
}));
vi.mock('@alga-psa/storage/StorageProviderFactory', () => ({
  StorageProviderFactory: { createProvider: vi.fn(async () => provider) },
  generateStoragePath: (_t: string, _f: string, name: string) => `tenant-1/files/${name}`,
}));
vi.mock('@alga-psa/storage/models/storage', () => ({
  FileStoreModel: { create: (...a: unknown[]) => fileStoreCreate(...a), softDelete: vi.fn() },
}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  tenantDb: () => ({ table: () => ({ where: () => ({ first: async () => ({ type_id: 'type-1' }) }), insert: async () => undefined }) }),
  withTransaction: async (_knex: unknown, fn: (trx: unknown) => Promise<unknown>) => fn({}),
}));
vi.mock('@alga-psa/validation', () => ({ isValidUUID: () => true }));
vi.mock('@alga-psa/documents/lib/documentPreviewJob', () => ({ scheduleDocumentPreviews: vi.fn(async () => undefined) }));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/workflow-streams', () => ({ buildDocumentAssociatedPayload: () => ({}) }));
vi.mock('server/src/lib/api/services/documents/entityAdapters', () => ({
  ENTITY_ADAPTERS: { ticket: { resolveFolder: async () => '/', documentOverrides: undefined, inTransaction: undefined } },
}));
vi.mock('server/src/lib/api/services/documents/fetchHostSettings', () => ({
  loadEffectiveFetchHosts: async () => ['files.example.com'],
}));

import { clearCachedStorageConfig } from '@alga-psa/storage/config/storage';
import { PayloadTooLargeError, ValidationError } from 'server/src/lib/api/middleware/apiErrors';
import { attachDocument } from 'server/src/lib/api/services/documents/attachDocument';
import { mapFetchError, resolveSource } from 'server/src/lib/api/services/documents/resolveSource';

const base = {
  knex: {} as any,
  tenant: 'tenant-1',
  actorUserId: 'user-1',
  target: { entityType: 'ticket' as const, entityId: 'ticket-1' },
  loadDocument: async (id: string) => ({ document_id: id } as any),
};
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

/** A fake `fetch`: 200 with the chunks; with `hang` the body then stalls until aborted. */
function fetchDep(chunks: Uint8Array[], opts: { hang?: boolean } = {}) {
  return vi.fn(async (_url: string, init: { signal: AbortSignal }) => {
    let i = 0;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        init.signal.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true });
      },
      pull(controller) {
        if (i < chunks.length) controller.enqueue(chunks[i++]!);
        else if (!opts.hang) controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'application/octet-stream' } });
  });
}

async function attachUrl(fetchImpl: ReturnType<typeof fetchDep>, deps: { maxBytes: number; totalTimeoutMs?: number }) {
  const file = await resolveSource(
    { source: { type: 'url', url: 'https://files.example.com/big.bin' } },
    { maxBytes: deps.maxBytes, urlTimeouts: { totalTimeoutMs: deps.totalTimeoutMs }, fetchDeps: { lookup: publicLookup, fetch: fetchImpl as any } },
    { knex: {} as any, tenant: 'tenant-1' },
  );
  return attachDocument({
    ...base,
    source: 'url',
    file: { ...file, mapSourceError: (e) => mapFetchError(e, 'tenant-1', deps.maxBytes) },
  }).catch((e) => ({ error: e, body: file.body as Readable }));
}

beforeEach(() => {
  vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', '*/*');
  vi.stubEnv('STORAGE_LOCAL_MAX_FILE_SIZE', String(64 * MiB));
  clearCachedStorageConfig();
  provider.beginWrite.mockReset().mockImplementation(async (path: string) => ({ path, written: 0 }));
  provider.writePart.mockReset().mockImplementation(async (h: any, n: number, _p: unknown, size: number) => {
    h.written += size;
    return { partNumber: n, size };
  });
  provider.completeWrite.mockReset().mockImplementation(async (h: any) => ({ path: h.path, size: h.written }));
  provider.abortWrite.mockReset().mockResolvedValue(undefined);
  fileStoreCreate.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  clearCachedStorageConfig();
});

describe('url source failing mid-stream, through attachDocument and the real ingest', () => {
  it('a body that outgrows the cap mid-stream is a 413, the write session is aborted, nothing is recorded', async () => {
    // 9 MiB goes out as a first 8 MiB part (the session is open), then the cap (12 MiB) is crossed.
    const chunks = [new Uint8Array(9 * MiB), new Uint8Array(4 * MiB)];

    const result: any = await attachUrl(fetchDep(chunks), { maxBytes: 12 * MiB });

    expect(result.error).toBeInstanceOf(PayloadTooLargeError);
    expect(result.error.statusCode).toBe(413);
    expect(provider.beginWrite).toHaveBeenCalledTimes(1);
    expect(provider.abortWrite).toHaveBeenCalledTimes(1);
    expect(provider.completeWrite).not.toHaveBeenCalled();
    expect(fileStoreCreate).not.toHaveBeenCalled();
    expect(result.body.destroyed).toBe(true);
  });

  it('a body that stalls past the total timeout is a validation error (400), the write session is aborted, nothing is recorded', async () => {
    const result: any = await attachUrl(fetchDep([new Uint8Array(9 * MiB)], { hang: true }), { maxBytes: 12 * MiB, totalTimeoutMs: 300 });

    expect(result.error).toBeInstanceOf(ValidationError);
    expect(JSON.stringify(result.error.details)).toMatch(/Timed out/i);
    expect(provider.beginWrite).toHaveBeenCalledTimes(1);
    expect(provider.abortWrite).toHaveBeenCalledTimes(1);
    expect(provider.completeWrite).not.toHaveBeenCalled();
    expect(fileStoreCreate).not.toHaveBeenCalled();
    expect(result.body.destroyed).toBe(true);
  });
});

describe('multipart-style Readable parts through the real uploadFile (default user-upload origin)', () => {
  const part = (...chunks: Buffer[]) => Readable.from(chunks);

  it('refuses a disallowed declared type with a 400 before any byte is stored', async () => {
    vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', 'text/plain');
    clearCachedStorageConfig();

    const error = await attachDocument({
      ...base, source: 'multipart',
      file: { fileName: 'a.html', mimeType: 'text/html', body: part(Buffer.from('<html></html>')) },
    }).catch((e) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect(provider.beginWrite).not.toHaveBeenCalled();
    expect(fileStoreCreate).not.toHaveBeenCalled();
  });

  it('refuses real bytes of a disallowed type declared as an allowed one (sniffed), with a 400', async () => {
    vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', 'text/plain');
    clearCachedStorageConfig();
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(62), Buffer.from([0x80, 0, 0, 0]), Buffer.alloc(512, 7)]);

    const error = await attachDocument({
      ...base, source: 'multipart',
      file: { fileName: 'a.txt', mimeType: 'text/plain', body: part(exe) },
    }).catch((e) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect(provider.completeWrite).not.toHaveBeenCalled();
    expect(fileStoreCreate).not.toHaveBeenCalled();
  });

  it('refuses a part over the provider max with a 413, and lets one exactly at it through', async () => {
    vi.stubEnv('STORAGE_LOCAL_MAX_FILE_SIZE', '100');
    clearCachedStorageConfig();

    const tooBig = await attachDocument({
      ...base, source: 'multipart',
      file: { fileName: 'a.txt', mimeType: 'text/plain', body: part(Buffer.alloc(60, 97), Buffer.alloc(60, 97)) },
    }).catch((e) => e);
    expect(tooBig).toBeInstanceOf(PayloadTooLargeError);
    expect(provider.completeWrite).not.toHaveBeenCalled();
    expect(fileStoreCreate).not.toHaveBeenCalled();

    fileStoreCreate.mockImplementation(async (_k: unknown, data: any) => ({ ...data, file_id: data.fileId }));
    await attachDocument({
      ...base, source: 'multipart',
      file: { fileName: 'ok.txt', mimeType: 'text/plain', body: part(Buffer.alloc(100, 97)) },
    });
    expect(provider.completeWrite).toHaveBeenCalledTimes(1);
  });
});
