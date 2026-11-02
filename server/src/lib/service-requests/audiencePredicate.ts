import { evaluatePredicate, isPredicateGroup, predicateGroupSchema, validatePredicate } from '@alga-psa/predicates';
import type { PredicateClause, PredicateGroup, PredicateNode } from '@alga-psa/predicates';
import { audienceSchema } from './audienceSchema';

export const EVERYONE_PREDICATE: PredicateGroup = { join: 'and', clauses: [] };

/** Checks the editor's shape in addition to the shared predicate and query schemas. */
export function isEditorAudience(value: unknown): value is PredicateGroup {
  const parsed = predicateGroupSchema.safeParse(value);
  if (!parsed.success || validatePredicate(audienceSchema, parsed.data).length) return false;
  const group = parsed.data;
  if (group.join === 'and') return group.clauses.length === 0;
  const isClause = (node: PredicateNode): node is PredicateClause => {
    if (isPredicateGroup(node) || node.operator !== 'in' || !Array.isArray(node.value) || !node.value.length) return false;
    if (!['client.id', 'client.tags', 'contact.id', 'contact.tags', 'contact.group.id'].includes(node.path)) return false;
    return node.path !== 'client.id' || node.value.length === 1;
  };
  return group.clauses.every((entry) => {
    if (!isPredicateGroup(entry)) return isClause(entry);
    return entry.join === 'and' && entry.clauses.length === 2 && isClause(entry.clauses[0]) &&
      isClause(entry.clauses[1]) && (entry.clauses[1] as PredicateClause).path === 'contact.tags';
  });
}

/** Invalid persisted predicates fail closed, including valid JSON with unsupported paths. */
export function isAudienceSatisfied(audience: unknown, requester: unknown): boolean {
  const parsed = predicateGroupSchema.safeParse(audience);
  if (!parsed.success || validatePredicate(audienceSchema, parsed.data).length) {
    console.error('Invalid service request audience');
    return false;
  }
  return evaluatePredicate(parsed.data, requester);
}
