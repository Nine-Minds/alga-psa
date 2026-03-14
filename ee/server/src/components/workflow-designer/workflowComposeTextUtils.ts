import type { PartialBlock } from '@blocknote/core';
import {
  composeTextOutputsSchema,
  generateComposeTextStableKey,
  isComposeTextStableKey,
  templateDocumentSchema,
  type ComposeTextOutput,
  type TemplateDocument,
  type TemplateInlineNode,
  type TemplateTextMark,
} from '@alga-psa/workflows/authoring';

export type ComposeTextOutputField = 'label' | 'stableKey' | 'document';

export type ComposeTextOutputValidation = {
  outputId: string;
  field: ComposeTextOutputField;
  message: string;
};

type LooseTemplateDocument = {
  version?: unknown;
  blocks?: unknown;
};

type LooseInlineText = {
  type?: unknown;
  text?: unknown;
  styles?: Record<string, unknown>;
};

type LooseInlineLink = {
  type?: unknown;
  href?: unknown;
  content?: unknown;
};

type LooseInlineReference = {
  type?: unknown;
  props?: {
    path?: unknown;
    label?: unknown;
  };
};

type LooseBlock = {
  type?: unknown;
  props?: Record<string, unknown>;
  content?: unknown;
};

const EMPTY_TEMPLATE_DOCUMENT: TemplateDocument = {
  version: 1,
  blocks: [],
};

const blockNoteTypeToTemplateType: Record<string, string> = {
  paragraph: 'paragraph',
  bulletListItem: 'bullet_list_item',
  numberedListItem: 'ordered_list_item',
  heading: 'heading',
  quote: 'blockquote',
  codeBlock: 'code_block',
};

const templateTypeToBlockNoteType: Record<string, string> = {
  paragraph: 'paragraph',
  bullet_list_item: 'bulletListItem',
  ordered_list_item: 'numberedListItem',
  heading: 'heading',
  blockquote: 'quote',
  code_block: 'codeBlock',
};

const markNames: TemplateTextMark[] = ['bold', 'italic', 'code', 'link'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const coerceTemplateDocument = (value: unknown): TemplateDocument => {
  const parsed = templateDocumentSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  const raw = (value as LooseTemplateDocument | null | undefined) ?? {};
  if (raw.version === 1 && Array.isArray(raw.blocks)) {
    return {
      version: 1,
      blocks: [],
    };
  }

  return EMPTY_TEMPLATE_DOCUMENT;
};

export const createEmptyComposeTextDocument = (): TemplateDocument => ({
  version: 1,
  blocks: [],
});

export const createComposeTextOutput = (
  label: string,
  existingKeys: Iterable<string>,
  createId: () => string
): ComposeTextOutput => ({
  id: createId(),
  label,
  stableKey: generateComposeTextStableKey(label, existingKeys),
  document: createEmptyComposeTextDocument(),
});

export const coerceComposeTextOutputs = (value: unknown): ComposeTextOutput[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry, index) => {
    const raw = isRecord(entry) ? entry : {};
    const id = typeof raw.id === 'string' && raw.id.trim().length > 0
      ? raw.id
      : `compose-text-output-${index + 1}`;
    const label = typeof raw.label === 'string' ? raw.label : '';
    const stableKey = typeof raw.stableKey === 'string' ? raw.stableKey : '';

    return {
      id,
      label,
      stableKey,
      document: coerceTemplateDocument(raw.document),
    };
  });
};

export const buildComposeTextReferencePath = (
  saveAs: string | undefined,
  stableKey: string
): string | null => {
  const trimmedSaveAs = saveAs?.trim();
  const trimmedKey = stableKey.trim();
  if (!trimmedSaveAs || !trimmedKey) {
    return null;
  }
  return `vars.${trimmedSaveAs}.${trimmedKey}`;
};

const collectInlineMarks = (styles: Record<string, unknown> | undefined): TemplateTextMark[] | undefined => {
  if (!styles) return undefined;
  const marks = markNames.filter((mark) => Boolean(styles[mark]));
  return marks.length > 0 ? marks : undefined;
};

const serializeTextNode = (value: LooseInlineText): TemplateInlineNode[] => {
  const text = typeof value.text === 'string' ? value.text : '';
  return [
    {
      type: 'text',
      text,
      marks: collectInlineMarks(value.styles),
    },
  ];
};

const serializeLinkNode = (value: LooseInlineLink): TemplateInlineNode[] => {
  const href = typeof value.href === 'string' ? value.href : undefined;
  const content = Array.isArray(value.content) ? value.content : [];

  return content.flatMap((item) => {
    if (!isRecord(item) || item.type !== 'text') {
      return [];
    }

    const textNode = item as LooseInlineText;
    const marks = new Set<TemplateTextMark>(collectInlineMarks(textNode.styles) ?? []);
    if (href) {
      marks.add('link');
    }

    return [
      {
        type: 'text' as const,
        text: typeof textNode.text === 'string' ? textNode.text : '',
        marks: marks.size > 0 ? Array.from(marks) : undefined,
        href,
      },
    ];
  });
};

