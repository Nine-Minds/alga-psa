import { z } from 'zod';

import type { ExpressionContext } from '../expressionEngine';

export const COMPOSE_TEXT_ACTION_ID = 'transform.compose_text';
export const COMPOSE_TEXT_VERSION = 1;

const SIMPLE_REFERENCE_PATH_PATTERN =
  /^(payload|vars|meta|error|[A-Za-z_][A-Za-z0-9_]*|\$index)(\.[A-Za-z_$][A-Za-z0-9_$]*|\[\d+\])*$/u;
const STABLE_KEY_PATTERN = /^[a-z_][a-z0-9_]*$/u;
const MARK_ORDER = ['code', 'bold', 'italic'] as const;

export type TemplateTextMark = 'bold' | 'italic' | 'code' | 'link';

export type TemplateTextNode = {
  type: 'text';
  text: string;
  marks?: TemplateTextMark[];
  href?: string;
};

export type TemplateReferenceNode = {
  type: 'reference';
  path: string;
  label: string;
};

export type TemplateInlineNode = TemplateTextNode | TemplateReferenceNode;

export type TemplateBlock =
  | { type: 'paragraph'; children: TemplateInlineNode[] }
  | { type: 'bullet_list_item'; children: TemplateInlineNode[] }
  | { type: 'ordered_list_item'; children: TemplateInlineNode[] }
  | { type: 'heading'; level: 1 | 2 | 3; children: TemplateInlineNode[] }
  | { type: 'blockquote'; children: TemplateInlineNode[] }
  | { type: 'code_block'; text: string };

export type TemplateDocument = {
  version: 1;
  blocks: TemplateBlock[];
};

export type ComposeTextOutput = {
  id: string;
  label: string;
  stableKey: string;
  document: TemplateDocument;
};

type ComposeTextValidationResult =
  | { ok: true; outputs: ComposeTextOutput[] }
  | { ok: false; errors: string[] };

type ComposeTextConfigLike = {
  actionId?: unknown;
  version?: unknown;
  outputs?: unknown;
};

const templateTextMarkSchema = z.enum(['bold', 'italic', 'code', 'link']);

const templateTextNodeBaseSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
  marks: z.array(templateTextMarkSchema).optional(),
  href: z.string().url().optional(),
});

const templateReferenceNodeBaseSchema = z.object({
  type: z.literal('reference'),
  path: z.string().min(1),
  label: z.string().trim().min(1),
});

export const templateInlineNodeSchema = z.union([
  templateTextNodeBaseSchema,
  templateReferenceNodeBaseSchema,
]).superRefine((node, ctx) => {
  if (node.type === 'text') {
    const marks = new Set(node.marks ?? []);
    if (marks.has('link') && !node.href) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Text nodes using the link mark require href.',
        path: ['href'],
      });
    }
    if (!marks.has('link') && node.href) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'href is only supported when the link mark is present.',
        path: ['href'],
      });
    }
    return;
  }

  if (!isComposeTextReferencePath(node.path)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Reference paths must be simple workflow references.',
      path: ['path'],
    });
  }
});

const blockChildrenSchema = z.array(templateInlineNodeSchema);

const paragraphBlockSchema = z.object({
  type: z.literal('paragraph'),
  children: blockChildrenSchema,
});

const bulletListItemBlockSchema = z.object({
  type: z.literal('bullet_list_item'),
  children: blockChildrenSchema,
});

const orderedListItemBlockSchema = z.object({
  type: z.literal('ordered_list_item'),
  children: blockChildrenSchema,
});

const headingBlockSchema = z.object({
  type: z.literal('heading'),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  children: blockChildrenSchema,
});

const blockQuoteSchema = z.object({
  type: z.literal('blockquote'),
  children: blockChildrenSchema,
});

const codeBlockSchema = z.object({
  type: z.literal('code_block'),
  text: z.string(),
});

export const templateBlockSchema = z.discriminatedUnion('type', [
  paragraphBlockSchema,
  bulletListItemBlockSchema,
  orderedListItemBlockSchema,
  headingBlockSchema,
  blockQuoteSchema,
  codeBlockSchema,
]);

export const templateDocumentSchema = z.object({
  version: z.literal(1),
  blocks: z.array(templateBlockSchema),
});

export const composeTextOutputSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  stableKey: z.string().trim().min(1).regex(STABLE_KEY_PATTERN, 'Stable keys must be lowercase snake_case identifiers.'),
  document: templateDocumentSchema,
});

