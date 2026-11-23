/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { CollaborativeEditor } from './CollaborativeEditor';
import { getDocumentRoomToken } from '../actions/collaborativeEditingActions';

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
  setConfiguration: vi.fn(),
  connect: vi.fn(async () => undefined),
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
vi.mock('../actions/collaborativeEditingActions', () => ({ getDocumentRoomToken: vi.fn(async () => ({ token: 'signed-token', expiresAt: Date.now() + 100_000 })) }));

describe('CollaborativeEditor room name', () => {
  beforeEach(() => vi.clearAllMocks());

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
      connect: false,
    });
  });

  it('uses a server-issued credential before connecting to the room', async () => {
    render(
      <CollaborativeEditor
        documentId="doc-123"
        tenantId="tenant-abc"
        userId="user-1"
        userName="Test User"
      />
    );

    await waitFor(() => expect(mockProvider.setConfiguration).toHaveBeenCalled());
    expect(mockProvider.setConfiguration).toHaveBeenCalledWith({ token: 'signed-token' });
    expect(getDocumentRoomToken).toHaveBeenCalledTimes(1);
    expect(mockProvider.connect).toHaveBeenCalledTimes(1);
  });
});
