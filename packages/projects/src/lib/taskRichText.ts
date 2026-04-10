import type { PartialBlock } from '@blocknote/core';
import { convertBlockNoteToMarkdown } from '@alga-psa/formatting/blocknoteUtils';

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
 * Signature for a BlockNote-serialized description: a JSON array whose first
 * element is an object. Plain text starting with `[` (e.g. `[URGENT] Fix bug`)
 * won't match because the character after `[` isn't `{`, so we avoid a wasted
 * JSON.parse attempt on those descriptions.
 */
const BLOCK_NOTE_JSON_SIGNATURE = /^\s*\[\s*\{/;

/**
 * BlockNote block types whose emptiness is determined by their inline content.
 * Any block type NOT in this set (image, table, video, audio, file, codeBlock,
 * embed, etc.) is inherently non-empty — even when it has no `content` array.
 */
const TEXT_CONTAINER_BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'bulletListItem',
  'numberedListItem',
  'checkListItem',
  'quote',
]);

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

  if (BLOCK_NOTE_JSON_SIGNATURE.test(trimmed)) {
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
 * Serialize BlockNote blocks into both storage formats:
 *   - description: markdown string (for search/display/portability)
 *   - description_rich_text: BlockNote JSON string (for editor round-tripping)
 *
 * Returns null values when the content is empty.
 */
export function serializeTaskDescriptions(
  content: PartialBlock[],
): { description: string | null; description_rich_text: string | null } {
  if (isTaskRichTextEmpty(content)) {
    return { description: null, description_rich_text: null };
  }
  return {
    description: convertBlockNoteToMarkdown(content),
    description_rich_text: serializeTaskRichTextContent(content),
  };
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

  if (BLOCK_NOTE_JSON_SIGNATURE.test(trimmed)) {
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
 * Check if a BlockNote content array represents empty content (no real text,
 * inline elements, or non-text blocks like images/tables/embeds).
 */
export function isTaskRichTextEmpty(content: PartialBlock[]): boolean {
  if (!content || content.length === 0) return true;

  for (const block of content) {
    const blockType = (block as any).type;

    // Non-text block types (image, table, video, audio, file, codeBlock, etc.)
    // are inherently non-empty even without an inline content array.
    if (blockType && !TEXT_CONTAINER_BLOCK_TYPES.has(blockType)) {
      return false;
    }

    if (Array.isArray(block.content)) {
      for (const item of block.content as any[]) {
        if (hasInlineContent(item)) return false;
      }
    }
  }
  return true;
}
