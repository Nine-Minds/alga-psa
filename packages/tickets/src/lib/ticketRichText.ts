import { PartialBlock } from '@blocknote/core';

const EMPTY_TICKET_RICH_TEXT_BLOCK: PartialBlock[] = [
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

function cloneDefaultBlock(): PartialBlock[] {
  return JSON.parse(JSON.stringify(EMPTY_TICKET_RICH_TEXT_BLOCK)) as PartialBlock[];
}

export function createTicketRichTextParagraph(text: string): PartialBlock[] {
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
          text,
          styles: {},
        },
      ],
    },
  ];
}

function createDefaultBlockProps() {
  return {
    textAlignment: 'left' as const,
    backgroundColor: 'default' as const,
    textColor: 'default' as const,
  };
}

export type TicketRichTextProseMirrorMark = {
  type: string;
  attrs?: Record<string, unknown>;
};

export type TicketRichTextProseMirrorNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TicketRichTextProseMirrorNode[];
  text?: string;
  marks?: TicketRichTextProseMirrorMark[];
};

export type TicketRichTextProseMirrorDoc = {
  type: 'doc';
  content: TicketRichTextProseMirrorNode[];
};

export type TicketMobileRichTextFormat = 'blocknote' | 'prosemirror';
export type TicketMobileRichTextSourceFormat = 'empty' | 'plain-text' | 'blocknote' | 'prosemirror';

export type TicketMobileRichTextDocument =
  | {
      format: 'blocknote';
      sourceFormat: Extract<TicketMobileRichTextSourceFormat, 'empty' | 'plain-text' | 'blocknote'>;
      content: PartialBlock[];
    }
  | {
      format: 'prosemirror';
      sourceFormat: 'prosemirror';
      content: TicketRichTextProseMirrorDoc;
    };

export type TicketMobileEditorCommand =
  | 'focus'
  | 'blur'
  | 'set-content'
  | 'set-editable'
  | 'toggle-bold'
  | 'toggle-italic'
  | 'toggle-underline'
  | 'toggle-bullet-list'
  | 'toggle-ordered-list'
  | 'undo'
  | 'redo'
  | 'insert-mention';

export type TicketMobileEditorRequest = 'get-html' | 'get-json';

export type TicketMobileEditorMentionPayload = {
  userId: string;
  username: string;
  displayName: string;
  from: number;
  to: number;
};

export type TicketMobileEditorToolbarState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  bulletList: boolean;
  orderedList: boolean;
};

export type TicketMobileEditorStatePayload = {
  ready: boolean;
  focused: boolean;
  editable: boolean;
  toolbar: TicketMobileEditorToolbarState;
  canUndo: boolean;
  canRedo: boolean;
};

export type TicketMobileEditorInitPayload = {
  content: string | null | undefined;
  editable: boolean;
  autofocus?: boolean;
  placeholder?: string;
  debounceMs?: number;
  imageAuth?: { baseUrl: string; apiKey: string };
};

export type TicketMobileEditorNativeToWebMessage =
  | {
      type: 'init';
      payload: TicketMobileEditorInitPayload;
    }
  | {
      type: 'command';
      payload: {
        command: TicketMobileEditorCommand;
        value?: string | boolean | TicketMobileRichTextDocument;
      };
    }
  | {
      type: 'request';
      payload: {
        requestId: string;
        request: TicketMobileEditorRequest;
      };
    }
  | {
      type: 'image-data';
      payload: {
        src: string;
        dataUri: string;
      };
    };

export type TicketMobileEditorWebToNativeMessage =
  | {
      type: 'editor-ready';
      payload: {
        format: TicketMobileRichTextFormat;
        editable: boolean;
      };
    }
  | {
      type: 'state-change';
      payload: TicketMobileEditorStatePayload;
    }
  | {
      type: 'content-change';
      payload: {
        html: string;
        json: PartialBlock[] | TicketRichTextProseMirrorDoc;
      };
    }
  | {
      type: 'content-height';
      payload: {
        height: number;
      };
    }
  | {
      type: 'response';
      payload: {
        requestId: string;
        request: TicketMobileEditorRequest;
        value: string | PartialBlock[] | TicketRichTextProseMirrorDoc;
      };
    }
  | {
      type: 'error';
      payload: {
        code: string;
        message: string;
        requestId?: string;
      };
    }
  | {
      type: 'image-request';
      payload: {
        src: string;
      };
    }
  | {
      type: 'mention-query';
      payload: {
        active: boolean;
        query: string;
        from: number;
        to: number;
      };
    };

function isProseMirrorDoc(value: unknown): value is TicketRichTextProseMirrorDoc {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const record = value as { type?: unknown; content?: unknown };
  return record.type === 'doc' && Array.isArray(record.content);
}

