/**
 * Seat authority: what a co-managed seat technician may touch, as a built-in rule resolver of the
 * authorization kernel.
 *
 * A seat technician is an internal user of the sponsor (MSP) tenant, so nothing about the user row
 * separates them from MSP staff. What does is a `co_managed_seat_assignments` row carrying their
 * user id. The resolver's class is every user who has such a row in ANY state: a technician whose
 * seat was revoked, or whose arrangement ended, stays in the class and is granted nothing, rather
 * than falling out of it and becoming an ordinary internal user.
 * Before writing an assignment's user id, retainBuiltinResolverSubject must run in the same
 * transaction. The assignment's foreign key enforces this membership index, so native tenant
 * probes can skip the feature tables without ever overlooking a technician.
 *
 * The baseline is closed. `SEAT_AUTHORITY_POLICY` is the whole of a seat subject's authority: a
 * resource type or action it does not grant is denied, including one added to the kernel later.
 * The rules live in this file. They are not bundle rules, so the policy service neither lists nor
 * edits them, and a bundle assigned to a technician can only narrow further.
 *
 * Nothing is cached. The assignment, its arrangement, the board scope and the project grants are
 * read with the subject on every request (see `BuiltinResolverFactSource`), so a revocation or a
 * scope change decides the technician's next request.
 *
 * Registration is a side effect of importing this module; `./capability`, which every process
 * boots through, imports it.
 */
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { matchRulesForAction } from '@alga-psa/authorization/kernel/actionAliases';
import { registerBuiltinRuleResolver, type BuiltinResolverRule, type BuiltinRuleResolver } from '@alga-psa/authorization/kernel/builtinRuleResolvers';
import type { AuthorizationSubject } from '@alga-psa/authorization/kernel/contracts';
import { builtinResolverSubjectsQuery } from '@alga-psa/authorization/subject/resolverSubjects';

export const CO_MANAGED_SEAT_RESOLVER_ID = 'co-managed-seat';

/** One condition a record must meet. Every condition listed for an action must hold. */
export type CoManagedSeatCondition =
  /** The record belongs to the client the technician's arrangement is for. */
  | 'own_client'
  /** The record is on a board in the arrangement's scope. */
  | 'in_scope_board'
  /** The record is on a board in scope that also admits creation. */
  | 'creatable_board'
  /** The record is a project shared with the arrangement. */
  | 'shared_project'
  /** The record is marked client-visible. */
  | 'client_visible';

export type CoManagedSeatResourcePolicy =
  /** The resource type is closed to seat subjects; the string says why. */
  | { denied: string }
  /** The actions granted, each with its conditions. An action that is not listed is denied. */
  | { granted: Readonly<Record<string, readonly CoManagedSeatCondition[]>> };

/**
 * Every resource type of the kernel catalog, classified for seat subjects. The resolver's rules are
 * derived from this table and from nothing else, and the contract test fails when a catalog
 * resource type is missing from it.
 */
export const SEAT_AUTHORITY_POLICY: Readonly<Record<string, CoManagedSeatResourcePolicy>> = Object.freeze({
  ticket: { granted: {
    read: ['own_client', 'in_scope_board'],
    create: ['own_client', 'creatable_board'],
    update: ['own_client', 'in_scope_board'],
  } },
  project: { granted: {
    read: ['own_client', 'shared_project'],
    update: ['own_client', 'shared_project'],
  } },
  document: { granted: {
    read: ['own_client', 'client_visible'],
    create: ['own_client'],
  } },
  time_entry: { granted: {
    read: ['own_client'], create: ['own_client'], update: ['own_client'], delete: ['own_client'],
  } },
  asset: { granted: { read: ['own_client'] } },
  tag: { granted: { read: ['own_client'] } },
  client: { granted: { read: ['own_client'] } },
  contact: { granted: { read: ['own_client'] } },
  billing: { denied: 'Commercial data is never available to a seat technician.' },
  interaction: { denied: 'Interactions are the MSP\'s own record of a client and are outside the operational surface.' },
  schedule_entry: { denied: 'A seat technician is not scheduled or dispatched by the MSP.' },
});

