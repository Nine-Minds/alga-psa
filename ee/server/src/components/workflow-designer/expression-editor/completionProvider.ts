/**
 * Monaco Completion Provider for JSONata Workflow Expressions
 *
 * Provides intelligent autocomplete for:
 * - Context roots (payload, vars, meta, error)
 * - Field paths based on schema
 * - Built-in functions
 * - Operators and keywords
 */

import type * as monaco from 'monaco-editor';
import { builtinFunctions, getFunctionsByCategory } from './functionDefinitions';
import { LANGUAGE_ID } from './jsonataLanguage';

/**
 * JSON Schema type for expression context
 */
export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  $ref?: string;
  definitions?: Record<string, JsonSchema>;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  description?: string;
  title?: string;
  enum?: unknown[];
  const?: unknown;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
}

/**
 * Expression context for autocomplete
 */
export interface ExpressionContext {
  /** Schema for payload fields */
  payloadSchema?: JsonSchema;
  /** Schema for workflow variables */
  varsSchema?: JsonSchema;
  /** Schema for metadata */
  metaSchema?: JsonSchema;
  /** Schema for error object (in catch blocks) */
  errorSchema?: JsonSchema;
  /** ForEach item variable name */
  forEachItemVar?: string;
  /** ForEach item schema */
  forEachItemSchema?: JsonSchema;
  /** ForEach index variable name */
  forEachIndexVar?: string;
  /** Whether currently inside a catch block (show error completions) */
  inCatchBlock?: boolean;
}

/**
 * Extract the path leading up to the current cursor position
 * E.g., "payload.emailData." returns "payload.emailData"
 */
