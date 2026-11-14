import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import knexFactory, { type Knex } from 'knex';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BuiltinAuthorizationKernelProvider, RESOLVER_CLIENT_VISIBLE_ONLY_DENIED_CODE, RESOLVER_CLOSED_BASELINE_DENIED_CODE,
  RESOLVER_TEMPLATE_DENIED_CODE, RESOLVER_RECORD_GUARD_DENIED_CODE, builtinResolversRestrict, compileResourceReadAuthorizationSql, createAuthorizationKernel,
  registerBuiltinRuleResolver, resetBuiltinRuleResolversForTests,
  type AuthorizationDecision, type AuthorizationSubject,
} from '@alga-psa/authorization/kernel';
import { BUNDLE_RULE_ACTIONS, BUNDLE_RULE_RESOURCE_TYPES } from '@alga-psa/authorization/bundles/catalog';
import {
  CO_MANAGED_SEAT_RESOLVER_ID, SEAT_AUTHORITY_ACTIONS, SEAT_AUTHORITY_POLICY, coManagedSeatAuthority, coManagedSeatResolver,
  coManagedSeatRules, isCoManagedSeatSubject, unclassifiedSeatResourceTypes, type CoManagedSeatCondition,
} from '../seatAuthority';

// Slice S11 of the co-managed seat plan: T015 (F026, F027) and T016 (F028, F026).

const OWN = 'client-own';
const OTHER = 'client-other';
const ARRANGEMENT = 'arr-1';
const facts = (over: Record<string, unknown> = {}) => ({
  assignments: [{ arrangement_id: ARRANGEMENT, state: 'active' }],
  arrangements: [{ arrangement_id: ARRANGEMENT, client_id: OWN, state: 'active' }],
  boards: [
    { arrangement_id: ARRANGEMENT, board_id: 'board-create', can_create: true },
    { arrangement_id: ARRANGEMENT, board_id: 'board-work', can_create: false },
  ],
  projects: [{ arrangement_id: ARRANGEMENT, project_id: 'project-shared' }],
  ...over,
});
const subjectWith = (resolverFacts?: Record<string, unknown>): AuthorizationSubject => ({
  tenant: 't1', userId: 'tech-1', userType: 'internal', roleIds: [], teamIds: [], managedUserIds: [], clientId: null,
  portfolioClientIds: [], ...(resolverFacts ? { resolverFacts } : {}),
});
const seat = subjectWith({ [CO_MANAGED_SEAT_RESOLVER_ID]: facts() });
const mspStaff = subjectWith();

// RBAC and the provider's own rules allow everything, so every denial below is the seat resolver's.
const kernel = createAuthorizationKernel({
  builtinProvider: new BuiltinAuthorizationKernelProvider({ relationshipRules: [] }),
  rbacEvaluator: async () => true,
});
const decide = (subject: AuthorizationSubject, resource: string, action: string, record: Record<string, unknown>) =>
  kernel.authorizeResource({ subject, resource: { type: resource, action }, record });

/** A record that meets every condition the policy can ask for. */
const goodRecord = {
  id: 'project-shared', clientId: OWN, boardId: 'board-create', is_client_visible: true, audience: 'client', attachedTickets: [],
};
/** The resource types the seat policy classifies: the bundle catalog, and the kernel types a bundle cannot name. */
const NON_CATALOG_RESOURCES = ['knowledge_base_article', 'credential'] as const;
const SEAT_RESOURCES = [...BUNDLE_RULE_RESOURCE_TYPES, ...NON_CATALOG_RESOURCES];
/** The same record with exactly one condition broken. */
const broken: Record<CoManagedSeatCondition, Record<string, unknown>> = {
  own_client: { ...goodRecord, clientId: OTHER },
  in_scope_board: { ...goodRecord, boardId: 'board-elsewhere' },
  creatable_board: { ...goodRecord, boardId: 'board-work' },
  shared_project: { ...goodRecord, id: 'project-unshared' },
  client_visible: { ...goodRecord, is_client_visible: false },
  external_audience: { ...goodRecord, audience: 'internal' },
  attached_tickets_in_scope: { ...goodRecord, attachedTickets: [{ clientId: OWN, boardId: 'board-elsewhere' }] },
  client_visible_or_in_scope_ticket: { ...goodRecord, is_client_visible: false, attachedTickets: [] },
};
const deniedRuleIds = (decision: AuthorizationDecision) => decision.reasons
  .filter((reason) => reason.code === RESOLVER_TEMPLATE_DENIED_CODE || reason.code === RESOLVER_CLIENT_VISIBLE_ONLY_DENIED_CODE ||
    reason.code === RESOLVER_RECORD_GUARD_DENIED_CODE)
  .flatMap((reason) => reason.metadata?.ruleIds as string[]);
