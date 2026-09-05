import { beforeEach, describe, expect, it, vi } from 'vitest';

const persistCollabSnapshot = vi.fn(async () => ({ success: true }));
const yXmlFragmentToProsemirrorJSON = vi.fn(() => ({ type: 'doc', content: [] as unknown[] }));

let fragmentLength = 0;
const providerDestroy = vi.fn();
const ydocDestroy = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (fn: (user: unknown, ctx: unknown, ...args: any[]) => unknown) =>
    (...args: any[]) =>
      fn({ user_id: 'user-1' }, { tenant: 'tenant-abc' }, ...args),
}));

vi.mock('@alga-psa/ui/editor', () => ({
  createYjsProvider: vi.fn(() => ({
    provider: { synced: true, on: vi.fn(), off: vi.fn(), destroy: providerDestroy },
    ydoc: {
      getXmlFragment: vi.fn(() => ({ length: fragmentLength })),
      destroy: ydocDestroy,
    },
  })),
}));

vi.mock('y-prosemirror', () => ({
  yXmlFragmentToProsemirrorJSON: (...args: any[]) => yXmlFragmentToProsemirrorJSON(...(args as [])),
}));

vi.mock('../lib/collabPersistence', () => ({
  persistCollabSnapshot: (...args: any[]) => persistCollabSnapshot(...(args as [])),
}));

const importAction = async () =>
  (await import('./collaborativeEditingActions')).syncCollabSnapshot as unknown as (
    documentId: string
  ) => Promise<{ success: boolean; message?: string }>;

describe('syncCollabSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    persistCollabSnapshot.mockResolvedValue({ success: true });
  });

  it('refuses to persist an empty room over stored content', async () => {
    fragmentLength = 0;
    const syncCollabSnapshot = await importAction();

    const result = await syncCollabSnapshot('doc-1');

    // The room can be empty because it was never seeded from the database or
    // was evicted; persisting it would wipe block_data (the KB article, images
    // and all). The caller falls back to the browser's editor JSON instead.
    expect(persistCollabSnapshot).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(providerDestroy).toHaveBeenCalled();
    expect(ydocDestroy).toHaveBeenCalled();
  });

  it('persists the snapshot when the room has content', async () => {
    fragmentLength = 3;
    const doc = { type: 'doc', content: [{ type: 'image', attrs: { src: '/api/documents/view/f1' } }] };
    yXmlFragmentToProsemirrorJSON.mockReturnValueOnce(doc as any);
    const syncCollabSnapshot = await importAction();

    const result = await syncCollabSnapshot('doc-1');

    expect(persistCollabSnapshot).toHaveBeenCalledWith('tenant-abc', 'doc-1', doc);
    expect(result.success).toBe(true);
  });
});
