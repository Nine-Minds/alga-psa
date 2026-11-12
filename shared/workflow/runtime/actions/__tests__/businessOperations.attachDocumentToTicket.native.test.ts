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
        delete: vi.fn(),
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

const fakeKnex: any = { table: (name: string) => makeBuilder(name) };

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

describe('email.send attachments use the provider allowlist', () => {
  it('validates through the shared upload policy, not a private MIME list', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(path.resolve(__dirname, '../businessOperations/email.ts'), 'utf8');
    expect(source).not.toContain('isAllowedAttachmentMimeType');
    expect(source).toContain("import('@alga-psa/storage/config/storage')");
  });
});