export const composeTextOutputsSchema = z.array(composeTextOutputSchema).min(1, 'Compose Text requires at least one output.').superRefine((outputs, ctx) => {
  const seenLabels = new Map<string, number>();
  const seenKeys = new Map<string, number>();

  outputs.forEach((output, index) => {
    const normalizedLabel = output.label.trim().toLocaleLowerCase();
    const existingLabelIndex = seenLabels.get(normalizedLabel);
    if (existingLabelIndex !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Output labels must be unique within the step.',
        path: [index, 'label'],
      });
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Output labels must be unique within the step.',
        path: [existingLabelIndex, 'label'],
      });
    } else {
      seenLabels.set(normalizedLabel, index);
    }

    const existingKeyIndex = seenKeys.get(output.stableKey);
    if (existingKeyIndex !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Stable keys must be unique within the step.',
        path: [index, 'stableKey'],
      });
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Stable keys must be unique within the step.',
        path: [existingKeyIndex, 'stableKey'],
      });
    } else {
      seenKeys.set(output.stableKey, index);
    }
  });
});

export const composeTextResultSchema = z.record(z.string()).describe(
  'Rendered markdown outputs keyed by stable output key.'
);

export const isWorkflowComposeTextAction = (actionId: unknown): actionId is typeof COMPOSE_TEXT_ACTION_ID =>
  actionId === COMPOSE_TEXT_ACTION_ID;

export function isComposeTextReferencePath(path: string | undefined): boolean {
  if (!path) return false;
  return SIMPLE_REFERENCE_PATH_PATTERN.test(path.trim());
}

export function isComposeTextStableKey(value: string | undefined): boolean {
  if (!value) return false;
  return STABLE_KEY_PATTERN.test(value.trim());
}

export function generateComposeTextStableKey(
  label: string,
  existingKeys: Iterable<string> = []
): string {
  const normalized = label
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  let candidate = normalized || 'output';
  if (!/^[a-z_]/u.test(candidate)) {
    candidate = `output_${candidate}`;
  }

  const used = new Set(existingKeys);
  if (!used.has(candidate)) {
    return candidate;
  }

  let suffix = 2;
  while (used.has(`${candidate}_${suffix}`)) {
    suffix += 1;
  }
  return `${candidate}_${suffix}`;
}

export const getComposeTextOutputsFromConfig = (
  config: unknown
): ComposeTextOutput[] | null => {
  const outputs = (config as ComposeTextConfigLike | null | undefined)?.outputs;
  const parsed = composeTextOutputsSchema.safeParse(outputs);
  return parsed.success ? (parsed.data as ComposeTextOutput[]) : null;
};

export const validateComposeTextConfig = (
  config: unknown
): ComposeTextValidationResult => {
  const raw = (config as ComposeTextConfigLike | null | undefined) ?? {};
  if (!isWorkflowComposeTextAction(raw.actionId)) {
    return { ok: false, errors: ['Compose Text config requires actionId "transform.compose_text".'] };
  }
  if (raw.version !== COMPOSE_TEXT_VERSION) {
    return { ok: false, errors: ['Compose Text config requires version 1.'] };
  }
  if (raw.outputs === undefined) {
    return { ok: false, errors: ['Compose Text requires at least one output.'] };
  }

  const parsed = composeTextOutputsSchema.safeParse(raw.outputs);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => issue.message),
    };
  }

  return { ok: true, outputs: parsed.data as ComposeTextOutput[] };
};

export const resolveComposeTextOutputSchemaFromConfig = (
  config: unknown
): Record<string, unknown> | null => {
  const validation = validateComposeTextConfig(config);
  if (!validation.ok) return null;

  const properties = Object.fromEntries(
    validation.outputs.map((output) => [
      output.stableKey,
      {
        type: 'string',
        description: output.label,
      },
    ])
  );

  return {
    type: 'object',
    properties,
    required: validation.outputs.map((output) => output.stableKey),
    additionalProperties: false,
  };
};

const wrapWithMark = (value: string, mark: Exclude<TemplateTextMark, 'link'>): string => {
  if (!value) return value;
  if (mark === 'code') return `\`${value}\``;
  if (mark === 'bold') return `**${value}**`;
  return `_${value}_`;
};