/** Catalog resource types the seat policy neither grants nor lists as denied. Empty when the policy is complete. */
export function unclassifiedSeatResourceTypes(
  catalog: readonly string[],
  policy: Readonly<Record<string, CoManagedSeatResourcePolicy>> = SEAT_AUTHORITY_POLICY,
): string[] {
  return catalog.filter((resource) => {
    const entry = Object.prototype.hasOwnProperty.call(policy, resource) ? policy[resource] : undefined;
    if (!entry) return true;
    return 'denied' in entry ? !entry.denied : Object.keys(entry.granted).length === 0;
  });
}

/** What a seat subject's live assignment gives them. */
export interface CoManagedSeatScope {
  arrangementId: string;
  clientId: string;
  /** Boards whose tickets the technician may work. */
  boardIds: string[];
  /** The subset of `boardIds` the technician may create tickets on. */
  creatableBoardIds: string[];
  /** Projects shared with the arrangement. */
  projectIds: string[];
}

/** A seat subject as resolved for one request. `scope` is null when no live assignment grants anything. */
export interface CoManagedSeatAuthority {
  scope: CoManagedSeatScope | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const rows = (value: unknown): Array<Record<string, unknown>> | null =>
  Array.isArray(value) && value.every(isRecord) ? value : null;
const id = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);

/**
 * The seat authority of a subject, from the facts loaded with it. Null when the subject is not a
 * seat subject. Facts that are present but cannot be read make the subject a seat subject with no
 * scope: when in doubt, deny.
 */
export function coManagedSeatAuthority(subject: Pick<AuthorizationSubject, 'resolverFacts'>): CoManagedSeatAuthority | null {
  const facts = subject.resolverFacts?.[CO_MANAGED_SEAT_RESOLVER_ID];
  if (facts === undefined || facts === null) return null;

  const assignments = isRecord(facts) ? rows(facts.assignments) : null;
  const arrangements = isRecord(facts) ? rows(facts.arrangements) : null;
  const boards = isRecord(facts) ? rows(facts.boards) : null;
  const projects = isRecord(facts) ? rows(facts.projects) : null;
  if (!assignments || !arrangements || !boards || !projects) return { scope: null };
  if (assignments.length === 0) return null;

  // A user holds at most one live assignment. More than one cannot be trusted, so none is used.
  const live = assignments.filter((assignment) => assignment.state === 'active');
  if (live.length !== 1) return { scope: null };
  const arrangementId = id(live[0].arrangement_id);
  const arrangement = arrangements.find((row) => row.arrangement_id === arrangementId);
  const clientId = id(arrangement?.client_id);
  if (!arrangementId || !clientId || arrangement?.state !== 'active') return { scope: null };

  const inArrangement = (row: Record<string, unknown>) => row.arrangement_id === arrangementId;
  const scopedBoards = boards.filter(inArrangement);
  const ids = (list: Array<Record<string, unknown>>, key: string) =>
    [...new Set(list.map((row) => id(row[key])).filter((value): value is string => value !== null))].sort();
  return {
    scope: {
      arrangementId,
      clientId,
      boardIds: ids(scopedBoards, 'board_id'),
      creatableBoardIds: ids(scopedBoards.filter((row) => row.can_create === true), 'board_id'),
      projectIds: ids(projects.filter(inArrangement), 'project_id'),
    },
  };
}

/** Whether the subject is governed by the seat resolver (a seat technician, live or not). */
export function isCoManagedSeatSubject(subject: Pick<AuthorizationSubject, 'resolverFacts'>): boolean {
  return coManagedSeatAuthority(subject) !== null;
}

function conditionRule(resource: string, action: string, condition: CoManagedSeatCondition, scope: CoManagedSeatScope): BuiltinResolverRule {
  const rule = { id: `seat:${resource}:${action}:${condition}`, resource, action };
  switch (condition) {
    case 'own_client': return { ...rule, templateKey: 'selected_clients', selectedClientIds: [scope.clientId] };
    case 'in_scope_board': return { ...rule, templateKey: 'selected_boards', selectedBoardIds: scope.boardIds };
    case 'creatable_board': return { ...rule, templateKey: 'selected_boards', selectedBoardIds: scope.creatableBoardIds };
    case 'shared_project': return { ...rule, templateKey: 'selected_records', selectedRecordIds: scope.projectIds };
    case 'client_visible': return { ...rule, constraintKey: 'client_visible_only' };
  }
}

