import { rm } from 'node:fs/promises';
import { buildMergedEeMigrationsDir } from '../../../test-utils/eeMigrations';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { acceptCoManagedSeatInvitation, endCoManagedSeatArrangement } from '@alga-psa/co-managed';
import { resizeCoManagedSeatAllocation, assertCoManagedSeatTechnicianWrite, reserveCoManagedWorkspace, getCoManagedEntitlementState, readCoManagedPoolCapacity, reserveAndActivateCoManagedSeatAllocation } from '@alga-psa/licensing';
import { admitSeatTrialCredential, admitSeatTrialSession } from '../../../../ee/server/src/lib/co-managed/seatTrialSession';
import { cancelCoManagedSeatTrial, replaceCoManagedSeatTrialTechnician, prepareCoManagedSeatTrial, readCoManagedSeatTrialAdmission } from '../../../../ee/server/src/lib/co-managed/seatTrial';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { usePaidSeatForTrial } from '../../../../ee/server/src/lib/co-managed/seatTrialConversion';
import { resolveAuthorizationSubject } from '@alga-psa/authorization/subject';
import { authorizeTicketRecordAccess } from '@alga-psa/authorization/ticketRecordAuthorization';
import { coManagedSeatAuthority } from '@alga-psa/co-managed/seatAuthority';
import { resolveCommentAudienceReader } from '../../../../shared/lib/commentAudience';
import { writeTicketActivity } from '../../../../shared/lib/ticketActivity/writeTicketActivity';
import { createCloseRulesFixture, insertTicket } from './helpers/closeRulesFixture';
import { createClient, createUser, createTenant, ensureContactWithEmail } from '../../../test-utils/testDataFactory';

const describeDb = await describeWithDb();

