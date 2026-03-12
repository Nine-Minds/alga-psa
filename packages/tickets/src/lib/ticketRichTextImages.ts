import type { PartialBlock } from '@blocknote/core';

function transformBlocks(
  blocks: PartialBlock[],
  transform: (block: PartialBlock) => PartialBlock | null
): PartialBlock[] {
  return blocks.flatMap((block) => {
    const nextBlock: PartialBlock = {
      ...block,
      children: Array.isArray(block.children)
        ? transformBlocks(block.children as PartialBlock[], transform)
        : block.children,
    };

    const transformedBlock = transform(nextBlock);
    return transformedBlock ? [transformedBlock] : [];
  });
}

export function removeTicketRichTextImageUrls(
  blocks: PartialBlock[],
  urlsToRemove: Iterable<string>
): PartialBlock[] {
  const urlSet = new Set(urlsToRemove);

  return transformBlocks(blocks, (block) => {
    const blockUrl =
      block.type === 'image' && typeof block.props?.url === 'string' ? block.props.url : null;

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
  return transformBlocks(blocks, (block) => {
    const blockUrl =
      block.type === 'image' && typeof block.props?.url === 'string' ? block.props.url : null;

    if (!blockUrl) {
      return block;
    }

    const replacementUrl = replacements.get(blockUrl);
    if (!replacementUrl) {
      return block;
    }

    return {
      ...block,
      props: {
        ...(block.props || {}),
        url: replacementUrl,
      },
    };
  });
}
