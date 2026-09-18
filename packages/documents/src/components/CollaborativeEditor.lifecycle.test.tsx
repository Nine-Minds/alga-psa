/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render } from '@testing-library/react';
import { CollaborativeEditor } from './CollaborativeEditor';

const mockDestroy = vi.fn();
const mockYdocDestroy = vi.fn();

const mockProvider = {
  awareness: {
    getStates: vi.fn(() => new Map()),
    setLocalStateField: vi.fn(),
  },
  on: vi.fn(),
  off: vi.fn(),
  destroy: mockDestroy,
  status: 'connected',
  synced: true,
  hasUnsyncedChanges: false,
};

const mockYdoc = {
  getXmlFragment: vi.fn(() => ({ length: 0 })),
  destroy: mockYdocDestroy,
};

vi.mock('@tiptap/react', () => ({
  useEditor: vi.fn(() => null),
  EditorContent: () => null,
}));

vi.mock('@alga-psa/ui/editor', () => ({
  Emoticon: {},
  createYjsProvider: vi.fn(() => ({ provider: mockProvider, ydoc: mockYdoc })),
  AiResponseBlock: {},
  EmojiSuggestionExtension: { configure: vi.fn(() => ({})) },
  EmojiSuggestionPopup: () => null,
  MentionNode: {},
  MentionSuggestionExtension: { configure: vi.fn(() => ({})) },
  MentionSuggestionPopup: () => null,
}));

vi.mock('../actions/documentBlockContentActions', () => ({
  getBlockContent: vi.fn(),
  updateBlockContent: vi.fn(),
}));

describe('CollaborativeEditor provider lifecycle', () => {
  beforeEach(() => {
    mockDestroy.mockClear();
    mockYdocDestroy.mockClear();
    // `on` records the listeners each render registers; without clearing it a
    // previous test's handler is found first and the assertions read a stale
    // closure.
    mockProvider.on.mockClear();
    mockProvider.off.mockClear();
  });

  it('keeps the provider alive when the parent re-renders with new callback identities', () => {
    // KBArticleEditor passes `onConnectionStatusChange` as an inline arrow, so
    // every parent render (clicking Save, editing metadata, loading tags)
    // produced a fresh identity. When those props were effect dependencies the
    // cleanup destroyed the provider and Y.Doc mid-session, silently detaching
    // the editor from Hocuspocus: local edits stopped reaching the server and
    // the next snapshot save saw an empty room.
    const renderWith = (label: string) => (
      <CollaborativeEditor
        documentId="doc-123"
        tenantId="tenant-abc"
        userId="user-1"
        userName="Test User"
        onConnectionStatusChange={() => void label}
        onSyncStateChange={() => void label}
        onUsersChange={() => void label}
      />
    );

    const { rerender, unmount } = render(renderWith('first'));
    rerender(renderWith('second'));
    rerender(renderWith('third'));

    expect(mockDestroy).not.toHaveBeenCalled();
    expect(mockYdocDestroy).not.toHaveBeenCalled();

    unmount();

    expect(mockDestroy).toHaveBeenCalledTimes(1);
    expect(mockYdocDestroy).toHaveBeenCalledTimes(1);
  });

  it('still reports connection status through the latest callback', () => {
    const statuses: string[] = [];
    const { rerender } = render(
      <CollaborativeEditor
        documentId="doc-123"
        tenantId="tenant-abc"
        userId="user-1"
        userName="Test User"
        onConnectionStatusChange={() => statuses.push('stale')}
      />
    );

    // Re-render with a new callback; the provider effect does not re-run, so
    // the ref indirection is what keeps the newest callback wired up.
    rerender(
      <CollaborativeEditor
        documentId="doc-123"
        tenantId="tenant-abc"
        userId="user-1"
        userName="Test User"
        onConnectionStatusChange={(status) => statuses.push(status)}
      />
    );

    const statusHandler = mockProvider.on.mock.calls.find(([event]) => event === 'status')?.[1] as
      | ((payload: { status: string }) => void)
      | undefined;
    expect(statusHandler).toBeDefined();
    statusHandler!({ status: 'disconnected' });

    expect(statuses.at(-1)).toBe('disconnected');
  });
});
