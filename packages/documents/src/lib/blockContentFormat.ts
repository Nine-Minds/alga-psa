export type BlockContentFormat = 'blocknote' | 'prosemirror' | 'empty' | 'unknown';

export const parseBlockContent = (blockData: unknown): unknown => {
  if (typeof blockData !== 'string') {
    return blockData;
  }

  try {
    return JSON.parse(blockData);
  } catch {
    return blockData;
  }
};

export const detectBlockContentFormat = (blockData: unknown): BlockContentFormat => {
  const parsed = parseBlockContent(blockData);

  if (parsed === null || parsed === undefined) {
    return 'empty';
  }

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      return 'empty';
    }

    const first = parsed[0] as Record<string, unknown> | undefined;
    if (first && typeof first === 'object' && 'props' in first) {
      return 'blocknote';
    }
    return 'unknown';
  }

  if (typeof parsed === 'object') {
    const maybeDoc = parsed as { type?: string };
    if (maybeDoc.type === 'doc') {
      return 'prosemirror';
    }
  }

  return 'unknown';
};

type BlockNoteInline =
  | {
      type: 'text';
      text?: string;
      styles?: Record<string, unknown>;
    }
  | {
      type: string;
      [key: string]: unknown;
    };

type BlockNoteBlock = {
  type?: string;
  content?: BlockNoteInline[] | string;
  props?: Record<string, unknown>;
  children?: BlockNoteBlock[];
};

type ProseMirrorNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: ProseMirrorNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
};

type ProseMirrorDoc = {
  type: 'doc';
  content: ProseMirrorNode[];
};

const emptyDoc = (): ProseMirrorDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph' }],
});

const convertInlineContent = (content: BlockNoteBlock['content']): ProseMirrorNode[] => {
  if (!content) return [];
  if (typeof content === 'string') {
    return content.length > 0 ? [{ type: 'text', text: content }] : [];
  }
  if (!Array.isArray(content)) return [];

  return content
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      if (item.type === 'text') {
        const marks: ProseMirrorNode['marks'] = [];
        const styles = item.styles as Record<string, unknown> | undefined;
        if (styles?.bold) marks.push({ type: 'bold' });
        if (styles?.italic) marks.push({ type: 'italic' });
        if (styles?.underline) marks.push({ type: 'underline' });
        if (styles?.strike) marks.push({ type: 'strike' });
        if (styles?.code) marks.push({ type: 'code' });
        const linkValue = styles?.link as
          | { href?: string; url?: string }
          | string
          | undefined;
        const href = typeof linkValue === 'string'
          ? linkValue
          : linkValue?.href || linkValue?.url;
        if (href) {
          marks.push({ type: 'link', attrs: { href } });
        }
        const textNode: ProseMirrorNode = {
          type: 'text',
          text: item.text || '',
        };
        if (marks.length > 0) {
          textNode.marks = marks;
        }
        return textNode;
      }

      if (item.type === 'link') {
        const href = (item as { href?: string; url?: string }).href
          || (item as { url?: string }).url;
        const linkContent = convertInlineContent((item as { content?: BlockNoteInline[] }).content);
        const nodes = linkContent.length > 0
          ? linkContent
          : item.text
            ? [{ type: 'text', text: item.text as string }]
            : [];
        if (!href) return nodes;
        return nodes.map((node) => ({
          ...node,
          marks: [...(node.marks ?? []), { type: 'link', attrs: { href } }],
        }));
      }

      if (item.type === 'mention') {
        const label = (item as { label?: string; name?: string; username?: string }).label
          || (item as { name?: string }).name
          || (item as { username?: string }).username
          || (item as { id?: string }).id
          || 'mention';
        return {
          type: 'text',
          text: `@${label}`,
        };
      }

      return null;
    })
    .flat()
    .filter(Boolean) as ProseMirrorNode[];
};

const convertBlockNoteBlock = (block: BlockNoteBlock): ProseMirrorNode | null => {
  if (!block || typeof block !== 'object') return null;

  switch (block.type) {
    case 'paragraph': {
      const content = convertInlineContent(block.content);
      return content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' };
    }
    case 'heading': {
      const content = convertInlineContent(block.content);
      const levelRaw = block.props?.level;
      const level = typeof levelRaw === 'number' && levelRaw >= 1 && levelRaw <= 6 ? levelRaw : 1;
      const headingNode: ProseMirrorNode = {
        type: 'heading',
        attrs: { level },
      };
      if (content.length > 0) {
        headingNode.content = content;
      }
      return headingNode;
    }
    case 'bulletListItem': {
      const content = convertInlineContent(block.content);
      const listItem: ProseMirrorNode = {
        type: 'list_item',
        content: [
          content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' },
        ],
      };
      return {
        type: 'bullet_list',
        content: [listItem],
      };
    }
    case 'numberedListItem': {
      const content = convertInlineContent(block.content);
      const listItem: ProseMirrorNode = {
        type: 'list_item',
        content: [
          content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' },
        ],
      };
      const orderRaw = block.props?.number;
      const order = typeof orderRaw === 'number' && orderRaw > 0 ? orderRaw : 1;
      return {
        type: 'ordered_list',
        attrs: { order },
        content: [listItem],
      };
    }
    default:
      return null;
  }
};

export const blockNoteJsonToProsemirrorJson = (blockData: unknown): ProseMirrorDoc => {
  const parsed = parseBlockContent(blockData);
  if (!Array.isArray(parsed)) {
    return emptyDoc();
  }

  const content = parsed
    .map((block) => convertBlockNoteBlock(block as BlockNoteBlock))
    .filter(Boolean) as ProseMirrorNode[];

  if (content.length === 0) {
    return emptyDoc();
  }

  return {
    type: 'doc',
    content,
  };
};
