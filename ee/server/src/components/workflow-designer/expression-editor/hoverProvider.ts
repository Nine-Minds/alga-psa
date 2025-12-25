/**
 * Monaco Hover Provider for JSONata Workflow Expressions
 *
 * Provides hover information for:
 * - Context roots (payload, vars, meta, error)
 * - Field paths with type information from schema
 * - Built-in functions with documentation
 * - Operators with descriptions
 */

import type * as monaco from 'monaco-editor';
import { findFunction } from './functionDefinitions';
import { LANGUAGE_ID } from './jsonataLanguage';
import type { ExpressionContext, JsonSchema } from './completionProvider';

const helperFunctionDocs: Record<string, { signature: string; description: string; parameters: Array<{ name: string; type: string; description: string; optional?: boolean }>; returnType: string; examples?: string[] }> = {
  coalesce: {
    signature: 'coalesce(value1, value2, ...)',
    description: 'Returns the first non-null, non-undefined value.',
    parameters: [
      { name: 'value1', type: 'any', description: 'First candidate value' },
      { name: 'value2', type: 'any', description: 'Fallback value' },
      { name: '...', type: 'any', description: 'Additional fallbacks', optional: true },
    ],
    returnType: 'any',
    examples: ['coalesce(payload.name, "Unknown")'],
  },
  nowIso: {
    signature: 'nowIso()',
    description: 'Returns the current timestamp as an ISO string.',
    parameters: [],
    returnType: 'string',
    examples: ['nowIso()'],
  },
  len: {
    signature: 'len(value)',
    description: 'Returns the length of a string or array.',
    parameters: [
      { name: 'value', type: 'string | array', description: 'Value to measure' },
    ],
    returnType: 'number',
    examples: ['len(payload.items)'],
  },
  toString: {
    signature: 'toString(value)',
    description: 'Converts a value to its string representation.',
    parameters: [
      { name: 'value', type: 'any', description: 'Value to convert' },
    ],
    returnType: 'string',
    examples: ['toString(payload.count)'],
  },
  append: {
    signature: 'append(array, items)',
    description: 'Returns a new array with items appended to the end.',
    parameters: [
      { name: 'array', type: 'array', description: 'Base array' },
      { name: 'items', type: 'array', description: 'Items to append' },
    ],
    returnType: 'array',
    examples: ['append(coalesce(vars.items, []), [payload.item])'],
  },
};

/**
 * Extract the word/path at a given position
 */
function getWordAtPosition(
  model: monaco.editor.ITextModel,
  position: monaco.Position
): { word: string; startColumn: number; endColumn: number } | null {
  const line = model.getLineContent(position.lineNumber);
  const column = position.column - 1; // 0-based

  // Find word boundaries including dots for paths
  let start = column;
  let end = column;

  // Expand left
  while (start > 0 && /[a-zA-Z0-9_.$]/.test(line[start - 1])) {
    start--;
  }

  // Expand right
  while (end < line.length && /[a-zA-Z0-9_]/.test(line[end])) {
    end++;
  }

  if (start === end) return null;

  return {
    word: line.slice(start, end),
    startColumn: start + 1,
    endColumn: end + 1,
  };
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

  // Handle anyOf (used for nullable types)
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

  if (resolved.properties?.[head]) {
    return getSchemaAtPath(resolved.properties[head], rest, rootSchema || schema);
  }

  if (resolved.items && !isNaN(Number(head))) {
    return getSchemaAtPath(resolved.items, rest, rootSchema || schema);
  }

  if (resolved.additionalProperties && typeof resolved.additionalProperties === 'object') {
    return getSchemaAtPath(resolved.additionalProperties, rest, rootSchema || schema);
  }

  return undefined;
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
 * Format schema as markdown for hover display
 */
function formatSchemaHover(path: string, schema: JsonSchema | undefined): string {
  if (!schema) {
    return `**${path}**: \`unknown\``;
  }

  const resolved = resolveSchema(schema, schema);
  const typeStr = getTypeString(resolved);
  const isNullable = Array.isArray(resolved?.type) && resolved.type.includes('null');

  let content = `**${path}**: \`${typeStr}\``;

  if (isNullable) {
    content += ` *(nullable)*`;
  }

  if (resolved?.description) {
    content += `\n\n${resolved.description}`;
  }

  // Show object properties
  if (resolved?.properties) {
    const props = Object.keys(resolved.properties).slice(0, 5);
    if (props.length > 0) {
      content += `\n\n**Properties:** ${props.join(', ')}`;
      if (Object.keys(resolved.properties).length > 5) {
        content += `, ...`;
      }
    }
  }

  // Show array item type
  if (resolved?.items) {
    const itemType = getTypeString(resolved.items);
    content += `\n\n**Items:** \`${itemType}\``;
  }

  // Show enum values
  if (resolved?.enum && resolved.enum.length <= 5) {
    content += `\n\n**Values:** ${resolved.enum.map(v => `\`${JSON.stringify(v)}\``).join(', ')}`;
  }

  return content;
}

/**
 * Get hover content for context roots
 */
function getContextRootHover(root: string, ctx: ExpressionContext): string | null {
  switch (root) {
    case 'payload':
      return `**payload**: \`object\`\n\nWorkflow input data (trigger payload).\n\nAccess fields with dot notation: \`payload.fieldName\``;
    case 'vars':
      return `**vars**: \`object\`\n\nWorkflow variables set by previous steps.\n\nEach step with \`saveAs\` creates a variable accessible here.`;
    case 'meta':
      return `**meta**: \`object\`\n\nWorkflow metadata.\n\n**Properties:**\n- \`state\`: Current workflow state\n- \`traceId\`: Trace identifier\n- \`tags\`: Workflow tags`;
    case 'error':
      if (!ctx.inCatchBlock) {
        return `**error**: \`object\` *(only available in catch blocks)*\n\nThe caught error object.`;
      }
      return `**error**: \`object\`\n\nThe caught error.\n\n**Properties:**\n- \`name\`: Error name\n- \`message\`: Error message\n- \`stack\`: Stack trace\n- \`nodePath\`: Location in workflow`;
    default:
      // Check for forEach item variable
      if (ctx.forEachItemVar && root === ctx.forEachItemVar) {
        const itemType = ctx.forEachItemSchema ? getTypeString(ctx.forEachItemSchema) : 'unknown';
        return `**${root}**: \`${itemType}\`\n\nCurrent item in forEach loop.`;
      }
      if (ctx.forEachIndexVar && root === ctx.forEachIndexVar) {
        return `**${root}**: \`number\`\n\nCurrent index in forEach loop (0-based).`;
      }
      return null;
  }
}

