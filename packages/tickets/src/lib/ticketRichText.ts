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
  | 'redo';

export type TicketMobileEditorRequest = 'get-html' | 'get-json';

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

  const extractedText = extractTextFromProseMirror(parsed.content).trimEnd();
  return extractedText
    ? createTicketRichTextParagraph(extractedText)
    : cloneDefaultBlock();
}

export function serializeTicketRichTextContent(content: PartialBlock[]): string {
  return JSON.stringify(content);
}

export function serializeTicketMobileRichTextDocument(
  document: TicketMobileRichTextDocument
): string {
  return JSON.stringify(document.content);
}