function extractTextFromProseMirror(node: unknown): string {
  if (!node || typeof node !== 'object') {
    return '';
  }

  const record = node as TicketRichTextProseMirrorNode;

  if (record.type === 'text') {
    return typeof record.text === 'string' ? record.text : '';
  }

  if (record.type === 'mention') {
    const username = typeof record.attrs?.username === 'string' ? record.attrs.username : '';
    const displayName = typeof record.attrs?.displayName === 'string' ? record.attrs.displayName : '';
    return username ? `@${username}` : `@${displayName}`;
  }

  if (record.type === 'hardBreak') {
    return '\n';
  }

  const childText = Array.isArray(record.content)
    ? record.content.map(extractTextFromProseMirror).join('')
    : '';

  if (!childText) {
    return '';
  }

  const blockTypes = new Set([
    'doc',
    'paragraph',
    'heading',
    'bullet_list',
    'ordered_list',
    'list_item',
    'blockquote',
    'code_block',
  ]);

  return blockTypes.has(record.type) ? `${childText}\n` : childText;
}

type TicketRichTextInlineContent =
  | {
      type: 'text';
      text: string;
      styles: Record<string, unknown>;
    }
  | {
      type: 'link';
      href: string;
      content: Array<{
        type: 'text';
        text: string;
        styles: Record<string, unknown>;
      }>;
    };

function getInlineStylesFromMarks(marks: TicketRichTextProseMirrorMark[] | undefined): Record<string, unknown> {
  const styles: Record<string, unknown> = {};

  for (const mark of marks ?? []) {
    switch (mark.type) {
      case 'bold':
        styles.bold = true;
        break;
      case 'italic':
        styles.italic = true;
        break;
      case 'underline':
        styles.underline = true;
        break;
      case 'strike':
        styles.strike = true;
        break;
      case 'textStyle':
        if (typeof mark.attrs?.color === 'string' && mark.attrs.color.trim()) {
          styles.textColor = mark.attrs.color.trim();
        }
        if (typeof mark.attrs?.backgroundColor === 'string' && mark.attrs.backgroundColor.trim()) {
          styles.backgroundColor = mark.attrs.backgroundColor.trim();
        }
        break;
    }
  }

  return styles;
}

function getLinkHrefFromMarks(marks: TicketRichTextProseMirrorMark[] | undefined): string | null {
  for (const mark of marks ?? []) {
    if (mark.type !== 'link') {
      continue;
    }

    const href = mark.attrs?.href;
    if (typeof href === 'string' && href.trim()) {
      return href.trim();
    }
  }

  return null;
}

function createEmptyInlineText(): TicketRichTextInlineContent {
  return {
    type: 'text',
    text: '',
    styles: {},
  };
}

function normalizeInlineContent(
  content: TicketRichTextInlineContent[],
): TicketRichTextInlineContent[] {
  if (content.length === 0) {
    return [createEmptyInlineText()];
  }

  return content;
}

function convertInlineNodeToBlockNoteContent(
  node: TicketRichTextProseMirrorNode,
): TicketRichTextInlineContent[] {
  if (node.type === 'text') {
    const text = typeof node.text === 'string' ? node.text : '';
    const styles = getInlineStylesFromMarks(node.marks);
    const href = getLinkHrefFromMarks(node.marks);

    if (href) {
      return [
        {
          type: 'link',
          href,
          content: [{
            type: 'text',
            text,
            styles,
          }],
        },
      ];
    }

    return [{
      type: 'text',
      text,
      styles,
    }];
  }

  if (node.type === 'mention') {
    const userId = typeof node.attrs?.userId === 'string' ? node.attrs.userId : '';
    const username = typeof node.attrs?.username === 'string' ? node.attrs.username : '';
    const displayName = typeof node.attrs?.displayName === 'string' ? node.attrs.displayName : 'Unknown';
    return [{
      type: 'mention' as TicketRichTextInlineContent['type'],
      props: { userId, username, displayName },
    } as unknown as TicketRichTextInlineContent];
  }

  if (node.type === 'hardBreak') {
    return [{
      type: 'text',
      text: '\n',
      styles: {},
    }];
  }

  if (!Array.isArray(node.content)) {
    return [];
  }

  return node.content.flatMap(convertInlineNodeToBlockNoteContent);
}

function createFallbackParagraphBlock(node: TicketRichTextProseMirrorNode): PartialBlock[] {
  const text = extractTextFromProseMirror(node).trimEnd();

  return text
    ? createTicketRichTextParagraph(text)
    : cloneDefaultBlock();
}

