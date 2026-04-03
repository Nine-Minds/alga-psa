export type BlockContentFormat = 'blocknote' | 'prosemirror' | 'empty' | 'unknown';

// ---------------------------------------------------------------------------
// Markdown detection & conversion helpers
// ---------------------------------------------------------------------------

const MARKDOWN_HEADING_PATTERN = /^#{1,6}\s/;
const MARKDOWN_BLOCK_PATTERNS = [
  /^#{1,6}\s/,       // headings
  /^[-*+]\s+/,       // unordered list
  /^\d+[.)]\s+/,     // ordered list
  /^```/,            // fenced code block
  /^>\s/,            // blockquote
  /^(-{3,}|\*{3,}|_{3,})\s*$/, // horizontal rule
];
const MARKDOWN_INLINE_PATTERN = /\*\*[^*]+\*\*|\[.+?\]\(.+?\)/;

/**
 * Extracts plain text from ProseMirror paragraph nodes, joining with newlines.
 */
const extractParagraphTexts = (nodes: ProseMirrorNode[]): string[] =>
  nodes
    .filter((n) => n.type === 'paragraph')
    .map((node) => {
      if (!node.content) return '';
      return node.content.map((child) => child.text || '').join('');
    });

/**
 * Detects if a ProseMirror document consists solely of paragraph nodes whose
 * text contains raw markdown syntax (headings, bold, links, etc.).
 */
export const isRawMarkdownInProsemirror = (doc: unknown): boolean => {
  const parsed = parseBlockContent(doc);
  if (!parsed || typeof parsed !== 'object') return false;

  const maybeDoc = parsed as { type?: string; content?: ProseMirrorNode[] };
  if (maybeDoc.type !== 'doc' || !Array.isArray(maybeDoc.content)) return false;

  const nodes = maybeDoc.content;
  if (nodes.length < 2) return false;

  // All content nodes must be paragraphs — presence of structured nodes means
  // the content is already formatted.
  if (nodes.some((n) => n.type !== 'paragraph')) return false;

  const texts = extractParagraphTexts(nodes);

  // Count distinct markdown signals
  let signals = 0;
  for (const text of texts) {
    for (const pattern of MARKDOWN_BLOCK_PATTERNS) {
      if (pattern.test(text)) { signals++; break; }
    }
    if (MARKDOWN_INLINE_PATTERN.test(text)) signals++;
  }

  // Require at least 2 signals to avoid false positives
  return signals >= 2;
};

/**
 * Parses inline markdown (bold, italic, code, links) into BlockNote inline
 * segments.
 */
const parseMarkdownInline = (
  text: string,
): BlockNoteInline[] => {
  const segments: BlockNoteInline[] = [];
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[([^\]]+)\]\((https?:\/\/[^)]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', text: text.slice(lastIndex, match.index) });
    }
    if (match[2]) {
      segments.push({ type: 'text', text: match[2], styles: { bold: true } });
    } else if (match[3]) {
      segments.push({ type: 'text', text: match[3], styles: { italic: true } });
    } else if (match[4]) {
      segments.push({ type: 'text', text: match[4], styles: { code: true } });
    } else if (match[5] && match[6]) {
      segments.push({ type: 'text', text: match[5], styles: { link: { href: match[6] } } });
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', text: text.slice(lastIndex) });
  }

  return segments.length > 0 ? segments : [{ type: 'text', text }];
};

/**
 * Lightweight markdown parser that converts a markdown string into an array of
 * BlockNote-style blocks. Handles headings, lists, code fences, blockquotes,
 * horizontal rules, and inline formatting.
 */
const markdownToBlockNoteBlocks = (markdown: string): BlockNoteBlock[] => {
  const lines = markdown.split('\n');
  const blocks: BlockNoteBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: 'horizontalRule' });
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith('> ') || line === '>') {
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i]!.startsWith('> ') || lines[i] === '>')) {
        quoteLines.push(lines[i]!.replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({
        type: 'blockquote',
        content: parseMarkdownInline(quoteLines.join(' ')),
      });
      continue;
    }

    // Fenced code block
    if (line.startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith('```')) {
        codeLines.push(lines[i]!);
        i++;
      }
      i++; // skip closing ```
      blocks.push({
        type: 'codeBlock',
        content: codeLines.join('\n'),
      });
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        props: { level: headingMatch[1]!.length },
        content: parseMarkdownInline(headingMatch[2]!),
      });
      i++;
      continue;
    }

    // Unordered list items
    if (/^\s*[-*+]\s+/.test(line)) {
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i]!)) {
        const text = lines[i]!.replace(/^\s*[-*+]\s+/, '');
        blocks.push({ type: 'bulletListItem', content: parseMarkdownInline(text) });
        i++;
      }
      continue;
    }

    // Ordered list items
    if (/^\s*\d+[.)]\s+/.test(line)) {
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i]!)) {
        const text = lines[i]!.replace(/^\s*\d+[.)]\s+/, '');
        blocks.push({ type: 'numberedListItem', content: parseMarkdownInline(text) });
        i++;
      }
      continue;
    }

    // Blank line
    if (!line.trim()) {
      i++;
      continue;
    }

    // Regular paragraph — collect consecutive non-blank, non-special lines
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !MARKDOWN_HEADING_PATTERN.test(lines[i]!) &&
      !lines[i]!.startsWith('```') &&
      !/^\s*[-*+]\s+/.test(lines[i]!) &&
      !/^\s*\d+[.)]\s+/.test(lines[i]!) &&
      !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i]!) &&
      !lines[i]!.startsWith('> ')
    ) {
      paraLines.push(lines[i]!);
      i++;
    }
    blocks.push({
      type: 'paragraph',
      content: parseMarkdownInline(paraLines.join(' ')),
    });
  }

  return blocks;
};

/**
 * Converts a ProseMirror doc whose paragraphs contain raw markdown text into a
 * properly structured ProseMirror document with headings, lists, bold marks,
 * link marks, etc.
 */
export const convertRawMarkdownProsemirror = (doc: unknown): ProseMirrorDoc => {
  const parsed = parseBlockContent(doc) as { content?: ProseMirrorNode[] } | null;
  const texts = extractParagraphTexts(parsed?.content ?? []);
  const markdownText = texts.join('\n');
  const blocks = markdownToBlockNoteBlocks(markdownText);
  return blockNoteJsonToProsemirrorJson(blocks);
};

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
