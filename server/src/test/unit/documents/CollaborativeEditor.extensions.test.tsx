// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import * as Y from 'yjs';

(globalThis as unknown as { React?: typeof React }).React = React;

const { collaborationConfigure, collaborationCaretConfigure, providerMock, createYjsProviderMock } = vi.hoisted(() => {
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
  prosemirrorJSONToYXmlFragment: vi.fn(),
}));

vi.mock('@alga-psa/documents/actions/documentBlockContentActions', () => ({
  getBlockContent: vi.fn(async () => null),
}));

let CollaborativeEditor: typeof import('@alga-psa/documents/components/CollaborativeEditor').CollaborativeEditor;

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
});