/**
 * The rules of a seat scope, derived from `policy`. `actions` is the kernel's action catalog: the
 * kernel lets a rule for one action stand in for another (`delete` falls back to `update`), so an
 * action the policy does not grant, but which would inherit a granted one, gets a rule no record
 * satisfies. A resource type the policy denies gets no rule and is closed by the baseline.
 */
export function coManagedSeatRules(
  scope: CoManagedSeatScope,
  actions: readonly string[],
  policy: Readonly<Record<string, CoManagedSeatResourcePolicy>> = SEAT_AUTHORITY_POLICY,
): BuiltinResolverRule[] {
  const rules: BuiltinResolverRule[] = [];
  for (const [resource, entry] of Object.entries(policy)) {
    if (!('granted' in entry)) continue;
    const granted = Object.entries(entry.granted).flatMap(([action, conditions]) =>
      conditions.map((condition) => conditionRule(resource, action, condition, scope)));
    rules.push(...granted);
    for (const action of actions) {
      if (action in entry.granted || matchRulesForAction(granted, resource, action).length === 0) continue;
      rules.push({ id: `seat:${resource}:${action}:not_granted`, resource, action, templateKey: 'selected_records', selectedRecordIds: [] });
    }
  }
  return rules;
}

// The kernel's action catalog (`BUNDLE_RULE_ACTIONS`). Kept as a literal so this module does not load the
// bundle service at boot; the contract test fails if the two lists differ.
export const SEAT_AUTHORITY_ACTIONS = ['read', 'create', 'update', 'delete', 'approve'] as const;

const aggregate = (knex: Knex | Knex.Transaction, query: Knex.QueryBuilder) =>
  knex.select(knex.raw("coalesce(jsonb_agg(facts), '[]'::jsonb)")).from(query.as('facts'));

/**
 * One jsonb value with everything the resolver decides from: the user's assignments in every
 * state, their arrangements, and the board scope and project grants of the live one. Each part is
 * read on its own, so a missing arrangement leaves the assignment visible (and the subject denied)
 * instead of removing the subject from the class.
 */
function seatFactsQuery(knex: Knex | Knex.Transaction, subject: { tenant: string; userId: string }): Knex.QueryBuilder {
  const db = tenantDb(knex, subject.tenant);
  const ofUser = (query: Knex.QueryBuilder, column: string, liveOnly: boolean) => {
    db.tenantJoin(query, 'co_managed_seat_assignments as a', 'a.arrangement_id', column);
    query.where('a.user_id', subject.userId);
    if (liveOnly) query.where('a.state', 'active');
    return query;
  };
  return knex.queryBuilder().select(knex.raw(
    `jsonb_build_object('assignments', (?), 'arrangements', (?), 'boards', (?), 'projects', (?))`,
    [
      aggregate(knex, db.table('co_managed_seat_assignments').where('user_id', subject.userId).select('arrangement_id', 'state')),
      aggregate(knex, ofUser(db.table('co_managed_seat_arrangements as r'), 'r.arrangement_id', false)
        .distinct('r.arrangement_id', 'r.client_id', 'r.state')),
      aggregate(knex, ofUser(db.table('co_managed_seat_board_scopes as s'), 's.arrangement_id', true)
        .select('s.arrangement_id', 's.board_id', 's.can_create')),
      aggregate(knex, ofUser(db.table('co_managed_seat_project_grants as g'), 'g.arrangement_id', true)
        .select('g.arrangement_id', 'g.project_id')),
    ],
  ));
}

export const coManagedSeatResolver: BuiltinRuleResolver = {
  id: CO_MANAGED_SEAT_RESOLVER_ID,
  baseline: 'closed',
  facts: {
    tenantHasSubjects: (knex, tenant) => builtinResolverSubjectsQuery(knex, tenant, CO_MANAGED_SEAT_RESOLVER_ID),
    subjectFacts: seatFactsQuery,
  },
  appliesTo: (input) => isCoManagedSeatSubject(input.subject),
  resolveRules: (input) => {
    const scope = coManagedSeatAuthority(input.subject)?.scope;
    return scope ? coManagedSeatRules(scope, SEAT_AUTHORITY_ACTIONS) : [];
  },
};

/** Idempotent: registering again replaces the earlier registration. */
export function registerCoManagedSeatAuthority(): void {
  registerBuiltinRuleResolver(coManagedSeatResolver);
}

registerCoManagedSeatAuthority();
