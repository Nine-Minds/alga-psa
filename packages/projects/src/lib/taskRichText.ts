import type { PartialBlock } from '@blocknote/core';

const DEFAULT_BLOCK: PartialBlock[] = [
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
];

/**
 * Parse a task description string into BlockNote blocks.
 * Handles:
 * - null/undefined/empty -> default empty block
 * - JSON array string (BlockNote format) -> parsed blocks
 * - Plain text string -> wrapped in a paragraph block
 */
export function parseTaskRichTextContent(
  content: string | null | undefined,
): PartialBlock[] {
  if (!content) {
    return structuredClone(DEFAULT_BLOCK);
  }

  const trimmed = content.trim();
  if (!trimmed) {
    return structuredClone(DEFAULT_BLOCK);
  }

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as PartialBlock[];
      }
    } catch {
      // Fall through to plain text handling
    }
  }

  // Plain text: wrap in a paragraph block
  return [
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
          text: content,
          styles: {},
        },
      ],
    },
  ];
}

/**
 * Serialize BlockNote blocks to a JSON string for database storage.
 */
export function serializeTaskRichTextContent(content: PartialBlock[]): string {
  return JSON.stringify(content);
}

/**
 * Extract the display text from a single inline content item.
 * Handles text nodes, mentions, links, and other inline types.
 */
function extractInlineText(item: any): string {
  if (!item) return '';
  if (typeof item.text === 'string') return item.text;
  // Mention nodes store display info in props
  if (item.type === 'mention') {
    const name = item.props?.displayName || item.props?.username || '';
    return name ? `@${name}` : '';
  }
  // Link nodes have nested content
  if (item.type === 'link' && Array.isArray(item.content)) {
    return item.content.map(extractInlineText).join('');
  }
  return '';
}

/**
 * Check if a single inline content item has meaningful content.
 */
function hasInlineContent(item: any): boolean {
  if (!item) return false;
  if (typeof item.text === 'string' && item.text.trim() !== '') return true;
  // Non-text inline types (mentions, links, etc.) count as content
  if (item.type && item.type !== 'text') return true;
  return false;
}

/**
 * Extract plain text from a task description for display in cards, lists, and search.
 * Handles both BlockNote JSON and plain text strings.
 */
export function extractTaskDescriptionText(description: string | null | undefined): string {
  if (!description) return '';

  const trimmed = description.trim();
  if (!trimmed) return '';

  if (trimmed.startsWith('[')) {
    try {
      const blocks = JSON.parse(trimmed);
      if (!Array.isArray(blocks)) return description;

      const lines: string[] = [];
      for (const block of blocks) {
        if (block?.content && Array.isArray(block.content)) {
          const line = block.content.map(extractInlineText).join('');
          lines.push(line);
        }
      }
      return lines.join('\n').trim();
    } catch {
      return description;
    }
  }

  return description;
}

/**
 * Check if a BlockNote content array represents empty content (no real text or inline elements).
 */
export function isTaskRichTextEmpty(content: PartialBlock[]): boolean {
  if (!content || content.length === 0) return true;

  for (const block of content) {
    if (!Array.isArray(block.content)) continue;
    for (const item of block.content as any[]) {
      if (hasInlineContent(item)) return false;
    }
  }
  return true;
}
