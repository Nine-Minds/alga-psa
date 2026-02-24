// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

(globalThis as unknown as { React?: typeof React }).React = React;

const {
  collaborationConfigure,
  collaborationCaretConfigure,
  providerMock,
  createYjsProviderMock,
  getBlockContentMock,
  prosemirrorJSONToYXmlFragmentMock,
} = vi.hoisted(() => {
  const awarenessMock = {
    setLocalStateField: vi.fn(),
    getStates: vi.fn(() => new Map()),
  };

  return {
    collaborationConfigure: vi.fn(() => ({ name: 'collaboration-extension' })),
    collaborationCaretConfigure: vi.fn(() => ({ name: 'collaboration-caret-extension' })),
    providerMock: {
      awareness: awarenessMock,
      on: vi.fn(),
      off: vi.fn(),
      destroy: vi.fn(),
      status: 'connected',
      synced: true,
      hasUnsyncedChanges: false,
    },
    createYjsProviderMock: vi.fn(),
    getBlockContentMock: vi.fn(async () => null),
    prosemirrorJSONToYXmlFragmentMock: vi.fn(),
  };
});

let ydoc: Y.Doc;
let providerListeners: Map<string, Set<(payload: any) => void>>;
let awarenessStates: Map<number, { user?: { id: string; name: string; color: string } }>;

vi.mock('@tiptap/extension-collaboration', () => ({
  default: {
    configure: (...args: unknown[]) => collaborationConfigure(...args),
  },
}));

vi.mock('@tiptap/extension-collaboration-caret', () => ({
  default: {
    configure: (...args: unknown[]) => collaborationCaretConfigure(...args),
  },
}));

vi.mock('@alga-psa/ui/editor', () => ({
  Emoticon: { name: 'emoticon-extension' },
  createYjsProvider: (...args: unknown[]) => createYjsProviderMock(...args),
}));

vi.mock('y-prosemirror', () => ({
  prosemirrorJSONToYXmlFragment: (...args: unknown[]) => prosemirrorJSONToYXmlFragmentMock(...args),
}));

vi.mock('@alga-psa/documents/actions/documentBlockContentActions', () => ({
  getBlockContent: (...args: unknown[]) => getBlockContentMock(...args),
}));

let CollaborativeEditor: typeof import('@alga-psa/documents/components/CollaborativeEditor').CollaborativeEditor;
const emitProviderEvent = (event: string, payload?: any) => {
  const listeners = providerListeners.get(event);
  if (!listeners) return;
  listeners.forEach((callback) => callback(payload));
};

