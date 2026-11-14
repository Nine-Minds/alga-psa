import type { Knex } from 'knex';
import type { AuthorizationEvaluationInput, AuthorizationSubject, RelationshipTemplateKey, ScopeConstraint } from './contracts';
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
  /** Record guard. Only `client_visible_only` is evaluated for resolver rules (JS and SQL). */
  constraintKey?: 'client_visible_only' | null;
  constraints?: ScopeConstraint[];
  selectedClientIds?: string[];
  selectedBoardIds?: string[];
  selectedRecordIds?: string[];
}

/**
 * Where a resolver's per-request facts come from. The kernel never queries the database while it evaluates,
 * and `appliesTo`/`resolveRules` are synchronous, so a resolver whose class or rules depend on rows declares
 * the two reads here and subject resolution runs them: the result arrives as `subject.resolverFacts[id]`.
 *
 * Both are composed into statements subject resolution already issues or gates on, so a tenant with no
 * subject of the class pays no extra statement. A failed load propagates like every other subject load: no
 * subject, no decision, no access.
 */
export interface BuiltinResolverFactSource {
  /** Rows that exist only when the tenant has at least one subject of the class; wrapped in EXISTS in the tenant probe. */
  tenantHasSubjects(knex: Knex | Knex.Transaction, tenant: string): Knex.QueryBuilder;
  /** A single-row, single-column query yielding the subject's facts as one jsonb value. */
  subjectFacts(knex: Knex | Knex.Transaction, subject: Pick<AuthorizationSubject, 'tenant' | 'userId'>): Knex.QueryBuilder;
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
  /** Per-request facts the class or the rules are derived from. Absent for a resolver that needs only the subject. */
  facts?: BuiltinResolverFactSource;
  /** Rules for a subject in the class. Not called for subjects outside it. */
  resolveRules(input: AuthorizationEvaluationInput): BuiltinResolverRule[];
  /**
   * Fields of `input.resource.type` that are closed to a subject in the class, as source column names
   * (`purchase_cost`, `client_billing_profiles.name`). Not called for subjects outside it.
   * Two consumers: the kernel adds them to every decision's `redactedFields`, so each record projection hides
   * them; and a read path asks `builtinClosedFields` before it builds its query, so a closed column is never
   * selected (and a table joined only for it is never joined). Redaction after the query is the safety net,
   * not the mechanism.
   */
  closedFields?(input: AuthorizationEvaluationInput): readonly string[];
  /**
   * Named operations on `input.resource.type` that are closed to a subject in the class: things a resource's
   * reads do not cover and no kernel action names (opening a remote session, running a script). An operation
   * that is not listed is open; the action layer asks `isBuiltinOperationClosed` before it does the work.
   */
  closedOperations?(input: AuthorizationEvaluationInput): readonly string[];
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

/** Registered resolvers that declare a fact source, in id order. */
export function builtinResolverFactSources(): Array<{ id: string; facts: BuiltinResolverFactSource }> {
  return [...store().values()]
    .filter((resolver): resolver is BuiltinRuleResolver & { facts: BuiltinResolverFactSource } => Boolean(resolver.facts))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((resolver) => ({ id: resolver.id, facts: resolver.facts }));
}

/** Whether some registered resolver has no fact source, so nothing can say a tenant has none of its subjects. */
export function hasBuiltinRuleResolversWithoutFactSource(): boolean {
  return [...store().values()].some((resolver) => !resolver.facts);
}

/**
 * Whether some fact source says the tenant has a subject of its class, as a boolean scalar expression to select
 * (the fact sources' `tenantHasSubjects`, OR-ed). Null when no registered resolver has a fact source. It visits
 * only what `tenantHasSubjects` names, never the tables `subjectFacts` reads, so a caller selects it alongside a
 * statement it already issues and reads the facts only when it is not false.
 */
export function builtinResolverSubjectsExistExpression(
  knex: Knex | Knex.Transaction,
  tenant: string
): Knex.Raw | null {
  const sources = builtinResolverFactSources();
  if (sources.length === 0) return null;
  return knex.raw(
    `(${sources.map(() => 'exists(?)').join(' or ')})`,
    sources.map(({ facts }) => facts.tenantHasSubjects(knex, tenant).select(knex.raw('1')))
  );
}

/**
 * One jsonb object of every fact source's facts for the subject, keyed by resolver id, as a scalar expression
 * to select. Null when no registered resolver has a fact source.
 */
export function builtinResolverFactsExpression(
  knex: Knex | Knex.Transaction,
  subject: Pick<AuthorizationSubject, 'tenant' | 'userId'>
): Knex.Raw | null {
  const sources = builtinResolverFactSources();
  if (sources.length === 0) return null;
  return knex.raw(
    `jsonb_build_object(${sources.map(() => '?::text, ?').join(', ')})`,
    sources.flatMap(({ id, facts }) => [id, facts.subjectFacts(knex, subject)])
  );
}

/** Loads every fact source's facts for the subject in one statement. Failures propagate. */
export async function loadBuiltinResolverFacts(
  knex: Knex | Knex.Transaction,
  subject: Pick<AuthorizationSubject, 'tenant' | 'userId'>
): Promise<Record<string, unknown> | undefined> {
  const expression = builtinResolverFactsExpression(knex, subject);
  if (!expression) return undefined;
  const row = await knex.queryBuilder().select(knex.raw('? as facts', [expression])).first<{ facts: Record<string, unknown> | null }>();
  if (!row?.facts || typeof row.facts !== 'object') throw new Error('Built-in resolver facts unavailable');
  return row.facts;
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

/** Fields every applying resolver closes for this subject and resource type, deduplicated. Empty when none applies. */
export function builtinClosedFields(input: AuthorizationEvaluationInput): string[] {
  const resolvers = store();
  if (resolvers.size === 0) return [];
  const fields = new Set<string>();
  for (const resolver of resolvers.values()) {
    if (!resolver.closedFields || !resolver.appliesTo(input)) continue;
    for (const field of resolver.closedFields(input)) fields.add(field);
  }
  return [...fields].sort();
}

/** Whether an applying resolver closes the operation named by `input.resource.action` on `input.resource.type`. */
export function isBuiltinOperationClosed(input: AuthorizationEvaluationInput): boolean {
  for (const resolver of store().values()) {
    if (!resolver.closedOperations || !resolver.appliesTo(input)) continue;
    if (resolver.closedOperations(input).includes(input.resource.action)) return true;
  }
  return false;
}

/** Every operation closed for this subject on `input.resource.type`, for a surface that decides what to render. */
export function builtinClosedOperations(input: AuthorizationEvaluationInput): string[] {
  const operations = new Set<string>();
  for (const resolver of store().values()) {
    if (!resolver.closedOperations || !resolver.appliesTo(input)) continue;
    for (const operation of resolver.closedOperations(input)) operations.add(operation);
  }
  return [...operations].sort();
}

/**
 * Whether a closed-baseline resolver denies this resource action outright for the subject: the resolver is closed
 * and none of its rules names the action (alias-aware). The decision no record can change, which is what a screen
 * needs to decide whether to render a control at all. False for a subject no closed resolver applies to.
 */
export function builtinResolversCloseAction(input: AuthorizationEvaluationInput): boolean {
  return resolveAppliedBuiltinResolvers(input).some(
    (resolver) =>
      resolver.baseline === 'closed' &&
      matchRulesForAction(resolver.rules, input.resource.type, input.resource.action).length === 0
  );
}

/**
 * Whether a registered resolver conceals records it denies: a subject governed by a closed-baseline resolver is
 * told a record it may not read does not exist, instead of that it may not read it, so out-of-scope ids cannot
 * be probed. False for every subject no closed resolver applies to, whose denials read as they always have.
 */
export function builtinResolversConcealDenials(input: AuthorizationEvaluationInput): boolean {
  return resolveAppliedBuiltinResolvers(input).some((resolver) => resolver.baseline === 'closed');
}
