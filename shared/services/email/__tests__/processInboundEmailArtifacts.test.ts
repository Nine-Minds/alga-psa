import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * These tests exercise the IMAP/in-app artifact pipeline end to end at the
 * module boundary: the shared storage policy (mocked to mirror
 * packages/storage/src/config/storage.ts), the attachment ledger, the document
 * rows, and the internal system trail comment.
 */

type Row = Record<string, any>;

const h = vi.hoisted(() => {
  const tables = new Map<string, Row[]>();
  const comments: Row[] = [];
  const uploads: Row[] = [];
  // Injected storage-policy behaviour: a thrown error exercises the
  // infrastructure-failure classification without a real broken import.
  const storageState = {
    policyError: null as Error | null,
    artifactError: null as Error | null,
    policyCalls: [] as Array<{ mimeType: string; fileSize: number }>,
    artifactCalls: [] as number[],
  };

  const getTable = (name: string): Row[] => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name)!;
  };

  const uniqueKeys: Record<string, string[]> = {
    email_processed_attachments: ['provider_id', 'email_id', 'attachment_id'],
  };

  function makeBuilder(tableName: string) {
    const conditions: Array<[string, any]> = [];
    let op: 'select' | 'insert' | 'update' = 'select';
    let payload: any = null;
    let wantFirst = false;
    let selectedCols: string[] | null = null;
    const orderSpecs: Array<[string, string]> = [];

    const matches = (row: Row) =>
      conditions.every(([col, val]) => (val === '__NOT_NULL__' ? row[col] != null : row[col] === val));

    const execute = async (): Promise<any> => {
      const table = getTable(tableName);

      if (op === 'insert') {
        const rows = Array.isArray(payload) ? payload : [payload];
        const keys = uniqueKeys[tableName];
        for (const row of rows) {
          if (keys) {
            const duplicate = table.find((existing) => keys.every((k) => existing[k] === row[k]));
            if (duplicate) {
              const error: any = new Error('duplicate key value violates unique constraint');
              error.code = '23505';
              throw error;
            }
          }
          table.push({ ...row });
        }
        return rows.length;
      }

      let rows = table.filter(matches);

      if (orderSpecs.length > 0) {
        rows = [...rows].sort((a, b) => {
          for (const [col, dir] of orderSpecs) {
            if (a[col] === b[col]) continue;
            const cmp = a[col] > b[col] ? 1 : -1;
            return dir === 'desc' ? -cmp : cmp;
          }
          return 0;
        });
      }

      if (op === 'update') {
        for (const row of rows) Object.assign(row, payload);
        return rows.length;
      }

      const projected = selectedCols
        ? rows.map((row) => {
            const out: Row = {};
            for (const col of selectedCols!) {
              const asMatch = col.match(/^(.*?)\s+as\s+(.*)$/i);
              out[asMatch ? asMatch[2].trim() : col] = row[asMatch ? asMatch[1].trim() : col];
            }
            return out;
          })
        : rows.map((row) => ({ ...row }));

      return wantFirst ? projected[0] : projected;
    };

    const builder: any = {
      select(...cols: any[]) {
        selectedCols = cols.length ? cols.map(String) : null;
        return builder;
      },
      where(arg1: any, arg2?: any) {
        if (typeof arg1 === 'string') conditions.push([arg1, arg2]);
        else for (const [key, value] of Object.entries(arg1)) conditions.push([key, value]);
        return builder;
      },
      andWhere(arg1: any, arg2?: any) {
        return builder.where(arg1, arg2);
      },
      whereNotNull(col: string) {
        conditions.push([col, '__NOT_NULL__']);
        return builder;
      },
      whereRaw() {
        // The trail-marker predicate is exercised via the metadata marker; the
        // in-memory store has no JSON query engine, so raw predicates are
        // treated as always-true and the marker is checked by `first()`.
        return builder;
      },
      orderBy(col: string, dir = 'asc') {
        orderSpecs.push([col, String(dir).toLowerCase()]);
        return builder;
      },
      first(...cols: any[]) {
        if (cols.length) builder.select(...cols);
        wantFirst = true;
        return execute();
      },
      insert(data: any) {
        op = 'insert';
        payload = data;
        return execute();
      },
      update(data: any) {
        op = 'update';
        payload = data;
        return execute();
      },
      then(resolve: any, reject: any) {
        return execute().then(resolve, reject);
      },
    };
    return builder;
  }

  const knex: any = (name: string) => makeBuilder(name);
  knex.table = (name: string) => makeBuilder(name);
  knex.transaction = async (callback: any) => callback(knex);
  knex.raw = async () => undefined;
  knex.fn = { now: () => new Date() };

  return { knex, tables, comments, uploads, getTable, storageState };
});

