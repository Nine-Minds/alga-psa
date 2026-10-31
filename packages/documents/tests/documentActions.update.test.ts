import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Behavioural tests for `updateDocument` / `replaceDocumentFile`, run against an in-memory
 * documents table. They live under tests/ because the documents-node vitest project only
 * includes tests/**\/*.test.ts.
 */

type Row = Record<string, any>;

const TENANT = 'tenant-a';
const OTHER_TENANT = 'tenant-b';
const SESSION_USER = { user_id: 'session-user', tenant: TENANT };

const state = vi.hoisted(() => ({
  documents: [] as Array<Record<string, any>>,
  readable: new Set<string>(),
  permissions: new Set<string>(),
  updates: [] as Array<Record<string, any>>,
  published: [] as Array<Record<string, any>>,
  previewCalls: [] as Array<Record<string, any>>,
}));

vi.mock('@alga-psa/db', () => {
  const makeQuery = (tenant: string) => {
    const predicates: Array<(row: Row) => boolean> = [(row) => row.tenant === tenant];
    const query: any = {
      modify(fn: (q: unknown) => unknown) {
        fn(query);
        return query;
      },
      where(criteria: Row | string, value?: unknown) {
        if (typeof criteria === 'string') {
          predicates.push((row) => row[criteria] === value);
        } else {
          for (const [key, v] of Object.entries(criteria)) predicates.push((row) => row[key] === v);
        }
        return query;
      },
      async first() {
        return state.documents.find((row) => predicates.every((p) => p(row)));
      },
      async update(values: Row) {
        state.updates.push(values);
        const rows = state.documents.filter((row) => predicates.every((p) => p(row)));
        rows.forEach((row) => Object.assign(row, values));
        return rows.length;
      },
    };
    return query;
  };
  return {
    createTenantKnex: async () => ({ knex: {}, tenant: TENANT }),
    withTransaction: async (_knex: unknown, fn: (trx: unknown) => unknown) => fn({}),
    tenantDb: (_conn: unknown, tenant: string) => ({ table: () => makeQuery(tenant) }),
  };
});

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: (...args: any[]) => unknown) => (...args: unknown[]) =>
    fn(SESSION_USER, { tenant: TENANT }, ...args),
  hasPermission: async (_user: unknown, resource: string, action: string) =>
    state.permissions.has(`${resource}:${action}`),
  checkMultiplePermissions: vi.fn(),
}));

vi.mock('@shared/lib/documentAuthorization', () => ({
  authorizeAndRedactDocuments: async (_trx: unknown, _tenant: string, _user: unknown, docs: Row[]) =>
    docs.filter((doc) => state.readable.has(doc.document_id)),
}));
vi.mock('../src/lib/meetingDocumentAdmission', () => ({
  admitMeetingDocumentsForBrowser: async (_t: unknown, _te: string, _u: unknown, documents: Row[]) => ({
    documents,
  }),
}));
vi.mock('../src/lib/documentPermissions', () => ({
  applyDocumentProductReadScope: (query: unknown) => query,
  canReadDocument: vi.fn(),
  canReadTicketDocuments: vi.fn(),
  canUploadDocument: vi.fn(),
}));
vi.mock('../src/cache/CacheFactory', () => ({
  CacheFactory: { getPreviewCache: () => ({ delete: async () => undefined }) },
}));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: async (event: Row) => {
    state.published.push(event);
  },
  publishWorkflowEvent: vi.fn(),
}));
vi.mock('../src/lib/documentPreviewGenerator', () => ({
  generateDocumentPreviews: async (document: Row) => {
    state.previewCalls.push(document);
    return {
      thumbnail_file_id: 'generated-thumb',
      preview_file_id: 'generated-preview',
      preview_generated_at: new Date('2026-01-01T00:00:00Z'),
    };
  },
}));
vi.mock('@alga-psa/storage/StorageService', () => ({
  StorageService: { downloadFile: async () => ({ buffer: Buffer.from('bytes'), metadata: {} }) },
}));

// Heavy, irrelevant imports of the actions module.
vi.mock('@alga-psa/workflow-streams', () => ({
  buildDocumentAssociatedPayload: vi.fn(),
  buildDocumentDeletedPayload: vi.fn(),
  buildDocumentDetachedPayload: vi.fn(),
}));
vi.mock('puppeteer', () => ({ default: {} }));
vi.mock('pdf2pic', () => ({ fromPath: vi.fn() }));
vi.mock('pdf-lib', () => ({ PDFDocument: {} }));
vi.mock('marked', () => ({ marked: vi.fn() }));
vi.mock('next/server', () => ({ NextResponse: {} }));
vi.mock('@shared/lib/ticketCommentAttachments', () => ({
  canAccessAttachmentTicket: vi.fn(),
  expireCommentAttachmentDrafts: vi.fn(),
}));
vi.mock('@alga-psa/documents/models/documentAssociation', () => ({ default: {} }));
vi.mock('../src/actions/file-actions/fileActions', () => ({ deleteFile: vi.fn() }));
vi.mock('@alga-psa/core/server', () => ({ deleteEntityWithValidation: vi.fn() }));
vi.mock('@alga-psa/tags/lib/tagCleanup', () => ({ deleteEntityTags: vi.fn() }));
vi.mock('@alga-psa/documents/handlers/DocumentHandlerRegistry', () => ({ DocumentHandlerRegistry: {} }));
vi.mock('@alga-psa/documents/handlers/previewErrors', () => ({ documentPreviewErrorMessage: vi.fn() }));
vi.mock('@alga-psa/formatting/avatarUtils', () => ({
  getClientLogoUrlsBatch: vi.fn(),
  getContactAvatarUrlsBatch: vi.fn(),
}));
vi.mock('../src/lib/inlineImageFiling', () => ({ ensureInlineImageFolder: vi.fn() }));
vi.mock('../src/lib/documentDownloadResponse', () => ({ createDocumentDownloadResponse: vi.fn() }));

