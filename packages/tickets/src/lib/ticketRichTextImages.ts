import type { PartialBlock } from '@blocknote/core';

function getImageBlockUrl(block: PartialBlock): string | null {
  if (block.type !== 'image') {
    return null;
  }

  const imageProps = block.props as { url?: unknown } | undefined;
  return typeof imageProps?.url === 'string' ? imageProps.url : null;
}

function transformBlocks(
  blocks: PartialBlock[],
  transform: (block: PartialBlock) => PartialBlock | null
): PartialBlock[] {
  return blocks.flatMap((block) => {
    const nextBlock = { ...block } as PartialBlock;

    if (Array.isArray(block.children)) {
      nextBlock.children = transformBlocks(block.children as PartialBlock[], transform) as PartialBlock['children'];
    }

    const transformedBlock = transform(nextBlock);
    return transformedBlock ? [transformedBlock] : [];
  });
}

export function removeTicketRichTextImageUrls(
  blocks: PartialBlock[],
  urlsToRemove: Iterable<string>
): PartialBlock[] {
  const urlSet = new Set(urlsToRemove);

  return transformBlocks(blocks, (block): PartialBlock | null => {
    const blockUrl = getImageBlockUrl(block);

    if (blockUrl && urlSet.has(blockUrl)) {
      return null;
    }

    return block;
  });
}

export function replaceTicketRichTextImageUrls(
  blocks: PartialBlock[],
  replacements: Map<string, string>
): PartialBlock[] {
  return transformBlocks(blocks, (block): PartialBlock => {
    const blockUrl = getImageBlockUrl(block);

    if (!blockUrl) {
      return block;
    }

    const replacementUrl = replacements.get(blockUrl);
    if (!replacementUrl) {
      return block;
    }

    const updatedBlock = { ...block } as PartialBlock;
    updatedBlock.props = {
      ...((block.props as Record<string, unknown> | undefined) || {}),
      url: replacementUrl,
    } as PartialBlock['props'];
    return updatedBlock;
  });
}