vi.mock('@alga-psa/core/secrets', () => ({
  getSecret: vi.fn(async () => ''),
  getSecretProviderInstance: vi.fn(async () => ({
    getAppSecret: async () => '',
    getTenantSecret: async () => '',
  })),
  secretProvider: { getSecret: vi.fn(async () => '') },
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: (conn: any, _tenant: string) => conn,
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: async () => h.knex,
}));

vi.mock('../tenantAdminTransaction', () => ({
  withTenantAdminTransaction: async (_tenantId: string, callback: any, existing?: any) =>
    callback(existing ?? h.knex, h.knex),
}));

vi.mock('../../../models/ticketModel', () => ({
  TicketModel: {
    createComment: async (input: any, tenant: string) => {
      const commentId = `comment-${h.comments.length + 1}`;
      h.comments.push({ ...input, tenant, comment_id: commentId });
      h.getTable('comments').push({
        comment_id: commentId,
        ticket_id: input.ticket_id,
        note: input.content,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
        is_internal: input.is_internal,
        author_type: input.author_type,
      });
      return { comment_id: commentId };
    },
  },
}));

function fakeStorageModule() {
  const allowedMimeTypes = () =>
    (process.env.STORAGE_LOCAL_ALLOWED_MIME_TYPES || '*/*').split(',').map((value) => value.trim());
  const maxFileSize = () => Number(process.env.STORAGE_LOCAL_MAX_FILE_SIZE || '524288000');

  const validateFileUpload = async (mimeType: string, fileSize: number) => {
    h.storageState.policyCalls.push({ mimeType, fileSize });
    if (h.storageState.policyError) throw h.storageState.policyError;
    if (fileSize > maxFileSize()) {
      throw new Error(`File size exceeds limit of ${maxFileSize()} bytes`);
    }
    const allowed = allowedMimeTypes();
    if (!allowed.includes('*/*')) {
      const isAllowed = allowed.some((entry) =>
        entry.endsWith('/*') ? mimeType.startsWith(entry.slice(0, -1)) : mimeType === entry
      );
      if (!isAllowed) throw new Error('File type not allowed');
    }
  };

  const validateSystemArtifact = async (fileSize: number) => {
    h.storageState.artifactCalls.push(fileSize);
    if (h.storageState.artifactError) throw h.storageState.artifactError;
    if (fileSize > maxFileSize()) {
      throw new Error(`File size exceeds limit of ${maxFileSize()} bytes`);
    }
  };

  const createProvider = async () => ({
    upload: async (file: Buffer, path: string, options?: { mime_type?: string }) => {
      h.uploads.push({ path, size: file.length, mime: options?.mime_type });
      return { path, size: file.length };
    },
  });

  const generateStoragePath = (tenant: string, _base: string, filename: string) =>
    `test/${tenant}/${filename}`;

  return {
    getStorageConfig: async () => ({
      defaultProvider: 'local',
      providers: {
        local: { maxFileSize: maxFileSize(), allowedMimeTypes: allowedMimeTypes() },
      },
    }),
    validateFileUpload,
    validateSystemArtifact,
    StorageProviderFactory: { createProvider },
    generateStoragePath,
  };
}

// The production code loads the narrow `config/storage` subpath so the built
// email-service worker can resolve it; mock that exact module, not the barrel.
vi.mock('@alga-psa/storage/config/storage', () => {
  const module = fakeStorageModule();
  return {
    getStorageConfig: module.getStorageConfig,
    validateFileUpload: module.validateFileUpload,
    validateSystemArtifact: module.validateSystemArtifact,
  };
});
vi.mock('@alga-psa/storage/StorageProviderFactory', () => {
  const module = fakeStorageModule();
  return {
    StorageProviderFactory: module.StorageProviderFactory,
    generateStoragePath: module.generateStoragePath,
  };
});