const closedDenial = (decision: AuthorizationDecision) =>
  decision.reasons.find((reason) => reason.code === RESOLVER_CLOSED_BASELINE_DENIED_CODE);

beforeAll(() => {
  resetBuiltinRuleResolversForTests();
  registerBuiltinRuleResolver(coManagedSeatResolver);
});
afterAll(() => resetBuiltinRuleResolversForTests());

describe('T015: a seat subject against every resource type and action in the kernel catalog', () => {
  for (const resource of SEAT_RESOURCES) {
    const entry = SEAT_AUTHORITY_POLICY[resource];
    for (const action of BUNDLE_RULE_ACTIONS) {
      const conditions = 'granted' in entry ? entry.granted[action] : undefined;

      if (conditions) {
        it(`${resource}:${action} is allowed on a record meeting [${conditions.join(', ')}]`, async () => {
          const decision = await decide(seat, resource, action, goodRecord);
          expect(decision.allowed).toBe(true);
          expect(decision.scope.allowAll).toBe(false);
          expect(decision.reasons.some((reason) => reason.sourceType === 'resolver' && reason.sourceId === CO_MANAGED_SEAT_RESOLVER_ID)).toBe(true);
        });
        for (const condition of conditions) {
          it(`${resource}:${action} is denied when ${condition} does not hold, naming that rule`, async () => {
            const decision = await decide(seat, resource, action, broken[condition]);
            expect(decision.allowed).toBe(false);
            // A create is also fenced by the read rule's client condition, under the read rule's id.
            expect(deniedRuleIds(decision).some((id) => id === `seat:${resource}:${action}:${condition}` ||
              (action === 'create' && condition === 'own_client' && id === `seat:${resource}:read:own_client`))).toBe(true);
          });
        }
      } else {
        it(`${resource}:${action} is denied, with the reason`, async () => {
          const decision = await decide(seat, resource, action, goodRecord);
          expect(decision.allowed).toBe(false);
          const closed = closedDenial(decision);
          if (closed) {
            expect(closed).toMatchObject({ stage: 'builtin', sourceType: 'resolver', sourceId: CO_MANAGED_SEAT_RESOLVER_ID,
              metadata: { resource, action } });
          } else {
            // The kernel lets this action inherit a granted one, so the policy's explicit refusal answers instead.
            expect(deniedRuleIds(decision)).toContain(`seat:${resource}:${action}:not_granted`);
          }
        });
      }
    }
  }

  it('own client is a condition of every action the policy grants, except for a resource with no client', () => {
    for (const [resource, entry] of Object.entries(SEAT_AUTHORITY_POLICY)) {
      if (!('granted' in entry)) continue;
      // An article has an audience and no client column: its rule is the audience alone.
      if (resource === 'knowledge_base_article') {
        expect(entry.granted).toEqual({ read: ['external_audience'] });
        continue;
      }
      for (const [action, conditions] of Object.entries(entry.granted)) {
        expect(conditions, `${resource}:${action}`).toContain('own_client');
      }
    }
  });

  it('the named cases: other client, out-of-scope board, unshared project, non-visible document', async () => {
    expect(deniedRuleIds(await decide(seat, 'ticket', 'read', { id: 't', clientId: OTHER, boardId: 'board-work' })))
      .toEqual(['seat:ticket:read:own_client']);
    expect(deniedRuleIds(await decide(seat, 'ticket', 'update', { id: 't', clientId: OWN, boardId: 'board-elsewhere' })))
      .toEqual(['seat:ticket:update:in_scope_board']);
    expect(deniedRuleIds(await decide(seat, 'ticket', 'create', { clientId: OWN, boardId: 'board-work' })))
      .toEqual(['seat:ticket:create:creatable_board']);
    expect(deniedRuleIds(await decide(seat, 'project', 'read', { id: 'project-unshared', clientId: OWN })))
      .toEqual(['seat:project:read:shared_project']);
    expect(deniedRuleIds(await decide(seat, 'document', 'read', { id: 'd', clientId: OWN, is_client_visible: false, attachedTickets: [] })))
      .toEqual(['seat:document:read:client_visible_or_in_scope_ticket']);
    expect((await decide(seat, 'ticket', 'read', { id: 't', clientId: OWN, boardId: 'board-work' })).allowed).toBe(true);
  });

  it('a resource type the kernel does not have yet is denied by the closed baseline', async () => {
    const decision = await decide(seat, 'a_future_resource', 'read', goodRecord);
    expect(decision.allowed).toBe(false);
    expect(decision.scope.denied).toBe(true);
    expect(closedDenial(decision)).toMatchObject({ sourceId: CO_MANAGED_SEAT_RESOLVER_ID, metadata: { resource: 'a_future_resource' } });
  });

  // F027: the scope is whatever the rows say on this request.
  const withoutScope: Array<[string, Record<string, unknown>]> = [
    ['a revoked assignment', facts({ assignments: [{ arrangement_id: ARRANGEMENT, state: 'revoked' }] })],
    ['an assignment that was never activated', facts({ assignments: [{ arrangement_id: ARRANGEMENT, state: 'invited' }] })],
    ['an ended arrangement', facts({ arrangements: [{ arrangement_id: ARRANGEMENT, client_id: OWN, state: 'ended' }] })],
    ['an assignment whose arrangement is missing', facts({ arrangements: [] })],
    ['two live assignments', facts({ assignments: [{ arrangement_id: ARRANGEMENT, state: 'active' }, { arrangement_id: 'arr-2', state: 'active' }] })],
    ['facts that cannot be read', { assignments: 'unexpected' }],
  ];
  for (const [label, seatFacts] of withoutScope) {
    it(`${label} keeps the subject in the class and grants nothing`, async () => {
      const subject = subjectWith({ [CO_MANAGED_SEAT_RESOLVER_ID]: seatFacts });
      expect(isCoManagedSeatSubject(subject)).toBe(true);
      expect(coManagedSeatAuthority(subject)).toEqual({ scope: null });
      for (const resource of [...SEAT_RESOURCES, 'a_future_resource']) {
        for (const action of BUNDLE_RULE_ACTIONS) {
          const decision = await decide(subject, resource, action, goodRecord);
          expect(decision.allowed, `${resource}:${action}`).toBe(false);
          expect(closedDenial(decision), `${resource}:${action}`).toBeTruthy();
        }
      }
    });
  }

  it('a board or project of another arrangement is not in scope', () => {
    const subject = subjectWith({ [CO_MANAGED_SEAT_RESOLVER_ID]: facts({
      boards: [{ arrangement_id: 'arr-2', board_id: 'board-foreign', can_create: true }],
      projects: [{ arrangement_id: 'arr-2', project_id: 'project-foreign' }],
    }) });
    expect(coManagedSeatAuthority(subject)?.scope).toEqual({ arrangementId: ARRANGEMENT, clientId: OWN, boardIds: [], creatableBoardIds: [], projectIds: [] });
  });

  it('an arrangement with no boards and no shared project admits no ticket and no project', async () => {
    const subject = subjectWith({ [CO_MANAGED_SEAT_RESOLVER_ID]: facts({ boards: [], projects: [] }) });
    expect((await decide(subject, 'ticket', 'read', goodRecord)).allowed).toBe(false);
    expect((await decide(subject, 'project', 'read', goodRecord)).allowed).toBe(false);
    expect((await decide(subject, 'asset', 'read', goodRecord)).allowed).toBe(true);
  });

  it('a subject outside the class is decided exactly as with nothing registered', async () => {
    const noSeatRows = subjectWith({ [CO_MANAGED_SEAT_RESOLVER_ID]: facts({ assignments: [], arrangements: [], boards: [], projects: [] }) });
    const cases = [mspStaff, noSeatRows].flatMap((subject) => BUNDLE_RULE_RESOURCE_TYPES.map((resource) =>
      ({ subject, resource: { type: resource, action: 'read' }, record: broken.own_client })));
    const registered = await Promise.all(cases.map((input) => kernel.authorizeResource(input)));
    resetBuiltinRuleResolversForTests();
    const unregistered = await Promise.all(cases.map((input) => kernel.authorizeResource(input)));
    registerBuiltinRuleResolver(coManagedSeatResolver);

    expect(registered).toEqual(unregistered);
    expect(registered.every((decision) => decision.allowed)).toBe(true);
    for (const subject of [mspStaff, noSeatRows]) {
      expect(isCoManagedSeatSubject(subject)).toBe(false);
      expect(builtinResolversRestrict({ subject, resource: { type: 'billing', action: 'read' } })).toBe(false);
    }
  });

  it('list reads are narrowed the same way in SQL', () => {
    const knex = knexFactory({ client: 'pg' });
    // The adapter's ticket hook is the resource's own SQL; here it only shows what it was asked.
    const ticketHook = (builder: Knex.QueryBuilder, scope: { clientIds: string[]; boardIds: string[] }, quantifier: string) =>
      builder.whereRaw(`${quantifier}_tickets_in(?, ?)`, [scope.clientIds.join(','), scope.boardIds.join(',')]);
    const sqlFor = (subject: AuthorizationSubject, resourceType: string, withHooks = true) => {
      const builder = knex('records as r');
      const result = compileResourceReadAuthorizationSql(builder, {
        resourceType, action: 'read', builtinRules: [], bundleRules: [],
        ctx: { subject, adapter: { idColumn: 'r.id', clientColumn: 'r.client_id', boardColumn: 'r.board_id',
          clientVisibleColumn: 'r.is_client_visible', applyAssignedUsers: () => undefined,
          ...(withHooks ? { audienceColumn: 'r.audience', applyAttachedTickets: ticketHook } : {}) } },
      });
      expect(result.supported).toBe(true);
      return builder.toQuery();
    };
    expect(sqlFor(seat, 'ticket')).toBe(`select * from "records" as "r" where ("r"."client_id" in ('${OWN}')) and ("r"."board_id" in ('board-create', 'board-work'))`);
    expect(sqlFor(seat, 'project')).toBe(`select * from "records" as "r" where ("r"."client_id" in ('${OWN}')) and ("r"."id" in ('project-shared'))`);
    // A document: its client, no ticket outside the scope, and client-visible or attached to a ticket inside it.
    expect(sqlFor(seat, 'document')).toBe(`select * from "records" as "r" where ("r"."client_id" in ('${OWN}')) and (every_tickets_in('${OWN}', 'board-create,board-work')) and (("r"."is_client_visible" = true or (some_tickets_in('${OWN}', 'board-create,board-work'))))`);
    // An article: its audience, and nothing else (no client condition).
    expect(sqlFor(seat, 'knowledge_base_article')).toBe(`select * from "records" as "r" where ("r"."audience" in ('client', 'public'))`);
    // A resource that maps neither the audience nor the ticket attachments matches no row: fail closed, as the JS guards do.
    expect(sqlFor(seat, 'knowledge_base_article', false)).toBe('select * from "records" as "r" where (1 = 0)');
    expect(sqlFor(seat, 'credential')).toBe('select * from "records" as "r" where 1 = 0');
    expect(sqlFor(seat, 'billing')).toBe('select * from "records" as "r" where 1 = 0');
    expect(sqlFor(subjectWith({ [CO_MANAGED_SEAT_RESOLVER_ID]: facts({ assignments: [{ arrangement_id: ARRANGEMENT, state: 'revoked' }] }) }), 'ticket'))
      .toBe('select * from "records" as "r" where 1 = 0');
    expect(sqlFor(mspStaff, 'ticket')).toBe('select * from "records" as "r"');
  });
});