const serializeInlineNode = (value: unknown): TemplateInlineNode[] => {
  if (typeof value === 'string') {
    return [{ type: 'text', text: value }];
  }

  if (!isRecord(value) || typeof value.type !== 'string') {
    return [];
  }

  if (value.type === 'text') {
    return serializeTextNode(value as LooseInlineText);
  }

  if (value.type === 'link') {
    return serializeLinkNode(value as LooseInlineLink);
  }

  if (value.type === 'workflowReference') {
    const reference = value as LooseInlineReference;
    if (
      typeof reference.props?.path === 'string' &&
      typeof reference.props?.label === 'string'
    ) {
      return [
        {
          type: 'reference',
          path: reference.props.path,
          label: reference.props.label,
        },
      ];
    }
  }

  return [];
};

const serializeBlockContent = (content: unknown): TemplateInlineNode[] => {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }

  if (!Array.isArray(content)) {
    return [];
  }

  return content.flatMap((item) => serializeInlineNode(item));
};

export const serializeComposeTextBlocksToDocument = (
  blocks: PartialBlock[]
): TemplateDocument => ({
  version: 1,
  blocks: blocks.flatMap((block) => {
    const rawBlock = block as LooseBlock;
    const blockType = typeof rawBlock.type === 'string'
      ? blockNoteTypeToTemplateType[rawBlock.type]
      : undefined;

    if (!blockType) {
      return [];
    }

    if (blockType === 'code_block') {
      const inlineText = serializeBlockContent(rawBlock.content)
        .filter((node): node is Extract<TemplateInlineNode, { type: 'text' }> => node.type === 'text')
        .map((node) => node.text)
        .join('');

      return [{
        type: 'code_block' as const,
        text: inlineText,
      }];
    }

    if (blockType === 'heading') {
      const level = rawBlock.props?.level;
      return [{
        type: 'heading' as const,
        level: level === 2 || level === 3 ? level : 1,
        children: serializeBlockContent(rawBlock.content),
      }];
    }

    return [{
      type: blockType as Exclude<TemplateDocument['blocks'][number]['type'], 'heading' | 'code_block'>,
      children: serializeBlockContent(rawBlock.content),
    }];
  }),
});

const buildBlockNoteTextContent = (node: Extract<TemplateInlineNode, { type: 'text' }>) => {
  const marks = new Set(node.marks ?? []);
  const styles: Record<string, boolean> = {};
  if (marks.has('bold')) styles.bold = true;
  if (marks.has('italic')) styles.italic = true;
  if (marks.has('code')) styles.code = true;

  if (marks.has('link') && node.href) {
    return {
      type: 'link' as const,
      href: node.href,
      content: [
        {
          type: 'text' as const,
          text: node.text,
          styles,
        },
      ],
    };
  }

  return {
    type: 'text' as const,
    text: node.text,
    styles,
  };
};

const hydrateInlineContent = (children: TemplateInlineNode[]) => {
  if (children.length === 0) {
    return '';
  }

  return children.map((child) => {
    if (child.type === 'reference') {
      return {
        type: 'workflowReference' as const,
        props: {
          path: child.path,
          label: child.label,
        },
      };
    }

    return buildBlockNoteTextContent(child);
  });
};

export const hydrateComposeTextDocumentToBlocks = (
  document: TemplateDocument
): PartialBlock[] => {
  if (document.blocks.length === 0) {
    return [{
      type: 'paragraph',
      content: '',
    }];
  }

  return document.blocks.map((block) => {
    const type = templateTypeToBlockNoteType[block.type];

    if (block.type === 'code_block') {
      return {
        type,
        content: block.text,
      };
    }

    if (block.type === 'heading') {
      return {
        type,
        props: {
          level: block.level,
        },
        content: hydrateInlineContent(block.children),
      };
    }

    return {
      type,
      content: hydrateInlineContent(block.children),
    };
  });
};

export const validateComposeTextOutputs = (
  outputs: ComposeTextOutput[]
): ComposeTextOutputValidation[] => {
  const parsed = composeTextOutputsSchema.safeParse(outputs);
  if (parsed.success) {
    return [];
  }

  return parsed.error.issues.flatMap((issue) => {
    const [outputIndex, field] = issue.path;
    if (typeof outputIndex !== 'number') {
      return [];
    }

    const output = outputs[outputIndex];
    if (!output) {
      return [];
    }

    const normalizedField: ComposeTextOutputField =
      field === 'stableKey' || field === 'document' ? field : 'label';

    return [{
      outputId: output.id,
      field: normalizedField,
      message: issue.message,
    }];
  });
};

export const isValidComposeTextStableKey = (value: string): boolean =>
  isComposeTextStableKey(value);

