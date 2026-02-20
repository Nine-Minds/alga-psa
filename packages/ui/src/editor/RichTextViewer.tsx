'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
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

const DEFAULT_EMPTY_BLOCK: PartialBlock[] = [
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

const MARKDOWN_PATTERN = /^#{1,6}\s|^\*\s|^-\s|^\d+\.\s|\*\*[^*]+\*\*|\[.+\]\(.+\)|^```/m;
const URL_REGEX = /(?:https?:\/\/|www\.)[^\s<>)"'\]]+/g;

/**
 * Check if parsed blocks contain plain text with markdown syntax.
 * This handles the case where content was stored as BlockNote JSON but the
 * text within the blocks was never converted from markdown.
 */
function blocksContainRawMarkdown(blocks: PartialBlock[]): string | null {
  // If there are already non-paragraph block types (headings, lists, etc.)
  // then the content is already structured — no need to re-parse
  if (blocks.some((b) => b.type && b.type !== 'paragraph')) return null;

  const lines: string[] = [];
  for (const block of blocks) {
    if (!Array.isArray(block.content) || block.content.length === 0) {
      lines.push('');
      continue;
    }

    const items = block.content as any[];
    // If any item is not plain text (e.g. link, mention, styled text),
    // this content is already formatted
    if (items.some((item) => item.type !== 'text')) return null;
    const hasAppliedStyles = items.some((item) => {
      if (!item.styles) return false;
      return Object.values(item.styles).some((v) => v === true || (typeof v === 'string' && v !== ''));
    });
    if (hasAppliedStyles) return null;

    lines.push(items.map((item) => item.text || '').join(''));
  }

  // Smart join: single \n between consecutive list items (flat list),
  // double \n\n between other blocks (paragraph separation)
  const isListLine = (line: string) => /^[-*+]\s|^\d+\.\s/.test(line.trim());
  const parts: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    parts.push(lines[i]);
    if (i < lines.length - 1) {
      parts.push(isListLine(lines[i]) && isListLine(lines[i + 1]) ? '\n' : '\n\n');
    }
  }
  const fullText = parts.join('');
  return MARKDOWN_PATTERN.test(fullText) ? fullText : null;
}

/**
 * Walk through block content and convert plain-text URLs to link inline content.
 */
function autolinkBlocks(blocks: PartialBlock[]): PartialBlock[] {
  return blocks.map((block) => {
    if (!block.content || !Array.isArray(block.content)) return block;

    const newContent: any[] = [];
    let changed = false;

    for (const item of block.content as any[]) {
      // Only process text items (skip links, mentions, etc.)
      if (item.type !== 'text' || !item.text) {
        newContent.push(item);
        continue;
      }

      const text = item.text as string;
      const segments = splitTextByUrls(text, item.styles || {});

      if (segments.length === 1 && segments[0].type === 'text') {
        newContent.push(item);
      } else {
        newContent.push(...segments);
        changed = true;
      }
    }

    const processedBlock = changed ? { ...block, content: newContent } as PartialBlock : block;

    // Recurse into children
    if (processedBlock.children && Array.isArray(processedBlock.children) && processedBlock.children.length > 0) {
      return { ...processedBlock, children: autolinkBlocks(processedBlock.children as PartialBlock[]) } as PartialBlock;
    }

    return processedBlock;
  });
}

function splitTextByUrls(text: string, itemStyles: Record<string, unknown>): any[] {
  const segments: any[] = [];
  let lastIndex = 0;

  URL_REGEX.lastIndex = 0;
  let match;
  while ((match = URL_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        type: 'text',
        text: text.slice(lastIndex, match.index),
        styles: itemStyles,
      });
    }

    const url = match[0];
    const href = url.startsWith('www.') ? `https://${url}` : url;
    segments.push({
      type: 'link',
      href,
      content: [{ type: 'text', text: url, styles: itemStyles }],
    });

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({
      type: 'text',
      text: text.slice(lastIndex),
      styles: itemStyles,
    });
  }

  return segments.length > 0 ? segments : [{ type: 'text', text, styles: itemStyles }];
}

/**
 * Trim trailing empty paragraph blocks.
 */
