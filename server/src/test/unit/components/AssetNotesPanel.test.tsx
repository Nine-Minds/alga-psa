/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';

(globalThis as unknown as { React?: typeof React }).React = React;

const useAssetNotesMock = vi.fn();
const textEditorMock = vi.fn(() => null);

vi.mock('@alga-psa/assets/hooks/useAssetNotes', () => ({
  useAssetNotes: (...args: unknown[]) => useAssetNotesMock(...args),
}));

vi.mock('@alga-psa/ui/editor', () => ({
  TextEditor: (props: unknown) => textEditorMock(props),
  DEFAULT_BLOCK: [
    {
      type: 'paragraph',
      props: {
        textAlignment: 'left',
        backgroundColor: 'default',
        textColor: 'default',
      },
      content: [
        {
          type: 'text',
          text: '',
          styles: {},
        },
      ],
    },
  ],
}));

const { AssetNotesPanel } = await import('@alga-psa/assets/components/panels/AssetNotesPanel');

describe('AssetNotesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes fetched note content as the editor initialContent', () => {
    const blocks = [
      {
        type: 'paragraph',
        props: {
          textAlignment: 'left',
          backgroundColor: 'default',
          textColor: 'default',
        },
        content: [
          {
            type: 'text',
            text: 'hello',
            styles: {},
          },
        ],
      },
    ];

    useAssetNotesMock.mockReturnValue({
      noteContent: blocks,
      noteDocument: { document_id: 'doc-1' },
      lastUpdated: null,
      isLoading: false,
      error: null,
      saveNote: vi.fn(),
      refresh: vi.fn(),
      isSaving: false,
    });

    render(<AssetNotesPanel assetId="asset-1" />);

    const lastCall = textEditorMock.mock.calls.at(-1)?.[0] as
      | { initialContent?: unknown }
      | undefined;
    expect(lastCall?.initialContent).toBe(blocks);
  });
});