function seedTables() {
  h.tables.clear();
  h.comments.length = 0;
  h.uploads.length = 0;
  h.storageState.policyError = null;
  h.storageState.artifactError = null;
  h.storageState.policyCalls.length = 0;
  h.storageState.artifactCalls.length = 0;
  h.tables.set('users', [{ user_id: 'system-user', created_at: '2020-01-01T00:00:00.000Z' }]);
  for (const table of [
    'email_processed_attachments',
    'external_files',
    'documents',
    'document_associations',
    'document_folders',
    'document_default_folders',
    'comments',
    'email_providers',
  ]) {
    h.tables.set(table, []);
  }
}

function buildEmailData(overrides: Partial<any> = {}) {
  return {
    id: 'email-voicemail@example.test',
    provider: 'imap',
    providerId: 'provider-1',
    tenant: 'tenant-1',
    receivedAt: '2026-01-01T00:00:00.000Z',
    from: { email: 'phone-system@example.test' },
    to: [{ email: 'support@example.test' }],
    subject: 'New voicemail',
    body: { text: 'Voicemail attached', html: undefined },
    attachments: [],
    ...overrides,
  } as any;
}

function wavAttachment() {
  return {
    id: 'attachment-wav-1',
    name: 'voicemail.wav',
    contentType: 'audio/wav',
    size: 12,
    content: Buffer.from('RIFF....WAVE').toString('base64'),
  };
}

async function run(overrides: Partial<any> = {}) {
  const { processInboundEmailArtifactsBestEffort } = await import('../processInboundEmailArtifacts');
  return processInboundEmailArtifactsBestEffort({
    tenantId: 'tenant-1',
    providerId: 'provider-1',
    ticketId: 'ticket-1',
    scopeLabel: 'new-ticket',
    emailData: buildEmailData(overrides),
  });
}

