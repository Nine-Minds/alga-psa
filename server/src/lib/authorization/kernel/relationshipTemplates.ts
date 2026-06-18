import type { Knex } from 'knex';
import type {
  AuthorizationEvaluationInput,
  AuthorizationSubject,
  RelationshipRule,
  RelationshipTemplateKey,
} from './contracts';
import type { BundleNarrowingRule } from './providers/bundleProvider';

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
  ownerColumn: string;
  clientColumn: string;
  boardColumn: string;
  teamColumn: string;
  /**
   * Column holding a boolean client-visibility flag. When omitted, the
   * `client_visible_only` bundle constraint denies all rows — matching the JS
   * kernel, which denies when `record.is_client_visible !== true` and the
   * resource never exposes that field.
   */
  clientVisibleColumn?: string;
  /**
   * Narrow `builder` to rows assigned to any of `userIds` (the primary assignee
   * column and/or a resource-specific co-assignee relation). Must deny (no rows)
   * when `userIds` is empty.
   */
  applyAssignedUsers(builder: Knex.QueryBuilder, userIds: string[]): void;
}

export interface RelationshipSqlContext {
  subject: AuthorizationSubject;
  selectedClientIds?: string[];
  selectedBoardIds?: string[];
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

interface RelationshipTemplateDef {
  matches(input: AuthorizationEvaluationInput): boolean;
  compileSql(builder: Knex.QueryBuilder, ctx: RelationshipSqlContext): void;
}

const RELATIONSHIP_TEMPLATES: Record<RelationshipTemplateKey, RelationshipTemplateDef> = {
  own: {
    matches: (input) =>
      typeof input.record?.ownerUserId === 'string' && input.record.ownerUserId === input.subject.userId,
    compileSql: (builder, ctx) => {
      builder.where(ctx.adapter.ownerColumn, ctx.subject.userId);
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
      builder
        .where(ctx.adapter.ownerColumn, ctx.subject.userId)
        .orWhere(function orAssigned(this: Knex.QueryBuilder) {
          ctx.adapter.applyAssignedUsers(this, [ctx.subject.userId]);
        });
    },
  },
  own_or_managed: {
    matches: (input) =>
      RELATIONSHIP_TEMPLATES.own.matches(input) || RELATIONSHIP_TEMPLATES.managed.matches(input),
    compileSql: (builder, ctx) => {
      builder
        .where(ctx.adapter.ownerColumn, ctx.subject.userId)
        .orWhere(function orManaged(this: Knex.QueryBuilder) {
          ctx.adapter.applyAssignedUsers(this, ctx.subject.managedUserIds ?? []);
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
      builder.where(ctx.adapter.clientColumn, ctx.subject.clientId);
    },
  },
  client_portfolio: {
    matches: (input) =>
      Boolean(input.record?.clientId && input.subject.portfolioClientIds?.includes(input.record.clientId)),
    compileSql: (builder, ctx) => {
      whereInOrDeny(builder, ctx.adapter.clientColumn, ctx.subject.portfolioClientIds);
    },
  },
  selected_clients: {
    matches: (input) =>
      Boolean(input.record?.clientId && input.selectedClientIds?.includes(input.record.clientId)),
    compileSql: (builder, ctx) => {
      whereInOrDeny(builder, ctx.adapter.clientColumn, ctx.selectedClientIds);
    },
  },
  same_team: {
    matches: (input) => hasIntersection(input.record?.teamIds, input.subject.teamIds),
    compileSql: (builder, ctx) => {
      whereInOrDeny(builder, ctx.adapter.teamColumn, ctx.subject.teamIds);
    },
  },
  selected_boards: {
    matches: (input) =>
      Boolean(input.record?.boardId && input.selectedBoardIds?.includes(input.record.boardId)),
    compileSql: (builder, ctx) => {
      whereInOrDeny(builder, ctx.adapter.boardColumn, ctx.selectedBoardIds);
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

  // `not_self_approver` only constrains mutations; it never denies a read.
  if (rule.constraintKey && rule.constraintKey !== 'not_self_approver') {
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
  const matching = bundleRules.filter((rule) => rule.resource === resourceType && rule.action === action);
  for (const rule of matching) {
    const result = compileBundleRuleSql(builder, rule, ctx);
    if (!result.supported) {
      return result;
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
  return compileBundleReadNarrowingSql(
    builder,
    params.bundleRules,
    params.resourceType,
    params.action,
    params.ctx
  );
}
