import type { Knex } from 'knex';
import type { TenantScopedQuery } from '@alga-psa/db';
import type {
  AuthorizationEvaluationInput,
  ContactVisibilityScope,
  AuthorizationSubject,
  RelationshipRule,
  RelationshipTemplateKey,
} from './contracts';
import type { BundleNarrowingRule } from './providers/bundleProvider';
import { matchRulesForAction } from './actionAliases';
import { closedBundlesNotNaming, closedSourcesNotNaming } from './closedBaseline';
import { resolveAppliedBuiltinResolvers } from './builtinRuleResolvers';
import { compileRecordGuardSql, isRecordGuardKey, type AttachedTicketQuantifier, type TicketScope } from './recordGuards';
import { applyTicketVisibilityFilter, ticketMatchesVisibility } from '../portal/visibility';

// ---------------------------------------------------------------------------
// Shared relationship-template definitions.
//
// Each template is defined ONCE with two facets:
//   - matches(): per-record JS evaluation (used by the kernel to filter
//     already-fetched rows)
//   - compileSql(): emits the equivalent SQL predicate onto a query builder
//     (used to push read-authorization into the database so pagination/count
//     run server-side instead of fetch-all-then-filter-in-JS)
//
// Keeping both facets in a single registry keyed by RelationshipTemplateKey
// makes the two paths impossible to drift: adding a template is a compile error
// until both facets are supplied. The kernel owns template *semantics*; a
// resource supplies its physical columns via RelationshipSqlAdapter.
// ---------------------------------------------------------------------------

function hasIntersection(left: string[] = [], right: string[] = []): boolean {
  if (left.length === 0 || right.length === 0) {
    return false;
  }
  const rightSet = new Set(right);
  return left.some((item) => rightSet.has(item));
}

function uniqueNonEmpty(values: Array<string | null | undefined> | undefined): string[] {
  return Array.from(
    new Set(
      (values ?? []).filter((value): value is string => typeof value === 'string' && value.length > 0)
    )
  );
}

/**
 * Resource-specific physical mapping the SQL compiler needs. The kernel owns the
 * template semantics; the resource supplies the columns/relations they map to.
 */
export interface RelationshipSqlAdapter {
  /** Column holding the record's own id. When omitted, the `selected_records` template denies all rows. */
  idColumn?: string;
  ownerColumn?: string;
  clientColumn?: string;
  boardColumn?: string;
  contactColumn?: string;
  /**
   * Column holding the ticket's billing profile. When omitted, billing-profile
   * grants cannot widen `contact_visibility` (narrower, fail-closed).
   */
  billingProfileColumn?: string;
  /**
   * JSONB column holding the resource's `attributes` object (the watch list is
   * its `watch_list` array). When omitted, the watcher grant cannot widen
   * `contact_visibility` (narrower, fail-closed).
   */
  watchListColumn?: string;
  teamColumn?: string;
  /**
   * Column holding a boolean client-visibility flag. When omitted, the
   * `client_visible_only` bundle constraint denies all rows — matching the JS
   * kernel, which denies when `record.is_client_visible !== true` and the
   * resource never exposes that field.
   */
  clientVisibleColumn?: string;
  /**
   * Column holding the record's audience (`internal` / `client` / `public`). When omitted, the
   * `external_audience_only` record guard denies all rows (fail closed), as the JS guard does for a
   * record that carries no audience.
   */
  audienceColumn?: string;
  /**
   * Narrow `builder` by the tickets a row is attached to. `every`: no attached ticket lies outside `scope`
   * (a row attached to none passes). `some`: at least one attached ticket lies inside it. A ticket is inside
   * when its client AND its board are listed; a ticket with no board is outside. When omitted, the guards
   * that read attachments deny all rows.
   */
  applyAttachedTickets?(builder: Knex.QueryBuilder, scope: TicketScope, quantifier: AttachedTicketQuantifier): void;
  /**
   * Narrow `builder` to rows assigned to any of `userIds` (the primary assignee
   * column and/or a resource-specific co-assignee relation). Must deny (no rows)
   * when `userIds` is empty.
   */
  applyAssignedUsers(builder: Knex.QueryBuilder, userIds: string[]): void;
  /** Optional relationship-backed ownership mapping for resources without a scalar owner column. */
  applyOwnerUsers?(builder: Knex.QueryBuilder, userIds: string[]): void;
  /** Optional relationship-backed team mapping for resources without a scalar team column. */
  applyTeams?(builder: Knex.QueryBuilder, teamIds: string[]): void;
  /**
   * Narrow `builder` to rows whose client is in `clientIds`, for resources with no
   * `clientColumn` (the polymorphic tables; see `polymorphicClientsHook`). Used only
   * when `clientColumn` is absent. Called with an empty set too, so a resource may keep rows
   * that need no client (a user's own client-less rows); the clause it adds for the clients
   * themselves must match nothing when `clientIds` is empty.
   */
  applyClients?(builder: Knex.QueryBuilder, clientIds: string[]): void;
}

