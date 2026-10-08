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

type InlineItem = { type?: string; text?: string; content?: InlineItem[]; [key: string]: unknown };

function textHasNewline(item: InlineItem | undefined): boolean {
  return item?.type === 'text' && typeof item.text === 'string' && item.text.includes('\n');
}

// Links carry their own text nodes. A pasted URL followed by blank lines lands
// as "https://…\n\n" inside the link, which the top-level check never sees.
function linkHasNewline(item: InlineItem | undefined): boolean {
  return item?.type === 'link' && Array.isArray(item.content) && item.content.some(textHasNewline);
}

function blockNeedsSplit(block: PartialBlock): boolean {
  if (typeof block.type !== 'string' || !SPLITTABLE_BLOCK_TYPES.has(block.type)) return false;
  if (!Array.isArray(block.content)) return false;
  return (block.content as InlineItem[]).some((item) => textHasNewline(item) || linkHasNewline(item));
}

function splitBlock(block: PartialBlock): PartialBlock[] {
  const segments: InlineItem[][] = [[]];
  const pushLines = (text: string, wrap: (part: string) => InlineItem) => {
    text.split('\n').forEach((part, index) => {
      if (index > 0) segments.push([]);
      if (part !== '') segments[segments.length - 1].push(wrap(part));
    });
  };

  for (const item of block.content as InlineItem[]) {
    if (textHasNewline(item)) {
      pushLines(item.text as string, (part) => ({ ...item, text: part }));
    } else if (linkHasNewline(item)) {
      for (const inner of item.content as InlineItem[]) {
        if (textHasNewline(inner)) {
          pushLines(inner.text as string, (part) => ({ ...item, content: [{ ...inner, text: part }] }));
        } else {
          segments[segments.length - 1].push({ ...item, content: [inner] });
        }
      }
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
