import type { AuthorizationEvaluationInput, RelationshipTemplateKey, ScopeConstraint } from './contracts';
import { matchRulesForAction } from './actionAliases';

/**
 * Registry of package-registered built-in rule resolvers (F012).
 *
 * A package registers a resolver for a class of subjects. For subjects in the class the resolver supplies
 * built-in narrowing rules. They live in code, never in the database: the bundle service neither lists, returns
 * nor edits them, and they are never merged into the bundle rule list the closed-baseline derivation sees.
 *
 * Semantics (all decisions are deliberate and tested):
 * - Order: resolver rules are evaluated by the built-in provider, which the engine runs before the bundle
 *   provider. They narrow first; a bundle cannot widen what a resolver narrowed (scopes intersect).
 * - Combination with the provider's other built-in rules (the default, a static `relationshipRules`, or a
 *   caller-supplied `resolveRelationshipRules`): resolver results are INTERSECTED with them, never substituted
 *   for them. A resolver therefore cannot widen what the default gives a client user.
 * - Several resolvers matching one subject: all compose (intersect). Each one's denial is reported.
 * - Re-registering an id REPLACES the earlier entry; it never stacks.
 * - With nothing registered, or no resolver applying, the provider returns exactly what it returned before.
 */
export interface BuiltinResolverRule {
  id: string;
  resource: string;
  action: string;
  /** Relationship template that must hold for a record (AND semantics, as for bundle rules). */
  templateKey?: RelationshipTemplateKey | null;
  constraints?: ScopeConstraint[];
  selectedClientIds?: string[];
  selectedBoardIds?: string[];
}

export interface BuiltinRuleResolver {
  /** Unique, stable id. Appears as the `sourceId` of every reason the resolver produces. */
  id: string;
  /**
   * 'closed': a subject in the class is denied every resource/action the resolver's rules do not name
   * (alias-aware). Absent means 'open'.
   */
  baseline?: 'open' | 'closed';
  /**
   * Whether the subject belongs to this resolver's class. It must depend only on the subject (and optionally
   * the resource/action): the SQL path calls it with a record-less input.
   */
  appliesTo(input: AuthorizationEvaluationInput): boolean;
  /** Rules for a subject in the class. Not called for subjects outside it. */
  resolveRules(input: AuthorizationEvaluationInput): BuiltinResolverRule[];
}

/** A resolver's rules for one subject, stamped with the resolver that supplied them. */
export interface AppliedBuiltinResolver {
  id: string;
  baseline: 'open' | 'closed';
  rules: Array<BuiltinResolverRule & { resolverId: string }>;
}

// Keyed on globalThis so duplicated module instances (dev HMR, split bundles) share one registry.
const STORE_KEY = Symbol.for('alga.authorization.builtinRuleResolvers');
function store(): Map<string, BuiltinRuleResolver> {
  const holder = globalThis as unknown as Record<symbol, Map<string, BuiltinRuleResolver> | undefined>;
  return (holder[STORE_KEY] ??= new Map());
}

/** Idempotent per id: registering an id again replaces the previous resolver. */
export function registerBuiltinRuleResolver(resolver: BuiltinRuleResolver): void {
  if (!resolver.id) throw new Error('A built-in rule resolver needs a non-empty id');
  store().set(resolver.id, resolver);
}

export function unregisterBuiltinRuleResolver(id: string): void {
  store().delete(id);
}

/** Tests only: drop every registration. */
export function resetBuiltinRuleResolversForTests(): void {
  store().clear();
}

export function hasRegisteredBuiltinRuleResolvers(): boolean {
  return store().size > 0;
}

/** Resolvers that apply to this subject, with their rules, in id order (so load order cannot change output). */
export function resolveAppliedBuiltinResolvers(input: AuthorizationEvaluationInput): AppliedBuiltinResolver[] {
  const resolvers = store();
  if (resolvers.size === 0) return [];
  return [...resolvers.values()]
    .filter((resolver) => resolver.appliesTo(input))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((resolver) => ({
      id: resolver.id,
      baseline: resolver.baseline ?? 'open',
      rules: resolver.resolveRules(input).map((rule) => ({ ...rule, resolverId: resolver.id })),
    }));
}

/** Whether a registered resolver restricts this resource and action for the subject (rule names it, or a closed one does not). */
export function builtinResolversRestrict(input: AuthorizationEvaluationInput): boolean {
  return resolveAppliedBuiltinResolvers(input).some(
    (resolver) =>
      resolver.baseline === 'closed' ||
      matchRulesForAction(resolver.rules, input.resource.type, input.resource.action).length > 0
  );
}
