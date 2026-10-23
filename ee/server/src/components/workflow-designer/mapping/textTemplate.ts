import jsonata from 'jsonata';
import type { MappingValue } from '@alga-psa/workflows/runtime';

/**
 * "Text with fields": plain text where `{{payload.x}}` / `{{vars.step.field}}` insert workflow data,
 * e.g. `Follow up with {{vars.client.client.client_name}} by {{payload.endDate}}`.
 *
 * The template is stored in the mapping contract the runtime already understands: text without
 * fields is a plain string, and text with fields compiles to a `&`-joined expression
 * (`"Follow up with " & vars.client.client.client_name & …`). Reading a value back parses that
 * expression shape, so the text editor and the Expression editor always agree.
 *
 * Only placeholders that start with a root the expression can read are fields: the workflow data
 * roots (payload, vars, meta, error, local, system) plus the names in scope where the input is
 * used, such as a loop's item and index. Anything else, such as Send Email's `{{name}}`, stays
 * literal text for the action's own template data to fill in.
 */

/** Names an input's expression can read besides the workflow data roots (loop item, index…). */
export type TextTemplateScope = {
  localNames?: readonly string[];
};

export type TextTemplateSegment =
  | { kind: 'text'; text: string }
  | { kind: 'field'; path: string };

export const WORKFLOW_DATA_ROOTS = ['payload', 'vars', 'meta', 'error', 'local', 'system'] as const;
const PATH_BODY = '(?:\\.[A-Za-z_$][A-Za-z0-9_$]*|\\[-?\\d+\\])*';
const IDENTIFIER = /^\$?[A-Za-z_][A-Za-z0-9_]*$/;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const patternCache = new Map<string, { path: RegExp; placeholder: RegExp }>();
const scopePatterns = (scope?: TextTemplateScope) => {
  const localNames = (scope?.localNames ?? []).filter((name) => IDENTIFIER.test(name));
  const key = localNames.join('|');
  let patterns = patternCache.get(key);
  if (!patterns) {
    const roots = [...WORKFLOW_DATA_ROOTS, ...localNames].map(escapeRegExp).join('|');
    const root = `(?:${roots})`;
    patterns = {
      path: new RegExp(`^${root}${PATH_BODY}$`),
      placeholder: new RegExp(`\\{\\{\\s*(${root}${PATH_BODY})\\s*\\}\\}`, 'g'),
    };
    patternCache.set(key, patterns);
  }
  return patterns;
};

export const isTextTemplateFieldPath = (path: string, scope?: TextTemplateScope): boolean =>
  scopePatterns(scope).path.test(path);

export const parseTextTemplate = (template: string, scope?: TextTemplateScope): TextTemplateSegment[] => {
  const segments: TextTemplateSegment[] = [];
  let lastIndex = 0;
  const placeholder = new RegExp(scopePatterns(scope).placeholder.source, 'g');
  for (const match of template.matchAll(placeholder)) {
    const index = match.index ?? 0;
    if (index > lastIndex) segments.push({ kind: 'text', text: template.slice(lastIndex, index) });
    segments.push({ kind: 'field', path: match[1] });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < template.length) segments.push({ kind: 'text', text: template.slice(lastIndex) });
  return segments;
};

export const textTemplateHasFields = (template: string, scope?: TextTemplateScope): boolean =>
  parseTextTemplate(template, scope).some((segment) => segment.kind === 'field');

/** The mapping value a template is saved as: a plain string, or an expression when it has fields. */
export const compileTextTemplate = (template: string, scope?: TextTemplateScope): MappingValue => {
  const segments = parseTextTemplate(template, scope);
  if (!segments.some((segment) => segment.kind === 'field')) return template;
  const parts = segments
    .filter((segment) => segment.kind === 'field' || segment.text.length > 0)
    .map((segment) => (segment.kind === 'field' ? segment.path : JSON.stringify(segment.text)));
  return { $expr: parts.join(' & ') };
};

type AstNode = {
  type?: string;
  value?: unknown;
  lhs?: AstNode;
  rhs?: AstNode;
  steps?: Array<{ type?: string; value?: unknown; stages?: Array<{ type?: string; expr?: AstNode }> }>;
  expressions?: AstNode[];
};

const pathFromAst = (node: AstNode, scope?: TextTemplateScope): string | null => {
  // A bare JSONata variable such as `$index` reads as a one-segment path.
  if (node.type === 'variable' && typeof node.value === 'string') {
    const name = `$${node.value}`;
    return isTextTemplateFieldPath(name, scope) ? name : null;
  }
  if (node.type !== 'path' || !node.steps?.length) return null;
  let path = '';
  for (const step of node.steps) {
    if (step.type !== 'name' || typeof step.value !== 'string') return null;
    path += path ? `.${step.value}` : step.value;
    for (const stage of step.stages ?? []) {
      if (stage.type !== 'filter' || stage.expr?.type !== 'number') return null;
      path += `[${String(stage.expr.value)}]`;
    }
  }
  return isTextTemplateFieldPath(path, scope) ? path : null;
};

const collectConcatParts = (node: AstNode, into: AstNode[]): void => {
  if (node.type === 'binary' && node.value === '&' && node.lhs && node.rhs) {
    collectConcatParts(node.lhs, into);
    collectConcatParts(node.rhs, into);
    return;
  }
  if (node.type === 'block' && node.expressions?.length === 1) {
    collectConcatParts(node.expressions[0], into);
    return;
  }
  into.push(node);
};

/**
 * The template text for a mapping value, or null when the value isn't text (or is an expression
 * that does more than join text and fields; that one stays in the Expression editor).
 */
export const textTemplateFromValue = (value: MappingValue | undefined, scope?: TextTemplateScope): string | null => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') {
    // Literal text that already looks like a workflow field would be read back as a field.
    return parseTextTemplate(value, scope).some((segment) => segment.kind === 'field') ? null : value;
  }
  if (typeof value !== 'object' || !('$expr' in value)) return null;
  const source = String((value as { $expr?: unknown }).$expr ?? '').trim();
  if (!source) return '';

  let ast: AstNode;
  try {
    ast = jsonata(source).ast() as AstNode;
  } catch {
    return null;
  }
  const parts: AstNode[] = [];
  collectConcatParts(ast, parts);

  let template = '';
  let fieldCount = 0;
  for (const part of parts) {
    if (part.type === 'string' && typeof part.value === 'string') {
      if (parseTextTemplate(part.value, scope).some((segment) => segment.kind === 'field')) return null;
      template += part.value;
      continue;
    }
    const path = pathFromAst(part, scope);
    if (!path) return null;
    template += `{{${path}}}`;
    fieldCount += 1;
  }
  void fieldCount;
  return template;
};

/** Locals the runtime binds inside a For Each (see the runtime's loop lexical scope). */
const LOOP_LOCAL_NAMES = ['item', 'index', 'length', 'isFirst', 'isLast'] as const;

/** The text-template scope for an input: the loop item and loop locals when inside a For Each. */
export const getTextTemplateScope = (
  forEach: { itemVar?: string; indexVar?: string } | undefined
): TextTemplateScope => ({
  localNames: forEach
    ? Array.from(new Set([forEach.itemVar, forEach.indexVar, ...LOOP_LOCAL_NAMES].filter((name): name is string => Boolean(name))))
    : [],
});
