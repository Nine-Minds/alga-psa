/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// BlockNote needs a real editing surface; the footer row under it does not.
vi.mock('@blocknote/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCreateBlockNote: () => ({
    document: [],
    onChange: () => () => undefined,
    _tiptapEditor: { view: null },
  }),
  SuggestionMenuController: () => null,
  GridSuggestionMenuController: () => null,
}));
vi.mock('@blocknote/mantine', () => ({
  BlockNoteView: () => <div data-testid="blocknote-view" />,
}));
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'light' }) }));
vi.mock('../lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : _key),
  }),
}));

import TextEditor from './TextEditor';

afterEach(() => {
  cleanup();
});

const footerRowOf = (node: HTMLElement | null) => node?.parentElement ?? null;

describe('TextEditor footer actions slot', () => {
  it('T050: the slot renders in the attachments footer, next to Attach files', () => {
    render(
      <TextEditor
        id="editor"
        allowFileAttachments
        uploadFile={async () => 'doc-1'}
        footerActions={<button type="button">Cc/Bcc</button>}
      />
    );

    const attach = document.getElementById('editor-attach-files');
    expect(attach).toBeTruthy();
    const slot = screen.getByRole('button', { name: 'Cc/Bcc' });
    // Same row as the attach button, so the two controls read as one footer.
    expect(footerRowOf(slot)).toBe(footerRowOf(attach as HTMLElement));
  });

  it('T050: without attachments the slot still has a row, and omitting it leaves the layout unchanged', () => {
    const { unmount } = render(
      <TextEditor id="editor" footerActions={<button type="button">Cc/Bcc</button>} />
    );
    expect(document.getElementById('editor-attach-files')).toBeNull();
    expect(screen.getByRole('button', { name: 'Cc/Bcc' })).toBeTruthy();
    unmount();

    render(<TextEditor id="editor" />);
    expect(screen.queryByRole('button', { name: 'Cc/Bcc' })).toBeNull();
    expect(document.getElementById('editor-attach-files')).toBeNull();
  });
});