describe('CollaborativeEditor', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    ydoc = new Y.Doc();
    providerListeners = new Map();
    awarenessStates = new Map();
    providerMock.status = 'connected';
    providerMock.synced = true;
    providerMock.hasUnsyncedChanges = false;
    providerMock.awareness.getStates.mockImplementation(() => awarenessStates);
    providerMock.on.mockImplementation((event: string, callback: (payload: any) => void) => {
      const existing = providerListeners.get(event) ?? new Set();
      existing.add(callback);
      providerListeners.set(event, existing);
    });
    providerMock.off.mockImplementation((event: string, callback: (payload: any) => void) => {
      const existing = providerListeners.get(event);
      if (!existing) return;
      existing.delete(callback);
    });
    createYjsProviderMock.mockImplementation(() => ({ provider: providerMock, ydoc }));
    ({ CollaborativeEditor } = await import('@alga-psa/documents/components/CollaborativeEditor'));
  });

  afterEach(() => {
    cleanup();
  });

  it('initializes TipTap with collaboration extensions', () => {
    render(
      <CollaborativeEditor
        documentId="doc-1"
        tenantId="tenant-1"
        userId="user-1"
        userName="Editor One"
      />
    );

    expect(collaborationConfigure).toHaveBeenCalledWith({ document: ydoc });
    expect(collaborationCaretConfigure).toHaveBeenCalledWith({
      provider: providerMock,
      user: expect.objectContaining({
        id: 'user-1',
        name: 'Editor One',
        color: expect.any(String),
      }),
    });
  });

  it('constructs the collab room name as document:<tenant>:<documentId>', () => {
    render(
      <CollaborativeEditor
        documentId="doc-88"
        tenantId="tenant-99"
        userId="user-88"
        userName="Editor Eight"
      />
    );

    expect(createYjsProviderMock).toHaveBeenCalledWith('document:tenant-99:doc-88', {
      parameters: {
        tenantId: 'tenant-99',
        userId: 'user-88',
      },
    });
  });

  it('uses distinct room names for the same document across tenants', () => {
    render(
      <CollaborativeEditor
        documentId="doc-88"
        tenantId="tenant-a"
        userId="user-a"
        userName="Editor A"
      />
    );

    render(
      <CollaborativeEditor
        documentId="doc-88"
        tenantId="tenant-b"
        userId="user-b"
        userName="Editor B"
      />
    );

    const roomNames = createYjsProviderMock.mock.calls.map((call) => call[0]);
    expect(roomNames).toContain('document:tenant-a:doc-88');
    expect(roomNames).toContain('document:tenant-b:doc-88');
  });

  it('renders a connected status when the provider is connected', () => {
    const { getByText, container } = render(
      <CollaborativeEditor
        documentId="doc-2"
        tenantId="tenant-2"
        userId="user-2"
        userName="Editor Two"
      />
    );

    expect(getByText('Connected')).toBeTruthy();
    const statusWrapper = container.querySelector('[data-status]');
    expect(statusWrapper).toBeTruthy();
    expect(statusWrapper.getAttribute('data-status')).toBe('connected');
  });

  it('sets awareness user state for collaboration cursors', async () => {
    await act(async () => {
      render(
        <CollaborativeEditor
          documentId="doc-3"
          tenantId="tenant-3"
          userId="user-3"
          userName="Editor Three"
        />
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(providerMock.awareness.setLocalStateField).toHaveBeenCalledWith(
      'user',
      expect.objectContaining({
        id: 'user-3',
        name: 'Editor Three',
        color: expect.any(String),
      })
    );
  });

  it('assigns deterministic cursor colors per user', async () => {
    await act(async () => {
      render(
        <CollaborativeEditor
          documentId="doc-4"
          tenantId="tenant-4"
          userId="user-4"
          userName="Editor Four"
        />
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const firstCall = providerMock.awareness.setLocalStateField.mock.calls[0]?.[1];
    cleanup();

    await act(async () => {
      render(
        <CollaborativeEditor
          documentId="doc-4"
          tenantId="tenant-4"
          userId="user-4"
          userName="Editor Four"
        />
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const secondCall = providerMock.awareness.setLocalStateField.mock.calls.at(-1)?.[1];
    expect(firstCall?.color).toBe(secondCall?.color);
  });

  it('shows connected users in the presence bar', async () => {
    awarenessStates.set(1, { user: { id: 'user-a', name: 'User A', color: '#111111' } });
    awarenessStates.set(2, { user: { id: 'user-b', name: 'User B', color: '#222222' } });

    const { getByText } = render(
      <CollaborativeEditor
        documentId="doc-5"
        tenantId="tenant-5"
        userId="user-5"
        userName="Editor Five"
      />
    );

    await act(async () => {
      emitProviderEvent('awarenessChange');
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(getByText('User A')).toBeTruthy();
    expect(getByText('User B')).toBeTruthy();
  });

  it('updates presence bar when a user disconnects', async () => {
    awarenessStates.set(1, { user: { id: 'user-a', name: 'User A', color: '#111111' } });
    awarenessStates.set(2, { user: { id: 'user-b', name: 'User B', color: '#222222' } });

    const { queryByText } = render(
      <CollaborativeEditor
        documentId="doc-6"
        tenantId="tenant-6"
        userId="user-6"
        userName="Editor Six"
      />
    );

    await act(async () => {
      emitProviderEvent('awarenessChange');
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(queryByText('User A')).toBeTruthy();
    expect(queryByText('User B')).toBeTruthy();

    awarenessStates.delete(2);

    await act(async () => {
      emitProviderEvent('awarenessChange');
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(queryByText('User B')).toBeNull();
  });

  it('renders a disconnected status when the provider disconnects', () => {
    providerMock.status = 'disconnected';

    const { getByText, container } = render(
      <CollaborativeEditor
        documentId="doc-7"
        tenantId="tenant-7"
        userId="user-7"
        userName="Editor Seven"
      />
    );

    expect(getByText('Disconnected')).toBeTruthy();
    const statusWrapper = container.querySelector('[data-status]');
    expect(statusWrapper?.getAttribute('data-status')).toBe('disconnected');
  });

  it('shows all changes saved when there are no unsynced changes', () => {
    providerMock.hasUnsyncedChanges = false;

    const { getByText } = render(
      <CollaborativeEditor
        documentId="doc-8"
        tenantId="tenant-8"
        userId="user-8"
        userName="Editor Eight"
      />
    );

    expect(getByText('All changes saved')).toBeTruthy();
  });

  it('does not render a manual save button', () => {
    const { queryByRole } = render(
      <CollaborativeEditor
        documentId="doc-9"
        tenantId="tenant-9"
        userId="user-9"
        userName="Editor Nine"
      />
    );

    expect(queryByRole('button', { name: /save/i })).toBeNull();
  });

  it('initializes the Y.js document from existing block content when empty', async () => {
    providerMock.synced = false;
    const fragmentMock = { length: 0, delete: vi.fn() } as unknown as Y.XmlFragment;
    const getXmlFragmentSpy = vi.spyOn(ydoc, 'getXmlFragment').mockReturnValue(fragmentMock);
    getBlockContentMock.mockResolvedValue({
      block_data: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] }),
    });

    await act(async () => {
      render(
        <CollaborativeEditor
          documentId="doc-10"
          tenantId="tenant-10"
          userId="user-10"
          userName="Editor Ten"
        />
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(providerMock.on).toHaveBeenCalledWith('synced', expect.any(Function));
    });

    act(() => {
      emitProviderEvent('synced', { state: true });
    });

    await waitFor(() => {
      expect(prosemirrorJSONToYXmlFragmentMock).toHaveBeenCalled();
    });

    getXmlFragmentSpy.mockRestore();
  });

  it('does not reinitialize Y.js content when the fragment already has data', async () => {
    const fragmentMock = { length: 1, delete: vi.fn() } as unknown as Y.XmlFragment;
    const getXmlFragmentSpy = vi.spyOn(ydoc, 'getXmlFragment').mockReturnValue(fragmentMock);
    getBlockContentMock.mockResolvedValue({
      block_data: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] }),
    });

    render(
      <CollaborativeEditor
        documentId="doc-11"
        tenantId="tenant-11"
        userId="user-11"
        userName="Editor Eleven"
      />
    );

    await waitFor(() => {
      expect(getXmlFragmentSpy).toHaveBeenCalledWith('prosemirror');
    });

    expect(getBlockContentMock).not.toHaveBeenCalled();
    expect(prosemirrorJSONToYXmlFragmentMock).not.toHaveBeenCalled();

    getXmlFragmentSpy.mockRestore();
  });
});
