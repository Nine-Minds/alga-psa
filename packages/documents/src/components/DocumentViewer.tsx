'use client';

import { useEffect, useMemo } from 'react';
import { EditorContent, useEditor, type JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import {
  blockNoteJsonToProsemirrorJson,
  detectBlockContentFormat,
  parseBlockContent,
} from '../lib/blockContentFormat';

interface DocumentViewerProps {
  content: unknown;
}

const getProseMirrorContent = (content: unknown): JSONContent => {
  const format = detectBlockContentFormat(content);
  if (format === 'blocknote') {
    return blockNoteJsonToProsemirrorJson(content) as JSONContent;
  }
  if (format === 'prosemirror') {
    return parseBlockContent(content) as JSONContent;
  }
  return { type: 'doc', content: [{ type: 'paragraph' }] };
};

export function DocumentViewer({ content }: DocumentViewerProps) {
  const resolvedContent = useMemo(() => getProseMirrorContent(content), [content]);

  const editor = useEditor({
    immediatelyRender: false,
    editable: false,
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: true,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: {
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      }),
      Underline,
    ],
    content: resolvedContent,
    editorProps: {
      attributes: {
        class: 'prose prose-sm sm:prose lg:prose-lg xl:prose-2xl mx-auto',
      },
    },
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.commands.setContent(resolvedContent);
  }, [editor, resolvedContent]);

  if (!editor || editor.isDestroyed) {
    return <div className="flex justify-center items-center h-64">Loading...</div>;
  }

  return <EditorContent editor={editor} />;
}
