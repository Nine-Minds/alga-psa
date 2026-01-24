'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import {
  BlockNoteSchema,
  defaultInlineContentSpecs,
  type PartialBlock,
} from '@blocknote/core';
import { Mention } from './Mention';
import styles from './TicketDetails.module.css';
import dynamic from 'next/dynamic';

export interface RichTextViewerProps {
  id?: string;
  content: string | PartialBlock[];
  className?: string;
}

const schema = BlockNoteSchema.create({
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    mention: Mention,
  },
});

function RichTextViewerInternal({
  id = 'rich-text-viewer',
  content,
  className = '',
}: RichTextViewerProps) {
  const parsedContent = (() => {
    let blocks: PartialBlock[] = [];

    if (Array.isArray(content)) {
      blocks = content;
    } else {
      try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed) && parsed.length > 0) {
          blocks = parsed;
        }
      } catch {
        blocks = [
          {
            type: 'paragraph' as const,
            props: {
              textAlignment: 'left' as const,
              backgroundColor: 'default' as const,
              textColor: 'default' as const,
            },
            content: [
              {
                type: 'text' as const,
                text: content,
                styles: {},
              },
            ],
          },
        ];
      }
    }

    if (blocks.length === 0) {
      return [
        {
          type: 'paragraph' as const,
          props: {
            textAlignment: 'left' as const,
            backgroundColor: 'default' as const,
            textColor: 'default' as const,
          },
          content: [
            {
              type: 'text' as const,
              text: '',
              styles: {},
            },
          ],
        },
      ];
    }

    const isTextContent = (
      item: unknown
    ): item is { type: 'text'; text: string; styles: Record<string, unknown> } => {
      return typeof item === 'object' && item !== null && (item as any).type === 'text';
    };

    let i = blocks.length - 1;
    while (i >= 0) {
      const block = blocks[i];
      if (block.type !== 'paragraph') break;

      const hasContent = (candidate: PartialBlock): boolean => {
        if (!candidate.content) return false;
        if (!Array.isArray(candidate.content)) return false;
        return candidate.content.some((item) => {
          if (isTextContent(item)) {
            return item.text.trim() !== '';
          }
          return true;
        });
      };

      if (hasContent(block)) break;
      i--;
    }

    return i >= 0
      ? blocks.slice(0, i + 1)
      : [
          {
            type: 'paragraph' as const,
            props: {
              textAlignment: 'left' as const,
              backgroundColor: 'default' as const,
              textColor: 'default' as const,
            },
            content: [
              {
                type: 'text' as const,
                text: '',
                styles: {},
              },
            ],
          },
        ];
  })();

  const contentKey = useMemo(() => {
    try {
      return JSON.stringify(parsedContent);
    } catch {
      return String(Date.now());
    }
  }, [parsedContent]);

  const isFirstRender = useRef(true);
  const prevContentKey = useRef(contentKey);
  const shouldRemount = !isFirstRender.current && prevContentKey.current !== contentKey;

  useEffect(() => {
    isFirstRender.current = false;
    prevContentKey.current = contentKey;
  }, [contentKey]);

  const editor = useCreateBlockNote({
    schema,
    initialContent: parsedContent,
    domAttributes: {
      editor: {
        class: 'pointer-events-none',
      },
    },
  });

  useEffect(() => {
    if (editor && parsedContent) {
      editor.replaceBlocks(editor.document, parsedContent);
    }
  }, [editor, contentKey, parsedContent]);

  return (
    <div className={`w-full min-w-0 ${className} ${styles.forceTextBreak}`}>
      <div className="w-full bg-white rounded-lg overflow-auto min-w-0">
        <BlockNoteView
          key={shouldRemount ? contentKey : 'stable'}
          editor={editor}
          theme="light"
          className="w-full min-w-0"
          style={{
            overflowWrap: 'break-word',
            wordBreak: 'break-word',
            minWidth: 0,
            maxWidth: '100%',
          }}
        />
      </div>
    </div>
  );
}

const RichTextViewer = dynamic(() => Promise.resolve(RichTextViewerInternal), {
  ssr: false,
  loading: () => <div>Loading...</div>,
});

export default RichTextViewer;
