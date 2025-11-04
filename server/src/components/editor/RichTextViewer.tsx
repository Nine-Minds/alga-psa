'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import {
  PartialBlock,
  BlockNoteSchema,
  defaultInlineContentSpecs,
} from '@blocknote/core';
import { Mention } from './Mention';
import styles from '../tickets/ticket/TicketDetails.module.css';

// Create custom schema with mention support (same as TextEditor)
const schema = BlockNoteSchema.create({
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    mention: Mention,
  },
});

interface RichTextViewerProps {
  id?: string;
  content: string | PartialBlock[];
  className?: string;
}

/**
 * RichTextViewer component for displaying BlockNote content with formatting
 * This component renders BlockNote content in read-only mode, preserving all formatting
 */
export default function RichTextViewer({ 
  id = 'rich-text-viewer',
  content,
  className = '',
}: RichTextViewerProps) {
  // Parse content and remove empty trailing blocks
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
        // If string can't be parsed as JSON, create a text block with it
        blocks = [{
          type: "paragraph" as const,
          props: {
            textAlignment: "left" as const,
            backgroundColor: "default" as const,
            textColor: "default" as const
          },
          content: [{
            type: "text" as const,
            text: content,
            styles: {}
          }]
        }];
      }
    }

    // If we still have no blocks, return a single empty paragraph
    if (blocks.length === 0) {
      return [{
        type: "paragraph" as const,
        props: {
          textAlignment: "left" as const,
          backgroundColor: "default" as const,
          textColor: "default" as const
        },
        content: [{
          type: "text" as const,
          text: "",
          styles: {}
        }]
      }];
    }

    // Type guard for text content
    const isTextContent = (content: any): content is { type: "text"; text: string; styles: {} } => {
      return content?.type === "text";
    };

    // Remove empty trailing blocks, but only if they're paragraph blocks
    // This preserves tables and other non-paragraph blocks even if they're at the end
    let i = blocks.length - 1;
    while (i >= 0) {
      const block = blocks[i];
      
      // Always keep non-paragraph blocks (tables, images, etc.)
      if (block.type !== "paragraph") break;
      
      const hasContent = (block: PartialBlock): boolean => {
        if (!block.content) return false;
        if (Array.isArray(block.content)) {
          return block.content.some(item => {
            if (isTextContent(item)) {
              return item.text.trim() !== "";
            }
            return true; // Keep non-text content
          });
        }
        return false;
      };
      
      if (hasContent(block)) break;
      i--;
    }

    // Return all blocks up to and including the last non-empty block
    // If all blocks are empty (i = -1), return at least one empty paragraph
    const finalBlocks = i >= 0 ? blocks.slice(0, i + 1) : [{
      type: "paragraph" as const,
      props: {
        textAlignment: "left" as const,
        backgroundColor: "default" as const,
        textColor: "default" as const
      },
      content: [{
        type: "text" as const,
        text: "",
        styles: {}
      }]
    }];
    
    return finalBlocks;
  })();

  // Track content changes to determine if we need to remount
  const contentKey = useMemo(() => {
    try {
      return JSON.stringify(parsedContent);
    } catch {
      return String(Date.now());
    }
  }, [parsedContent]);

  // Use a ref to track if this is the first render
  const isFirstRender = useRef(true);
  const prevContentKey = useRef(contentKey);

  // Only remount if content ACTUALLY changed (not on first render)
  const shouldRemount = !isFirstRender.current && prevContentKey.current !== contentKey;

  useEffect(() => {
    isFirstRender.current = false;
    prevContentKey.current = contentKey;
  }, [contentKey]);

  // Create the editor at the top level with the parsed content and custom schema
  const editor = useCreateBlockNote({
    schema,
    initialContent: parsedContent,
    domAttributes: {
      editor: {
        class: 'pointer-events-none', // Disable interactions with the editor
      },
    },
  });

  // Update the editor content when parsedContent changes
  useEffect(() => {
    if (editor && parsedContent) {
      // Replace the editor's content with the new blocks
      editor.replaceBlocks(editor.document, parsedContent);
    }
  }, [contentKey, editor, parsedContent]);

  if (process.env.NODE_ENV !== 'production') {
    console.log('[RichTextViewer] Render', {
      shouldRemount,
      contentKeyLength: contentKey.length,
      blocks: parsedContent.length
    });
  }

  // Check if we're in the browser environment
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return <div>Loading...</div>;
  }

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
            maxWidth: '100%'
          }}
        />
      </div>
    </div>
  );
}