describe('T016: the seat policy classifies the whole kernel catalog and is not editable', () => {
  it('every resource type in the kernel catalog is granted by a named rule or listed as denied', () => {
    expect(unclassifiedSeatResourceTypes(BUNDLE_RULE_RESOURCE_TYPES)).toEqual([]);
  });

  it('credentials are an explicit denial: no rule, a stated reason, and every action refused', async () => {
    const entry = SEAT_AUTHORITY_POLICY.credential;
    expect('denied' in entry && entry.denied.length > 0).toBe(true);
    for (const action of ['read', 'create', 'update', 'delete', 'reveal']) {
      const decision = await decide(seat, 'credential', action, { id: 'c', clientId: OWN });
      expect(decision.allowed, action).toBe(false);
      expect(closedDenial(decision), action).toMatchObject({ sourceId: CO_MANAGED_SEAT_RESOLVER_ID, metadata: { resource: 'credential' } });
    }
    expect((await decide(mspStaff, 'credential', 'read', { id: 'c', clientId: OWN })).allowed).toBe(true);
  });

  it('a resource type added to the catalog without classifying it for seat subjects fails the check', () => {
    expect(unclassifiedSeatResourceTypes([...BUNDLE_RULE_RESOURCE_TYPES, 'purchase_order'])).toEqual(['purchase_order']);
    const { asset: _dropped, ...withoutAsset } = SEAT_AUTHORITY_POLICY;
    expect(unclassifiedSeatResourceTypes(BUNDLE_RULE_RESOURCE_TYPES, withoutAsset)).toEqual(['asset']);
    // Neither an empty grant nor an unexplained denial counts as a classification, nor does an inherited key.
    expect(unclassifiedSeatResourceTypes(['ticket', 'billing', 'toString'], { ticket: { granted: {} }, billing: { denied: '' } }))
      .toEqual(['ticket', 'billing', 'toString']);
  });

  it('the policy names no resource type or action the catalog does not have', () => {
    const catalog = new Set<string>(SEAT_RESOURCES);
    expect(Object.keys(SEAT_AUTHORITY_POLICY).filter((resource) => !catalog.has(resource))).toEqual([]);
    expect([...SEAT_AUTHORITY_ACTIONS]).toEqual([...BUNDLE_RULE_ACTIONS]);
    for (const [resource, entry] of Object.entries(SEAT_AUTHORITY_POLICY)) {
      if (!('granted' in entry)) continue;
      for (const action of Object.keys(entry.granted)) expect(BUNDLE_RULE_ACTIONS, resource).toContain(action);
    }
  });

  it('the rules come from the policy table alone: a denied type has none, a granted one only its own', () => {
    const scope = coManagedSeatAuthority(seat)!.scope!;
    const rules = coManagedSeatRules(scope, BUNDLE_RULE_ACTIONS);
    for (const [resource, entry] of Object.entries(SEAT_AUTHORITY_POLICY)) {
      const named = rules.filter((rule) => rule.resource === resource);
      if ('denied' in entry) expect(named, resource).toEqual([]);
      else expect(new Set(named.filter((rule) => !rule.id.endsWith(':not_granted')).map((rule) => rule.action)), resource)
        .toEqual(new Set(Object.keys(entry.granted)));
    }
    expect(rules.every((rule) => Object.prototype.hasOwnProperty.call(SEAT_AUTHORITY_POLICY, rule.resource))).toBe(true);
    expect(coManagedSeatResolver.baseline).toBe('closed');
  });

  it('the policy service lists no seat rule as editable: seat rules are not bundle rules and are frozen in code', () => {
    // Bundle rules are rows of a bundle revision; the policy service lists and edits those and nothing else.
    const rules = coManagedSeatRules(coManagedSeatAuthority(seat)!.scope!, BUNDLE_RULE_ACTIONS);
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule).not.toHaveProperty('bundleId');
      expect(rule).not.toHaveProperty('revisionId');
    }
    expect(Object.isFrozen(SEAT_AUTHORITY_POLICY)).toBe(true);

    const root = resolve(__dirname, '../../../..');
    // The policy service has no path to the resolver registry or to the seat policy...
    for (const file of ['packages/authorization/src/bundles/service.ts', 'server/src/lib/authorization/bundles/service.ts',
      'ee/server/src/lib/actions/auth/authorizationBundleActions.ts']) {
      expect(readFileSync(resolve(root, file), 'utf8'), file)
        .not.toMatch(/seatAuthority|SEAT_AUTHORITY|co-managed-seat|BuiltinRuleResolver|builtinRuleResolvers|resolveAppliedBuiltinResolvers/);
    }
    // ...and the seat resolver never writes the tables that hold editable rules.
    expect(readFileSync(resolve(root, 'packages/co-managed/src/seatAuthority.ts'), 'utf8')).not.toMatch(/authorization_bundle/);
  });
});