const { updateDocument, replaceDocumentFile, getAuthorizedDocumentById } = await import(
  '../src/actions/documentActions'
);

const baseDoc = (overrides: Row = {}): Row => ({
  document_id: 'doc-1',
  document_name: 'Original',
  tenant: TENANT,
  file_id: 'file-1',
  preview_file_id: 'preview-1',
  thumbnail_file_id: 'thumb-1',
  preview_generated_at: new Date('2025-01-01T00:00:00Z'),
  storage_path: '/store/original',
  mime_type: 'image/png',
  file_size: 111,
  user_id: 'owner',
  created_by: 'owner',
  order_number: 1,
  source_template_id: 'tpl-1',
  source_template_version: 3,
  rendered_locale: 'en',
  entered_at: new Date('2024-01-01T00:00:00Z'),
  updated_at: new Date('2024-06-01T00:00:00Z'),
  edited_by: 'original-editor',
  type_id: 'type-1',
  folder_path: '/a',
  is_client_visible: false,
  shared_type_id: 'shared-1',
  ...overrides,
});

const FORBIDDEN: Array<[string, unknown]> = [
  ['file_id', 'victim-file'],
  ['preview_file_id', 'victim-preview'],
  ['thumbnail_file_id', 'victim-thumb'],
  ['preview_generated_at', new Date('2030-01-01T00:00:00Z')],
  ['storage_path', '/store/victim'],
  ['mime_type', 'application/x-evil'],
  ['file_size', 999999],
  ['tenant', OTHER_TENANT],
  ['user_id', 'attacker'],
  ['created_by', 'attacker'],
  ['document_id', 'doc-other'],
  ['order_number', 42],
  ['source_template_id', 'tpl-evil'],
  ['source_template_version', 99],
  ['rendered_locale', 'xx'],
  ['entered_at', new Date('2000-01-01T00:00:00Z')],
  ['updated_at', new Date('2000-01-01T00:00:00Z')],
];

const row = (id = 'doc-1') => state.documents.find((d) => d.document_id === id && d.tenant === TENANT)!;

