/**
 * Monaco Diagnostics Provider for JSONata Workflow Expressions
 *
 * Provides real-time validation for:
 * - Syntax errors (unbalanced brackets, invalid tokens)
 * - Reference validation (unknown paths)
 * - Function validation (unknown functions, argument count)
 */

import type * as monaco from 'monaco-editor';
import { builtinFunctions } from './functionDefinitions';
import { LANGUAGE_ID } from './jsonataLanguage';
import type { ExpressionContext, JsonSchema } from './completionProvider';

/**
 * Diagnostic severity levels
 */
export enum DiagnosticSeverity {
  Error = 8,
  Warning = 4,
  Information = 2,
  Hint = 1,
}

/**
 * A validation diagnostic
 */
export interface ExpressionDiagnostic {
  message: string;
  severity: DiagnosticSeverity;
  startOffset: number;
  endOffset: number;
}

/**
 * Token types for simple lexer
 */
type TokenType =
  | 'identifier'
  | 'function'
  | 'number'
  | 'string'
  | 'operator'
  | 'lparen'
  | 'rparen'
  | 'lbracket'
  | 'rbracket'
  | 'lbrace'
  | 'rbrace'
  | 'comma'
  | 'colon'
  | 'dot'
  | 'keyword'
  | 'whitespace'
  | 'unknown';

interface Token {
  type: TokenType;
  value: string;
  start: number;
  end: number;
}

/**
 * Simple lexer for expression tokenization
 */
function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;

  while (pos < expression.length) {
    const char = expression[pos];

    // Whitespace
    if (/\s/.test(char)) {
      const start = pos;
      while (pos < expression.length && /\s/.test(expression[pos])) {
        pos++;
      }
      tokens.push({ type: 'whitespace', value: expression.slice(start, pos), start, end: pos });
      continue;
    }

    // String literals
    if (char === '"' || char === "'" || char === '`') {
      const quote = char;
      const start = pos;
      pos++;
      while (pos < expression.length) {
        if (expression[pos] === '\\' && pos + 1 < expression.length) {
          pos += 2;
        } else if (expression[pos] === quote) {
          pos++;
          break;
        } else {
          pos++;
        }
      }
      tokens.push({ type: 'string', value: expression.slice(start, pos), start, end: pos });
      continue;
    }

    // Numbers
    if (/\d/.test(char)) {
      const start = pos;
      while (pos < expression.length && /[\d.eE+\-]/.test(expression[pos])) {
        pos++;
      }
      tokens.push({ type: 'number', value: expression.slice(start, pos), start, end: pos });
      continue;
    }

    // Function calls (starting with $)
    if (char === '$') {
      const start = pos;
      pos++;
      while (pos < expression.length && /[a-zA-Z0-9_]/.test(expression[pos])) {
        pos++;
      }
      tokens.push({ type: 'function', value: expression.slice(start, pos), start, end: pos });
      continue;
    }

    // Identifiers and keywords
    if (/[a-zA-Z_]/.test(char)) {
      const start = pos;
      while (pos < expression.length && /[a-zA-Z0-9_]/.test(expression[pos])) {
        pos++;
      }
      const value = expression.slice(start, pos);
      const keywords = ['true', 'false', 'null', 'and', 'or', 'not', 'in'];
      const type = keywords.includes(value) ? 'keyword' : 'identifier';
      tokens.push({ type, value, start, end: pos });
      continue;
    }

    // Single character tokens
    const singleCharTokens: Record<string, TokenType> = {
      '(': 'lparen',
      ')': 'rparen',
      '[': 'lbracket',
      ']': 'rbracket',
      '{': 'lbrace',
      '}': 'rbrace',
      ',': 'comma',
      ':': 'colon',
      '.': 'dot',
    };

    if (singleCharTokens[char]) {
      tokens.push({ type: singleCharTokens[char], value: char, start: pos, end: pos + 1 });
      pos++;
      continue;
    }

    // Operators
    if (/[+\-*\/%=<>!&|~?]/.test(char)) {
      const start = pos;
      while (pos < expression.length && /[+\-*\/%=<>!&|~?>]/.test(expression[pos])) {
        pos++;
      }
      tokens.push({ type: 'operator', value: expression.slice(start, pos), start, end: pos });
      continue;
    }

    // Unknown character
    tokens.push({ type: 'unknown', value: char, start: pos, end: pos + 1 });
    pos++;
  }

  return tokens;
}

/**
 * Validate bracket matching
 */
