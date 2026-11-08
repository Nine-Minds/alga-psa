import { isPredicateGroup, type PredicateLiteral, type PredicateNode } from './types';

/** References include negative comparisons: deleting a referenced value changes their meaning too. */
export function predicateReferencesValue(node: PredicateNode, path: string, value: PredicateLiteral): boolean {
  if (isPredicateGroup(node)) return node.clauses.some((child) => predicateReferencesValue(child, path, value));
  return node.path === path && (Array.isArray(node.value) ? node.value.includes(value) : node.value === value);
}
