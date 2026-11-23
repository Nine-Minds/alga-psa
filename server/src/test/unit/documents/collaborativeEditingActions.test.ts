import { describe, it, expect, vi, beforeEach } from 'vitest';

const createYjsProviderMock = vi.fn();
const yXmlFragmentToProsemirrorJSONMock = vi.fn();
const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();
const hasPermissionMock = vi.fn();
const getAuthorizedDocumentByIdMock = vi.fn();
const deletePreviewMock = vi.fn();

vi.mock('@alga-psa/ui/editor', () => ({
  createYjsProvider: (...args: unknown[]) => createYjsProviderMock(...args),
}));

vi.mock('y-prosemirror', () => ({
  yXmlFragmentToProsemirrorJSON: (...args: unknown[]) => yXmlFragmentToProsemirrorJSONMock(...args),
}));

vi.mock('@alga-psa/auth', () => ({
  hasPermission: (...args: unknown[]) => hasPermissionMock(...args),
  withAuth: (fn: Function) => (...args: unknown[]) =>
    fn({ user_id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
}));

vi.mock('@alga-psa/documents/actions/documentActions', () => ({
  getAuthorizedDocumentById: (...args: unknown[]) => getAuthorizedDocumentByIdMock(...args),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: unknown[]) => createTenantKnexMock(...args),
  withTransaction: (...args: unknown[]) => withTransactionMock(...args),
  runWithTenant: (_tenant: string, fn: () => unknown) => fn(),
  tenantDb: (conn: any, _tenant: string) => ({
    table: (t: string) => conn(t),
  }),
}));

vi.mock('@alga-psa/documents/cache/CacheFactory', () => ({
  CacheFactory: {
    getPreviewCache: () => ({
      delete: deletePreviewMock,
    }),
  },
}));

const makeTrx = (existing: unknown, updated: unknown) => {
  const returning = vi.fn(async () => updated);
  const update = vi.fn(() => ({ returning }));
  const content = { where: vi.fn(() => ({ first: vi.fn(async () => existing), update })) };
  const documentUpdate = vi.fn(async () => 1);
  const documents = { where: vi.fn(() => ({ update: documentUpdate })) };
  const users = { where: vi.fn(() => ({ first: vi.fn(async () => ({ user_id: 'user-1', is_inactive: false })) })) };
  const tables = { document_block_content: content, documents, users };
  const trx = Object.assign(
    (table: keyof typeof tables) => tables[table],
    { fn: { now: vi.fn(() => new Date()) } },
  );
  return { trx, update, documentUpdate };
};

describe('syncCollabSnapshot', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    hasPermissionMock.mockResolvedValue(true);
    getAuthorizedDocumentByIdMock.mockResolvedValue({ document_id: 'doc-1', content: '' });
  });

  it('writes TipTap JSON snapshot to document_block_content', async () => {
    const json = { type: 'doc', content: [{ type: 'paragraph' }] };
    const fragment = { length: 1 };
    const provider = {
      synced: true,
      on: vi.fn(),
      off: vi.fn(),
      destroy: vi.fn(),
    };
    const ydoc = {
      getXmlFragment: vi.fn(() => fragment),
      destroy: vi.fn(),
    };

    const { trx, update, documentUpdate } = makeTrx({ content_id: 'content-1' }, [{ content_id: 'content-1' }]);

    createYjsProviderMock.mockReturnValue({ provider, ydoc });
    yXmlFragmentToProsemirrorJSONMock.mockReturnValue(json);
    createTenantKnexMock.mockResolvedValue({ knex: {} });
    withTransactionMock.mockImplementation(async (_knex: unknown, fn: Function) => fn(trx));

    const { syncCollabSnapshot } = await import('@alga-psa/documents/actions/collaborativeEditingActions');

    const result = await syncCollabSnapshot('doc-1');

    expect(result).toEqual({ success: true });
    expect(getAuthorizedDocumentByIdMock).toHaveBeenCalledTimes(2);
    expect(documentUpdate).toHaveBeenCalledWith({ edited_by: 'user-1', updated_at: expect.any(Date) });
    expect(deletePreviewMock).toHaveBeenCalledWith('doc-1');
    expect(provider.destroy).toHaveBeenCalledTimes(1);
    expect(ydoc.destroy).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      block_data: JSON.stringify(json),
      updated_at: expect.any(Date),
    });
  });

  it('returns a not found error when stored document content is missing', async () => {
    const provider = {
      synced: true,
      on: vi.fn(),
      off: vi.fn(),
      destroy: vi.fn(),
    };
    const ydoc = {
      getXmlFragment: vi.fn(() => ({ length: 1 })),
      destroy: vi.fn(),
    };

    const { trx, update } = makeTrx(undefined, []);

    createYjsProviderMock.mockReturnValue({ provider, ydoc });
    yXmlFragmentToProsemirrorJSONMock.mockReturnValue({ type: 'doc', content: [] });
    createTenantKnexMock.mockResolvedValue({ knex: {} });
    withTransactionMock.mockImplementation(async (_knex: unknown, fn: Function) => fn(trx));

    const { syncCollabSnapshot } = await import('@alga-psa/documents/actions/collaborativeEditingActions');

    const result = await syncCollabSnapshot('missing-doc');

    expect(result).toEqual({ success: false, message: 'Document content not found.' });
    expect(update).not.toHaveBeenCalled();
    expect(deletePreviewMock).not.toHaveBeenCalled();
  });

  it('denies callers without update permission before opening the room', async () => {
    hasPermissionMock.mockResolvedValue(false);
    const { syncCollabSnapshot } = await import('@alga-psa/documents/actions/collaborativeEditingActions');

    expect(await syncCollabSnapshot('doc-1')).toMatchObject({ success: false, message: expect.stringContaining('Permission denied') });
    expect(createYjsProviderMock).not.toHaveBeenCalled();
    expect(createTenantKnexMock).not.toHaveBeenCalled();
  });

  it.each([null, { document_id: 'doc-1' }])('rejects an inaccessible content projection: %j', async document => {
    getAuthorizedDocumentByIdMock.mockResolvedValue(document);
    createTenantKnexMock.mockResolvedValue({ knex: {} });
    withTransactionMock.mockImplementation(async (_knex: unknown, fn: Function) => fn({}));
    const { syncCollabSnapshot } = await import('@alga-psa/documents/actions/collaborativeEditingActions');

    expect(await syncCollabSnapshot('doc-1')).toMatchObject({ success: false, message: expect.stringContaining('Permission denied') });
    expect(createYjsProviderMock).not.toHaveBeenCalled();
    expect(deletePreviewMock).not.toHaveBeenCalled();
  });

  it('does not persist when content access is revoked while the room synchronizes', async () => {
    getAuthorizedDocumentByIdMock
      .mockResolvedValueOnce({ document_id: 'doc-1', content: '' })
      .mockResolvedValueOnce({ document_id: 'doc-1' });
    const { trx, update } = makeTrx({ content_id: 'content-1' }, [{ content_id: 'content-1' }]);
    createTenantKnexMock.mockResolvedValue({ knex: {} });
    withTransactionMock.mockImplementation(async (_knex: unknown, fn: Function) => fn(trx));
    const provider = { synced: true, on: vi.fn(), off: vi.fn(), destroy: vi.fn() };
    const ydoc = { getXmlFragment: vi.fn(() => ({ length: 1 })), destroy: vi.fn() };
    createYjsProviderMock.mockReturnValue({ provider, ydoc });
    yXmlFragmentToProsemirrorJSONMock.mockReturnValue({ type: 'doc', content: [] });
    const { syncCollabSnapshot } = await import('@alga-psa/documents/actions/collaborativeEditingActions');

    expect(await syncCollabSnapshot('doc-1')).toMatchObject({ success: false, permissionDenied: true });
    expect(createYjsProviderMock).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
    expect(deletePreviewMock).not.toHaveBeenCalled();
    expect(provider.destroy).toHaveBeenCalledTimes(1);
    expect(ydoc.destroy).toHaveBeenCalledTimes(1);
  });
});