export interface RelationshipSqlContext {
  contactVisibility?: ContactVisibilityScope | null;
  subject: AuthorizationSubject;
  selectedClientIds?: string[];
  selectedBoardIds?: string[];
  selectedRecordIds?: string[];
  adapter: RelationshipSqlAdapter;
}

export type RelationshipSqlCompileResult =
  | { supported: true }
  | { supported: false; reason: string };

function deny(builder: Knex.QueryBuilder): void {
  builder.whereRaw('1 = 0');
}

function whereInOrDeny(
  builder: Knex.QueryBuilder,
  column: string,
  values: Array<string | null | undefined> | undefined
): void {
  const normalized = uniqueNonEmpty(values);
  if (normalized.length === 0) {
    deny(builder);
    return;
  }
  builder.whereIn(column, normalized);
}

/**
 * Narrow to rows owned by any of `clientIds`: through the scalar client column when
 * the resource has one, else through its `applyClients` hook, else deny.
 */
function whereClientsOrDeny(
  builder: Knex.QueryBuilder,
  adapter: RelationshipSqlAdapter,
  clientIds: Array<string | null | undefined> | undefined
): void {
  if (adapter.clientColumn) {
    whereInOrDeny(builder, adapter.clientColumn, clientIds);
    return;
  }
  if (!adapter.applyClients) {
    deny(builder);
    return;
  }
  adapter.applyClients(builder, uniqueNonEmpty(clientIds));
}

interface RelationshipTemplateDef {
  matches(input: AuthorizationEvaluationInput): boolean;
  compileSql(builder: Knex.QueryBuilder, ctx: RelationshipSqlContext): void;
}

