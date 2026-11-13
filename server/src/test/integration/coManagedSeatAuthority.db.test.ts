/**
 * Co-managed seat and workspace shapes, slice S11 (F026, F027 / T020) on real Postgres.
 *
 * A seat technician's authority is read from the assignment, arrangement, board scope and project
 * grant rows with the subject, on every request. Each "request" below resolves the subject afresh,
 * with a fresh request cache and no sign-in in between: removing a board from scope, withdrawing a
 * project grant, revoking the assignment or ending the arrangement decides the very next one.
 */
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createCoManagedSeatArrangement, setCoManagedSeatBoardScope } from '@alga-psa/co-managed';
import {
  CO_MANAGED_SEAT_RESOLVER_ID, coManagedSeatAuthority, coManagedSeatResolver, isCoManagedSeatSubject,
} from '@alga-psa/co-managed/seatAuthority';
import {
  BuiltinAuthorizationKernelProvider, RESOLVER_CLOSED_BASELINE_DENIED_CODE, RESOLVER_TEMPLATE_DENIED_CODE,
  RequestLocalAuthorizationCache, createAuthorizationKernel, registerBuiltinRuleResolver, unregisterBuiltinRuleResolver,
  type AuthorizationDecision, type AuthorizationRecord,
} from '@alga-psa/authorization/kernel';
import { probeTenantAuthorizationScope, resolveAuthorizationSubject } from '@alga-psa/authorization/subject';
import { createTicketAuthorizationContext } from '@alga-psa/authorization/ticketRecordAuthorization';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

const DAY = 86_400_000;
const describeDb = await describeWithDb();

