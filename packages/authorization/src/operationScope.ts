import type { Knex } from 'knex';
import { isClientUserType } from '@alga-psa/types';
import {
  RequestLocalAuthorizationCache,
  matchRulesForAction,
  type AuthorizationRequestCache,
} from './kernel';
import { builtinClosedFields, resolveAppliedBuiltinResolvers } from './kernel/builtinRuleResolvers';
import { resolveAuthorizationSubject } from './subject/resolver';
import { probeTenantAuthorizationScope } from './subject/tenantScope';
import { resolveReadableScope } from './subject/readScope';
import type { SubjectUserInput } from './subject/assemble';
import { resolveNarrowedReadScope, applyReadScope } from './readScope';
import type { RelationshipSqlAdapter } from './kernel';

/**
 * "Operation → authorized scope", the one answer a picker or search asks before it builds a query.
 *
 * A picker for an operation must offer only what THAT operation permits: Add Ticket the boards the caller may
 * create on, a filter the boards they may read, an existing ticket's destination the boards an update may leave
 * it on. These are different sets for a subject a built-in rule resolver governs (a co-managed seat technician has
 * read boards, and a subset it may also create on), and a bundle may narrow each of them further.
 *
 * Neutral by construction: a tenant with no published bundle assignment and no built-in resolver subject is
 * answered by the one cached tenant probe and returns `null` (unrestricted) without loading anything. A fault
 * while resolving propagates: a scope that cannot be resolved must not read as "unrestricted".
 */
export type ScopedOperation = 'read' | 'create' | 'update';

export interface OperationScopeInput {
  tenant: string;
  user: SubjectUserInput;
  action: ScopedOperation;
  requestCache?: AuthorizationRequestCache;
}

const intersect = (current: Set<string> | null, next: Iterable<string>): Set<string> => {
  const incoming = new Set(next);
  if (current === null) return incoming;
  return new Set([...current].filter((id) => incoming.has(id)));
};

/**
 * The boards `user` may use for ticket `action`: the built-in resolver's board rules for that action (a seat
 * technician's readable or creatable boards; every rule must hold, so the sets intersect) narrowed by the
 * subject's bundle rules for that action. `null` means no board restriction; `[]` means no board at all (a
 * resolver whose baseline is closed and which grants the action nothing, a revoked seat, for one).
 */
export async function resolveOperationBoardIds(
  conn: Knex | Knex.Transaction,
  input: OperationScopeInput,
): Promise<string[] | null> {
  if (isClientUserType(input.user.user_type)) return null;
  const requestCache = input.requestCache ?? new RequestLocalAuthorizationCache();
  const tenantScope = await probeTenantAuthorizationScope(conn, input.tenant, requestCache);
  if (!tenantScope.publishedAssignments && tenantScope.resolverSubjects === false) return null;

  const subject = await resolveAuthorizationSubject(conn, { tenant: input.tenant, user: input.user, requestCache });
  let allowed: Set<string> | null = null;
  for (const resolver of resolveAppliedBuiltinResolvers({ subject, resource: { type: 'ticket', action: input.action } })) {
    const rules = matchRulesForAction(resolver.rules, 'ticket', input.action);
    if (rules.length === 0) {
      if (resolver.baseline === 'closed') return [];
      continue;
    }
    for (const rule of rules) {
      if (rule.templateKey === 'selected_boards') allowed = intersect(allowed, rule.selectedBoardIds ?? []);
    }
  }

  const bundle = await resolveReadableScope(conn, {
    tenant: input.tenant,
    user: input.user,
    clientResources: [],
    boardResource: 'ticket',
    boardAction: input.action,
    requestCache,
  });
  if (bundle.boardIds !== null) allowed = intersect(allowed, bundle.boardIds);

  return allowed === null ? null : [...allowed].sort();
}

/** Whether `boardId` is one the caller may use for `action`. */
export async function isBoardPermittedFor(
  conn: Knex | Knex.Transaction,
  input: OperationScopeInput & { boardId: string },
): Promise<boolean> {
  const ids = await resolveOperationBoardIds(conn, input);
  return ids === null || ids.includes(input.boardId);
}

/**
 * Narrow `query` to the rows of `resourceType` the caller may read, through the resource's physical mapping.
 * The scope is a predicate on the query itself, so a search, a count and a page all describe the same set; nothing
 * is filtered after the fact. A subject no bundle or resolver narrows leaves the query untouched.
 */
export async function narrowQueryToReadable(
  conn: Knex | Knex.Transaction,
  input: { tenant: string; user: SubjectUserInput; resourceType: string; adapter: RelationshipSqlAdapter; requestCache?: AuthorizationRequestCache },
  query: Knex.QueryBuilder,
): Promise<void> {
  const requestCache = input.requestCache ?? new RequestLocalAuthorizationCache();
  const scope = await resolveNarrowedReadScope(conn, {
    tenant: input.tenant, user: input.user, resourceType: input.resourceType, requestCache,
  });
  if (!scope) return;
  applyReadScope(query, scope, { resourceType: input.resourceType, adapter: input.adapter });
}

/**
 * The source columns a built-in resolver closes for `resourceType` for this caller (a seat technician is never
 * given a project's service, budget or billing profile). Empty for a caller no resolver governs, at no statement
 * beyond the cached tenant probe. A read path leaves these columns out of what it returns.
 */
export async function resolveClosedFields(
  conn: Knex | Knex.Transaction,
  input: { tenant: string; user: SubjectUserInput; resourceType: string; requestCache?: AuthorizationRequestCache },
): Promise<string[]> {
  if (isClientUserType(input.user.user_type)) return [];
  const requestCache = input.requestCache ?? new RequestLocalAuthorizationCache();
  const tenantScope = await probeTenantAuthorizationScope(conn, input.tenant, requestCache);
  if (tenantScope.resolverSubjects === false) return [];
  const subject = await resolveAuthorizationSubject(conn, { tenant: input.tenant, user: input.user, requestCache });
  return builtinClosedFields({ subject, resource: { type: input.resourceType, action: 'read' } });
}
