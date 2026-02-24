/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, waitFor, screen } from '@testing-library/react';
import { CollaborativeEditor } from './CollaborativeEditor';
import { prosemirrorJSONToYXmlFragment } from 'y-prosemirror';
import { blockNoteJsonToProsemirrorJson } from '../lib/blockContentFormat';
import { getBlockContent, updateBlockContent } from '../actions/documentBlockContentActions';

const mockProvider = {
  awareness: {
    getStates: vi.fn(() => new Map()),
    setLocalStateField: vi.fn(),
  },
  on: vi.fn(),
  off: vi.fn(),
  destroy: vi.fn(),
  status: 'connected',
  synced: true,
  hasUnsyncedChanges: false,
};

const fragment = { length: 0 };
const mockYdoc = {
  getXmlFragment: vi.fn(() => fragment),
  destroy: vi.fn(),
};

const createYjsProvider = vi.fn(() => ({
  provider: mockProvider,
  ydoc: mockYdoc,
}));

let hasCreated = false;

const caretRenderRef = vi.hoisted(() => ({
  current: null as ((user: { name: string; color: string }) => HTMLElement) | null,
}));

const mockCollaboration = vi.hoisted(() => ({
  configure: vi.fn(() => ({})),
}));

const mockCollaborationCaret = vi.hoisted(() => ({
  configure: vi.fn((options: { render: (user: { name: string; color: string }) => HTMLElement }) => {
    caretRenderRef.current = options.render;
    return {};
  }),
}));

vi.mock('@tiptap/react', () => ({
  useEditor: vi.fn((options) => {
    if (!hasCreated && options?.onCreate) {
      hasCreated = true;
      options.onCreate();
    }
    return {
      schema: {},
      isDestroyed: false,
      commands: {
        insertContent: vi.fn(),
      },
    };
  }),
  EditorContent: () => null,
}));

vi.mock('@tiptap/extension-collaboration', () => ({
  default: mockCollaboration,
}));

vi.mock('@tiptap/extension-collaboration-caret', () => ({
  default: mockCollaborationCaret,
}));

vi.mock('y-prosemirror', () => ({
  prosemirrorJSONToYXmlFragment: vi.fn(),
}));

vi.mock('./EditorToolbar', () => ({
  EditorToolbar: () => null,
}));

vi.mock('@alga-psa/ui/editor', () => ({
  Emoticon: {},
  createYjsProvider: (...args: any[]) => createYjsProvider(...args),
  EmojiSuggestionExtension: { configure: vi.fn(() => ({})) },
  EmojiSuggestionPopup: () => null,
  MentionNode: {},
  MentionSuggestionExtension: { configure: vi.fn(() => ({})) },
  MentionSuggestionPopup: () => null,
}));

vi.mock('@alga-psa/ui/components/AvatarIcon', () => ({
  default: () => <div data-testid="avatar" />,
}));

vi.mock('../actions/documentBlockContentActions', () => ({
  getBlockContent: vi.fn(),
  updateBlockContent: vi.fn(),
}));

describe('CollaborativeEditor initialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasCreated = false;
    caretRenderRef.current = null;
    mockYdoc.getXmlFragment.mockReturnValue(fragment);
  });

  it('loads ProseMirror JSON without conversion', async () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
    };

    (getBlockContent as unknown as { mockResolvedValue: (value: unknown) => void }).mockResolvedValue({
      block_data: doc,
    });

    render(
      <CollaborativeEditor
        documentId="doc-1"
        tenantId="tenant-1"
        userId="user-1"
        userName="User One"
      />
    );

    await waitFor(() => {
      expect(prosemirrorJSONToYXmlFragment).toHaveBeenCalled();
    });

    expect(prosemirrorJSONToYXmlFragment).toHaveBeenCalledWith({}, doc, fragment);
    expect(updateBlockContent).not.toHaveBeenCalled();
  });

  it('loads BlockNote JSON after conversion', async () => {
    const blocknote = [
      {
        type: 'paragraph',
        props: { textAlignment: 'left' },
        content: [{ type: 'text', text: 'Legacy', styles: {} }],
      },
    ];

    const converted = blockNoteJsonToProsemirrorJson(blocknote);

    (getBlockContent as unknown as { mockResolvedValue: (value: unknown) => void }).mockResolvedValue({
      block_data: blocknote,
    });

    render(
      <CollaborativeEditor
        documentId="doc-2"
        tenantId="tenant-1"
        userId="user-1"
        userName="User One"
      />
    );

    await waitFor(() => {
      expect(prosemirrorJSONToYXmlFragment).toHaveBeenCalled();
    });

    expect(prosemirrorJSONToYXmlFragment).toHaveBeenCalledWith({}, converted, fragment);
    expect(updateBlockContent).toHaveBeenCalledWith('doc-2', {
      block_data: JSON.stringify(converted),
      user_id: 'user-1',
    });
  });

  it('shows connected users in the presence bar', async () => {
    mockProvider.awareness.getStates.mockReturnValue(new Map([
      [1, { user: { id: 'user-1', name: 'User One', color: '#111111' } }],
      [2, { user: { id: 'user-2', name: 'User Two', color: '#222222' } }],
    ]));

    render(
      <CollaborativeEditor
        documentId="doc-3"
        tenantId="tenant-1"
        userId="user-1"
        userName="User One"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('User One')).toBeInTheDocument();
      expect(screen.getByText('User Two')).toBeInTheDocument();
    });
  });

  it('configures Yjs collaboration for real-time sync', () => {
    render(
      <CollaborativeEditor
        documentId="doc-4"
        tenantId="tenant-1"
        userId="user-1"
        userName="User One"
      />
    );

    expect(mockCollaboration.configure).toHaveBeenCalledWith(
      expect.objectContaining({ document: mockYdoc })
    );
  });

  it('renders collaboration caret labels for remote users', () => {
    render(
      <CollaborativeEditor
        documentId="doc-5"
        tenantId="tenant-1"
        userId="user-1"
        userName="User One"
      />
    );

    expect(mockCollaborationCaret.configure).toHaveBeenCalled();
    expect(caretRenderRef.current).toBeTypeOf('function');

    const caret = caretRenderRef.current?.({ name: 'User Two', color: '#123456' });
    const label = caret?.querySelector('.collaboration-caret__label');
    expect(label?.textContent).toBe('User Two');
    expect((label as HTMLElement | null)?.style.backgroundColor).toBe('rgb(18, 52, 86)');
  });
});