describeDb('co-managed seat authority is resolved from rows on every request', { shuffle: false }, () => {
  let db: Knex;

  // RBAC and the provider's own rules allow everything, so every denial is the seat resolver's.
  const kernel = createAuthorizationKernel({
    builtinProvider: new BuiltinAuthorizationKernelProvider({ relationshipRules: [] }),
    rbacEvaluator: async () => true,
  });

  const sponsorWithPool = async (capacity = 10) => {
    const sponsor = await createTenant(db, `Seat sponsor ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    await db('co_managed_entitlements').insert({ tenant: sponsor, source: 'hosted', source_reference: `sub_${randomUUID()}`, capacity,
      verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY) });
    return sponsor;
  };
  const board = async (tenant: string) => {
    const boardId = randomUUID();
    await db('boards').insert({ tenant, board_id: boardId, board_name: `Board ${boardId.slice(0, 8)}`, is_default: false });
    return boardId;
  };
  /** A technician holding a seat, the way accepting an invitation will leave the rows. */
  const seatTechnician = async (tenant: string, arrangementId: string) => {
    const userId = await createUser(db, tenant, { user_type: 'internal' });
    await db('co_managed_seat_assignments').insert({ tenant, assignment_id: randomUUID(), arrangement_id: arrangementId,
      user_id: userId, state: 'active' });
    return userId;
  };
  /** One request: the subject is resolved from the database, nothing is carried over. */
  const request = async (tenant: string, userId: string) => {
    const subject = await resolveAuthorizationSubject(db, {
      tenant, user: { user_id: userId, user_type: 'internal' }, requestCache: new RequestLocalAuthorizationCache(),
    });
    return {
      subject,
      decide: (resource: string, action: string, record: AuthorizationRecord) =>
        kernel.authorizeResource({ subject, resource: { type: resource, action }, record }),
    };
  };
  const deniedBy = (decision: AuthorizationDecision) => decision.reasons
    .filter((reason) => reason.code === RESOLVER_TEMPLATE_DENIED_CODE).flatMap((reason) => reason.metadata?.ruleIds as string[]);
  const closed = (decision: AuthorizationDecision) => decision.reasons.some((reason) =>
    reason.code === RESOLVER_CLOSED_BASELINE_DENIED_CODE && reason.sourceId === CO_MANAGED_SEAT_RESOLVER_ID);

  /** A sponsor with a seat arrangement for one client: two boards in scope, one technician. */
  const seatArrangement = async () => {
    const tenant = await sponsorWithPool();
    const clientId = await createClient(db, tenant, `Seat client ${randomUUID().slice(0, 8)}`);
    const otherClientId = await createClient(db, tenant, `Other client ${randomUUID().slice(0, 8)}`);
    const [createBoard, workBoard, unscopedBoard] = [await board(tenant), await board(tenant), await board(tenant)];
    const arrangement = await createCoManagedSeatArrangement(db, { sponsorTenant: tenant, clientId, operationId: randomUUID(), seats: 2 });
    const arrangementId = arrangement.arrangement_id;
    await setCoManagedSeatBoardScope(db, { sponsorTenant: tenant, arrangementId,
      boards: [{ boardId: createBoard, canCreate: true }, { boardId: workBoard, canCreate: false }] });
    const userId = await seatTechnician(tenant, arrangementId);
    return { tenant, clientId, otherClientId, createBoard, workBoard, unscopedBoard, arrangementId, userId };
  };

  beforeAll(async () => {
    db = await createTestDbConnection({ databaseName: 's11_seat_authority_test' });
    registerBuiltinRuleResolver(coManagedSeatResolver);
  }, 300_000);
  afterAll(async () => { await db?.destroy(); });

  // F026 / F027
  it('gives a technician their own client, the boards in scope and nothing else', async () => {
    const s = await seatArrangement();
    const { subject, decide } = await request(s.tenant, s.userId);

    expect(coManagedSeatAuthority(subject)).toEqual({ scope: {
      arrangementId: s.arrangementId, clientId: s.clientId,
      boardIds: [s.createBoard, s.workBoard].sort(), creatableBoardIds: [s.createBoard], projectIds: [],
    } });

    expect((await decide('ticket', 'read', { id: randomUUID(), clientId: s.clientId, boardId: s.workBoard })).allowed).toBe(true);
    expect((await decide('ticket', 'create', { clientId: s.clientId, boardId: s.createBoard })).allowed).toBe(true);
    expect((await decide('asset', 'read', { id: randomUUID(), clientId: s.clientId })).allowed).toBe(true);

    expect(deniedBy(await decide('ticket', 'read', { id: randomUUID(), clientId: s.otherClientId, boardId: s.workBoard })))
      .toEqual(['seat:ticket:read:own_client']);
    expect(deniedBy(await decide('ticket', 'read', { id: randomUUID(), clientId: s.clientId, boardId: s.unscopedBoard })))
      .toEqual(['seat:ticket:read:in_scope_board']);
    expect(deniedBy(await decide('ticket', 'create', { clientId: s.clientId, boardId: s.workBoard })))
      .toEqual(['seat:ticket:create:creatable_board']);
    expect(closed(await decide('billing', 'read', { id: randomUUID(), clientId: s.clientId }))).toBe(true);
  });

  // T020 / F027
  it('removing a board from scope denies the next request, with no new sign-in', async () => {
    const s = await seatArrangement();
    const ticket = { id: randomUUID(), clientId: s.clientId, boardId: s.workBoard };
    expect((await (await request(s.tenant, s.userId)).decide('ticket', 'read', ticket)).allowed).toBe(true);

    await setCoManagedSeatBoardScope(db, { sponsorTenant: s.tenant, arrangementId: s.arrangementId,
      boards: [{ boardId: s.createBoard, canCreate: false }] });

    const next = await request(s.tenant, s.userId);
    const denied = await next.decide('ticket', 'read', ticket);
    expect(denied.allowed).toBe(false);
    expect(deniedBy(denied)).toEqual(['seat:ticket:read:in_scope_board']);
    // The board that stayed is still workable, but it no longer admits creation.
    expect((await next.decide('ticket', 'update', { ...ticket, boardId: s.createBoard })).allowed).toBe(true);
    expect((await next.decide('ticket', 'create', { clientId: s.clientId, boardId: s.createBoard })).allowed).toBe(false);

    // An empty scope removes all ticket access and leaves the rest of the client's records.
    await setCoManagedSeatBoardScope(db, { sponsorTenant: s.tenant, arrangementId: s.arrangementId, boards: [] });
    const last = await request(s.tenant, s.userId);
    expect((await last.decide('ticket', 'read', { ...ticket, boardId: s.createBoard })).allowed).toBe(false);
    expect((await last.decide('contact', 'read', { id: randomUUID(), clientId: s.clientId })).allowed).toBe(true);
  });

  // T020 / F027
  it('revoking the assignment denies everything on the next request and never leaves an ordinary internal user', async () => {
    const s = await seatArrangement();
    const records: Array<[string, string, AuthorizationRecord]> = [
      ['ticket', 'read', { id: randomUUID(), clientId: s.clientId, boardId: s.workBoard }],
      ['asset', 'read', { id: randomUUID(), clientId: s.clientId }],
      ['client', 'read', { id: s.clientId, clientId: s.clientId }],
      ['time_entry', 'create', { clientId: s.clientId }],
    ];
    const before = await request(s.tenant, s.userId);
    for (const [resource, action, record] of records) {
      expect((await before.decide(resource, action, record)).allowed, `${resource}:${action}`).toBe(true);
    }

    await db('co_managed_seat_assignments').where({ tenant: s.tenant, user_id: s.userId })
      .update({ state: 'revoked', revoked_at: new Date(), updated_at: new Date() });

    const after = await request(s.tenant, s.userId);
    expect(isCoManagedSeatSubject(after.subject)).toBe(true);
    expect(coManagedSeatAuthority(after.subject)).toEqual({ scope: null });
    for (const [resource, action, record] of [...records,
      ['ticket', 'read', { id: randomUUID(), clientId: s.otherClientId, boardId: s.unscopedBoard }] as [string, string, AuthorizationRecord]]) {
      const decision = await after.decide(resource, action, record);
      expect(decision.allowed, `${resource}:${action}`).toBe(false);
      expect(closed(decision), `${resource}:${action}`).toBe(true);
    }
    // The subject the first request resolved is not reused: it still carries the old scope.
    expect(coManagedSeatAuthority(before.subject)?.scope).not.toBeNull();
  });

  // F027
  it('ending the arrangement, and withdrawing a project grant, take effect on the next request', async () => {
    const s = await seatArrangement();
    const projectId = randomUUID();
    const project = { id: projectId, clientId: s.clientId };
    expect(deniedBy(await (await request(s.tenant, s.userId)).decide('project', 'read', project)))
      .toEqual(['seat:project:read:shared_project']);

    await db('co_managed_seat_project_grants').insert({ tenant: s.tenant, arrangement_id: s.arrangementId, project_id: projectId });
    const shared = await request(s.tenant, s.userId);
    expect((await shared.decide('project', 'read', project)).allowed).toBe(true);
    expect((await shared.decide('project', 'read', { ...project, clientId: s.otherClientId })).allowed).toBe(false);

    await db('co_managed_seat_project_grants').where({ tenant: s.tenant, project_id: projectId }).del();
    expect((await (await request(s.tenant, s.userId)).decide('project', 'read', project)).allowed).toBe(false);

    await db('co_managed_seat_arrangements').where({ tenant: s.tenant, arrangement_id: s.arrangementId })
      .update({ state: 'ended', ended_at: new Date(), updated_at: new Date() });
    const ended = await request(s.tenant, s.userId);
    expect(coManagedSeatAuthority(ended.subject)).toEqual({ scope: null });
    expect(closed(await ended.decide('asset', 'read', { id: randomUUID(), clientId: s.clientId }))).toBe(true);
  });

  // F027: the ticket screens resolve the subject from one snapshot statement; the facts ride in it.
  it('the ticket authorization context carries the same seat scope', async () => {
    const s = await seatArrangement();
    const context = await db.transaction((trx) => createTicketAuthorizationContext(trx, s.tenant,
      { user_id: s.userId, user_type: 'internal', tenant: s.tenant, roles: [] } as never));
    expect(coManagedSeatAuthority(context.authorizationSubject)?.scope).toMatchObject({ clientId: s.clientId, creatableBoardIds: [s.createBoard] });
    const denied = await context.authorizationKernel.authorizeResource({ subject: context.authorizationSubject,
      resource: { type: 'ticket', action: 'read' }, record: { id: randomUUID(), clientId: s.otherClientId, boardId: s.workBoard } });
    expect(denied.allowed).toBe(false);
    expect(deniedBy(denied)).toEqual(['seat:ticket:read:own_client']);
  });

  // Release posture: dark.
  it('MSP staff of the same tenant, and tenants with no seat technician, are untouched', async () => {
    const s = await seatArrangement();
    const staffId = await createUser(db, s.tenant, { user_type: 'internal' });
    const staff = await request(s.tenant, staffId);
    expect(isCoManagedSeatSubject(staff.subject)).toBe(false);
    expect((await staff.decide('ticket', 'read', { id: randomUUID(), clientId: s.otherClientId, boardId: s.unscopedBoard })).allowed).toBe(true);
    expect((await staff.decide('billing', 'read', { id: randomUUID(), clientId: s.otherClientId })).allowed).toBe(true);

    // An invitation that nobody accepted has no user: the tenant still has no seat subject.
    const plain = await sponsorWithPool();
    const plainClient = await createClient(db, plain, `Plain client ${randomUUID().slice(0, 8)}`);
    const arrangement = await createCoManagedSeatArrangement(db, { sponsorTenant: plain, clientId: plainClient, operationId: randomUUID(), seats: 1 });
    await db('co_managed_seat_assignments').insert({ tenant: plain, assignment_id: randomUUID(),
      arrangement_id: arrangement.arrangement_id, invitation_id: randomUUID(), state: 'invited' });
    const plainUser = await createUser(db, plain, { user_type: 'internal' });

    expect(await probeTenantAuthorizationScope(db, plain, new RequestLocalAuthorizationCache())).toMatchObject({ resolverSubjects: false });
    expect(await probeTenantAuthorizationScope(db, s.tenant, new RequestLocalAuthorizationCache())).toMatchObject({ resolverSubjects: true });

    // The same number of statements with the resolver registered as without it.
    const statements = async () => {
      let count = 0;
      const onQuery = () => { count += 1; };
      db.on('query', onQuery);
      const { subject } = await request(plain, plainUser);
      db.removeListener('query', onQuery);
      return { count, subject };
    };
    const registered = await statements();
    unregisterBuiltinRuleResolver(CO_MANAGED_SEAT_RESOLVER_ID);
    const unregistered = await statements();
    registerBuiltinRuleResolver(coManagedSeatResolver);
    expect(registered.count).toBe(unregistered.count);
    expect(registered.subject).toEqual(unregistered.subject);
    expect(registered.subject.resolverFacts).toBeUndefined();
  });

  // T016 (database half): nothing the policy service lists or edits was written.
  it('no seat rule exists as an editable bundle rule', async () => {
    const s = await seatArrangement();
    await request(s.tenant, s.userId);
    expect(await db('authorization_bundle_rules').where({ tenant: s.tenant })).toEqual([]);
    expect(await db('authorization_bundles').where({ tenant: s.tenant })).toEqual([]);
  });
});
