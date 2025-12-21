import type { Expr } from '../types';
import type { ExpressionContext } from '../expressionEngine';
import { compileExpression } from '../expressionEngine';

export async function resolveExpressions(value: unknown, ctx: ExpressionContext): Promise<unknown> {
  if (isExpr(value)) {
    const compiled = compileExpression(value);
    try {
      return await compiled.evaluate(ctx);
    } catch (error) {
      throw { category: 'ExpressionError', message: error instanceof Error ? error.message : String(error) };
    }
  }
  if (Array.isArray(value)) {
    const resolved: unknown[] = [];
    for (const item of value) {
      resolved.push(await resolveExpressions(item, ctx));
    }
    return resolved;
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = await resolveExpressions(val, ctx);
    }
    return result;
  }
  return value;
}

export function isExpr(value: unknown): value is Expr {
  return !!value && typeof value === 'object' && '$expr' in (value as Record<string, unknown>);
}
