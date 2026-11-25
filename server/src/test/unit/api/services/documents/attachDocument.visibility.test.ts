import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';

const uploadFile = vi.fn();
const deleteFile = vi.fn();
const hasApiContextPermission = vi.fn();
const inserted = vi.hoisted(() => ({ rows: [] as Array<{ table: string; row: Record<string, unknown> }> }));

vi.mock('@alga-psa/storage/StorageService', () => ({
  StorageService: { uploadFile: (...a: unknown[]) => uploadFile(...a), deleteFile: (...a: unknown[]) => deleteFile(...a) },
}));
vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: (table: string) => ({
      where: () => ({ first: async () => ({ type_id: 'type-1' }) }),
      insert: async (row: Record<string, unknown>) => { inserted.rows.push({ table, row }); },
    }),
  }),
  withTransaction: async (_knex: unknown, fn: (trx: unknown) => Promise<unknown>) => fn({}),
}));
vi.mock('@alga-psa/documents/lib/documentPreviewJob', () => ({ scheduleDocumentPreviews: vi.fn(async () => undefined) }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: vi.fn(async () => undefined), publishWorkflowEvent: vi.fn(async () => undefined) }));
vi.mock('@alga-psa/workflow-streams', () => ({ buildDocumentAssociatedPayload: () => ({}) }));
vi.mock('server/src/lib/api/middleware/apiContextPermission', () => ({
  hasApiContextPermission: (...a: unknown[]) => hasApiContextPermission(...a),
}));
// Adapter shapes mirror the real table; the real adapters are covered in entityAdapters.visibility.test.ts.
vi.mock('server/src/lib/api/services/documents/entityAdapters', async () => {
  const visible = (options: { commentAttachmentDraft?: boolean; isClientVisible?: boolean }) =>
    options.commentAttachmentDraft || options.isClientVisible ? { is_client_visible: true } : {};
  const adapter = (portalVisible: boolean) => ({
    portalVisible,
    resolveFolder: async () => '/',
    ...(portalVisible ? { documentOverrides: visible } : {}),
  });
  return {
    ENTITY_ADAPTERS: {
      ticket: adapter(true),
      project_task: adapter(true),
      client: adapter(true),
      contact: adapter(false),
      asset: adapter(false),
    },
  };
});

import { ForbiddenError, ValidationError } from 'server/src/lib/api/middleware/apiErrors';
import { attachDocument } from 'server/src/lib/api/services/documents/attachDocument';

const ctx = { tenant: 'tenant-1', user: { user_id: 'user-1' } };
const attach = (
  entityType: 'ticket' | 'project_task' | 'client' | 'contact' | 'asset',
  options?: { isClientVisible?: boolean; commentAttachmentDraft?: boolean },
  permissionContext: typeof ctx | null = ctx,
) =>
  attachDocument({
    knex: {} as any,
    tenant: 'tenant-1',
    actorUserId: 'user-1',
    target: { entityType, entityId: 'e-1' },
    file: { fileName: 'a.txt', mimeType: 'text/plain', body: Readable.from([Buffer.from('abc')]) },
    source: 'base64',
    options,
    permissionContext: permissionContext ?? undefined,
    loadDocument: async (id: string) => ({ document_id: id } as any),
  });
const documentRow = () => inserted.rows.find((r) => r.table === 'documents')!.row;

beforeEach(() => {
  vi.clearAllMocks();
  inserted.rows.length = 0;
  uploadFile.mockResolvedValue({ file_id: 'f1', storage_path: 'p', mime_type: 'text/plain', file_size: 3 });
  hasApiContextPermission.mockResolvedValue(true);
});

describe('attachDocument client visibility', () => {
  it('stays internal by default and for an explicit false', async () => {
    await attach('ticket');
    expect(documentRow()).not.toHaveProperty('is_client_visible');
    inserted.rows.length = 0;
    await attach('ticket', { isClientVisible: false });
    expect(documentRow()).not.toHaveProperty('is_client_visible');
    expect(hasApiContextPermission).not.toHaveBeenCalled();
  });

  it.each(['ticket', 'project_task', 'client'] as const)('accepts true on %s and checks document:update', async (entityType) => {
    await attach(entityType, { isClientVisible: true });
    expect(documentRow()).toMatchObject({ is_client_visible: true });
    expect(hasApiContextPermission).toHaveBeenCalledWith(ctx, 'document', 'update', expect.anything());
  });

  it.each(['contact', 'asset'] as const)('refuses true on %s with a 400 before any upload', async (entityType) => {
    await expect(attach(entityType, { isClientVisible: true })).rejects.toBeInstanceOf(ValidationError);
    expect(uploadFile).not.toHaveBeenCalled();
    expect(inserted.rows).toEqual([]);
  });

  it('allows an explicit false on contact and asset', async () => {
    await attach('contact', { isClientVisible: false });
    await attach('asset', { isClientVisible: false });
    expect(uploadFile).toHaveBeenCalledTimes(2);
  });

  it('refuses true without document:update, before any upload', async () => {
    hasApiContextPermission.mockResolvedValue(false);
    await expect(attach('ticket', { isClientVisible: true })).rejects.toBeInstanceOf(ForbiddenError);
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('fails closed when no permission context is supplied', async () => {
    await expect(attach('client', { isClientVisible: true }, null)).rejects.toBeInstanceOf(ForbiddenError);
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('keeps a comment-attachment draft client-visible when isClientVisible is false', async () => {
    await attach('ticket', { commentAttachmentDraft: true, isClientVisible: false });
    expect(documentRow()).toMatchObject({ is_client_visible: true });
  });
});
