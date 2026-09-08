import type { TemplateAst } from '@alga-psa/types';
import type { TemplateEvaluationResult } from './evaluator';

export const EMPTY_REPEAT_SCOPE = Symbol('empty repeated collection');

/** Resolve declared aliases against the current repeated row before global bindings.
 * Keep invalid values distinct from empty collections so every surface can report them.
 */
export function resolveEvaluatedCollection(
  ast: TemplateAst,
  evaluation: TemplateEvaluationResult,
  bindingId: string,
  scope?: Record<string, unknown>,
): { rows: Record<string, unknown>[]; diagnostic?: string } {
  if ((scope as Record<symbol, unknown> | undefined)?.[EMPTY_REPEAT_SCOPE]) return { rows: [] };
  const collections = ast.bindings?.collections ?? {};
  const path = collections[bindingId]?.path ?? bindingId;
  const segments = path.split('.');
  let value: unknown;
  if (scope && Object.prototype.hasOwnProperty.call(scope, segments[0])) {
    value = scope;
    for (const segment of segments) {
      value = value && typeof value === 'object' ? (value as Record<string, unknown>)[segment] : undefined;
    }
  } else {
    const declaredId = Object.entries(collections).find(([, binding]) => binding.path === bindingId)?.[0];
    value = Object.prototype.hasOwnProperty.call(evaluation.bindings, bindingId)
      ? evaluation.bindings[bindingId]
      : declaredId ? evaluation.bindings[declaredId] : undefined;
  }
  if (!Array.isArray(value)) return { rows: [], diagnostic: `Collection "${bindingId}" (path "${path}") is missing or is not an array.` };
  return { rows: value.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row)) };
}