/**
 * Create the hover provider
 */
export function createHoverProvider(
  monacoInstance: typeof monaco,
  getContext: () => ExpressionContext
): monaco.languages.HoverProvider {
  return {
    provideHover: (
      model: monaco.editor.ITextModel,
      position: monaco.Position,
      _token: monaco.CancellationToken
    ): monaco.languages.ProviderResult<monaco.languages.Hover> => {
      const wordInfo = getWordAtPosition(model, position);
      if (!wordInfo) return null;

      const { word, startColumn, endColumn } = wordInfo;
      const ctx = getContext();

      const range: monaco.IRange = {
        startLineNumber: position.lineNumber,
        startColumn,
        endLineNumber: position.lineNumber,
        endColumn,
      };

      // Check if it's a function call
      if (word.startsWith('$')) {
        const fn = findFunction(word);
        if (fn) {
          const examples = fn.examples?.map(e => `  ${e}`).join('\n') || '';
          const content = [
            `**${fn.name}**`,
            '',
            '```',
            fn.signature,
            '```',
            '',
            fn.description,
            '',
            fn.parameters.length > 0 ? '**Parameters:**' : '',
            ...fn.parameters.map(p => `- \`${p.name}\`: ${p.type}${p.optional ? ' *(optional)*' : ''} - ${p.description}`),
            '',
            `**Returns:** \`${fn.returnType}\``,
            examples ? `\n**Examples:**\n\`\`\`\n${examples}\n\`\`\`` : '',
          ].filter(Boolean).join('\n');

          return {
            range,
            contents: [{ value: content }],
          };
        }
      }

      // Check for helper functions (non-$)
      const helperDoc = helperFunctionDocs[word];
      if (helperDoc) {
        const examples = helperDoc.examples?.map(e => `  ${e}`).join('\n') || '';
        const content = [
          `**${word}**`,
          '',
          '```',
          helperDoc.signature,
          '```',
          '',
          helperDoc.description,
          '',
          helperDoc.parameters.length > 0 ? '**Parameters:**' : '',
          ...helperDoc.parameters.map(p => `- \`${p.name}\`: ${p.type}${p.optional ? ' *(optional)*' : ''} - ${p.description}`),
          '',
          `**Returns:** \`${helperDoc.returnType}\``,
          examples ? `\n**Examples:**\n\`\`\`\n${examples}\n\`\`\`` : '',
        ].filter(Boolean).join('\n');

        return {
          range,
          contents: [{ value: content }],
        };
      }

      // Check for context root
      const parts = word.split('.');
      const root = parts[0];

      // Check if it's just the root
      if (parts.length === 1) {
        const rootHover = getContextRootHover(root, ctx);
        if (rootHover) {
          return {
            range,
            contents: [{ value: rootHover }],
          };
        }
      }

      // Check for path into schema
      let schema: JsonSchema | undefined;
      if (root === 'payload') schema = ctx.payloadSchema;
      else if (root === 'vars') schema = ctx.varsSchema;
      else if (root === 'meta') schema = ctx.metaSchema;
      else if (root === 'error') schema = ctx.errorSchema;
      else if (ctx.forEachItemVar && root === ctx.forEachItemVar) schema = ctx.forEachItemSchema;

      if (schema) {
        const restPath = parts.slice(1);
        const targetSchema = getSchemaAtPath(schema, restPath, schema);
        const hoverContent = formatSchemaHover(word, targetSchema);
        return {
          range,
          contents: [{ value: hoverContent }],
        };
      }

      // Operator descriptions
      const operatorDocs: Record<string, string> = {
        'and': '**and**\n\nLogical AND operator.\n\n`a and b` returns `true` if both `a` and `b` are truthy.',
        'or': '**or**\n\nLogical OR operator.\n\n`a or b` returns `true` if either `a` or `b` is truthy.',
        'not': '**not**\n\nLogical NOT operator.\n\n`not a` returns `true` if `a` is falsy.',
        'in': '**in**\n\nMembership operator.\n\n`a in b` returns `true` if `a` is contained in array `b`.',
        'true': '**true**\n\nBoolean literal representing truth.',
        'false': '**false**\n\nBoolean literal representing falsehood.',
        'null': '**null**\n\nNull literal representing absence of a value.',
      };

      if (operatorDocs[word]) {
        return {
          range,
          contents: [{ value: operatorDocs[word] }],
        };
      }

      return null;
    },
  };
}

/**
 * Register the hover provider with Monaco
 */
export function registerHoverProvider(
  monacoInstance: typeof monaco,
  getContext: () => ExpressionContext
): monaco.IDisposable {
  return monacoInstance.languages.registerHoverProvider(
    LANGUAGE_ID,
    createHoverProvider(monacoInstance, getContext)
  );
}
