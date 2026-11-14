import type { Knex } from 'knex';
import { isMspPrincipalUserType, type IUserWithRoles } from '@alga-psa/types';
import {
  RequestLocalAuthorizationCache,
  compileResourceReadAuthorizationSql,
  matchRulesForAction,
  type AuthorizationSubject,
  type BundleNarrowingRule,
  type ContactVisibilityScope,
  type RelationshipRule,
} from './kernel/index';
import { probeTenantAuthorizationScope, resolveAuthorizationSubject } from './subject/index';
import { resolveBundleNarrowingRulesForEvaluation } from './bundles/service';
import { createTicketRelationshipSqlAdapter } from './clientScopeSqlAdapters';

/**
 * "The tickets this subject may read", as a predicate that can be ANDed onto any query over `tickets`
 * (a count, a group-by, a sub-select) — the same compiler the ticket list uses, so a count and the list it
 * summarizes cannot describe different sets. Nothing here filters rows after the query.
 *
 * Fails closed: a rule the SQL compiler cannot express, a subject or rules that cannot be resolved, and a
 * caller that is not an MSP principal all narrow to no rows — never to unscoped totals.
 */
export interface TicketReadScope {
  /** True when something narrows ticket reads for this subject (a fail-closed scope is narrowed). */
  readonly narrowed: boolean;
  /** AND the predicate onto `query`; `alias` is the alias the query gives `tickets`. A no-op when not narrowed. */
  apply<T extends Knex.QueryBuilder>(query: T, alias?: string): T;
}

const UNNARROWED: TicketReadScope = Object.freeze({ narrowed: false, apply: <T>(query: T) => query });

const DENY_ALL: TicketReadScope = Object.freeze({
  narrowed: true,
  apply<T extends Knex.QueryBuilder>(query: T): T {
    query.whereRaw('1 = 0');
    return query;
  },
});

/** Rules that only redact fields never narrow rows; the SQL compiler does not model them. */
function rowNarrowingRule(rule: BundleNarrowingRule): BundleNarrowingRule {
  return rule.constraintKey === 'hide_sensitive_fields' ? { ...rule, constraintKey: null } : rule;
}

export interface TicketReadScopeInput {
  subject: AuthorizationSubject;
  /** The subject's `ticket`/`read` bundle rules (the ticket list resolves exactly these). */
  bundleRules: BundleNarrowingRule[];
  /** Client-portal readers only: the built-in contact-visibility narrowing the ticket list applies. */
  builtinRules?: RelationshipRule[];
  selectedBoardIds?: string[];
  contactVisibility?: ContactVisibilityScope | null;
}

/**
 * The scope from rules the caller already resolved (the ticket list holds them in its authorization
 * context), so building it issues no statement. Field-redaction rules narrow rows like any other.
 */
export function createTicketReadScopeFromRules(input: TicketReadScopeInput): TicketReadScope {
  const rules = input.bundleRules.map(rowNarrowingRule);
  const builtinRules = input.builtinRules ?? [];
  if (builtinRules.length === 0 && matchRulesForAction(rules, 'ticket', 'read').length === 0) return UNNARROWED;

  return {
    narrowed: true,
    apply(query, alias = 't') {
      query.andWhere(function narrowToReadableTickets(this: Knex.QueryBuilder) {
        const result = compileResourceReadAuthorizationSql(this, {
          resourceType: 'ticket',
          action: 'read',
          builtinRules,
          bundleRules: rules,
          ctx: {
            subject: input.subject,
            selectedBoardIds: input.selectedBoardIds,
            contactVisibility: input.contactVisibility,
            adapter: createTicketRelationshipSqlAdapter(alias),
          },
        });
        // A rule SQL cannot express must not widen the answer: no rows.
        if (!result.supported) this.whereRaw('1 = 0');
      });
      return query;
    },
  };
}

/**
 * The ticket read scope for an MSP user, for surfaces that are not the ticket list (client and contact
 * screens, dashboards). Fast path: a tenant with no published bundle assignment has nothing that could narrow
 * ticket reads for an internal user, so the subject is never resolved and the query is unchanged — the only
 * statement added is the one probe.
 */
export async function createTicketReadScope(
  conn: Knex | Knex.Transaction,
  tenant: string,
  user: IUserWithRoles,
  requestCache: RequestLocalAuthorizationCache = new RequestLocalAuthorizationCache()
): Promise<TicketReadScope> {
  // These surfaces are MSP screens. A caller that is not an MSP principal has no built-in ticket narrowing
  // modelled here, so it reads nothing rather than everything.
  if (!isMspPrincipalUserType(user.user_type)) return DENY_ALL;

  try {
    // A probe that cannot be trusted reports the slow path, so this never skips rules a tenant has.
    const scope = await probeTenantAuthorizationScope(conn, tenant, requestCache);
    if (!scope.publishedAssignments) return UNNARROWED;

    const subject = await resolveAuthorizationSubject(conn, { tenant, user, requestCache });
    const bundleRules = await resolveBundleNarrowingRulesForEvaluation(conn, {
      subject,
      resource: { type: 'ticket', action: 'read' },
      requestCache,
      knex: conn,
    });
    return createTicketReadScopeFromRules({ subject, bundleRules });
  } catch {
    return DENY_ALL;
  }
}
