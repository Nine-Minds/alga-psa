import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// This suite deliberately does NOT mock `@alga-psa/storage` (the barrel) or
// `@alga-psa/storage/config/storage`. The workflow helper must resolve the
// real shared upload-policy module; mocking the barrel is what let a
// native-runtime module resolution failure hide from CI (alga-2026-0002491).

const wavBytes = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WAVE'),
  Buffer.from('fmt '),
  Buffer.from([0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00]),
  Buffer.from([0x40, 0x1f, 0x00, 0x00, 0x80, 0x3e, 0x00, 0x00, 0x02, 0x00, 0x10, 0x00]),
  Buffer.from('data'),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
]);

// The url branch streams into a provider write session (the ingest); `uploadMock` is its commit.
const uploadMock = vi.fn(async (storagePath: string, size: number, mime?: string) => ({
  path: storagePath,
  size,
  mime_type: mime,
}));
const abortWriteMock = vi.fn(async () => undefined);
const deleteObjectMock = vi.fn(async (_path: string) => undefined);

/** A fetch response whose body is a real web stream, as undici returns. */
function streamResponse(chunks: Uint8Array[], headers: Record<string, string> = {}, opts: { hang?: boolean } = {}) {
  return async (_url: string, init?: { signal?: AbortSignal }) => {
    let i = 0;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true });
      },
      pull(controller) {
        if (i < chunks.length) controller.enqueue(chunks[i++]!);
        else if (!opts.hang) controller.close();
      },
    });
    return {
      ok: true,
      status: 200,
      body,
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    };
  };
}

// Keep the real module graph (and its generateStoragePath export) but stub the
// provider so no bytes are written to disk during the unit test.
vi.mock('@alga-psa/storage/StorageProviderFactory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/storage/StorageProviderFactory')>();
  return {
    ...actual,
    StorageProviderFactory: {
      createProvider: vi.fn(async () => ({
        beginWrite: vi.fn(async (path: string, options?: { mimeType?: string }) => ({ path, mimeType: options?.mimeType, written: 0 })),
        writePart: vi.fn(async (handle: any, partNumber: number, _part: Buffer, size: number, opts?: { final?: boolean }) => {
          handle.written += size;
          return { partNumber, size, final: Boolean(opts?.final) };
        }),
        completeWrite: vi.fn(async (handle: any) => uploadMock(handle.path, handle.written, handle.mimeType)),
        abortWrite: abortWriteMock,
        download: vi.fn(),
        delete: (path: string) => deleteObjectMock(path),
      })),
    },
  };
});

vi.mock('@alga-psa/db', () => ({
  tenantDb: (conn: any, _tenant: string) => conn,
}));

type Row = Record<string, any>;

const fileRow: Row = {
  file_id: '11111111-1111-4111-8111-111111111111',
  file_name: 'stored-voicemail.wav',
  original_name: 'voicemail.wav',
  mime_type: 'audio/wav',
  file_size: 1234,
  storage_path: 'tenant-1/voicemail.wav',
};

const state: {
  ticket: Row | null;
  file: Row | null;
  documents: Row[];
  associations: Row[];
  externalFiles: Row[];
} = {
  ticket: null,
  file: null,
  documents: [],
  associations: [],
  externalFiles: [],
};

function makeBuilder(table: string) {
  return {
    where: vi.fn().mockReturnThis(),
    first: vi.fn(async () => {
      if (table === 'tickets') return state.ticket;
      if (table === 'external_files') return state.file;
      return undefined;
    }),
    insert: vi.fn(async (row: Row) => {
      if (table === 'documents') state.documents.push(row);
      if (table === 'document_associations') state.associations.push(row);
      if (table === 'external_files') state.externalFiles.push(row);
      return [row];
    }),
    onConflict: vi.fn().mockReturnThis(),
    ignore: vi.fn().mockResolvedValue(undefined),
  };
}

const failInsertFor: { table: string | null } = { table: null };
const fakeKnex: any = {
  table: (name: string) => {
    const builder = makeBuilder(name);
    if (failInsertFor.table === name) builder.insert = vi.fn(async () => { throw new Error(`insert into ${name} failed`); });
    return builder;
  },
};

const ctx = { stepPath: 'step-1', runId: 'run-1' } as any;
const tx = { tenantId: 'tenant-1', actorUserId: 'user-1', trx: fakeKnex } as any;
const ticketId = '22222222-2222-4222-8222-222222222222';