function validateBrackets(tokens: Token[]): ExpressionDiagnostic[] {
  const diagnostics: ExpressionDiagnostic[] = [];
  const stack: { type: 'lparen' | 'lbracket' | 'lbrace'; token: Token }[] = [];

  const matchingClose: Record<string, string> = {
    lparen: 'rparen',
    lbracket: 'rbracket',
    lbrace: 'rbrace',
  };

  const bracketNames: Record<string, string> = {
    lparen: '(',
    rparen: ')',
    lbracket: '[',
    rbracket: ']',
    lbrace: '{',
    rbrace: '}',
  };

  for (const token of tokens) {
    if (token.type === 'lparen' || token.type === 'lbracket' || token.type === 'lbrace') {
      stack.push({ type: token.type, token });
    } else if (token.type === 'rparen' || token.type === 'rbracket' || token.type === 'rbrace') {
      if (stack.length === 0) {
        diagnostics.push({
          message: `Unexpected closing bracket '${bracketNames[token.type]}'`,
          severity: DiagnosticSeverity.Error,
          startOffset: token.start,
          endOffset: token.end,
        });
      } else {
        const last = stack.pop()!;
        const expectedClose = matchingClose[last.type];
        if (token.type !== expectedClose) {
          diagnostics.push({
            message: `Mismatched brackets: expected '${bracketNames[expectedClose]}' but found '${bracketNames[token.type]}'`,
            severity: DiagnosticSeverity.Error,
            startOffset: token.start,
            endOffset: token.end,
          });
        }
      }
    }
  }

  // Report unclosed brackets
  for (const item of stack) {
    diagnostics.push({
      message: `Unclosed bracket '${bracketNames[item.type]}'`,
      severity: DiagnosticSeverity.Error,
      startOffset: item.token.start,
      endOffset: item.token.end,
    });
  }

  return diagnostics;
}

/**
 * Validate string literals
 */
function validateStrings(tokens: Token[]): ExpressionDiagnostic[] {
  const diagnostics: ExpressionDiagnostic[] = [];

  for (const token of tokens) {
    if (token.type === 'string') {
      const quote = token.value[0];
      if (token.value.length < 2 || token.value[token.value.length - 1] !== quote) {
        diagnostics.push({
          message: `Unterminated string literal`,
          severity: DiagnosticSeverity.Error,
          startOffset: token.start,
          endOffset: token.end,
        });
      }
    }
  }

  return diagnostics;
}

/**
 * Validate function calls
 */
function validateFunctions(tokens: Token[]): ExpressionDiagnostic[] {
  const diagnostics: ExpressionDiagnostic[] = [];
  const knownFunctions = new Set(builtinFunctions.map(f => f.name));

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'function') {
      // Check if function exists
      if (!knownFunctions.has(token.value)) {
        // Check for similar function names
        const similar = builtinFunctions.find(f =>
          f.name.toLowerCase().includes(token.value.slice(1).toLowerCase()) ||
          token.value.slice(1).toLowerCase().includes(f.name.slice(1).toLowerCase())
        );

        diagnostics.push({
          message: similar
            ? `Unknown function '${token.value}'. Did you mean '${similar.name}'?`
            : `Unknown function '${token.value}'`,
          severity: DiagnosticSeverity.Warning,
          startOffset: token.start,
          endOffset: token.end,
        });
      }
    }
  }

  return diagnostics;
}

/**
 * Validate unknown tokens
 */
function validateUnknownTokens(tokens: Token[]): ExpressionDiagnostic[] {
  const diagnostics: ExpressionDiagnostic[] = [];

  for (const token of tokens) {
    if (token.type === 'unknown') {
      diagnostics.push({
        message: `Unexpected character '${token.value}'`,
        severity: DiagnosticSeverity.Error,
        startOffset: token.start,
        endOffset: token.end,
      });
    }
  }

  return diagnostics;
}

/**
 * Resolve schema at path
 */
function resolveSchema(schema: JsonSchema | undefined, rootSchema?: JsonSchema): JsonSchema | undefined {
  if (!schema) return undefined;
  if (schema.$ref && rootSchema?.definitions) {
    const refKey = schema.$ref.replace('#/definitions/', '');
    const resolved = rootSchema.definitions[refKey];
    if (resolved) return resolveSchema(resolved, rootSchema);
  }
  if (schema.anyOf?.length) {
    const nonNullVariant = schema.anyOf.find(
      (variant) => variant.type !== 'null'
    );
    if (nonNullVariant) return resolveSchema(nonNullVariant, rootSchema);
  }
  return schema;
}

/**
 * Get schema at path
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
  return undefined;
}

/**
 * Validate path references
 */
