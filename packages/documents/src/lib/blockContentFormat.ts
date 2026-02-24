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
        return {
          type: 'text',
          text: item.text || '',
        } as ProseMirrorNode;
      }
      return null;
    })
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
