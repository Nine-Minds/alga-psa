import jsonata from 'jsonata';
import type { Expr } from './types';

const MAX_OUTPUT_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 25;

const allowedFunctions = new Set(['nowIso', 'coalesce', 'len', 'toString']);

export type ExpressionContext = {
  payload: unknown;
  vars: Record<string, unknown>;
  meta: Record<string, unknown>;
  error?: unknown;
};

export type CompiledExpression = {
  evaluate: (ctx: ExpressionContext, timeoutMs?: number) => Promise<unknown>;
  source: string;
};

export function validateExpressionSource(source: string): void {
  const functionCalls = extractFunctionCalls(source);
  for (const fn of functionCalls) {
    if (!allowedFunctions.has(fn)) {
      throw new Error(`Expression uses disallowed function: ${fn}`);
    }
  }
  const expr = jsonata(source);
  // Access AST to ensure parse happens now; jsonata throws on invalid syntax
  expr.ast();
}

export function compileExpression(expr: Expr): CompiledExpression {
  validateExpressionSource(expr.$expr);
  const compiled = jsonata(expr.$expr);
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

  return {
    source: expr.$expr,
    evaluate: async (ctx: ExpressionContext, timeoutMs?: number) => {
      const start = Date.now();
      const result = await Promise.resolve(compiled.evaluate(ctx));
      const duration = Date.now() - start;
      if (duration > (timeoutMs ?? DEFAULT_TIMEOUT_MS)) {
        throw new Error(`Expression evaluation exceeded ${timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`);
      }
      const serialized = JSON.stringify(result);
      if (serialized && serialized.length > MAX_OUTPUT_BYTES) {
        throw new Error('Expression result exceeded max output size');
      }
      return result;
    }
  };
}

function extractFunctionCalls(source: string): string[] {
  const calls: string[] = [];
  const regex = /([A-Za-z_\\$][A-Za-z0-9_]*)\\s*\\(/g;
  let match;
  while ((match = regex.exec(source)) !== null) {
    calls.push(match[1]);
  }
  return calls;
}