describeDb('co-managed Seat trial admission on migrated PostgreSQL', { shuffle: false }, () => {
  let db: Knex;
  let migrationsDir: string;
  beforeAll(async () => {
    migrationsDir = buildMergedEeMigrationsDir();
    db = await createTestDbConnection({ databaseName: 'seat_trial_admission_test', migrationsDir });
  }, 300_000);
  afterAll(async () => {
    await db?.destroy();
    if (migrationsDir) await rm(migrationsDir, { recursive: true, force: true });
  });

  async function sponsorWithBase() {
    const tenant = await createTenant(db, 'Seat trial sponsor', { productCode: 'psa' });
    await db('tenants').where({ tenant }).update({ billing_source: 'stripe', licensed_user_count: 1 });
    const [customer] = await db('stripe_customers').insert({ tenant, stripe_customer_external_id: 'cus_' + tenant, email: 'msp@example.test' }).returning('*');
    const [product] = await db('stripe_products').insert({ tenant, stripe_product_external_id: 'prod_' + tenant, name: 'Pro', product_type: 'license' }).returning('*');
    const [price] = await db('stripe_prices').insert({ tenant, stripe_price_external_id: 'price_' + tenant,
      stripe_product_id: product.stripe_product_id, unit_amount: 2900 }).returning('*');
    await db('stripe_subscriptions').insert({ tenant, stripe_subscription_external_id: 'sub_' + tenant,
      stripe_customer_id: customer.stripe_customer_id, stripe_price_id: price.stripe_price_id, status: 'trialing',
      trial_end: new Date(Date.now() + 2 * 86400000), current_period_end: new Date(Date.now() + 30 * 86400000) });
    return tenant;
  }

  async function draft(tenant: string) {
    const clientId = await createClient(db, tenant, `Pilot client ${randomUUID()}`);
    const contactId = await ensureContactWithEmail(db, tenant, clientId, randomUUID() + '@example.test', 'Pilot Technician');
    return { tenant, clientId, contactId, operationId: randomUUID(), boards: [] };
  }

  it('serializes competing setups and revokes replaced links before and after acceptance', async () => {
    const tenant = await sponsorWithBase();
    const otherTenant = await sponsorWithBase();
    const independent = await prepareCoManagedSeatTrial(db, await draft(otherTenant));
    const choices = await Promise.all([draft(tenant), draft(tenant)]);
    const results = await Promise.allSettled(choices.map(request => prepareCoManagedSeatTrial(db, request)));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const index = results.findIndex(r => r.status === 'fulfilled');
    const won = await prepareCoManagedSeatTrial(db, choices[index]);
    expect(won.trialId).not.toBe(independent.trialId);
    const initial = results[index];
    if (initial.status !== 'fulfilled') throw new Error('Missing winning setup');
    const accept = (token: string) => acceptCoManagedSeatInvitation(db, { token, password: 'Correct-horse-9-battery' });
    await expect(accept(initial.value.invitation!.token)).rejects.toThrow();
    const nextContact = await ensureContactWithEmail(db, tenant, choices[index].clientId, randomUUID() + '@example.test', 'Replacement Technician');
    const next = await replaceCoManagedSeatTrialTechnician(db, { tenant, trialId: won.trialId, contactId: nextContact });
    await expect(accept(won.invitation!.token)).rejects.toThrow();
    const accepted = await accept(next.invitation.token);
    const lastContact = await ensureContactWithEmail(db, tenant, choices[index].clientId, randomUUID() + '@example.test', 'Final Technician');
    const afterAcceptance = await replaceCoManagedSeatTrialTechnician(db, { tenant, trialId: won.trialId, contactId: lastContact });
    await accept(afterAcceptance.invitation.token);
    const old = await db('co_managed_seat_trials').where({ tenant }).first();
    await cancelCoManagedSeatTrial(db, { tenant, trialId: won.trialId });
    expect(await db('co_managed_seat_trial_milestones').where({ tenant })).toHaveLength(0);
    const replacement = await prepareCoManagedSeatTrial(db, choices[1-index]);
    expect(replacement.trialId).toBe(won.trialId);
    await expect(cancelCoManagedSeatTrial(db, { tenant, trialId: won.trialId, allocationId: old.allocation_id }))
      .rejects.toThrow('TRIAL_CLAIM_UNAVAILABLE');
    expect((await db('co_managed_seat_assignments').where({ tenant, user_id: accepted.user_id }).first()).state).toBe('revoked');
    expect(await db('co_managed_seat_trial_milestones').where({ tenant })).toHaveLength(0);
  });

  it('serializes a spare-seat conversion with a competing paid reservation', async () => {
    const tenant = await sponsorWithBase();
    const setup = await prepareCoManagedSeatTrial(db, await draft(tenant));
    await db('co_managed_entitlements').insert({ tenant, source: 'hosted', source_reference: 'sub_' + tenant,
      capacity: 3, verified_at: new Date(), valid_until: new Date(Date.now() + 86400000) });
    const client = () => createClient(db, tenant, `Paying client ${randomUUID()}`);
    await reserveCoManagedWorkspace(db, { sponsorTenant: tenant, operationId: randomUUID(), seats: 1,
      clientId: await client(), visibilityMode: 'board_scope' });
    const reserve = async () => reserveAndActivateCoManagedSeatAllocation(db, { sponsorTenant: tenant,
      operationId: randomUUID(), clientId: await client(), seats: 1 });
    const paidSeat = await reserve();
    const pilot = await db('co_managed_seat_trials').where({ tenant }).first();
    const resize = (allocationId: string, seats: number, expectedSeats: number) =>
      resizeCoManagedSeatAllocation(db, tenant, { allocationId, seats, expectedSeats, countCommittedSeats: async () => 0 });
    await expect(resize(pilot.allocation_id, 2, 1)).rejects.toThrow();
    await resize(paidSeat.allocation_id, 2, 1);
    await resize(paidSeat.allocation_id, 1, 2);
    await db('co_managed_entitlements').where({ tenant }).update({ valid_until: new Date(Date.now() - 86_400_000) });
    await expect(usePaidSeatForTrial(db, tenant, setup.trialId)).rejects.toThrow();
    await db('co_managed_entitlements').where({ tenant }).update({ valid_until: new Date(Date.now() + 86_400_000) });
    const results = await Promise.allSettled([usePaidSeatForTrial(db, tenant, setup.trialId), reserve()]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(await getCoManagedEntitlementState(db, tenant)).toMatchObject({ capacity: 3, allocated: 3, available: 0 });
    expect(await db('co_managed_purchase_operations').where({ tenant })).toHaveLength(0);
  });

  it.each([true, false])('records shared ticket work exactly once with technician first = %s', async technicianFirst => {
    const tenant = await sponsorWithBase();
    const staff = await createUser(db, tenant);
    const fixture = await createCloseRulesFixture(db, tenant, staff);
    const setup = await prepareCoManagedSeatTrial(db, { tenant, clientId: fixture.clientId, contactId: fixture.contactId,
      boards: [{ boardId: fixture.boardId, canCreate: true }], operationId: randomUUID() });
    const accepted = await acceptCoManagedSeatInvitation(db, { token: setup.invitation!.token, password: 'Correct-horse-9-battery' });
    const sessionId = randomUUID();
    await db('sessions').insert({ tenant, session_id: sessionId, user_id: accepted.user_id, created_at: db.fn.now(),
      expires_at: new Date(Date.now() + 86400000), login_method: 'credentials' });
    expect(await admitSeatTrialSession(tenant, accepted.user_id, sessionId, db)).toBe(true);
    const reader = () => resolveCommentAudienceReader(db, tenant, { userId: accepted.user_id, userType: 'internal' });
    expect(await reader()).toMatchObject({ kind: 'seat', clientId: fixture.clientId });
    const parties = technicianFirst ? [accepted.user_id, staff] : [staff, accepted.user_id];
    const ticket = await insertTicket(db, fixture);
    const other = await insertTicket(db, fixture);
    const work = (userId: string, ticketId: string, eventType = 'TICKET_UPDATED') => writeTicketActivity(db, {
      tenant, ticketId, eventType, entityType: 'ticket', actor: { actorType: 'user', userId }, source: 'ui',
    });
    const shared = () => db('co_managed_seat_trial_milestones').where({ tenant, milestone: 'shared_ticket_work' });
    await work(parties[0], ticket);
    await work(parties[1], other);
    await work(parties[1], ticket, 'TICKET_VIEWED');
    expect(await shared()).toHaveLength(0);
    await work(parties[1], ticket);
    await work(parties[0], ticket);
    expect(await shared()).toHaveLength(1);
    const scope = async () => coManagedSeatAuthority(await resolveAuthorizationSubject(db, {
      tenant, user: { user_id: accepted.user_id, user_type: 'internal' },
    }));
    expect((await scope())?.scope?.boardIds).toEqual([fixture.boardId]);
    const access = (id: string, action: 'read' | 'update', userId = accepted.user_id) =>
      db.transaction(trx => authorizeTicketRecordAccess({ trx, tenant, user: { tenant, user_id: userId, user_type: 'internal' } as never,
        ticketId: id, action }));
    await expect(access(ticket, 'read')).resolves.toMatchObject({ ticket_id: ticket });
    await expect(access(ticket, 'update')).resolves.toBeTruthy();
    const outside = await createCloseRulesFixture(db, tenant, staff);
    await expect(access(await insertTicket(db, outside), 'read')).rejects.toThrow();
    await db('stripe_subscriptions').where({ tenant }).update({ trial_end: new Date(Date.now() - 1000) });
    await expect(access(ticket, 'read')).rejects.toThrow();
    await expect(access(ticket, 'update')).rejects.toThrow();
    await db('stripe_subscriptions').where({ tenant }).update({ status: 'active' });
    await expect(access(ticket, 'update')).resolves.toBeTruthy();
    await assertCoManagedSeatTechnicianWrite(db, tenant, accepted.user_id);
    await db('co_managed_seat_trials').where({ tenant }).update({
      activated_at: db.raw("statement_timestamp() - interval '360 hours'"), deadline_at: db.raw('statement_timestamp()'),
    });
    expect(await scope()).toEqual({ scope: null });
    expect(await reader()).toBeNull();
    await expect(access(ticket, 'read')).rejects.toThrow();
    await expect(access(ticket, 'update')).rejects.toThrow();
    await expect(access(ticket, 'read', staff)).resolves.toMatchObject({ ticket_id: ticket });
    const previous = process.env.FORCE_CAPABILITIES;
    process.env.FORCE_CAPABILITIES = 'co-managed:off,co-managed-seat:off';
    try { await expect(assertCoManagedSeatTechnicianWrite(db, tenant, accepted.user_id)).rejects.toThrow(); }
    finally { if (previous == null) delete process.env.FORCE_CAPABILITIES; else process.env.FORCE_CAPABILITIES = previous; }
    await expect(assertCoManagedSeatTechnicianWrite(db, tenant, accepted.user_id)).rejects.toThrow();
    expect(await admitSeatTrialCredential(tenant, accepted.user_id, db)).toBe(false);
    expect(await admitSeatTrialSession(tenant, accepted.user_id, sessionId, db)).toBe(false);
    expect(await db('ticket_audit_logs').where({ tenant, ticket_id: ticket, actor_user_id: accepted.user_id }).first()).toBeTruthy();
    const ended = await endCoManagedSeatArrangement(db, { sponsorTenant: tenant, arrangementId: setup.arrangementId, actorUserId: staff });
    expect(ended.releasedSeats).toBe(0);
    expect(await readCoManagedSeatTrialAdmission(db, { tenant, assignmentId: setup.assignmentId })).toMatchObject({ status: 'ended' });
    await expect(prepareCoManagedSeatTrial(db, await draft(tenant))).rejects.toThrow('TRIAL_CLAIM_UNAVAILABLE');
  });

  it('acceptance leaves the clock empty; concurrent first sessions establish one 360-hour window', async () => {
    const tenant = await sponsorWithBase();
    await db('co_managed_entitlements').insert({ tenant, source: 'hosted', source_reference: `sub_${randomUUID()}`,
      capacity: 0, verified_at: new Date(Date.now() - 60_000), valid_until: new Date(Date.now() + 86_400_000) });
    const client = await createClient(db, tenant, `Trial client ${randomUUID()}`);
    const contactId = await ensureContactWithEmail(db, tenant, client, `${randomUUID()}@client.example`, 'Taylor Technician');
    const operationId = randomUUID();
    const prepared = await prepareCoManagedSeatTrial(db, { tenant, clientId: client, contactId, operationId, boards: [] });
    const arrangement = await db('co_managed_seat_arrangements').where({ tenant, arrangement_id: prepared.arrangementId }).first();
    const allocation = await db('co_managed_allocations').where({ tenant, allocation_id: arrangement.allocation_id }).first();
    expect(allocation).toMatchObject({ seats: 1, funding_source: 'seat_trial' });
    expect((await db('co_managed_entitlements').where({ tenant }).first()).capacity).toBe(0);
    await expect(reserveAndActivateCoManagedSeatAllocation(db, { sponsorTenant: tenant, clientId: client,
      operationId, seats: 1, fundingSource: 'paid' })).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
    const accepted = await acceptCoManagedSeatInvitation(db, { token: prepared.invitation!.token, password: 'Correct-horse-9-battery' });
    const assignment = await db('co_managed_seat_assignments').where({ tenant, user_id: accepted.user_id }).first();
    const trialId = prepared.trialId;
    expect(assignment.assignment_id).toBe(prepared.assignmentId);

    expect((await db('co_managed_seat_trials').where({ tenant, trial_id: trialId }).first()).activated_at).toBeNull();
    expect(await admitSeatTrialCredential(tenant, accepted.user_id, db)).toBe(false);
    expect(await admitSeatTrialSession(tenant, accepted.user_id, randomUUID(), db)).toBe(false);
    const sessions = await db('sessions').insert([1, 2].map(() => ({ tenant, user_id: accepted.user_id,
      session_id: randomUUID(), token: '', created_at: db.fn.now(), expires_at: new Date(Date.now() + 86400000), login_method: 'credentials' }))).returning('session_id');
    const starts = await Promise.all(sessions.map(row => admitSeatTrialSession(tenant, accepted.user_id, row.session_id, db)));
    expect(starts).toEqual([true, true]);
    expect(await admitSeatTrialCredential(tenant, accepted.user_id, db)).toBe(true);
    const current = () => readCoManagedSeatTrialAdmission(db, { tenant, assignmentId: assignment.assignment_id });
    const active = await current();
    expect(active?.status).toBe('active');
    expect(active!.deadlineAt!.getTime() - active!.activatedAt!.getTime()).toBe(360 * 3600000);
    await db('stripe_subscriptions').where({ tenant }).update({ trial_end: new Date(Date.now() - 1000) });
    expect(await current()).toMatchObject({ status: 'base_paused' });
    expect(await admitSeatTrialSession(tenant, accepted.user_id, sessions[0].session_id, db)).toBe(false);
    expect(await db('co_managed_trial_access').where({ tenant })).toHaveLength(0);
    await db('stripe_subscriptions').where({ tenant }).update({ status: 'active' });
    expect(await current()).toMatchObject({ status: 'active', deadlineAt: active!.deadlineAt });
    expect(await db('co_managed_trial_access').where({ tenant })).toHaveLength(1);
    expect((await db('tenants').where({ tenant }).first()).licensed_user_count).toBe(1);
    expect(await db('co_managed_seat_trial_milestones').where({ tenant, trial_id: trialId, milestone: 'technician_sign_in' })).toHaveLength(1);
  });

  it('keeps an existing paid subscriber eligible and an appliance ineligible even with a Stripe mirror', async () => {
    const tenant = await sponsorWithBase();
    await db('stripe_subscriptions').where({ tenant }).update({ status: 'active', trial_end: null });
    const request = await draft(tenant);
    await db.transaction(async trx => {
      await trx('license_state').insert({ edition_choice: 'ee' });
      await expect(prepareCoManagedSeatTrial(trx, request)).rejects.toThrow('SPONSOR_NOT_ELIGIBLE');
      await trx('license_state').delete();
    });
    const prepared = await prepareCoManagedSeatTrial(db, request);
    expect(await readCoManagedSeatTrialAdmission(db, { tenant, assignmentId: prepared.assignmentId })).toMatchObject({ status: 'pending', deadlineAt: null });
    const accepted = await acceptCoManagedSeatInvitation(db, { token: prepared.invitation!.token, password: 'Correct-horse-9-battery' });
    const sessionId = randomUUID();
    await db('sessions').insert({ tenant, session_id: sessionId, user_id: accepted.user_id, login_method: 'credentials', created_at: db.fn.now(),
      expires_at: new Date(Date.now() + 86400000) });
    await db.transaction(async trx => {
      // Set a private POSIX time zone whose spring transition falls inside the actual
      // pilot window, regardless of which day CI runs. The database clock stays real.
      const clock = await trx.raw("SELECT extract(doy from current_timestamp at time zone 'UTC')::int AS today");
      const day = Number(clock.rows[0].today);
      const zone = `STD5DST,J${(day + 4) % 365 + 1}/2,J${(day + 40) % 365 + 1}/2`;
      await trx.raw("SELECT set_config('TimeZone', ?, true)", [zone]);
      expect(await admitSeatTrialSession(tenant, accepted.user_id, sessionId, trx)).toBe(true);
      const row = await trx('co_managed_seat_trials').where({ tenant }).first(
        trx.raw('extract(epoch from deadline_at - activated_at)::integer AS duration'),
        trx.raw('extract(timezone from deadline_at) - extract(timezone from activated_at) AS offset_change'),
      );
      expect(Number(row?.duration)).toBe(360 * 3600);
      expect(Number(row?.offset_change)).toBe(3600);
    });
  });

  it('prepares a hosted Pro trial without an entitlement row and without changing the base user count', async () => {
    const tenant = await sponsorWithBase();
    const client = await createClient(db, tenant, `Trial client ${randomUUID()}`);
    const contactId = await ensureContactWithEmail(db, tenant, client, `${randomUUID()}@client.example`, 'Morgan Technician');
    const usersBefore = await db('users').where({ tenant }).count('* as count').first();

    const prepared = await prepareCoManagedSeatTrial(db, { tenant, clientId: client, contactId, operationId: randomUUID(), boards: [] });

    expect(await db('co_managed_entitlements').where({ tenant }).first()).toBeUndefined();
    const pilot = await db('co_managed_seat_trials').where({ tenant, trial_id: prepared.trialId }).first();
    expect(await db('co_managed_allocations').where({ tenant, allocation_id: pilot.allocation_id }).first())
      .toMatchObject({ funding_source: 'seat_trial', seats: 1 });
    await db.transaction(async (trx) => expect(await readCoManagedPoolCapacity(trx, tenant, 0))
      .toMatchObject({ purchased: 0, allocated: 0, available: 0 }));
    const usersAfter = await db('users').where({ tenant }).count('* as count').first();
    expect(String(usersAfter?.count ?? 0)).toBe(String(usersBefore?.count ?? 0));
  });
  it('starts on the first server session after password authentication and tracked session issuance', async () => {
    const tenant = await sponsorWithBase();
    const setup = await prepareCoManagedSeatTrial(db, await draft(tenant));
    const password = 'Correct-horse-9-battery';
    const technician = await acceptCoManagedSeatInvitation(db, { token: setup.invitation!.token, password });
    const pilot = () => db('co_managed_seat_trials').where({ tenant }).first();
    // Route production connection factories to this fixture. At the HTTP boundary
    // supply the session which Auth.js would have decoded from its signed cookie.
    vi.resetModules();
    const database = await import('@alga-psa/db');
    const admin = await import('../../../../packages/db/src/lib/admin');
    const connections = await import('../../../../packages/db/src/lib/tenant');
    vi.spyOn(database, 'getConnection').mockResolvedValue(db);
    vi.spyOn(admin, 'getAdminConnection').mockResolvedValue(db);
    vi.spyOn(connections, 'getConnection').mockResolvedValue(db);
    let cookie: { user: { id: string; tenant: string; user_type: string }; session_id: string } | null = null;
    vi.doMock('../../../../packages/auth/src/nextauth/edge-auth', () => ({ auth: async () => cookie }));
    vi.doMock('../../../../packages/auth/src/nextauth/auth', () => ({ auth: async () => null }));
    vi.doMock('@enterprise/lib/co-managed/seatTrialSession', () => ({
      admitSeatTrialSession: (home: string, user: string, session: string) => admitSeatTrialSession(home, user, session, db),
    }));
    try {
      const { authenticateUser } = await import('../../../../packages/auth/src/actions/auth');
      const { UserSession } = await import('@alga-psa/db/models/UserSession');
      const { getSession } = await import('../../../../packages/auth/src/lib/getSession');
      await expect(authenticateUser(technician.email, 'invalid', 'internal')).resolves.toBeNull();
      await expect(getSession()).resolves.toBeNull();
      expect((await pilot()).deadline_at).toBeNull();
      const user = await authenticateUser(technician.email, password, 'internal');
      expect(user?.user_id).toBe(technician.user_id);
      expect((await pilot()).deadline_at).toBeNull();
      const sessionId = await UserSession.create({ tenant, user_id: technician.user_id, expires_at: new Date(Date.now() + 86400000),
        login_method: 'credentials', ip_address: '127.0.0.1', device_fingerprint: 'test', device_name: 'test',
        device_type: 'desktop', user_agent: 'integration test' });
      cookie = { user: { id: technician.user_id, tenant, user_type: 'internal' }, session_id: sessionId };
      await expect(getSession()).resolves.toEqual(cookie);
      expect((await pilot()).state).toBe('active');
      await db('co_managed_seat_trials').where({ tenant }).update({
        activated_at: db.raw("statement_timestamp() - interval '360 hours'"), deadline_at: db.raw('statement_timestamp()'),
      });
      await expect(getSession()).resolves.toBeNull();
    } finally {
      vi.restoreAllMocks();
      vi.doUnmock('../../../../packages/auth/src/nextauth/edge-auth');
      vi.doUnmock('../../../../packages/auth/src/nextauth/auth');
      vi.doUnmock('@enterprise/lib/co-managed/seatTrialSession');
      vi.resetModules();
    }
  });

  it('uses authorized overview and invitation actions to recover failed delivery on the original sponsor', async () => {
    const tenant = await sponsorWithBase();
    const elsewhere = await sponsorWithBase();
    const foreignRequest = await draft(elsewhere);
    const foreign = await prepareCoManagedSeatTrial(db, foreignRequest);
    const user = { user_id: await createUser(db, tenant), user_type: 'internal', tenant };
    const request = await draft(tenant);
    let mayManage = false;
    let delivered = false;
    vi.stubEnv('FORCE_CAPABILITIES', 'co-managed:on,co-managed-seat:on');
    vi.stubEnv('STRIPE_CO_MANAGED_USER_PRICE_ID', 'price_fixture');
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'https://msp.example.test');
    vi.doMock('@alga-psa/auth', () => ({ withAuth: (fn: Function) => (...args: unknown[]) => fn(user, { tenant }, ...args) }));
    vi.doMock('@alga-psa/auth/rbac', () => ({ hasPermission: async (_: unknown, resource: string) =>
      resource === 'account_management' || mayManage }));
    vi.doMock('@alga-psa/db', async original => ({ ...await original<typeof import('@alga-psa/db')>(),
      createTenantKnex: async () => ({ knex: db }) }));
    vi.doMock('@alga-psa/authorization/clientScopeAuthorization', () => ({
      createClientScopeContext: async () => ({ permits: async (_: string, id: string) => id === request.clientId }),
    }));
    vi.doMock('../../lib/co-managed/browserActor', () => ({ coManagedBrowserActor: async () => ({ tenant, userId: user.user_id }) }));
    vi.doMock('@alga-psa/email', () => ({ sendTeamInvitationEmail: async () => delivered }));
    vi.doMock('../../../../ee/server/src/lib/stripe/StripeService', () => ({
      getStripeService: () => ({ coManagedSeatPrice: async () => ({ unitAmount: 1149, currency: 'eur' }), refreshSeatTrialBase: async () => {} }),
    }));
    try {
      const actions = await import('../../../../ee/server/src/lib/actions/coManagedSeatTrialActions');
      expect(await actions.getSeatTrialOfferAction()).toMatchObject({ canStart: false, pilot: null, price: { currency: 'eur' } });
      expect(await actions.getSeatTrialOfferAction(request.clientId)).toBeNull();
      mayManage = true;
      expect(await actions.getSeatTrialOfferAction(request.clientId)).toMatchObject({ canStart: true });
      const saved = await actions.prepareCoManagedSeatTrialAction({ ...request, tenant: elsewhere } as typeof request);
      expect(saved.delivered).toBe(false);
      const pending = await actions.getSeatTrialOfferAction(request.clientId);
      expect(pending?.pilot).toMatchObject({ trialId: saved.trialId, status: 'pending', invited: true });
      delivered = true;
      expect(await actions.resumeCoManagedSeatTrialAction(saved.trialId)).toMatchObject({ resent: true, delivered: true });
      await expect(actions.replaceCoManagedSeatTrialTechnicianAction({ trialId: foreign.trialId, contactId: foreignRequest.contactId,
        tenant: elsewhere } as { trialId: string; contactId: string })).rejects.toThrow('Trial not found');
      expect(await db('co_managed_seat_trials').where({ tenant: elsewhere }).first()).toMatchObject({ assignment_id: foreign.assignmentId, revision: 1 });
      vi.stubEnv('FORCE_CAPABILITIES', 'co-managed:off,co-managed-seat:off');
      expect(await actions.getSeatTrialOfferAction(request.clientId)).toMatchObject({ canStart: false, pilot: { trialId: saved.trialId } });
      await actions.cancelCoManagedSeatTrialAction(saved.trialId);
      expect(await actions.getSeatTrialOfferAction(request.clientId)).toBeNull();
    } finally {
      vi.unstubAllEnvs();
      vi.doUnmock('@alga-psa/auth'); vi.doUnmock('@alga-psa/auth/rbac'); vi.doUnmock('@alga-psa/db');
      vi.doUnmock('@alga-psa/authorization/clientScopeAuthorization'); vi.doUnmock('../../lib/co-managed/browserActor');
      vi.doUnmock('@alga-psa/email'); vi.doUnmock('../../../../ee/server/src/lib/stripe/StripeService');
    }
  });

});