const renderInlineText = (node: TemplateTextNode): string => {
  let content = node.text.replace(/\n/g, '  \n');
  const marks = new Set(node.marks ?? []);

  for (const mark of MARK_ORDER) {
    if (marks.has(mark)) {
      content = wrapWithMark(content, mark);
    }
  }

  if (marks.has('link') && node.href) {
    content = `[${content}](${node.href})`;
  }

  return content;
};

const stringifyReferenceValue = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value);
  }
  return JSON.stringify(value);
};

const resolveReferenceValue = async (
  path: string,
  expressionContext: ExpressionContext | undefined
): Promise<unknown> => {
  if (!expressionContext) return undefined;
  const normalizedPath = path.replace(/\[(\d+)\]/g, '.$1');
  const parts = normalizedPath.split('.').filter(Boolean);
  if (parts.length === 0) return undefined;

  let current: unknown = expressionContext[parts[0]];
  for (let index = 1; index < parts.length; index += 1) {
    const segment = parts[index];
    if (current === null || current === undefined) {
      return undefined;
    }
    if (Array.isArray(current) && /^\d+$/u.test(segment)) {
      current = current[Number(segment)];
      continue;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
};

const renderInlineNodes = async (
  children: TemplateInlineNode[],
  options: { expressionContext?: ExpressionContext; outputKey: string }
): Promise<string> => {
  const rendered: string[] = [];

  for (const child of children) {
    if (child.type === 'text') {
      rendered.push(renderInlineText(child));
      continue;
    }

    const resolved = await resolveReferenceValue(child.path, options.expressionContext);
    if (resolved === undefined) {
      throw {
        category: 'ValidationError',
        code: 'MISSING_REFERENCE',
        message: `Compose Text output "${options.outputKey}" is missing reference "${child.path}".`,
        details: {
          outputKey: options.outputKey,
          referencePath: child.path,
          referenceLabel: child.label,
        },
      };
    }
    rendered.push(stringifyReferenceValue(resolved));
  }

  return rendered.join('');
};

const renderCodeFence = (text: string): string => {
  const fence = text.includes('```') ? '````' : '```';
  return `${fence}\n${text}\n${fence}`;
};

const prefixMultiline = (value: string, prefix: string): string =>
  value
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');

export const renderTemplateDocumentToMarkdown = async (
  document: TemplateDocument,
  options: { expressionContext?: ExpressionContext; outputKey: string }
): Promise<string> => {
  const renderedBlocks: string[] = [];

  for (let index = 0; index < document.blocks.length; index += 1) {
    const block = document.blocks[index];

    if (block.type === 'bullet_list_item' || block.type === 'ordered_list_item') {
      const listLines: string[] = [];
      let counter = 1;
      let cursor = index;
      while (cursor < document.blocks.length && document.blocks[cursor]?.type === block.type) {
        const current = document.blocks[cursor] as Extract<TemplateBlock, { type: 'bullet_list_item' | 'ordered_list_item' }>;
        const line = await renderInlineNodes(current.children, options);
        listLines.push(block.type === 'bullet_list_item' ? `- ${line}` : `${counter}. ${line}`);
        cursor += 1;
        counter += 1;
      }
      renderedBlocks.push(listLines.join('\n'));
      index = cursor - 1;
      continue;
    }

    if (block.type === 'code_block') {
      renderedBlocks.push(renderCodeFence(block.text));
      continue;
    }

    const inline = await renderInlineNodes(block.children, options);
    if (block.type === 'paragraph') {
      renderedBlocks.push(inline);
      continue;
    }
    if (block.type === 'heading') {
      renderedBlocks.push(`${'#'.repeat(block.level)} ${inline}`);
      continue;
    }
    if (block.type === 'blockquote') {
      renderedBlocks.push(prefixMultiline(inline, '> '));
    }
  }

  return renderedBlocks.join('\n\n');
};

export const renderComposeTextOutputs = async (
  config: unknown,
  expressionContext?: ExpressionContext
): Promise<Record<string, string>> => {
  const validation = validateComposeTextConfig(config);
  if (validation.ok === false) {
    throw {
      category: 'ValidationError',
      code: 'INVALID_COMPOSE_TEXT_CONFIG',
      message: validation.errors[0] ?? 'Compose Text config is invalid.',
      details: { errors: validation.errors },
    };
  }

  const result: Record<string, string> = {};
  for (const output of validation.outputs) {
    result[output.stableKey] = await renderTemplateDocumentToMarkdown(output.document, {
      expressionContext,
      outputKey: output.stableKey,
    });
  }
  return result;
};
