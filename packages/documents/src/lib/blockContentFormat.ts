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
    if (first && typeof first === 'object') {
      // BlockNote blocks always have a 'type' field (paragraph, heading, etc.)
      // and may have 'props'. ProseMirror content is always wrapped in
      // { type: 'doc', content: [...] }, never a top-level array, so any
      // array of typed objects is BlockNote.
      if ('props' in first || 'type' in first) {
        return 'blocknote';
      }
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

const extractInlineText = (content: BlockNoteBlock['content']): string => {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => {
      if (!item || typeof item !== 'object') return '';
      if (item.type === 'text') return item.text || '';
      if (item.type === 'link') {
        const linkContent = extractInlineText((item as { content?: BlockNoteInline[] }).content);
        return linkContent || (item.text as string) || '';
      }
      if (item.type === 'mention') {
        const label = (item as { label?: string; name?: string; username?: string }).label
          || (item as { name?: string }).name
          || (item as { username?: string }).username
          || (item as { id?: string }).id
          || 'mention';
        return `@${label}`;
      }
      return '';
    })
    .join('');
};

const extractTextFromUnknown = (value: unknown): string => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map(extractTextFromUnknown).filter(Boolean).join(' ');
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.text === 'string') return record.text;
    if (record.content) return extractTextFromUnknown(record.content);
    return Object.values(record).map(extractTextFromUnknown).filter(Boolean).join(' ');
  }
  return '';
};

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
          text: typeof item.text === 'string' ? item.text : '',
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
        type: 'listItem',
        content: [
          content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' },
        ],
      };
      return {
        type: 'bulletList',
        content: [listItem],
      };
    }
    case 'numberedListItem': {
      const content = convertInlineContent(block.content);
      const listItem: ProseMirrorNode = {
        type: 'listItem',
        content: [
          content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' },
        ],
      };
      const orderRaw = block.props?.number;
      const order = typeof orderRaw === 'number' && orderRaw > 0 ? orderRaw : 1;
      return {
        type: 'orderedList',
        attrs: { order },
        content: [listItem],
      };
    }
    case 'checkListItem': {
      const isChecked = Boolean(block.props?.checked);
      const prefix = isChecked ? '[x] ' : '[ ] ';
      const content = convertInlineContent(block.content);
      const paragraphContent: ProseMirrorNode[] = [
        { type: 'text', text: prefix },
        ...content,
      ];
      return {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              paragraphContent.length > 0
                ? { type: 'paragraph', content: paragraphContent }
                : { type: 'paragraph' },
            ],
          },
        ],
      };
    }
    case 'codeBlock': {
      const codeText = extractInlineText(block.content);
      return {
        type: 'codeBlock',
        content: codeText ? [{ type: 'text', text: codeText }] : [],
      };
    }
    case 'blockquote': {
      const content = convertInlineContent(block.content);
      return {
        type: 'blockquote',
        content: [
          content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' },
        ],
      };
    }
    case 'horizontalRule':
      return { type: 'horizontalRule' };
    case 'table': {
      const tableText = extractTextFromUnknown(block.content);
      const content = tableText ? [{ type: 'text', text: tableText }] : [];
      return content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' };
    }
    default:
      return null;
  }
};

const isListType = (type: string): boolean =>
  type === 'bulletList' || type === 'orderedList';

const convertBlockNoteBlocks = (blocks: BlockNoteBlock[]): ProseMirrorNode[] => {
  const result: ProseMirrorNode[] = [];

  for (const block of blocks) {
    const node = convertBlockNoteBlock(block);
    if (node) {
      const prev = result[result.length - 1];
      // Merge consecutive list items of the same type into one list node
      if (prev && isListType(node.type) && prev.type === node.type) {
        prev.content = [...(prev.content ?? []), ...(node.content ?? [])];
      } else {
        result.push(node);
      }
    }

    if (Array.isArray(block.children) && block.children.length > 0) {
      result.push(...convertBlockNoteBlocks(block.children));
    }
  }

  return result;
};

/**
 * Normalizes legacy ProseMirror snake_case node types to TipTap camelCase.
 * Handles content saved before the naming convention was fixed.
 */
const LEGACY_NODE_TYPE_MAP: Record<string, string> = {
  bullet_list: 'bulletList',
  ordered_list: 'orderedList',
  list_item: 'listItem',
  code_block: 'codeBlock',
  hard_break: 'hardBreak',
  horizontal_rule: 'horizontalRule',
};

const normalizeNodeTypes = (node: ProseMirrorNode): ProseMirrorNode => {
  const normalizedType = LEGACY_NODE_TYPE_MAP[node.type] || node.type;
  const result: ProseMirrorNode = { ...node, type: normalizedType };
  if (result.content) {
    result.content = result.content.map(normalizeNodeTypes);
  }
  return result;
};

export const normalizeProsemirrorJson = (doc: unknown): unknown => {
  if (!doc || typeof doc !== 'object') return doc;
  const maybeDoc = doc as { type?: string; content?: ProseMirrorNode[] };
  if (maybeDoc.type !== 'doc' || !Array.isArray(maybeDoc.content)) return doc;
  return {
    ...maybeDoc,
    content: maybeDoc.content.map(normalizeNodeTypes),
  };
};

export const blockNoteJsonToProsemirrorJson = (blockData: unknown): ProseMirrorDoc => {
  const parsed = parseBlockContent(blockData);
  if (!Array.isArray(parsed)) {
    return emptyDoc();
  }

  const content = convertBlockNoteBlocks(parsed as BlockNoteBlock[]);

  if (content.length === 0) {
    return emptyDoc();
  }

  return {
    type: 'doc',
    content,
  };
};
