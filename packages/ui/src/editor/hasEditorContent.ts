import type { PartialBlock } from '@blocknote/core';

// LEVERAGE: pattern block-has-content — TextEditor.tsx (blockHasContent) and RichTextViewer.tsx (hasContent) answer the same "is this block non-empty" question; kept dependency-free here so dirty-state checks do not import the whole editor
const MEDIA_BLOCK_TYPES = new Set(['image', 'video', 'audio', 'file']);

function blockHasContent(block: PartialBlock): boolean {
  if (Array.isArray(block.content)) {
    const hasInline = (block.content as Array<{ type?: string; text?: unknown }>).some((item) =>
      item?.type === 'text' && typeof item.text === 'string' ? item.text.trim() !== '' : true,
    );
    if (hasInline) {
      return true;
    }
  } else if (block.content && typeof block.content === 'object') {
    // Table content and other structured inline content is intentional content.
    return true;
  }

  if (typeof block.type === 'string' && MEDIA_BLOCK_TYPES.has(block.type)) {
    const props = block.props as Record<string, unknown> | undefined;
    if (props?.url || props?.name) {
      return true;
    }
  }

  return (block.children ?? []).some(blockHasContent);
}

/**
 * True when the editor document holds anything a user would be upset to lose:
 * non-blank text, a mention, a table, or an uploaded media block. Blank
 * placeholder paragraphs do not count.
 */
export function hasEditorContent(blocks: PartialBlock[] | null | undefined): boolean {
  return Boolean(blocks?.some(blockHasContent));
}