const RELATIONSHIP_TEMPLATES: Record<RelationshipTemplateKey, RelationshipTemplateDef> = {
  own: {
    matches: (input) =>
      typeof input.record?.ownerUserId === 'string' && input.record.ownerUserId === input.subject.userId,
    compileSql: (builder, ctx) => {
      if (ctx.adapter.applyOwnerUsers) {
        ctx.adapter.applyOwnerUsers(builder, [ctx.subject.userId]);
      } else if (ctx.adapter.ownerColumn) {
        builder.where(ctx.adapter.ownerColumn, ctx.subject.userId);
      } else {
        deny(builder);
      }
    },
  },
  assigned: {
    matches: (input) =>
      Array.isArray(input.record?.assignedUserIds) &&
      input.record.assignedUserIds.includes(input.subject.userId),
    compileSql: (builder, ctx) => {
      ctx.adapter.applyAssignedUsers(builder, [ctx.subject.userId]);
    },
  },
  managed: {
    matches: (input) =>
      Array.isArray(input.record?.assignedUserIds) &&
      hasIntersection(input.record.assignedUserIds, input.subject.managedUserIds),
    compileSql: (builder, ctx) => {
      ctx.adapter.applyAssignedUsers(builder, ctx.subject.managedUserIds ?? []);
    },
  },
  own_or_assigned: {
    matches: (input) =>
      RELATIONSHIP_TEMPLATES.own.matches(input) || RELATIONSHIP_TEMPLATES.assigned.matches(input),
    compileSql: (builder, ctx) => {
      builder.where(function ownOrAssigned(this: Knex.QueryBuilder) {
        if (ctx.adapter.applyOwnerUsers) ctx.adapter.applyOwnerUsers(this, [ctx.subject.userId]);
        else if (ctx.adapter.ownerColumn) this.where(ctx.adapter.ownerColumn, ctx.subject.userId);
        else deny(this);
        this.orWhere(function orAssigned(this: Knex.QueryBuilder) {
          ctx.adapter.applyAssignedUsers(this, [ctx.subject.userId]);
        });
      });
    },
  },
  own_or_managed: {
    matches: (input) =>
      RELATIONSHIP_TEMPLATES.own.matches(input) || RELATIONSHIP_TEMPLATES.managed.matches(input),
    compileSql: (builder, ctx) => {
      builder.where(function ownOrManaged(this: Knex.QueryBuilder) {
        if (ctx.adapter.applyOwnerUsers) ctx.adapter.applyOwnerUsers(this, [ctx.subject.userId]);
        else if (ctx.adapter.ownerColumn) this.where(ctx.adapter.ownerColumn, ctx.subject.userId);
        else deny(this);
        this.orWhere(function orManaged(this: Knex.QueryBuilder) {
          ctx.adapter.applyAssignedUsers(this, ctx.subject.managedUserIds ?? []);
        });
      });
    },
  },
  same_client: {
    matches: (input) =>
      Boolean(
        input.record?.clientId &&
          input.subject.clientId &&
          input.record.clientId === input.subject.clientId
      ),
    compileSql: (builder, ctx) => {
      if (!ctx.subject.clientId) {
        deny(builder);
        return;
      }
      if (ctx.adapter.clientColumn) builder.where(ctx.adapter.clientColumn, ctx.subject.clientId);
      else whereClientsOrDeny(builder, ctx.adapter, [ctx.subject.clientId]);
    },
  },
  client_portfolio: {
    matches: (input) =>
      Boolean(input.record?.clientId && input.subject.portfolioClientIds?.includes(input.record.clientId)),
    compileSql: (builder, ctx) => {
      whereClientsOrDeny(builder, ctx.adapter, ctx.subject.portfolioClientIds);
    },
  },
  selected_clients: {
    matches: (input) =>
      Boolean(input.record?.clientId && input.selectedClientIds?.includes(input.record.clientId)),
    compileSql: (builder, ctx) => {
      whereClientsOrDeny(builder, ctx.adapter, ctx.selectedClientIds);
    },
  },
  same_team: {
    matches: (input) => hasIntersection(input.record?.teamIds, input.subject.teamIds),
    compileSql: (builder, ctx) => {
      if (ctx.adapter.applyTeams) ctx.adapter.applyTeams(builder, ctx.subject.teamIds ?? []);
      else if (ctx.adapter.teamColumn) whereInOrDeny(builder, ctx.adapter.teamColumn, ctx.subject.teamIds);
      else deny(builder);
    },
  },
  // One rule intersects client, board, and contact restrictions. Built-in rules
  // otherwise compose with OR, which would leak sibling tickets if split up.
  contact_visibility: {
    matches: ({ record, contactVisibility: scope }) => ticketMatchesVisibility(record, scope),
    compileSql: (builder, ctx) => {
      const scope = ctx.contactVisibility;
      if (!scope || !scope.clientId) {
        deny(builder);
        return;
      }
      if (!ctx.adapter.clientColumn) {
        deny(builder);
        return;
      }
      builder.where(ctx.adapter.clientColumn, scope.clientId);
      if (scope.effectiveTicketScope === 'contact' && !ctx.adapter.contactColumn) {
        // Contact scope without a contact column cannot be expressed: deny.
        if (scope.visibleBoardIds !== null) {
          if (!ctx.adapter.boardColumn) deny(builder);
          else whereInOrDeny(builder, ctx.adapter.boardColumn, scope.visibleBoardIds);
        }
        deny(builder);
        return;
      }
      if (scope.effectiveTicketScope !== 'client' && scope.effectiveTicketScope !== 'contact') {
        deny(builder);
        return;
      }
      applyTicketVisibilityFilter(builder, scope, {
        boardColumn: ctx.adapter.boardColumn ?? '',
        // Only read under contact scope, which returned above when it is absent.
        contactColumn: ctx.adapter.contactColumn ?? '',
        billingProfileColumn: ctx.adapter.billingProfileColumn,
        watchListColumn: ctx.adapter.watchListColumn,
      });
    },
  },
  selected_boards: {
    matches: (input) =>
      Boolean(input.record?.boardId && input.selectedBoardIds?.includes(input.record.boardId)),
    compileSql: (builder, ctx) => {
      if (!ctx.adapter.boardColumn) { deny(builder); return; }
      whereInOrDeny(builder, ctx.adapter.boardColumn, ctx.selectedBoardIds);
    },
  },
  // The record itself is on an explicit list (a project shared with a seat arrangement, say). An empty list
  // and a resource with no id column both deny.
  selected_records: {
    matches: (input) => Boolean(input.record?.id && input.selectedRecordIds?.includes(input.record.id)),
    compileSql: (builder, ctx) => {
      if (!ctx.adapter.idColumn) { deny(builder); return; }
      whereInOrDeny(builder, ctx.adapter.idColumn, ctx.selectedRecordIds);
    },
  },
};

