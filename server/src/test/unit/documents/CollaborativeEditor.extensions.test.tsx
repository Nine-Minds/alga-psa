// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
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
});
