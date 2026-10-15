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

const uploadMock = vi.fn(async (buffer: Buffer, storagePath: string) => ({
  path: storagePath,
  size: buffer.length,
}));

// Keep the real module graph (and its generateStoragePath export) but stub the
// provider so no bytes are written to disk during the unit test.
vi.mock('@alga-psa/storage/StorageProviderFactory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/storage/StorageProviderFactory')>();
  return {
    ...actual,
    StorageProviderFactory: {
      createProvider: vi.fn(async () => ({
        upload: uploadMock,
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => wavBytes,
        headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'audio/wav' : null) },
      }))
    );

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
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => wavBytes,
        headers: { get: () => 'audio/wav' },
      }))
    );

    const { attachDocumentToTicket } = await import('../businessOperations/shared');

    await expect(
      attachDocumentToTicket(ctx, tx, ticketId, { source: { url: 'https://example.test/voicemail.wav' } })
    ).rejects.toMatchObject({ category: 'ValidationError', code: 'VALIDATION_ERROR' });

    expect(uploadMock).not.toHaveBeenCalled();
    expect(state.externalFiles).toHaveLength(0);
  });
});