function extractPathBeforeCursor(textBeforeCursor: string): string {
  // Match path segments (identifier.identifier.identifier.)
  const match = textBeforeCursor.match(/([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)\.\s*$/);
  return match ? match[1] : '';
}

/**
 * Check if cursor is after $ for function completions
 */
function isAfterDollar(textBeforeCursor: string): boolean {
  return /\$\s*$/.test(textBeforeCursor);
}

/**
 * Check if cursor is at the start of a new expression (should show context roots)
 */
function isAtExpressionStart(textBeforeCursor: string): boolean {
  const trimmed = textBeforeCursor.trim();
  if (trimmed === '') return true;
  // After operators or opening brackets
  return /[+\-*\/=<>!&|,(\[{:?]\s*$/.test(textBeforeCursor) || /\b(and|or|not|in)\s+$/.test(textBeforeCursor);
}

/**
 * Check if we're typing the first word at the beginning of an expression
 * This catches cases like "p", "pay", "payload" where the user is starting to type
 * a context root or identifier but hasn't completed it yet
 */
function isTypingFirstWord(textBeforeCursor: string): boolean {
  const trimmed = textBeforeCursor.trim();
  // Check if the entire text is just a single word (identifier) being typed
  // This means no operators, dots, brackets, etc. - just letters, numbers, underscores
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed);
}

/**
 * Resolve a JSON Schema, handling $ref and anyOf
 */
function resolveSchema(schema: JsonSchema | undefined, rootSchema?: JsonSchema): JsonSchema | undefined {
  if (!schema) return undefined;

  // Handle $ref
  if (schema.$ref && rootSchema?.definitions) {
    const refKey = schema.$ref.replace('#/definitions/', '');
    const resolved = rootSchema.definitions[refKey];
    if (resolved) return resolveSchema(resolved, rootSchema);
  }

  // Handle anyOf (used for nullable types) - extract non-null variant
  if (schema.anyOf?.length) {
    const nonNullVariant = schema.anyOf.find(
      (variant) => variant.type !== 'null' && !(Array.isArray(variant.type) && variant.type.length === 1 && variant.type[0] === 'null')
    );
    if (nonNullVariant) {
      return resolveSchema(nonNullVariant, rootSchema);
    }
  }

  return schema;
}

/**
 * Get schema at a specific path
 */
function getSchemaAtPath(schema: JsonSchema | undefined, path: string[], rootSchema?: JsonSchema): JsonSchema | undefined {
  if (!schema || path.length === 0) return resolveSchema(schema, rootSchema);

  const resolved = resolveSchema(schema, rootSchema);
  if (!resolved) return undefined;

  const [head, ...rest] = path;

  // Handle object properties
  if (resolved.properties?.[head]) {
    return getSchemaAtPath(resolved.properties[head], rest, rootSchema || schema);
  }

  // Handle array items
  if (resolved.items && !isNaN(Number(head))) {
    return getSchemaAtPath(resolved.items, rest, rootSchema || schema);
  }

  // Handle additionalProperties
  if (resolved.additionalProperties && typeof resolved.additionalProperties === 'object') {
    return getSchemaAtPath(resolved.additionalProperties, rest, rootSchema || schema);
  }

  return undefined;
}

/**
 * Get property completions from a schema
 */
function getPropertyCompletions(
  schema: JsonSchema | undefined,
  monaco: typeof import('monaco-editor'),
  range: monaco.IRange,
  rootSchema?: JsonSchema
): monaco.languages.CompletionItem[] {
  const resolved = resolveSchema(schema, rootSchema);
  if (!resolved?.properties) return [];

  return Object.entries(resolved.properties).map(([key, propSchema]) => {
    const resolvedProp = resolveSchema(propSchema, rootSchema || schema);
    const typeStr = getTypeString(resolvedProp);
    const isRequired = resolved.required?.includes(key);

    return {
      label: key,
      kind: monaco.languages.CompletionItemKind.Property,
      detail: typeStr + (isRequired ? '' : '?'),
      documentation: resolvedProp?.description || resolvedProp?.title,
      insertText: key,
      range,
      sortText: isRequired ? '0' + key : '1' + key,
    };
  });
}

/**
 * Get type string for display
 */
function getTypeString(schema: JsonSchema | undefined): string {
  if (!schema) return 'unknown';
  if (Array.isArray(schema.type)) {
    return schema.type.filter(t => t !== 'null').join(' | ') || 'unknown';
  }
  if (schema.type) return schema.type;
  if (schema.anyOf) return schema.anyOf.map(s => getTypeString(s)).filter(t => t !== 'null').join(' | ');
  if (schema.oneOf) return schema.oneOf.map(s => getTypeString(s)).join(' | ');
  if (schema.enum) return schema.enum.map(v => JSON.stringify(v)).join(' | ');
  return 'unknown';
}

/**
 * Create the completion provider
 * @param monacoInstance - The Monaco instance
 * @param getContext - Function to get context, optionally receiving the model for per-editor context lookup
 */
export function createCompletionProvider(
  monacoInstance: typeof monaco,
  getContext: (model?: monaco.editor.ITextModel) => ExpressionContext
): monaco.languages.CompletionItemProvider {
  return {
    triggerCharacters: ['.', '$', '(', ' '],

    provideCompletionItems: (
      model: monaco.editor.ITextModel,
      position: monaco.Position,
      _context: monaco.languages.CompletionContext,
      _token: monaco.CancellationToken
    ): monaco.languages.ProviderResult<monaco.languages.CompletionList> => {
      const textBeforeCursor = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });

      const wordInfo = model.getWordUntilPosition(position);
      const range: monaco.IRange = {
        startLineNumber: position.lineNumber,
        startColumn: wordInfo.startColumn,
        endLineNumber: position.lineNumber,
        endColumn: wordInfo.endColumn,
      };

      const suggestions: monaco.languages.CompletionItem[] = [];
      const ctx = getContext(model);

      // After $ - suggest functions
      if (isAfterDollar(textBeforeCursor)) {
        suggestions.push(...getFunctionCompletions(monacoInstance, range));
        return { suggestions };
      }

      // After a dot - suggest properties
      const pathBefore = extractPathBeforeCursor(textBeforeCursor);
      if (pathBefore) {
        const pathParts = pathBefore.split('.');
        const root = pathParts[0];
        const restPath = pathParts.slice(1);

        let schema: JsonSchema | undefined;
        if (root === 'payload') schema = ctx.payloadSchema;
        else if (root === 'vars') schema = ctx.varsSchema;
        else if (root === 'meta') schema = ctx.metaSchema;
        else if (root === 'error') schema = ctx.errorSchema;
        else if (ctx.forEachItemVar && root === ctx.forEachItemVar) schema = ctx.forEachItemSchema;

        console.log('[CompletionProvider] Property lookup:', {
          root,
          restPath,
          hasSchema: !!schema,
          schemaHasRef: !!schema?.$ref,
          schemaHasDefinitions: !!schema?.definitions,
          ctxHasPayloadSchema: !!ctx.payloadSchema,
        });

        // Resolve root-level $ref if the schema itself is a reference
        // This handles cases where the schema has { $ref: "#/definitions/...", definitions: {...} }
        if (schema?.$ref && schema?.definitions) {
          const refKey = schema.$ref.replace('#/definitions/', '');
          const resolved = schema.definitions[refKey];
          console.log('[CompletionProvider] Resolving $ref:', { refKey, hasResolved: !!resolved });
          if (resolved) {
            // Keep definitions available for nested refs
            schema = { ...resolved, definitions: schema.definitions };
          }
        }

        console.log('[CompletionProvider] After $ref resolution:', {
          hasSchema: !!schema,
          schemaType: schema?.type,
          schemaProps: schema?.properties ? Object.keys(schema.properties) : null,
        });

        if (schema) {
          const targetSchema = getSchemaAtPath(schema, restPath, schema);
          suggestions.push(...getPropertyCompletions(targetSchema, monacoInstance, range, schema));
        }

        return { suggestions };
      }

      // At expression start OR typing first word - suggest context roots, keywords, and snippets
      // isAtExpressionStart checks for empty/after operators
      // isTypingFirstWord checks if we're typing the first identifier (e.g., "p" or "pay")
      if (isAtExpressionStart(textBeforeCursor) || isTypingFirstWord(textBeforeCursor)) {
        suggestions.push(...getContextRootCompletions(monacoInstance, range, ctx));
        suggestions.push(...getKeywordCompletions(monacoInstance, range));
        suggestions.push(...getSnippetCompletions(monacoInstance, range));
      }

      return { suggestions };
    },
  };
}

/**
 * Get completions for context roots (payload, vars, meta, error)
 */
function getContextRootCompletions(
  monaco: typeof import('monaco-editor'),
  range: monaco.IRange,
  ctx: ExpressionContext
): monaco.languages.CompletionItem[] {
  const items: monaco.languages.CompletionItem[] = [];

  items.push({
    label: 'payload',
    kind: monaco.languages.CompletionItemKind.Variable,
    detail: 'Workflow input data',
    documentation: 'Access the workflow payload (trigger data)',
    insertText: 'payload',
    range,
    sortText: '0payload',
  });

  items.push({
    label: 'vars',
    kind: monaco.languages.CompletionItemKind.Variable,
    detail: 'Workflow variables',
    documentation: 'Access variables set by previous steps',
    insertText: 'vars',
    range,
    sortText: '0vars',
  });

  items.push({
    label: 'meta',
    kind: monaco.languages.CompletionItemKind.Variable,
    detail: 'Workflow metadata',
    documentation: 'Access workflow metadata (state, traceId, etc.)',
    insertText: 'meta',
    range,
    sortText: '1meta',
  });

  if (ctx.inCatchBlock) {
    items.push({
      label: 'error',
      kind: monaco.languages.CompletionItemKind.Variable,
      detail: 'Caught error',
      documentation: 'Access the caught error in a try/catch block',
      insertText: 'error',
      range,
      sortText: '0error',
    });
  }

  // Add forEach item variable if in forEach context
  if (ctx.forEachItemVar) {
    items.push({
      label: ctx.forEachItemVar,
      kind: monaco.languages.CompletionItemKind.Variable,
      detail: 'forEach item',
      documentation: 'Current item in forEach iteration',
      insertText: ctx.forEachItemVar,
      range,
      sortText: '0' + ctx.forEachItemVar,
    });
  }

  // Add forEach index variable if in forEach context
  if (ctx.forEachIndexVar) {
    items.push({
      label: ctx.forEachIndexVar,
      kind: monaco.languages.CompletionItemKind.Variable,
      detail: 'forEach index',
      documentation: 'Current index in forEach iteration',
      insertText: ctx.forEachIndexVar,
      range,
      sortText: '0' + ctx.forEachIndexVar,
    });
  }

  return items;
}

/**
 * Get completions for built-in functions
 */
function getFunctionCompletions(
  monaco: typeof import('monaco-editor'),
  range: monaco.IRange
): monaco.languages.CompletionItem[] {
  const categories = getFunctionsByCategory();
  const items: monaco.languages.CompletionItem[] = [];
  const categoryOrder = ['String', 'Number', 'Array', 'Object', 'Boolean', 'Date', 'Higher-Order', 'Misc'];

  for (const category of categoryOrder) {
    const fns = categories.get(category) || [];
    for (const fn of fns) {
      // Create snippet with placeholders for parameters
      let snippet = fn.name.slice(1) + '('; // Remove $ prefix, add (
      const placeholders = fn.parameters.map((p, i) => `\${${i + 1}:${p.name}}`);
      snippet += placeholders.join(', ') + ')';

      const examples = fn.examples?.join('\n') || '';
      const doc = fn.description + (examples ? '\n\n**Examples:**\n' + examples : '');

      items.push({
        label: fn.name,
        kind: monaco.languages.CompletionItemKind.Function,
        detail: fn.signature,
        documentation: {
          value: doc,
          isTrusted: true,
        },
        insertText: snippet,
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        filterText: fn.name.slice(1), // Remove $ for filtering since Monaco's word doesn't include $
        range,
        sortText: categoryOrder.indexOf(category).toString() + fn.name,
      });
    }
  }

  return items;
}

/**
 * Get completions for keywords (true, false, null, and, or, not, in)
 */
function getKeywordCompletions(
  monaco: typeof import('monaco-editor'),
  range: monaco.IRange
): monaco.languages.CompletionItem[] {
  return [
    {
      label: 'true',
      kind: monaco.languages.CompletionItemKind.Keyword,
      detail: 'Boolean true',
      insertText: 'true',
      range,
      sortText: '2true',
    },
    {
      label: 'false',
      kind: monaco.languages.CompletionItemKind.Keyword,
      detail: 'Boolean false',
      insertText: 'false',
      range,
      sortText: '2false',
    },
    {
      label: 'null',
      kind: monaco.languages.CompletionItemKind.Keyword,
      detail: 'Null value',
      insertText: 'null',
      range,
      sortText: '2null',
    },
    {
      label: 'and',
      kind: monaco.languages.CompletionItemKind.Operator,
      detail: 'Logical AND',
      documentation: 'Logical AND operator: `a and b` returns true if both are truthy',
      insertText: 'and ',
      range,
      sortText: '3and',
    },
    {
      label: 'or',
      kind: monaco.languages.CompletionItemKind.Operator,
      detail: 'Logical OR',
      documentation: 'Logical OR operator: `a or b` returns true if either is truthy',
      insertText: 'or ',
      range,
      sortText: '3or',
    },
    {
      label: 'not',
      kind: monaco.languages.CompletionItemKind.Operator,
      detail: 'Logical NOT',
      documentation: 'Logical NOT operator: `not a` returns true if a is falsy',
      insertText: 'not ',
      range,
      sortText: '3not',
    },
    {
      label: 'in',
      kind: monaco.languages.CompletionItemKind.Operator,
      detail: 'Membership test',
      documentation: 'Membership operator: `a in b` returns true if a is contained in array b',
      insertText: 'in ',
      range,
      sortText: '3in',
    },
  ];
}

/**
 * Get snippet completions for common expression patterns
 */
function getSnippetCompletions(
  monaco: typeof import('monaco-editor'),
  range: monaco.IRange
): monaco.languages.CompletionItem[] {
  return [
    {
      label: 'conditional',
      kind: monaco.languages.CompletionItemKind.Snippet,
      detail: 'Ternary conditional',
      documentation: 'Conditional expression: condition ? trueValue : falseValue',
      insertText: '${1:condition} ? ${2:trueValue} : ${3:falseValue}',
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      range,
      sortText: '4conditional',
    },
    {
      label: 'map',
      kind: monaco.languages.CompletionItemKind.Snippet,
      detail: 'Map array transformation',
      documentation: 'Transform each item in an array using $map function',
      insertText: '\\$map(${1:array}, function(\\$v, \\$i) { ${2:\\$v} })',
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      range,
      sortText: '4map',
    },
    {
      label: 'filter',
      kind: monaco.languages.CompletionItemKind.Snippet,
      detail: 'Filter array',
      documentation: 'Filter array items using $filter function',
      insertText: '\\$filter(${1:array}, function(\\$v) { ${2:\\$v.condition} })',
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      range,
      sortText: '4filter',
    },
    {
      label: 'reduce',
      kind: monaco.languages.CompletionItemKind.Snippet,
      detail: 'Reduce array to value',
      documentation: 'Reduce array to a single value using $reduce function',
      insertText: '\\$reduce(${1:array}, function(\\$acc, \\$v) { ${2:\\$acc + \\$v} }, ${3:0})',
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      range,
      sortText: '4reduce',
    },
    {
      label: 'coalesce',
      kind: monaco.languages.CompletionItemKind.Snippet,
      detail: 'Null coalescing',
      documentation: 'Return first non-null value',
      insertText: '${1:value} ? ${1:value} : ${2:default}',
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      range,
      sortText: '4coalesce',
    },
    {
      label: 'exists',
      kind: monaco.languages.CompletionItemKind.Snippet,
      detail: 'Check if value exists',
      documentation: 'Check if a value is defined and not null',
      insertText: '\\$exists(${1:value})',
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      range,
      sortText: '4exists',
    },
    {
      label: 'string-template',
      kind: monaco.languages.CompletionItemKind.Snippet,
      detail: 'String concatenation',
      documentation: 'Concatenate strings and values',
      insertText: '"${1:text}" & ${2:value} & "${3:more text}"',
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      range,
      sortText: '4string-template',
    },
    {
      label: 'array-index',
      kind: monaco.languages.CompletionItemKind.Snippet,
      detail: 'Access array element',
      documentation: 'Access an element in an array by index',
      insertText: '${1:array}[${2:0}]',
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      range,
      sortText: '4array-index',
    },
    {
      label: 'array-filter-expr',
      kind: monaco.languages.CompletionItemKind.Snippet,
      detail: 'Filter array with expression',
      documentation: 'Filter array using predicate expression',
      insertText: '${1:array}[${2:condition}]',
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      range,
      sortText: '4array-filter-expr',
    },
    {
      label: 'object-construct',
      kind: monaco.languages.CompletionItemKind.Snippet,
      detail: 'Construct object',
      documentation: 'Create a new object literal',
      insertText: '{ "${1:key}": ${2:value} }',
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      range,
      sortText: '4object-construct',
    },
    {
      label: 'date-now',
      kind: monaco.languages.CompletionItemKind.Snippet,
      detail: 'Current timestamp',
      documentation: 'Get current date/time as ISO string',
      insertText: '\\$now()',
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      range,
      sortText: '4date-now',
    },
  ];
}

/**
 * Register the completion provider with Monaco
 * @param monacoInstance - The Monaco instance
 * @param getContext - Function to get context, receives the model for per-editor context lookup
 */
export function registerCompletionProvider(
  monacoInstance: typeof monaco,
  getContext: (model?: monaco.editor.ITextModel) => ExpressionContext
): monaco.IDisposable {
  return monacoInstance.languages.registerCompletionItemProvider(
    LANGUAGE_ID,
    createCompletionProvider(monacoInstance, getContext)
  );
}