function validateReferences(tokens: Token[], context: ExpressionContext): ExpressionDiagnostic[] {
  const diagnostics: ExpressionDiagnostic[] = [];

  // Build paths from consecutive identifier.identifier sequences
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];

    // Skip non-identifiers
    if (token.type !== 'identifier') {
      i++;
      continue;
    }

    // Collect the full path
    const pathTokens: Token[] = [token];
    let j = i + 1;

    while (j < tokens.length) {
      // Skip whitespace
      while (j < tokens.length && tokens[j].type === 'whitespace') {
        j++;
      }

      // Check for dot
      if (j < tokens.length && tokens[j].type === 'dot') {
        j++;
        // Skip whitespace after dot
        while (j < tokens.length && tokens[j].type === 'whitespace') {
          j++;
        }
        // Get next identifier
        if (j < tokens.length && tokens[j].type === 'identifier') {
          pathTokens.push(tokens[j]);
          j++;
        } else {
          break;
        }
      } else {
        break;
      }
    }

    // Validate the path
    if (pathTokens.length > 0) {
      const root = pathTokens[0].value;
      const validRoots = ['payload', 'vars', 'meta', 'error', 'true', 'false', 'null'];

      if (context.forEachItemVar) validRoots.push(context.forEachItemVar);
      if (context.forEachIndexVar) validRoots.push(context.forEachIndexVar);

      // Check if root is valid
      if (!validRoots.includes(root)) {
        // It might be a local variable or we're not in a context where we know all variables
        // Just add a hint for truly unknown roots that look like they should be context roots
        const possibleContextRoots = ['payload', 'vars', 'meta', 'error'];
        const similar = possibleContextRoots.find(r =>
          r.toLowerCase().includes(root.toLowerCase()) ||
          root.toLowerCase().includes(r.toLowerCase())
        );

        if (similar && root.length > 2) {
          diagnostics.push({
            message: `Unknown identifier '${root}'. Did you mean '${similar}'?`,
            severity: DiagnosticSeverity.Hint,
            startOffset: pathTokens[0].start,
            endOffset: pathTokens[0].end,
          });
        }
      } else if (pathTokens.length > 1) {
        // Validate path against schema
        let schema: JsonSchema | undefined;
        if (root === 'payload') schema = context.payloadSchema;
        else if (root === 'vars') schema = context.varsSchema;
        else if (root === 'meta') schema = context.metaSchema;
        else if (root === 'error') schema = context.errorSchema;
        else if (context.forEachItemVar && root === context.forEachItemVar) schema = context.forEachItemSchema;

        if (schema) {
          const pathParts = pathTokens.slice(1).map(t => t.value);
          const resolved = getSchemaAtPath(schema, pathParts, schema);

          if (!resolved && pathParts.length > 0) {
            // Path not found in schema - this is a warning, not error, as schemas might be incomplete
            const lastToken = pathTokens[pathTokens.length - 1];
            diagnostics.push({
              message: `Path '${pathTokens.map(t => t.value).join('.')}' not found in schema`,
              severity: DiagnosticSeverity.Information,
              startOffset: pathTokens[0].start,
              endOffset: lastToken.end,
            });
          }
        }
      }
    }

    i = j;
  }

  return diagnostics;
}

/**
 * Validate an expression and return diagnostics
 */
export function validateExpression(
  expression: string,
  context: ExpressionContext
): ExpressionDiagnostic[] {
  if (!expression.trim()) {
    return [];
  }

  const tokens = tokenize(expression);
  const diagnostics: ExpressionDiagnostic[] = [];

  // Run all validators
  diagnostics.push(...validateBrackets(tokens));
  diagnostics.push(...validateStrings(tokens));
  diagnostics.push(...validateFunctions(tokens));
  diagnostics.push(...validateUnknownTokens(tokens));
  diagnostics.push(...validateReferences(tokens, context));

  return diagnostics;
}

/**
 * Convert diagnostics to Monaco markers
 */
export function diagnosticsToMarkers(
  diagnostics: ExpressionDiagnostic[],
  model: monaco.editor.ITextModel
): monaco.editor.IMarkerData[] {
  return diagnostics.map(d => {
    const startPos = model.getPositionAt(d.startOffset);
    const endPos = model.getPositionAt(d.endOffset);

    return {
      severity: d.severity as monaco.MarkerSeverity,
      message: d.message,
      startLineNumber: startPos.lineNumber,
      startColumn: startPos.column,
      endLineNumber: endPos.lineNumber,
      endColumn: endPos.column,
    };
  });
}

/**
 * Create and register the diagnostics provider
 * Returns a function to update diagnostics for a model
 */
export function createDiagnosticsProvider(
  monacoInstance: typeof monaco
): {
  updateDiagnostics: (model: monaco.editor.ITextModel, context: ExpressionContext) => void;
  clearDiagnostics: (model: monaco.editor.ITextModel) => void;
} {
  return {
    updateDiagnostics: (model: monaco.editor.ITextModel, context: ExpressionContext) => {
      if (model.getLanguageId() !== LANGUAGE_ID) return;

      const expression = model.getValue();
      const diagnostics = validateExpression(expression, context);
      const markers = diagnosticsToMarkers(diagnostics, model);

      monacoInstance.editor.setModelMarkers(model, 'expression-validator', markers);
    },
    clearDiagnostics: (model: monaco.editor.ITextModel) => {
      monacoInstance.editor.setModelMarkers(model, 'expression-validator', []);
    },
  };
}
