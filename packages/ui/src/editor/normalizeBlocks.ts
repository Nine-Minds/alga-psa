import type { PartialBlock } from '@blocknote/core';

// ProseMirror text nodes are not meant to carry raw newlines — BlockNote
// authors line breaks as separate blocks. Content with embedded "\n" inside a
// text item (multi-line paste, programmatic inserts) renders unreliably, so we
// split such blocks into one block per line, both on save and on display.

const SPLITTABLE_BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'bulletListItem',
  'numberedListItem',
  'checkListItem',
  'quote',
]);

type InlineItem = { type?: string; text?: string; [key: string]: unknown };

function blockNeedsSplit(block: PartialBlock): boolean {
  if (typeof block.type !== 'string' || !SPLITTABLE_BLOCK_TYPES.has(block.type)) return false;
  if (!Array.isArray(block.content)) return false;
  return (block.content as InlineItem[]).some(
    (item) => item?.type === 'text' && typeof item.text === 'string' && item.text.includes('\n')
  );
}

function splitBlock(block: PartialBlock): PartialBlock[] {
  const segments: InlineItem[][] = [[]];

  for (const item of block.content as InlineItem[]) {
    if (item?.type === 'text' && typeof item.text === 'string' && item.text.includes('\n')) {
      const parts = item.text.split('\n');
      parts.forEach((part, index) => {
        if (index > 0) segments.push([]);
        if (part !== '') segments[segments.length - 1].push({ ...item, text: part });
      });
    } else {
      segments[segments.length - 1].push(item);
    }
  }

  return segments.map((content) => ({
    ...block,
    id: undefined,
    content: content.length > 0 ? content : [{ type: 'text', text: '', styles: {} }],
  })) as PartialBlock[];
}

/**
 * Replace any block whose text items contain raw "\n" characters with one
 * block per line (same type and props). Blocks without embedded newlines are
 * returned untouched, and the input array is returned as-is when nothing
 * needs splitting.
 */
export function splitEmbeddedNewlineBlocks(blocks: PartialBlock[]): PartialBlock[] {
  if (!Array.isArray(blocks) || !blocks.some(blockNeedsSplit)) return blocks;
  return blocks.flatMap((block) => (blockNeedsSplit(block) ? splitBlock(block) : [block]));
}
