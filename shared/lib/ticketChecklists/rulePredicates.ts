import { isPredicateGroup, predicateGroupSchema, validateClause } from '@alga-psa/predicates';
import type { PredicateGroup, PredicateNode } from '@alga-psa/predicates';
import { ticketQuerySchema } from '../ticketQuery/ticketQuerySchema';

export const CHECKLIST_RULE_WHERE_VERSION = 1;
export const emptyChecklistWhere = (): PredicateGroup => ({ join: 'and', clauses: [] });

export class UnsupportedRuleVersionError extends Error {
  constructor(version: unknown) {
    super(`Unsupported checklist rule version: ${String(version)}`);
    this.name = 'UnsupportedRuleVersionError';
  }
}

export class ChecklistRuleValidationError extends Error {
  constructor(
    message: string,
    readonly clientId?: string
  ) {
    super(message);
    this.name = 'ChecklistRuleValidationError';
  }
}

/** The persisted format has no legacy fallback. Validate every leaf, including nested groups. */
export function readChecklistWhere(where: unknown, version: unknown): PredicateGroup {
  if (version !== CHECKLIST_RULE_WHERE_VERSION) throw new UnsupportedRuleVersionError(version);
  const parsed = predicateGroupSchema.safeParse(where);
  if (!parsed.success)
    throw new ChecklistRuleValidationError(parsed.error.issues.map((issue) => issue.message).join('; '));
  function validate(node: PredicateNode): void {
    if (isPredicateGroup(node)) node.clauses.forEach(validate);
    else {
      const issue = validateClause(ticketQuerySchema, node);
      if (issue) throw new ChecklistRuleValidationError(issue.message);
    }
  }
  validate(parsed.data);
  return parsed.data;
}

/**
 * Ownership is enforced separately at apply time. Substitute owner-only client clauses with TRUE,
 * then simplify Boolean groups (removing a TRUE child from OR would change its meaning).
 */
export function checklistWhereForOwner(where: PredicateGroup, owner: string | null): PredicateGroup {
  if (!owner) return where;
  function simplify(node: PredicateNode): PredicateNode | true | false {
    if (!isPredicateGroup(node)) {
      if (node.path !== 'client.id') return node;
      const values = Array.isArray(node.value) ? node.value : [node.value];
      const other = values.find((value) => typeof value === 'string' && value !== owner);
      if (typeof other === 'string') {
        throw new ChecklistRuleValidationError(
          `Client ${other} is outside this template's ownership.`,
          other
        );
      }
      return values.length > 0 && values.every((value) => value === owner) ? true : node;
    }
    const children = node.clauses.map(simplify);
    const absorbing = node.join === 'and' ? false : true;
    if (children.includes(absorbing)) return absorbing;
    const clauses = children.filter((child): child is PredicateNode => typeof child !== 'boolean');
    return clauses.length ? { join: node.join, clauses } : node.join === 'and';
  }
  const normalized = simplify(where);
  return typeof normalized === 'boolean'
    ? { join: normalized ? 'and' : 'or', clauses: [] }
    : isPredicateGroup(normalized)
      ? normalized
      : { join: 'and', clauses: [normalized] };
}

export function checklistWhereTagIds(where: PredicateGroup): string[] {
  const ids = new Set<string>();
  function visit(node: PredicateNode): void {
    if (isPredicateGroup(node)) node.clauses.forEach(visit);
    else if (node.path === 'client.tags' || node.path === 'contact.tags') {
      if (Array.isArray(node.value))
        node.value.forEach((value) => {
          if (typeof value === 'string') ids.add(value);
        });
    }
  }
  visit(where);
  return [...ids];
}