export function evaluateRelationshipTemplate(
  template: RelationshipTemplateKey,
  input: AuthorizationEvaluationInput
): boolean {
  if (!input.record) {
    return false;
  }
  return RELATIONSHIP_TEMPLATES[template].matches(input);
}

export function compileRelationshipTemplateSql(
  builder: Knex.QueryBuilder,
  template: RelationshipTemplateKey,
  ctx: RelationshipSqlContext
): void {
  RELATIONSHIP_TEMPLATES[template].compileSql(builder, ctx);
}

/**
 * Built-in relationship rules narrow with OR semantics (a row is allowed if ANY
 * rule's template matches); an empty rule set allows all. Mirrors
 * `evaluateRelationshipRules`.
 */
export function compileRelationshipRulesSql(
  builder: Knex.QueryBuilder,
  rules: RelationshipRule[],
  ctx: RelationshipSqlContext
): void {
  if (rules.length === 0) {
    return;
  }
  builder.andWhere(function relationshipGroup(this: Knex.QueryBuilder) {
    rules.forEach((rule, index) => {
      const apply = function templatePredicate(this: Knex.QueryBuilder) {
        compileRelationshipTemplateSql(this, rule.template, ctx);
      };
      if (index === 0) {
        this.where(apply);
      } else {
        this.orWhere(apply);
      }
    });
  });
}

function compileBundleRuleSql(
  builder: Knex.QueryBuilder,
  rule: BundleNarrowingRule,
  ctx: RelationshipSqlContext
): RelationshipSqlCompileResult {
  if (rule.constraintKey === 'client_visible_only') {
    if (ctx.adapter.clientVisibleColumn) {
      builder.where(ctx.adapter.clientVisibleColumn, true);
    } else {
      deny(builder);
    }
    return { supported: true };
  }

  // `not_self_approver` only constrains mutations and `hide_sensitive_fields` only redacts fields of rows
  // the rule already lets through: neither denies a read, so neither stops the rule narrowing in SQL.
  // Redaction is applied afterwards as a projection over the narrowed page (see `projectNarrowedPage`).
  if (
    rule.constraintKey &&
    rule.constraintKey !== 'not_self_approver' &&
    rule.constraintKey !== 'hide_sensitive_fields'
  ) {
    return { supported: false, reason: `unsupported bundle constraint ${rule.constraintKey}` };
  }

  if (!rule.templateKey) {
    return { supported: true };
  }

  const ruleCtx: RelationshipSqlContext = {
    ...ctx,
    selectedClientIds:
      rule.templateKey === 'selected_clients' ? (rule.selectedClientIds ?? []) : ctx.selectedClientIds,
    selectedBoardIds:
      rule.templateKey === 'selected_boards' ? (rule.selectedBoardIds ?? []) : ctx.selectedBoardIds,
    selectedRecordIds:
      rule.templateKey === 'selected_records' ? (rule.selectedRecordIds ?? []) : ctx.selectedRecordIds,
  };

  builder.andWhere(function bundleTemplate(this: Knex.QueryBuilder) {
    compileRelationshipTemplateSql(this, rule.templateKey as RelationshipTemplateKey, ruleCtx);
  });
  return { supported: true };
}

/**
 * Bundle narrowing rules intersect with AND semantics (every matching rule's
 * template must hold). Mirrors `BundleAuthorizationKernelProvider.evaluateNarrowing`
 * for the read path. Returns `{ supported: false }` for any constraint not yet
 * representable in SQL so the caller can fall back to the JS kernel.
 */
