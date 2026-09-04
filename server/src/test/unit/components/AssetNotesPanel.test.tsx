/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ContentCardVariantProvider } from '@alga-psa/ui/components';

(globalThis as unknown as { React?: typeof React }).React = React;

const useAssetNotesMock = vi.fn();
const textEditorMock = vi.fn(() => (
  <div data-testid="text-editor" className="editor-paper min-h-[100px] p-4">
    <div className="bn-editor" />
  </div>
));

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

function notesState(overrides: Record<string, unknown> = {}) {
  return {
    noteContent: null,
    noteDocument: null,
    lastUpdated: null,
    isLoading: false,
    error: null,
    saveNote: vi.fn(),
    refresh: vi.fn(),
    isSaving: false,
    ...overrides,
  };
}

function renderBentoPanel() {
  return render(
    <ContentCardVariantProvider variant="bento">
      <AssetNotesPanel assetId="asset-1" />
    </ContentCardVariantProvider>
  );
}

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

    useAssetNotesMock.mockReturnValue(notesState({
      noteContent: blocks,
      noteDocument: { document_id: 'doc-1' },
    }));

    render(<AssetNotesPanel assetId="asset-1" />);

    const lastCall = textEditorMock.mock.calls.at(-1)?.[0] as
      | { initialContent?: unknown }
      | undefined;
    expect(lastCall?.initialContent).toBe(blocks);
  });

  it('renders one compact Notes tile in the bento variant', () => {
    useAssetNotesMock.mockReturnValue(notesState({
      lastUpdated: '2026-08-26T12:00:00.000Z',
    }));

    const { container } = renderBentoPanel();

    expect(screen.getAllByRole('heading', { name: 'Notes' })).toHaveLength(1);
    const shell = container.querySelector('section#asset-bento-notes');
    expect(shell).toHaveClass('p-4');
    expect(screen.getByTestId('text-editor')).toHaveClass('min-h-[100px]', 'p-4');
    expect(screen.getByTestId('text-editor').parentElement).toHaveClass(
      '[&_.editor-paper]:p-0',
      '[&_.bn-editor]:!px-0'
    );
    expect(screen.getByTestId('text-editor').parentElement).not.toHaveClass('min-h-[200px]');
    expect(container.querySelector('.bg-white')).toBeNull();
    expect(screen.getByText(/Last updated:/)).toBeInTheDocument();
  });

  it('keeps the loading state inside the compact bento shell', () => {
    useAssetNotesMock.mockReturnValue(notesState({ isLoading: true }));

    const { container } = renderBentoPanel();

    expect(screen.getByRole('heading', { name: 'Notes' })).toBeInTheDocument();
    expect(container.querySelector('section#asset-bento-notes .animate-pulse')).toHaveClass('min-h-[100px]');
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('shows the error, disables saving, and retries loading', () => {
    const refresh = vi.fn();
    useAssetNotesMock.mockReturnValue(notesState({
      error: new Error('load failed'),
      refresh,
    }));

    renderBentoPanel();

    expect(screen.getByText('Notes failed to load')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('saves local editor changes from the bento action', () => {
    const saveNote = vi.fn();
    const editedBlocks = [{ type: 'paragraph', content: [{ type: 'text', text: 'updated' }] }];
    useAssetNotesMock.mockReturnValue(notesState({ saveNote }));
    renderBentoPanel();

    const editorProps = textEditorMock.mock.calls.at(-1)?.[0] as
      | { onContentChange?: (content: unknown) => void }
      | undefined;
    act(() => editorProps?.onContentChange?.(editedBlocks));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(saveNote).toHaveBeenCalledWith(editedBlocks);
  });

  it('preserves the default Card presentation outside bento layouts', () => {
    useAssetNotesMock.mockReturnValue(notesState());

    const { container } = render(<AssetNotesPanel assetId="asset-1" />);

    expect(screen.getByRole('heading', { name: 'Notes' })).toBeInTheDocument();
    expect(container.querySelector('.bg-white')).toBeInTheDocument();
    expect(container.querySelector('#asset-bento-notes')).toBeNull();
    expect(screen.getByTestId('text-editor').parentElement).toHaveClass('min-h-[200px]');
    expect(screen.getByTestId('text-editor').parentElement).not.toHaveClass(
      '[&_.editor-paper]:p-0',
      '[&_.bn-editor]:!px-0'
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});