beforeEach(() => {
  state.documents = [
    baseDoc(),
    // Same-tenant file the caller can no longer read.
    baseDoc({ document_id: 'doc-secret', file_id: 'victim-file', document_name: 'Secret' }),
    // Same-tenant file the caller can read.
    baseDoc({ document_id: 'doc-readable', file_id: 'readable-file', mime_type: 'application/pdf', document_name: 'Readable' }),
    // Other-tenant document that happens to use a file id.
    baseDoc({ document_id: 'doc-foreign', tenant: OTHER_TENANT, file_id: 'foreign-file' }),
  ];
  state.readable = new Set(['doc-1', 'doc-readable']);
  state.permissions = new Set(['document:update']);
  state.updates = [];
  state.published = [];
  state.previewCalls = [];
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('updateDocument allowlist', () => {
  it.each(FORBIDDEN)('ignores forbidden field %s but applies document_name', async (field, value) => {
    const before = { ...row() };

    await updateDocument('doc-1', { document_name: 'Renamed', [field]: value } as any);

    expect(row().document_name).toBe('Renamed');
    if (field === 'updated_at') {
      // The server stamps this itself; the caller's value must not win.
      expect(row().updated_at).not.toEqual(value);
    } else {
      expect((row() as Row)[field]).toEqual(before[field]);
    }
    expect(state.documents.filter((d) => d.document_id === 'doc-other')).toHaveLength(0);
    // Nothing forbidden was ever handed to the UPDATE.
    expect(Object.keys(state.updates[0]).sort()).toEqual(['document_name', 'edited_by', 'updated_at']);
  });

  it('ignores every forbidden field sent together', async () => {
    const before = { ...row() };
    const payload = Object.fromEntries(FORBIDDEN);

    await updateDocument('doc-1', { document_name: 'Renamed', ...payload } as any);

    for (const [field] of FORBIDDEN) {
      if (field === 'updated_at') continue; // server stamps this itself
      expect(row()[field], field).toEqual(before[field]);
    }
    expect(row().document_name).toBe('Renamed');
  });

  it('persists all allowlisted metadata', async () => {
    await updateDocument('doc-1', {
      document_name: 'New name',
      type_id: 'type-2',
      folder_path: '/b/c',
      is_client_visible: true,
      shared_type_id: 'shared-2',
    });

    expect(row()).toMatchObject({
      document_name: 'New name',
      type_id: 'type-2',
      folder_path: '/b/c',
      is_client_visible: true,
      shared_type_id: 'shared-2',
    });
  });

  it('stamps edited_by from the session even when the payload carries another id', async () => {
    await updateDocument('doc-1', { document_name: 'Renamed', edited_by: 'someone-else' } as any);

    expect(row().edited_by).toBe(SESSION_USER.user_id);
  });

  it('derives the search-event field list from the picked keys only', async () => {
    await updateDocument('doc-1', { document_name: 'Renamed', file_id: 'victim-file', tenant: 'x' } as any);

    expect(state.published).toHaveLength(1);
    expect(state.published[0].payload.changedFields).toEqual(['document_name']);
  });

  it('empty command (decision): issues no UPDATE, writes no audit stamp, publishes nothing', async () => {
    const before = { ...row() };

    await expect(updateDocument('doc-1', {})).resolves.toBeUndefined();
    await expect(updateDocument('doc-1', { file_id: 'victim-file' } as any)).resolves.toBeUndefined();
    await expect(updateDocument('doc-1', undefined as any)).resolves.toBeUndefined();

    expect(state.updates).toHaveLength(0);
    expect(row()).toEqual(before);
    expect(state.published).toHaveLength(0);
  });

  it('still denies an unreadable target document', async () => {
    const result = await updateDocument('doc-secret', { document_name: 'x' });

    expect(result).toMatchObject({ permissionError: expect.any(String) });
    expect(row('doc-secret').document_name).toBe('Secret');
  });
});

describe('replaceDocumentFile', () => {
  it('allows a file whose owning document the caller can read; only file_id changes', async () => {
    const before = { ...row() };

    const result = await replaceDocumentFile('doc-1', 'readable-file');

    expect(result).toBeUndefined();
    expect(row().file_id).toBe('readable-file');
    for (const field of [
      'storage_path', 'mime_type', 'file_size', 'tenant', 'user_id', 'created_by', 'document_id',
      'order_number', 'source_template_id', 'source_template_version', 'rendered_locale', 'entered_at',
      'document_name', 'edited_by',
    ]) {
      expect(row()[field], field).toEqual(before[field]);
    }
    // First UPDATE touches file_id + updated_at only.
    expect(Object.keys(state.updates[0]).sort()).toEqual(['file_id', 'updated_at']);
    expect(state.published[0].payload.changedFields).toEqual(['file_id']);
  });

  it('regenerates previews through the generator and writes them only from its result', async () => {
    await replaceDocumentFile('doc-1', 'readable-file');

    expect(state.previewCalls).toHaveLength(1);
    expect(state.previewCalls[0]).toMatchObject({ file_id: 'readable-file', mime_type: 'application/pdf' });
    expect(row()).toMatchObject({
      preview_file_id: 'generated-preview',
      thumbnail_file_id: 'generated-thumb',
    });
  });

  it('refuses a file owned by a document the caller cannot read', async () => {
    const result = await replaceDocumentFile('doc-1', 'victim-file');

    expect(result).toMatchObject({ permissionError: expect.any(String) });
    expect(row().file_id).toBe('file-1');
    expect(state.updates).toHaveLength(0);
  });

  it('refuses a file from another tenant', async () => {
    state.readable.add('doc-foreign');

    const result = await replaceDocumentFile('doc-1', 'foreign-file');

    expect(result).toMatchObject({ permissionError: expect.any(String) });
    expect(row().file_id).toBe('file-1');
  });

  it('refuses a file that does not exist', async () => {
    const result = await replaceDocumentFile('doc-1', 'nope');

    expect(result).toMatchObject({ permissionError: expect.any(String) });
    expect(row().file_id).toBe('file-1');
  });

  it('refuses when the caller cannot update the target document', async () => {
    const result = await replaceDocumentFile('doc-secret', 'readable-file');

    expect(result).toMatchObject({ permissionError: expect.any(String) });
    expect(row('doc-secret').file_id).toBe('victim-file');
  });

  it('refuses without document:update permission', async () => {
    state.permissions.clear();

    const result = await replaceDocumentFile('doc-1', 'readable-file');

    expect(result).toMatchObject({ permissionError: expect.any(String) });
    expect(row().file_id).toBe('file-1');
  });
});

describe('exploit chain', () => {
  it('download-route lookup still resolves the original file after a rejected rebinding', async () => {
    await updateDocument('doc-1', {
      document_name: 'Renamed',
      file_id: 'victim-file',
      preview_file_id: 'victim-preview',
      thumbnail_file_id: 'victim-thumb',
    } as any);
    await replaceDocumentFile('doc-1', 'victim-file');

    // Mirrors the download route: authorize the document, then serve its file_id.
    const resolved = await getAuthorizedDocumentById({} as any, TENANT, SESSION_USER as any, 'doc-1');

    expect(resolved?.file_id).toBe('file-1');
    expect(resolved?.preview_file_id).toBe('preview-1');
    expect(resolved?.thumbnail_file_id).toBe('thumb-1');
  });
});