async function resetStoragePolicy(): Promise<void> {
  const { clearCachedStorageConfig } = await import('@alga-psa/storage/config/storage');
  clearCachedStorageConfig();
}

describe('attachDocumentToTicket — real shared upload policy (unmocked storage)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    state.ticket = { ticket_id: ticketId };
    state.file = { ...fileRow };
    state.documents = [];
    state.associations = [];
    state.externalFiles = [];
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('accepts audio/wav through the real policy (file_id branch)', async () => {
    vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', '*/*');
    await resetStoragePolicy();

    const { attachDocumentToTicket } = await import('../businessOperations/shared');
    const result = await attachDocumentToTicket(ctx, tx, ticketId, {
      source: { file_id: fileRow.file_id },
    });

    expect(result).toMatchObject({ file_id: fileRow.file_id, content_type: 'audio/wav' });
    expect(state.documents).toHaveLength(1);
    expect(state.associations).toHaveLength(1);
  });

  it('rejects a disallowed MIME through the real policy (file_id branch)', async () => {
    vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', 'application/pdf');
    await resetStoragePolicy();

    const { attachDocumentToTicket } = await import('../businessOperations/shared');

    await expect(
      attachDocumentToTicket(ctx, tx, ticketId, { source: { file_id: fileRow.file_id } })
    ).rejects.toMatchObject({ category: 'ValidationError', code: 'VALIDATION_ERROR' });

    expect(state.documents).toHaveLength(0);
    expect(state.associations).toHaveLength(0);
  });

  it('rejects an oversize attachment through the real provider size ceiling (file_id branch)', async () => {
    vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', '*/*');
    vi.stubEnv('STORAGE_LOCAL_MAX_FILE_SIZE', '100');
    await resetStoragePolicy();

    const { attachDocumentToTicket } = await import('../businessOperations/shared');

    await expect(
      attachDocumentToTicket(ctx, tx, ticketId, { source: { file_id: fileRow.file_id } })
    ).rejects.toMatchObject({ category: 'ValidationError', code: 'VALIDATION_ERROR' });

    expect(state.documents).toHaveLength(0);
  });

  it('ingests an audio URL through the real policy and provider path (url branch)', async () => {
    vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', '*/*');
    await resetStoragePolicy();
    vi.stubGlobal('fetch', vi.fn(streamResponse([wavBytes], { 'content-type': 'audio/wav' })));

    const { attachDocumentToTicket } = await import('../businessOperations/shared');
    const result = await attachDocumentToTicket(ctx, tx, ticketId, {
      source: { url: 'https://example.test/voicemail.wav' },
      filename: 'voicemail.wav',
    });

    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ filename: 'voicemail.wav', content_type: 'audio/wav' });
    expect(state.externalFiles).toHaveLength(1);
    expect(state.externalFiles[0]).toMatchObject({
      mime_type: 'audio/wav',
      file_size: wavBytes.length,
      original_name: 'voicemail.wav',
    });
    expect(state.externalFiles[0].storage_path).toContain('tenant-1');
    expect(state.documents).toHaveLength(1);
    expect(state.associations).toHaveLength(1);
  });

  it('rejects a disallowed MIME from a fetched URL through the real policy (url branch)', async () => {
    vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', 'application/pdf');
    await resetStoragePolicy();
    vi.stubGlobal('fetch', vi.fn(streamResponse([wavBytes], { 'content-type': 'audio/wav' })));

    const { attachDocumentToTicket } = await import('../businessOperations/shared');

    await expect(
      attachDocumentToTicket(ctx, tx, ticketId, { source: { url: 'https://example.test/voicemail.wav' } })
    ).rejects.toMatchObject({ category: 'ValidationError', code: 'VALIDATION_ERROR' });

    expect(uploadMock).not.toHaveBeenCalled();
    expect(state.externalFiles).toHaveLength(0);
  });

  it('no longer exports a private MIME allowlist: the provider policy is the only one', async () => {
    const shared: Record<string, unknown> = await import('../businessOperations/shared');
    expect(shared.ALLOWED_ATTACHMENT_MIME_TYPES).toBeUndefined();
    expect(shared.isAllowedAttachmentMimeType).toBeUndefined();
  });

  it('accepts a type the old private list refused when the provider allows it (url branch)', async () => {
    vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', '*/*');
    await resetStoragePolicy();
    vi.stubGlobal('fetch', vi.fn(streamResponse([wavBytes], { 'content-type': 'audio/wav' })));
    const { attachDocumentToTicket } = await import('../businessOperations/shared');
    // audio/wav was not on the old list (pdf, text, png, jpeg, webp, octet-stream).
    await expect(
      attachDocumentToTicket(ctx, tx, ticketId, { source: { url: 'https://example.test/a.wav' }, filename: 'a.wav' })
    ).resolves.toMatchObject({ content_type: 'audio/wav' });
  });

  it('aborts a url body that outgrows the cap, without relying on Content-Length (url branch)', async () => {
    vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', '*/*');
    vi.stubEnv('STORAGE_LOCAL_MAX_FILE_SIZE', '50');
    await resetStoragePolicy();
    vi.stubGlobal('fetch', vi.fn(streamResponse([new Uint8Array(30), new Uint8Array(30)], { 'content-type': 'text/plain' })));
    const { attachDocumentToTicket } = await import('../businessOperations/shared');

    await expect(
      attachDocumentToTicket(ctx, tx, ticketId, { source: { url: 'https://example.test/a.txt' }, filename: 'a.txt' })
    ).rejects.toMatchObject({ category: 'ValidationError', message: 'Attachment too large' });

    // Refused on the byte count before the head was even sniffed: nothing was committed.
    expect(uploadMock).not.toHaveBeenCalled();
    expect(state.externalFiles).toHaveLength(0);
  });

  it('refuses a declared Content-Length over the cap before reading the body (url branch)', async () => {
    vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', '*/*');
    vi.stubEnv('STORAGE_LOCAL_MAX_FILE_SIZE', '50');
    await resetStoragePolicy();
    vi.stubGlobal('fetch', vi.fn(streamResponse([new Uint8Array(10)], { 'content-length': '5000', 'content-type': 'text/plain' })));
    const { attachDocumentToTicket } = await import('../businessOperations/shared');

    await expect(
      attachDocumentToTicket(ctx, tx, ticketId, { source: { url: 'https://example.test/a.txt' }, filename: 'a.txt' })
    ).rejects.toMatchObject({ category: 'ValidationError', message: 'Attachment too large' });
  });

  it('times out a url download that never finishes (url branch)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', '*/*');
      await resetStoragePolicy();
      const fetchMock = vi.fn(streamResponse([new Uint8Array(5)], { 'content-type': 'text/plain' }, { hang: true }));
      vi.stubGlobal('fetch', fetchMock);
      const { attachDocumentToTicket, ATTACHMENT_URL_FETCH_TIMEOUT_MS } = await import('../businessOperations/shared');

      const attempt = attachDocumentToTicket(ctx, tx, ticketId, { source: { url: 'https://example.test/a.txt' }, filename: 'a.txt' })
        .catch((error) => error);
      // The timer is armed once the lazy storage imports have resolved; wait for the request (setImmediate is not faked).
      while (fetchMock.mock.calls.length === 0) await new Promise((resolve) => setImmediate(resolve));
      await vi.advanceTimersByTimeAsync(ATTACHMENT_URL_FETCH_TIMEOUT_MS + 10);
      const error = await attempt;

      expect(error).toMatchObject({ category: 'TransientError', code: 'TRANSIENT_FAILURE' });
      expect(JSON.stringify(error.details)).toContain('Timed out');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('attachDocumentToTicket url branch: cleanup of the stored object', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    failInsertFor.table = null;
    state.ticket = { ticket_id: ticketId };
    state.file = null;
    state.documents = [];
    state.associations = [];
    state.externalFiles = [];
  });

  afterEach(() => {
    failInsertFor.table = null;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('aborts the write session when the ingest fails mid-stream (byte guard), leaving no object and no rows', async () => {
    vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', '*/*');
    // Cap 10 MiB (default WORKFLOW_ACTION_ATTACHMENT_MAX_BYTES); 9 MiB then 2 MiB crosses it after the first part went out.
    vi.stubEnv('STORAGE_LOCAL_MAX_FILE_SIZE', String(500 * 1024 * 1024));
    await resetStoragePolicy();
    vi.stubGlobal('fetch', vi.fn(streamResponse([new Uint8Array(9 * 1024 * 1024), new Uint8Array(2 * 1024 * 1024)], { 'content-type': 'application/octet-stream' })));
    const { attachDocumentToTicket } = await import('../businessOperations/shared');

    await expect(
      attachDocumentToTicket(ctx, tx, ticketId, { source: { url: 'https://example.test/a.bin' }, filename: 'a.bin' })
    ).rejects.toMatchObject({ category: 'ValidationError', message: 'Attachment too large' });

    expect(abortWriteMock).toHaveBeenCalledTimes(1);
    expect(uploadMock).not.toHaveBeenCalled();
    expect(state.externalFiles).toHaveLength(0);
  });

  it('aborts the write session when the download stalls past the 60 s timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', '*/*');
      await resetStoragePolicy();
      const fetchMock = vi.fn(streamResponse([new Uint8Array(9 * 1024 * 1024)], { 'content-type': 'application/octet-stream' }, { hang: true }));
      vi.stubGlobal('fetch', fetchMock);
      const { attachDocumentToTicket, ATTACHMENT_URL_FETCH_TIMEOUT_MS } = await import('../businessOperations/shared');

      const attempt = attachDocumentToTicket(ctx, tx, ticketId, { source: { url: 'https://example.test/a.bin' }, filename: 'a.bin' })
        .catch((error) => error);
      while (fetchMock.mock.calls.length === 0) await new Promise((resolve) => setImmediate(resolve));
      // Let the first part reach the write session before time runs out.
      await new Promise((resolve) => setImmediate(resolve));
      await vi.advanceTimersByTimeAsync(ATTACHMENT_URL_FETCH_TIMEOUT_MS + 10);
      const error = await attempt;

      expect(error).toMatchObject({ category: 'TransientError' });
      expect(abortWriteMock).toHaveBeenCalledTimes(1);
      expect(uploadMock).not.toHaveBeenCalled();
      expect(state.externalFiles).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['external_files', 'documents', 'document_associations'])(
    'deletes the stored object when the %s insert fails after a successful ingest',
    async (table) => {
      vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', '*/*');
      await resetStoragePolicy();
      vi.stubGlobal('fetch', vi.fn(streamResponse([wavBytes], { 'content-type': 'audio/wav' })));
      failInsertFor.table = table;
      const { attachDocumentToTicket } = await import('../businessOperations/shared');

      await expect(
        attachDocumentToTicket(ctx, tx, ticketId, { source: { url: 'https://example.test/v.wav' }, filename: 'v.wav' })
      ).rejects.toThrow(`insert into ${table} failed`);

      expect(uploadMock).toHaveBeenCalledTimes(1);
      expect(deleteObjectMock).toHaveBeenCalledTimes(1);
      expect(deleteObjectMock).toHaveBeenCalledWith(expect.stringContaining('tenant-1'));
    }
  );

  it('does not delete anything for a file_id source whose document insert fails (the object is not ours)', async () => {
    state.file = { ...fileRow };
    state.ticket = { ticket_id: ticketId };
    vi.stubEnv('STORAGE_LOCAL_ALLOWED_MIME_TYPES', '*/*');
    await resetStoragePolicy();
    failInsertFor.table = 'documents';
    const { attachDocumentToTicket } = await import('../businessOperations/shared');

    await expect(
      attachDocumentToTicket(ctx, tx, ticketId, { source: { file_id: fileRow.file_id } })
    ).rejects.toThrow('insert into documents failed');
    expect(deleteObjectMock).not.toHaveBeenCalled();
  });
});

describe('WORKFLOW_ACTION_ATTACHMENT_MAX_BYTES', () => {
  it('is parsed strictly: a malformed value throws naming the variable instead of disabling the cap', async () => {
    const { parseAttachmentMaxBytes } = await import('../businessOperations/shared');
    expect(parseAttachmentMaxBytes(undefined, 10)).toBe(10);
    expect(parseAttachmentMaxBytes('', 10)).toBe(10);
    expect(parseAttachmentMaxBytes('2048', 10)).toBe(2048);
    for (const bad of ['10MB', '0', '-5', '1.5', 'abc', 'Infinity']) {
      expect(() => parseAttachmentMaxBytes(bad, 10)).toThrow(/WORKFLOW_ACTION_ATTACHMENT_MAX_BYTES/);
    }
  });
});
