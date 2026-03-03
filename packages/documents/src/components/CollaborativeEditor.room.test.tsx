/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render } from '@testing-library/react';
import { CollaborativeEditor } from './CollaborativeEditor';

const mockOn = vi.fn();
const mockOff = vi.fn();
const mockDestroy = vi.fn();
const mockGetStates = vi.fn(() => new Map());

const mockProvider = {
  awareness: {
    getStates: mockGetStates,
    setLocalStateField: vi.fn(),
  },
  on: mockOn,
  off: mockOff,
  destroy: mockDestroy,
  status: 'connected',
  synced: true,
  hasUnsyncedChanges: false,
};

const mockYdoc = {
  getXmlFragment: vi.fn(() => ({ length: 0 })),
  destroy: vi.fn(),
};

const createYjsProvider = vi.fn(() => ({
  provider: mockProvider,
  ydoc: mockYdoc,
}));

vi.mock('@tiptap/react', () => ({
  useEditor: vi.fn(() => null),
  EditorContent: () => null,
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

describe('CollaborativeEditor room name', () => {
  it('connects to document:<tenantId>:<documentId> room', () => {
    render(
      <CollaborativeEditor
        documentId="doc-123"
        tenantId="tenant-abc"
        userId="user-1"
        userName="Test User"
      />
    );

    expect(createYjsProvider).toHaveBeenCalledWith('document:tenant-abc:doc-123', {
      parameters: {
        tenantId: 'tenant-abc',
        userId: 'user-1',
      },
    });
  });
});