export function compileBundleReadNarrowingSql(
  builder: Knex.QueryBuilder,
  bundleRules: BundleNarrowingRule[],
  resourceType: string,
  action: string,
  ctx: RelationshipSqlContext
): RelationshipSqlCompileResult {
  // A closed bundle that does not name this resource and action denies everything: representable in SQL, so
  // it is `supported`, never a fall-back. Mirrors the closed-baseline branch of the bundle provider.
  if (closedBundlesNotNaming(bundleRules, resourceType, action).length > 0) {
    deny(builder);
    return { supported: true };
  }

  const matching = matchRulesForAction(bundleRules, resourceType, action);
  for (const rule of matching) {
    const result = compileBundleRuleSql(builder, rule, ctx);
    if (!result.supported) {
      return result;
    }
  }
  return { supported: true };
}

/**
 * Registered built-in rule resolvers for the subject, as SQL. Mirrors `evaluateBuiltinRuleResolvers`: a closed
 * resolver that does not name this resource and action denies; a named rule's template ANDs in. No resolver
 * registered or applying leaves the builder untouched.
 */
export function compileBuiltinResolverReadNarrowingSql(
  builder: Knex.QueryBuilder,
  resourceType: string,
  action: string,
  ctx: RelationshipSqlContext
): RelationshipSqlCompileResult {
  const applied = resolveAppliedBuiltinResolvers({ subject: ctx.subject, resource: { type: resourceType, action } });
  if (applied.length === 0) return { supported: true };

  const closed = applied.filter((resolver) => resolver.baseline === 'closed');
  if (closedSourcesNotNaming(closed, resourceType, action).length > 0) {
    deny(builder);
    return { supported: true };
  }
  for (const resolver of applied) {
    for (const rule of matchRulesForAction(resolver.rules, resourceType, action)) {
      // A record guard is a resolver-only condition: the bundle compiler never sees one.
      if (isRecordGuardKey(rule.constraintKey)) {
        const guardKey = rule.constraintKey;
        builder.andWhere(function recordGuard(this: Knex.QueryBuilder) {
          compileRecordGuardSql(this, guardKey, rule, ctx);
        });
        continue;
      }
      const result = compileBundleRuleSql(builder, rule, ctx);
      if (!result.supported) return result;
    }
  }
  return { supported: true };
}

export interface ResourceReadAuthorizationSqlParams {
  resourceType: string;
  action: string;
  builtinRules: RelationshipRule[];
  bundleRules: BundleNarrowingRule[];
  ctx: RelationshipSqlContext;
}

/**
 * Compile a complete read-authorization predicate onto `builder`: the built-in
 * relationship rules (OR-group) ANDed with every matching bundle rule. Returns
 * `{ supported: false }` when a rule cannot be represented in SQL — callers
 * MUST then fall back to the JS kernel rather than run the partial query.
 */
export function compileResourceReadAuthorizationSql(
  builder: Knex.QueryBuilder,
  params: ResourceReadAuthorizationSqlParams
): RelationshipSqlCompileResult {
  compileRelationshipRulesSql(builder, params.builtinRules, params.ctx);
  const resolverResult = compileBuiltinResolverReadNarrowingSql(
    builder,
    params.resourceType,
    params.action,
    params.ctx
  );
  if (!resolverResult.supported) return resolverResult;
  return compileBundleReadNarrowingSql(
    builder,
    params.bundleRules,
    params.resourceType,
    params.action,
    params.ctx
  );
}

/**
 * Preferred staged-migration entry point for SQL read authorization.
 *
 * The legacy compiler accepts any Knex builder, which makes tenant scoping a
 * caller convention. This wrapper requires a query created by the DB tenant
 * query helper and verifies it matches the subject before mutating it.
 */
export function compileTenantScopedResourceReadAuthorizationSql(
  query: TenantScopedQuery,
  params: ResourceReadAuthorizationSqlParams
): RelationshipSqlCompileResult {
  if (query.tenant !== params.ctx.subject.tenant) {
    throw new Error(
      `Tenant-scoped authorization query tenant ${query.tenant} does not match subject tenant ${params.ctx.subject.tenant}`
    );
  }

  return compileResourceReadAuthorizationSql(query.builder, params);
}
