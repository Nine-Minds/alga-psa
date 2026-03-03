import { describe, it, expect, vi, beforeEach } from 'vitest';

const createYjsProviderMock = vi.fn();
const yXmlFragmentToProsemirrorJSONMock = vi.fn();
const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();

vi.mock('@alga-psa/ui/editor', () => ({
  createYjsProvider: (...args: unknown[]) => createYjsProviderMock(...args),
}));

vi.mock('y-prosemirror', () => ({
  yXmlFragmentToProsemirrorJSON: (...args: unknown[]) => yXmlFragmentToProsemirrorJSONMock(...args),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: Function) => (...args: unknown[]) =>
    fn({ user_id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: unknown[]) => createTenantKnexMock(...args),
  withTransaction: (...args: unknown[]) => withTransactionMock(...args),
}));

const makeTrx = (existing: unknown, updated: unknown) => {
  const returning = vi.fn(async () => updated);
  const update = vi.fn(() => ({ returning }));
  const first = vi.fn(async () => existing);
  const where = vi.fn(() => ({ first, update }));
  const trx = Object.assign(
    (table: string) => ({ where, update }),
    {
      fn: {
        now: vi.fn(() => new Date()),
      },
    }
  );
  return { trx, where, update, returning, first };
};

describe('syncCollabSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes TipTap JSON snapshot to document_block_content', async () => {
    const json = { type: 'doc', content: [{ type: 'paragraph' }] };
    const fragment = { dummy: true };
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

    const { trx, update } = makeTrx({ content_id: 'content-1' }, [{ content_id: 'content-1' }]);

    createYjsProviderMock.mockReturnValue({ provider, ydoc });
    yXmlFragmentToProsemirrorJSONMock.mockReturnValue(json);
    createTenantKnexMock.mockResolvedValue({ knex: {} });
    withTransactionMock.mockImplementation(async (_knex: unknown, fn: Function) => fn(trx));

    const { syncCollabSnapshot } = await import('@alga-psa/documents/actions/collaborativeEditingActions');

    const result = await syncCollabSnapshot('doc-1');

    expect(result).toEqual({ success: true });
    expect(update).toHaveBeenCalledWith({
      block_data: JSON.stringify(json),
      updated_at: expect.any(Date),
    });
  });

  it('returns a not found error when the document is missing', async () => {
    const provider = {
      synced: true,
      on: vi.fn(),
      off: vi.fn(),
      destroy: vi.fn(),
    };
    const ydoc = {
      getXmlFragment: vi.fn(() => ({})),
      destroy: vi.fn(),
    };

    const { trx, update } = makeTrx(undefined, []);

    createYjsProviderMock.mockReturnValue({ provider, ydoc });
    yXmlFragmentToProsemirrorJSONMock.mockReturnValue({ type: 'doc', content: [] });
    createTenantKnexMock.mockResolvedValue({ knex: {} });
    withTransactionMock.mockImplementation(async (_knex: unknown, fn: Function) => fn(trx));

    const { syncCollabSnapshot } = await import('@alga-psa/documents/actions/collaborativeEditingActions');

    const result = await syncCollabSnapshot('missing-doc');

    expect(result).toEqual({ success: false, message: 'Document not found.' });
    expect(update).not.toHaveBeenCalled();
  });
});