function trimTrailingEmpty(blocks: PartialBlock[]): PartialBlock[] {
  if (blocks.length === 0) return DEFAULT_EMPTY_BLOCK;

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

  return i >= 0 ? blocks.slice(0, i + 1) : DEFAULT_EMPTY_BLOCK;
}

function RichTextViewerInternal({
  id = 'rich-text-viewer',
  content,
  className = '',
}: RichTextViewerProps) {
  const { resolvedTheme } = useTheme();
  const blockNoteTheme = resolvedTheme === 'dark' ? 'dark' : 'light';
  const [markdownBlocks, setMarkdownBlocks] = useState<PartialBlock[] | null>(null);

  // Synchronous parse: JSON blocks or detect raw markdown string
  const { syncBlocks, rawMarkdown } = useMemo(() => {
    if (Array.isArray(content)) {
      // Check if the blocks themselves contain raw markdown text
      const mdText = blocksContainRawMarkdown(content);
      if (mdText) {
        return { syncBlocks: DEFAULT_EMPTY_BLOCK, rawMarkdown: mdText };
      }
      return { syncBlocks: autolinkBlocks(trimTrailingEmpty(content)), rawMarkdown: null };
    }

    // Try JSON parse
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Check if parsed blocks contain raw markdown text
        const mdText = blocksContainRawMarkdown(parsed);
        if (mdText) {
          return { syncBlocks: DEFAULT_EMPTY_BLOCK, rawMarkdown: mdText };
        }
        return { syncBlocks: autolinkBlocks(trimTrailingEmpty(parsed)), rawMarkdown: null };
      }
    } catch {
      // Not JSON
    }

    // Check if raw string content looks like markdown or contains URLs
    if (content && (MARKDOWN_PATTERN.test(content) || URL_REGEX.test(content))) {
      return { syncBlocks: DEFAULT_EMPTY_BLOCK, rawMarkdown: content };
    }

    // Plain text fallback — still autolink URLs
    const plainBlock: PartialBlock[] = [
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
    return { syncBlocks: autolinkBlocks(plainBlock), rawMarkdown: null };
  }, [content]);

  // The blocks to display: markdown-parsed blocks take priority over sync blocks
  const displayBlocks = rawMarkdown ? (markdownBlocks || syncBlocks) : syncBlocks;

  const contentKey = useMemo(() => {
    try {
      return JSON.stringify(displayBlocks);
    } catch {
      return String(Date.now());
    }
  }, [displayBlocks]);

  const isFirstRender = useRef(true);
  const prevContentKey = useRef(contentKey);
  const shouldRemount = !isFirstRender.current && prevContentKey.current !== contentKey;

  useEffect(() => {
    isFirstRender.current = false;
    prevContentKey.current = contentKey;
  }, [contentKey]);

  const editor = useCreateBlockNote({
    schema,
    initialContent: displayBlocks,
  });

  // Async markdown-to-blocks conversion
  useEffect(() => {
    if (!rawMarkdown || !editor) return;

    let cancelled = false;
    (async () => {
      try {
        const blocks = await editor.tryParseMarkdownToBlocks(rawMarkdown);
        if (!cancelled && blocks && blocks.length > 0) {
          setMarkdownBlocks(autolinkBlocks(trimTrailingEmpty(blocks as PartialBlock[])));
        }
      } catch (e) {
        // Markdown parse failed — fall back to plain text with autolink
        if (!cancelled) {
          const fallback: PartialBlock[] = [
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
                  text: rawMarkdown,
                  styles: {},
                },
              ],
            },
          ];
          setMarkdownBlocks(autolinkBlocks(fallback));
        }
      }
    })();

    return () => { cancelled = true; };
  }, [rawMarkdown, editor]);

  // Update editor when display blocks change
  useEffect(() => {
    if (editor && displayBlocks) {
      editor.replaceBlocks(
        editor.document.map((b) => b.id),
        displayBlocks as any
      );
    }
  }, [editor, contentKey, displayBlocks]);

  return (
    <div className={`w-full min-w-0 ${className} ${styles.forceTextBreak}`}>
      <div className="w-full rounded-lg overflow-auto min-w-0">
        <BlockNoteView
          key={shouldRemount ? contentKey : 'stable'}
          editor={editor}
          editable={false}
          theme={blockNoteTheme}
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