describe('processInboundEmailArtifactsBestEffort — inbound upload policy', () => {
  beforeEach(() => {
    seedTables();
    delete process.env.STORAGE_LOCAL_ALLOWED_MIME_TYPES;
    delete process.env.STORAGE_LOCAL_MAX_FILE_SIZE;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.STORAGE_LOCAL_ALLOWED_MIME_TYPES;
    delete process.env.STORAGE_LOCAL_MAX_FILE_SIZE;
  });

  it('persists an audio attachment as a downloadable ticket document under the default policy', async () => {
    await run({ attachments: [wavAttachment()] });

    const documents = h.getTable('documents');
    const wavDocument = documents.find((doc) => doc.mime_type === 'audio/wav');
    expect(wavDocument).toBeTruthy();
    expect(wavDocument.file_id).toBeTruthy();
    expect(wavDocument.storage_path).toBeTruthy();

    const association = h.getTable('document_associations').find(
      (row) => row.document_id === wavDocument.document_id
    );
    expect(association).toMatchObject({ entity_id: 'ticket-1', entity_type: 'ticket' });

    const processed = h.getTable('email_processed_attachments').find(
      (row) => row.attachment_id === 'attachment-wav-1'
    );
    expect(processed).toMatchObject({ processing_status: 'success' });
    expect(processed.file_id).toBe(wavDocument.file_id);

    // No trail comment for a successful attachment.
    expect(h.comments).toHaveLength(0);
  });

  it('skips a disallowed audio attachment and posts exactly one internal system comment', async () => {
    process.env.STORAGE_LOCAL_ALLOWED_MIME_TYPES = 'application/pdf';

    await run({ attachments: [wavAttachment()] });

    const processed = h.getTable('email_processed_attachments').find(
      (row) => row.attachment_id === 'attachment-wav-1'
    );
    expect(processed.processing_status).toBe('skipped');
    expect(String(processed.error_message)).toContain('attachment_type_not_allowed:audio/wav');

    expect(h.getTable('documents').some((doc) => doc.mime_type === 'audio/wav')).toBe(false);
    // The raw .eml is a system artifact: a restrictive user allow-list must not
    // suppress the archive, and it must not appear as a trail skip.
    expect(h.getTable('documents').some((doc) => doc.mime_type === 'message/rfc822')).toBe(true);

    expect(h.comments).toHaveLength(1);
    expect(h.comments[0]).toMatchObject({
      is_internal: true,
      author_type: 'system',
      is_system_generated: true,
    });
    expect(h.comments[0].content).toContain('voicemail.wav');
    expect(h.comments[0].content).toContain('attachment_type_not_allowed:audio/wav');
    // Author display is covered by tickets/lib/commentAuthorResolution.test.ts.
  });

  it('skips a genuinely oversized attachment as attachment_too_large and lists it in the trail', async () => {
    process.env.STORAGE_LOCAL_MAX_FILE_SIZE = '10';

    await run({ attachments: [wavAttachment()] });

    const processed = h.getTable('email_processed_attachments').find(
      (row) => row.attachment_id === 'attachment-wav-1'
    );
    expect(processed.processing_status).toBe('skipped');
    expect(processed.error_message).toBe('attachment_too_large:12');

    expect(h.comments).toHaveLength(1);
    expect(h.comments[0].content).toContain('voicemail.wav');
    expect(h.comments[0].content).toContain('attachment_too_large:12');
  });

  it('marks an arbitrary validator failure as failed (not skipped, not too_large) and reports the real error', async () => {
    h.storageState.policyError = new Error('storage config unavailable');

    await run({ attachments: [wavAttachment()] });

    const processed = h.getTable('email_processed_attachments').find(
      (row) => row.attachment_id === 'attachment-wav-1'
    );
    expect(processed.processing_status).toBe('failed');
    expect(processed.error_message).toBe('storage config unavailable');
    expect(String(processed.error_message)).not.toContain('too_large');
    expect(String(processed.error_message)).not.toContain('not_allowed');

    expect(h.comments).toHaveLength(1);
    expect(h.comments[0].content).toContain('storage config unavailable');
  });

  it('reports an original-email infrastructure failure in the trail instead of silently omitting it', async () => {
    h.storageState.artifactError = new Error('artifact storage unavailable');

    await run({ attachments: [wavAttachment()] });

    const original = h.getTable('email_processed_attachments').find(
      (row) => row.attachment_id === '__original_email_source__'
    );
    expect(original.processing_status).toBe('failed');
    expect(original.error_message).toBe('artifact storage unavailable');

    expect(h.comments).toHaveLength(1);
    expect(h.comments[0].content).toContain('original-email');
    expect(h.comments[0].content).toContain('artifact storage unavailable');
  });

  it('does not duplicate the trail comment when the same email is processed again', async () => {
    process.env.STORAGE_LOCAL_ALLOWED_MIME_TYPES = 'application/pdf';

    await run({ attachments: [wavAttachment()] });
    await run({ attachments: [wavAttachment()] });

    expect(h.comments).toHaveLength(1);
  });

  it('never suppresses the original .eml archive for a restrictive user allow-list', async () => {
    process.env.STORAGE_LOCAL_ALLOWED_MIME_TYPES = 'application/pdf';

    await run({ attachments: [wavAttachment()] });

    const emlDocument = h.getTable('documents').find((doc) => doc.mime_type === 'message/rfc822');
    expect(emlDocument).toBeTruthy();
    expect(emlDocument.file_id).toBeTruthy();
  });

  it('preserves inline CID image dedup without emitting a trail comment', async () => {
    const result = await run({
      body: { text: '', html: '<p><img src="cid:inline-image-1" /></p>' },
      attachments: [
        {
          id: 'attachment-inline-1',
          name: 'signature.png',
          contentType: 'image/png',
          size: 3,
          contentId: '<inline-image-1>',
          isInline: true,
          content: Buffer.from('abc').toString('base64'),
        },
      ],
    });

    expect(result.embeddedImageUrlMappings).toHaveLength(1);
    expect(result.embeddedImageUrlMappings[0]).toMatchObject({
      source: 'cid',
      reference: 'inline-image-1',
    });

    const base = h.getTable('email_processed_attachments').find(
      (row) => row.attachment_id === 'attachment-inline-1'
    );
    expect(base.processing_status).toBe('skipped');
    expect(String(base.error_message)).toContain('Inline/CID');

    expect(h.comments).toHaveLength(0);
  });
});
