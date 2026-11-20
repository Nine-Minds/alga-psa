/** @vitest-environment jsdom */
import React, { createRef } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BlockNoteEditor } from '@blocknote/core';
import { expect, it, vi } from 'vitest';
import TextEditor from '@alga-psa/ui/editor/TextEditor';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));

it('can paste another image after reopening an image-only comment', async () => {
  const saved = '/api/documents/view/saved';
  const pasted = '/api/documents/view/pasted';
  const editorRef = createRef<BlockNoteEditor>();
  render(
    <TextEditor
      editorRef={editorRef}
      initialContent={[{ type: 'image', props: { url: saved } }]}
      uploadFile={async () => pasted}
    />,
  );

  const editor = editorRef.current!;
  const caret = editor.document.at(-1)!;
  expect(caret.type).toBe('paragraph');
  editor.setTextCursorPosition(caret);
  const image = new File(['pixels'], 'screenshot.png', { type: 'image/png' });
  fireEvent.paste(screen.getByRole('textbox'), {
    clipboardData: {
      types: ['Files'],
      getData: () => '',
      items: [{ type: image.type, kind: 'file', getAsFile: () => image }],
    },
  });
  await waitFor(() => expect(editor.document.filter(b => b.type === 'image').map(b => b.props.url))
    .toEqual([saved, pasted]));
});
