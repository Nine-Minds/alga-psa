/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react';
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

vi.mock('../actions/documentBlockContentActions', () => ({
  getBlockContent: vi.fn(),
  updateBlockContent: vi.fn(),
}));

describe('CollaborativeEditor initialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasCreated = false;
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
});
