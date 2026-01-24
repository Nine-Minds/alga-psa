import jsonata from 'jsonata';
import type { Expr } from './types';

const MAX_OUTPUT_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 25;

const allowedFunctions = new Set(['nowIso', 'coalesce', 'len', 'toString', 'append']);

export type ExpressionContext = {
  payload?: unknown;
  vars?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  error?: unknown;
  event?: unknown;
  [key: string]: unknown;
};

export type CompiledExpression = {
  evaluate: (ctx: ExpressionContext, timeoutMs?: number) => Promise<unknown>;
  source: string;
};

export function validateExpressionSource(source: string): void {
  const normalizedSource = normalizeExpressionSource(source);
  const functionCalls = extractFunctionCalls(normalizedSource);
  for (const fn of functionCalls) {
    const normalizedFn = fn.startsWith('$') ? fn.slice(1) : fn;
    if (!allowedFunctions.has(normalizedFn)) {
      throw new Error(`Expression uses disallowed function: ${normalizedFn}`);
    }
  }
  const expr = jsonata(normalizedSource);
  // Access AST to ensure parse happens now; jsonata throws on invalid syntax
  expr.ast();
}

export function compileExpression(expr: Expr): CompiledExpression {
  const normalizedSource = normalizeExpressionSource(expr.$expr);
  validateExpressionSource(normalizedSource);
  const compiled = jsonata(normalizedSource);
  compiled.registerFunction('nowIso', () => new Date().toISOString());
  compiled.registerFunction('coalesce', (...args: unknown[]) => {
    for (const arg of args) {
      if (arg !== null && arg !== undefined) return arg;
    }
    return null;
  });
  compiled.registerFunction('len', (value: unknown) => {
    if (typeof value === 'string' || Array.isArray(value)) {
      return value.length;
    }
    return 0;
  });
  compiled.registerFunction('toString', (value: unknown) => {
    if (value === null || value === undefined) return '';
    return String(value);
  });
  compiled.registerFunction('append', (list: unknown, value: unknown) => {
    const base = Array.isArray(list) ? list : list === null || list === undefined ? [] : [list];
    const toAdd = Array.isArray(value) ? value : [value];
    return base.concat(toAdd);
  });

  return {
    source: expr.$expr,
    evaluate: async (ctx: ExpressionContext, timeoutMs?: number) => {
      const start = Date.now();
      const result = await Promise.resolve(compiled.evaluate(ctx));
      const duration = Date.now() - start;
      if (duration > (timeoutMs ?? DEFAULT_TIMEOUT_MS)) {
        throw new Error(`Expression evaluation exceeded ${timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`);
      }
      if (!isJsonSerializable(result)) {
        throw new Error('Expression result is not JSON-serializable');
      }
      let serialized: string;
      try {
        serialized = JSON.stringify(result) ?? '';
      } catch (error) {
        throw new Error('Expression result is not JSON-serializable');
      }
      if (!serialized && serialized !== '') {
        throw new Error('Expression result is not JSON-serializable');
      }
      if (serialized && serialized.length > MAX_OUTPUT_BYTES) {
        throw new Error('Expression result exceeded max output size');
      }
      return result;
    }
  };
}

function normalizeExpressionSource(source: string): string {
  return source.replace(
    /(^|[^.$A-Za-z0-9_])([A-Za-z_][A-Za-z0-9_]*)(?=\s*\()/g,
    (match, prefix, name: string) => {
      if (!allowedFunctions.has(name)) {
        return match;
      }
      return `${prefix}$${name}`;
    }
  );
}

function extractFunctionCalls(source: string): string[] {
  const calls: string[] = [];
  const regex = /([A-Za-z_$][A-Za-z0-9_]*)\s*\(/g;
  let match;
  while ((match = regex.exec(source)) !== null) {
    calls.push(match[1]);
  }
  return calls;
}

function isJsonSerializable(value: unknown): boolean {
  if (value === undefined) return false;
  const valueType = typeof value;
  if (valueType === 'function' || valueType === 'symbol' || valueType === 'bigint') return false;
  if (value === null) return true;
  if (Array.isArray(value)) {
    return value.every((item) => isJsonSerializable(item));
  }
  if (valueType === 'object') {
    if (value instanceof Date) return true;
    return Object.values(value as Record<string, unknown>).every((item) => isJsonSerializable(item));
  }
  return true;
}