function convertListItemNode(
  node: TicketRichTextProseMirrorNode,
  listType: 'bulletListItem' | 'numberedListItem',
): PartialBlock[] {
  const children = Array.isArray(node.content) ? node.content : [];
  const firstTextualChild = children.find((child) => child.type === 'paragraph' || child.type === 'heading');
  const nestedChildren = children.flatMap((child) => {
    if (child === firstTextualChild) {
      return [];
    }

    return convertProseMirrorNodeToBlockNote(child);
  });

  const block: PartialBlock = {
    type: listType,
    props: createDefaultBlockProps(),
    content: normalizeInlineContent(
      firstTextualChild && Array.isArray(firstTextualChild.content)
        ? firstTextualChild.content.flatMap(convertInlineNodeToBlockNoteContent)
        : []
    ),
  };

  if (nestedChildren.length > 0) {
    block.children = nestedChildren;
  }

  return [block];
}

function convertProseMirrorNodeToBlockNote(node: TicketRichTextProseMirrorNode): PartialBlock[] {
  switch (node.type) {
    case 'doc':
      return Array.isArray(node.content)
        ? node.content.flatMap(convertProseMirrorNodeToBlockNote)
        : cloneDefaultBlock();
    case 'paragraph':
      return [{
        type: 'paragraph',
        props: createDefaultBlockProps(),
        content: normalizeInlineContent(
          Array.isArray(node.content)
            ? node.content.flatMap(convertInlineNodeToBlockNoteContent)
            : []
        ),
      }];
    case 'heading':
      return [{
        type: 'heading',
        props: {
          ...createDefaultBlockProps(),
          level: typeof node.attrs?.level === 'number' ? node.attrs.level : 1,
        },
        content: normalizeInlineContent(
          Array.isArray(node.content)
            ? node.content.flatMap(convertInlineNodeToBlockNoteContent)
            : []
        ),
      }];
    case 'bullet_list':
      return Array.isArray(node.content)
        ? node.content.flatMap((child) => convertListItemNode(child, 'bulletListItem'))
        : cloneDefaultBlock();
    case 'ordered_list':
      return Array.isArray(node.content)
        ? node.content.flatMap((child) => convertListItemNode(child, 'numberedListItem'))
        : cloneDefaultBlock();
    case 'list_item':
      return convertListItemNode(node, 'bulletListItem');
    case 'image': {
      const url = typeof node.attrs?.src === 'string' ? node.attrs.src.trim() : '';
      if (!url) {
        return cloneDefaultBlock();
      }

      return [{
        type: 'image',
        props: {
          url,
          name: typeof node.attrs?.alt === 'string' ? node.attrs.alt.trim() : '',
          caption: typeof node.attrs?.title === 'string' ? node.attrs.title.trim() : '',
        },
      }];
    }
    case 'blockquote':
    case 'code_block':
      return createFallbackParagraphBlock(node);
    default:
      return createFallbackParagraphBlock(node);
  }
}

export function convertProseMirrorToTicketRichTextBlocks(
  document: TicketRichTextProseMirrorDoc
): PartialBlock[] {
  const converted = convertProseMirrorNodeToBlockNote(document)
    .filter((block) => block && typeof block === 'object');

  return converted.length > 0 ? converted : cloneDefaultBlock();
}

export function createEmptyTicketMobileRichTextDocument(): TicketMobileRichTextDocument {
  return {
    format: 'blocknote',
    sourceFormat: 'empty',
    content: cloneDefaultBlock(),
  };
}

export function parseTicketMobileRichTextDocument(
  content: string | null | undefined,
  options?: {
    onParseError?: (error: unknown) => void;
  }
): TicketMobileRichTextDocument {
  if (!content) {
    return createEmptyTicketMobileRichTextDocument();
  }

  const trimmedContent = content.trim();
  if (!trimmedContent) {
    return createEmptyTicketMobileRichTextDocument();
  }

  if (trimmedContent.startsWith('[') || trimmedContent.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmedContent) as unknown;

      if (Array.isArray(parsed)) {
        return {
          format: 'blocknote',
          sourceFormat: 'blocknote',
          content: parsed.length > 0 ? (parsed as PartialBlock[]) : cloneDefaultBlock(),
        };
      }

      if (isProseMirrorDoc(parsed)) {
        return {
          format: 'prosemirror',
          sourceFormat: 'prosemirror',
          content: parsed,
        };
      }
    } catch (error) {
      options?.onParseError?.(error);
    }
  }

  return {
    format: 'blocknote',
    sourceFormat: 'plain-text',
    content: createTicketRichTextParagraph(content),
  };
}

export function parseTicketRichTextContent(
  content: string | null | undefined,
  options?: {
    onParseError?: (error: unknown) => void;
  }
): PartialBlock[] {
  const parsed = parseTicketMobileRichTextDocument(content, options);

  if (parsed.format === 'blocknote') {
    return parsed.content;
  }

  return convertProseMirrorToTicketRichTextBlocks(parsed.content);
}

export function serializeTicketRichTextContent(content: PartialBlock[]): string {
  return JSON.stringify(content);
}

export function serializeTicketMobileRichTextDocument(
  document: TicketMobileRichTextDocument
): string {
  return JSON.stringify(document.content);
}
