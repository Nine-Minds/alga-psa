/**
 * CM L6b: the REAL escalate / hand back path on Postgres with the co-managed SLA lifecycle handlers
 * REGISTERED (the instrumentation configuration), no mocked handler, store or admission.
 *
 *  (a) An MSP that has not finished SLA setup (no priority mapping) never has a handoff blocked:
 *      escalation succeeds, no obligation rows are written, hand back still works, and the
 *      shared-ticket read model reports 'not_configured' (the card's empty state).
 *  (b) With mapping, MSP policy and target seeded: escalation starts a running obligation, hand back
 *      pauses it, and re-escalation resumes it with the elapsed time kept.
 *  (c) Work escalated before any obligation existed (pre-migration) re-escalates untimed.
 *
 * Production capability/lifecycle registration runs against an entitled, allocated sponsor. Handoffs
 * force the release gate on; the neutrality case uses real participation discovery and its cache.
 * Own scratch database; the tests run in order and share state.
 */
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { escalateCoManagedTicket, handBackCoManagedTicket, getCoManagedTicketSlaDisplay,
  type CoManagedSessionActor, type CoManagedSharedResource } from '@alga-psa/co-managed';
import { organizationSlaElapsedMinutes } from '@alga-psa/shared/lib/sla/organizationSlaClock';
import { registerCoManagedTicketSlaHandlers } from '@alga-psa/co-managed/ticketSlaRegistration';
import { coManagedParticipants, registerCoManagedCapability } from '@alga-psa/co-managed/capability';
import { registerCapabilityParticipation, serves } from '@alga-psa/core/capability';
import { dispatchTicketLifecycle } from '@alga-psa/tickets/lib/ticketLifecycleHooks';
import { applyOrganizationSlaEvent, findActiveOrganizationSlaObligation } from '@alga-psa/shared/lib/sla/organizationSlaStore';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

const describeDb = await describeWithDb();

interface Customer { tenant: string; relationshipId: string; admin: CoManagedSessionActor; priority: string; tickets: Record<string, string> }

describeDb('co-managed organization SLA on the real handoff path (handlers registered)', { shuffle: false }, () => {
  let db: Knex;
  let msp: string;
  let mspBoard: string;
  let mspPriority: string;
  let tech: CoManagedSessionActor;
  const N = {} as Customer, M = {} as Customer;
  const note = 'shared IT note';
  const previousForce = process.env.FORCE_CAPABILITIES;

  async function actorFor(tenant: string, permissions: Array<[string, string]>, msp_: boolean): Promise<CoManagedSessionActor> {
    const userId = await createUser(db, tenant, { user_type: 'internal' });
    const roleId = randomUUID();
    await db('roles').insert({ tenant, role_id: roleId, role_name: `role-${roleId.slice(0, 8)}`, msp: true, client: false });
    for (const [resource, action] of permissions) {
      const permissionId = randomUUID();
      await db('permissions').insert({ tenant, permission_id: permissionId, resource, action, msp: true, client: false });
      await db('role_permissions').insert({ tenant, role_id: roleId, permission_id: permissionId });
    }
    await db('user_roles').insert({ tenant, user_id: userId, role_id: roleId });
    const sessionId = randomUUID();
    await db('sessions').insert({ tenant, session_id: sessionId, user_id: userId, expires_at: new Date(Date.now() + 3600_000), created_at: new Date() });
    return { kind: 'session', tenant, userId, sessionId };
  }

  async function seedCustomer(target: Customer, label: string, ticketKeys: string[]) {
    target.tenant = await createTenant(db, `Customer ${label}`, { productCode: 'co_managed' });
    const customerClient = await createClient(db, target.tenant, `Customer ${label} client`);
    const sponsorClient = await createClient(db, msp, `Sponsor client for ${label}`);
    target.relationshipId = randomUUID();
    target.admin = await actorFor(target.tenant, [['ticket', 'read'], ['ticket', 'update'], ['co_management', 'manage']], false);
    const board = randomUUID(), status = randomUUID();
    target.priority = randomUUID();
    await db('boards').insert({ tenant: target.tenant, board_id: board, board_name: `${label} board` });
    await db('statuses').insert({ tenant: target.tenant, status_id: status, name: 'Open', status_type: 'ticket', order_number: 1, is_closed: false });
    await db('priorities').insert({ tenant: target.tenant, priority_id: target.priority, priority_name: 'Normal', order_number: 1 });
    await db('co_management_relationships').insert({ tenant: target.tenant, relationship_id: target.relationshipId, sponsor_tenant: msp,
      sponsor_client_id: sponsorClient, state: 'active', visibility_mode: 'board_scope', escalation_board_id: mspBoard,
      accepted_by: target.admin.userId, accepted_at: new Date() });
    await db('co_managed_allocations').insert({ tenant: msp, allocation_id: randomUUID(), operation_id: randomUUID(),
      request_fingerprint: 'a'.repeat(64), customer_tenant: target.tenant, relationship_id: target.relationshipId, seats: 1, state: 'active' });
    await db('co_management_board_scopes').insert({ tenant: target.tenant, relationship_id: target.relationshipId, board_id: board, can_collaborate: true });
    await db('co_management_staff_assignments').insert({ tenant: msp, customer_tenant: target.tenant, relationship_id: target.relationshipId,
      principal_type: 'user', principal_id: tech.userId, relationship_role: 'technician' });
    target.tickets = {};
    let n = 1000;
    for (const key of ticketKeys) {
      const ticketId = target.tickets[key] = randomUUID();
      const stamp = new Date(Date.UTC(2026, 0, 1));
      await db('tickets').insert({ tenant: target.tenant, ticket_id: ticketId, ticket_number: String(++n), title: `${label} ${key}`,
        client_id: customerClient, board_id: board, status_id: status, priority_id: target.priority, is_closed: false,
        entered_by: target.admin.userId, entered_at: stamp, updated_at: stamp });
    }
  }

  const resource = (c: Customer, key: string): CoManagedSharedResource => ({ tenant: c.tenant, relationshipId: c.relationshipId, kind: 'ticket', id: c.tickets[key] });
  const escalate = (c: Customer, key: string, expectedRevision: number) =>
    escalateCoManagedTicket(db, c.admin, resource(c, key), { operationId: randomUUID(), expectedRevision, note });
  const handBack = (c: Customer, key: string, expectedRevision: number) =>
    handBackCoManagedTicket(db, tech, resource(c, key), { operationId: randomUUID(), expectedRevision, note });
  const obligations = (c: Customer) => db('sla_organization_obligations').where({ tenant: msp, source_tenant: c.tenant }).orderBy('generation');
  const events = async (obligationId: string) => (await db('sla_organization_events').where({ tenant: msp, obligation_id: obligationId }).orderBy('revision')).map(e => e.event_type);
  const display = (c: Customer, key: string) => getCoManagedTicketSlaDisplay(db, c.admin, resource(c, key));
  const nativeSla = async (c: Customer, key: string) => Object.fromEntries(Object.entries(
    await db('tickets').where({ tenant: c.tenant, ticket_id: c.tickets[key] }).first()
  ).filter(([column]) => column.startsWith('sla_')));

  beforeAll(async () => {
    process.env.FORCE_CAPABILITIES = 'co-managed:on';
    registerCoManagedTicketSlaHandlers();
    db = await createTestDbConnection({ databaseName: 'l6b_sla_path_test' });
    msp = await createTenant(db, 'Sponsor MSP', { productCode: 'psa' });
    await db('co_managed_entitlements').insert({ tenant: msp, source: 'admin_grant', source_reference: randomUUID(), capacity: 10,
      verified_at: new Date(), valid_until: new Date(Date.now() + 365 * 86400000) });
    mspBoard = randomUUID();
    await db('boards').insert({ tenant: msp, board_id: mspBoard, board_name: 'Escalations', is_inactive: false });
    tech = await actorFor(msp, [['ticket', 'read'], ['ticket', 'update']], true);
    await seedCustomer(N, 'N', ['n1']);
    await seedCustomer(M, 'M', ['m1', 'm2']);
  }, 300_000);

  afterAll(async () => {
    if (previousForce === undefined) delete process.env.FORCE_CAPABILITIES; else process.env.FORCE_CAPABILITIES = previousForce;
    await db?.destroy();
  });

  it('(a) without priority mapping, escalation succeeds, creates no obligation, and the card reads not_configured', async () => {
    const receipt = await escalate(N, 'n1', 0);
    expect(receipt).toMatchObject({ transition: 'escalated', appliedRevision: 1 });
    expect(await obligations(N)).toEqual([]);
    expect(await db('sla_organization_events').where({ tenant: msp }).count('* as n').first()).toMatchObject({ n: '0' });
    expect((await display(N, 'n1')).msp).toEqual({ state: 'not_configured' });
    // Pausing on hand back still works with no obligation, and re-escalation is just as unblocked.
    expect(await handBack(N, 'n1', 1)).toMatchObject({ transition: 'handed_back', appliedRevision: 2 });
    expect(await escalate(N, 'n1', 2)).toMatchObject({ transition: 'escalated', appliedRevision: 3 });
    expect(await obligations(N)).toEqual([]);
  });

  it('(a2) a mapping but no MSP policy or target also never blocks escalation', async () => {
    mspPriority = randomUUID();
    await db('priorities').insert({ tenant: msp, priority_id: mspPriority, priority_name: 'MSP Normal', order_number: 1, item_type: 'ticket' });
    await db('co_managed_sla_priority_mappings').insert({ tenant: msp, customer_tenant: M.tenant, relationship_id: M.relationshipId,
      customer_priority_id: M.priority, msp_priority_id: mspPriority });
    // No default policy yet: m2 escalates untimed.
    expect(await escalate(M, 'm2', 0)).toMatchObject({ transition: 'escalated' });
    expect(await obligations(M)).toEqual([]);
    expect((await display(M, 'm2')).msp).toEqual({ state: 'not_configured' });
  });

  it('(b) with mapping, policy and target: escalation runs the clock, hand back pauses it, re-escalation resumes it keeping elapsed time', async () => {
    const schedule = randomUUID(), policy = randomUUID();
    await db('business_hours_schedules').insert({ tenant: msp, schedule_id: schedule, schedule_name: 'Always', timezone: 'UTC', is_default: true, is_24x7: true });
    await db('sla_policies').insert({ tenant: msp, sla_policy_id: policy, policy_name: 'Default', is_default: true, business_hours_schedule_id: schedule });
    await db('sla_policy_targets').insert({ tenant: msp, target_id: randomUUID(), sla_policy_id: policy, priority_id: mspPriority,
      response_time_minutes: 60, resolution_time_minutes: 480, escalation_1_percent: 50, escalation_2_percent: 75, escalation_3_percent: 90, is_24x7: true });

    // A real, independent customer promise is already running before the MSP accepts work.
    const customerPolicy = randomUUID();
    await db('sla_policies').insert({ tenant: M.tenant, sla_policy_id: customerPolicy, policy_name: 'Customer policy', is_default: true });
    await db('tickets').where({ tenant: M.tenant, ticket_id: M.tickets.m1 }).update({ sla_policy_id: customerPolicy,
      sla_started_at: new Date('2026-01-01T00:00:00Z'), sla_response_due_at: new Date('2026-01-01T02:00:00Z'),
      sla_response_at: new Date('2026-01-01T01:00:00Z'), sla_response_met: true,
      sla_resolution_due_at: new Date('2026-01-02T00:00:00Z'), sla_total_pause_minutes: 7 });
    const nativeBefore = await nativeSla(M, 'm1');

    expect(await escalate(M, 'm1', 0)).toMatchObject({ transition: 'escalated', appliedRevision: 1 });
    const [started] = await obligations(M);
    expect(started).toMatchObject({ source_tenant: M.tenant, ticket_id: M.tickets.m1, generation: 1 });
    expect(started.clock.pauseReasons).toEqual([]);
    expect(await events(started.obligation_id)).toEqual(['started']);
    expect(await nativeSla(M, 'm1')).toEqual(nativeBefore);
    const running = (await display(M, 'm1')).msp!;
    expect(running).toMatchObject({ state: 'tracking', paused: false });

    // Let a measurable amount of business time pass on the running clock, then hand back.
    await new Promise(resolve => setTimeout(resolve, 1500));
    expect(await handBack(M, 'm1', 1)).toMatchObject({ transition: 'handed_back', appliedRevision: 2 });
    const [paused] = await obligations(M).where('ticket_id', M.tickets.m1);
    expect(paused.clock.pauseReasons).toContain('customer_responsible');
    expect(await events(paused.obligation_id)).toEqual(['started', 'paused']);
    const elapsedAtPause = organizationSlaElapsedMinutes(paused.clock);
    expect(elapsedAtPause).toBeGreaterThan(0); // the clock ran before it was paused
    expect((await display(M, 'm1')).msp).toMatchObject({ state: 'tracking', paused: true });
    expect(await nativeSla(M, 'm1')).toEqual(nativeBefore);

    // Editing the mapping while the ticket is with the customer must not retarget its existing promise.
    const urgent = randomUUID();
    await db('priorities').insert({ tenant: msp, priority_id: urgent, priority_name: 'Urgent', order_number: 2, item_type: 'ticket' });
    await db('sla_policy_targets').insert({ tenant: msp, target_id: randomUUID(), sla_policy_id: policy, priority_id: urgent,
      response_time_minutes: 5, resolution_time_minutes: 15, is_24x7: true });
    await db('co_managed_sla_priority_mappings').where({ tenant: msp, customer_tenant: M.tenant, relationship_id: M.relationshipId,
      customer_priority_id: M.priority }).update({ msp_priority_id: urgent });

    expect(await escalate(M, 'm1', 2)).toMatchObject({ transition: 'escalated', appliedRevision: 3 });
    const rows = await obligations(M).where('ticket_id', M.tickets.m1);
    expect(rows).toHaveLength(1); // resumed, not restarted
    expect(rows[0].obligation_id).toBe(started.obligation_id);
    expect(rows[0].clock.pauseReasons).toEqual([]);
    expect(rows[0].priority_id).toBe(mspPriority);
    expect(rows[0].clock.response.targetMinutes).toBe(60);
    expect(rows[0].clock.resolution.targetMinutes).toBe(480);
    expect(await events(started.obligation_id)).toEqual(['started', 'paused', 'resumed']);
    // Elapsed time accrued before the pause is kept across the resume (never reset to zero).
    expect(organizationSlaElapsedMinutes(rows[0].clock)).toBe(elapsedAtPause);
    const pausedMs = Date.parse(rows[0].clock.observedAt) - Date.parse(paused.clock.observedAt);
    for (const target of ['response', 'resolution'] as const) {
      expect(Date.parse(rows[0].clock[target].dueAt) - Date.parse(started.clock[target].dueAt)).toBe(pausedMs);
    }
    expect(await nativeSla(M, 'm1')).toEqual(nativeBefore);
    expect((await display(M, 'm1')).msp).toMatchObject({ state: 'tracking', paused: false });
  });

  it('(c) pre-migration work (escalated before any obligation) re-escalates untimed instead of failing', async () => {
    // m2 was escalated in (a2) with no policy, so it now has first_escalated_at and no obligation: the same shape.
    expect(await handBack(M, 'm2', 1)).toMatchObject({ transition: 'handed_back' });
    expect(await escalate(M, 'm2', 2)).toMatchObject({ transition: 'escalated' });
    expect((await obligations(M)).filter(o => o.ticket_id === M.tickets.m2)).toEqual([]);
    expect((await display(M, 'm2')).msp).toEqual({ state: 'not_configured' });
  });

  it('(d) persisted warning and breach crossings are deduplicated, and leave the native promise unchanged', async () => {
    const [row] = await obligations(M).where('ticket_id', M.tickets.m1);
    const identity = row.clock.identity;
    const nativeBefore = await nativeSla(M, 'm1');
    for (const percent of [50, 100]) await db('sla_notification_thresholds').insert({ tenant: msp,
      threshold_id: randomUUID(), sla_policy_id: row.sla_policy_id, threshold_percent: percent,
      notification_type: percent === 100 ? 'breach' : 'warning', notify_assignee: true, channels: ['in_app'] });
    const observeAt = async (elapsedMinutes: number, operationId = randomUUID()) => {
      const occurredAt = new Date(Date.parse(row.clock.observedAt) + elapsedMinutes * 60000).toISOString();
      return db.transaction(trx => applyOrganizationSlaEvent(trx, identity, operationId, { kind: 'observed', occurredAt }));
    };
    const notices = () => db('sla_organization_notification_events').where({ tenant: msp, obligation_id: row.obligation_id }).orderBy('threshold_percent');
    await observeAt(30);
    expect(await notices()).toMatchObject([{ sla_type: 'response', notification_type: 'warning', threshold_percent: 50, status: 'pending' }]);
    const operationId = randomUUID();
    await observeAt(61, operationId);
    const saved = await notices();
    expect(saved).toMatchObject([
      { sla_type: 'response', notification_type: 'warning', threshold_percent: 50 },
      { sla_type: 'response', notification_type: 'breach', threshold_percent: 100 },
    ]);
    expect(await observeAt(61, operationId)).toMatchObject({ deduplicated: true });
    await observeAt(62);
    expect(await notices()).toEqual(saved);
    expect(await nativeSla(M, 'm1')).toEqual(nativeBefore);
  });

  it('(e) a foreign owner cannot read or mutate an obligation, and a forged source rolls back without changing it', async () => {
    const [before] = await obligations(M).where('ticket_id', M.tickets.m1);
    const identity = before.clock.identity;
    const beforeEvents = await events(before.obligation_id);
    expect(await findActiveOrganizationSlaObligation(db, N.tenant, M.tenant, M.tickets.m1)).toBeUndefined();
    const event = { kind: 'observed' as const, occurredAt: before.clock.observedAt };
    await expect(db.transaction(trx => applyOrganizationSlaEvent(trx, { ...identity, tenant: N.tenant }, randomUUID(), event)))
      .rejects.toThrow('does not exist');
    await expect(db.transaction(trx => applyOrganizationSlaEvent(trx, { ...identity, sourceTenant: N.tenant }, randomUUID(), event)))
      .rejects.toThrow('source does not match');
    expect(await obligations(M).where('ticket_id', M.tickets.m1)).toEqual([before]);
    expect(await events(before.obligation_id)).toEqual(beforeEvents);
  });

  it.each(['plain PSA', 'kill switch'] as const)('(f) %s executes every lifecycle hook with zero SQL', async mode => {
    const tenant = mode === 'plain PSA' ? await createTenant(db, 'Plain PSA control', { productCode: 'psa' }) : M.tenant;
    if (mode === 'plain PSA') delete process.env.FORCE_CAPABILITIES;
    else process.env.FORCE_CAPABILITIES = 'co-managed:off';
    registerCapabilityParticipation('co-managed', ({ tenantIds }) => coManagedParticipants(tenantIds, db));
    try {
      expect(await serves('co-managed', tenant)).toMatchObject({ served: false,
        reasons: { served: mode === 'plain PSA' ? 'not-participating' : 'forced-off' } });
      await db.transaction(async trx => {
        const statements: string[] = [];
        const record = (query: { sql: string }) => statements.push(query.sql);
        db.on('query', record);
        try {
          const base = { tenant, ticketId: M.tickets.m1 };
          await dispatchTicketLifecycle(trx, { ...base, kind: 'resolved' });
          await dispatchTicketLifecycle(trx, { ...base, kind: 'reopened' });
          await dispatchTicketLifecycle(trx, { ...base, kind: 'awaitingClient', previous: null, next: 'awaiting_client' });
          await dispatchTicketLifecycle(trx, { ...base, kind: 'firstResponse', relationshipId: M.relationshipId,
            commentId: randomUUID(), actorTenant: msp, actorUserId: tech.userId, actorReferenceId: randomUUID() });
          await dispatchTicketLifecycle(trx, { ...base, kind: 'handoff', relationshipId: M.relationshipId,
            workId: randomUUID(), operationId: randomUUID(), transition: 'escalated', firstEscalatedAt: null, occurredAt: new Date().toISOString() });
          expect(statements).toEqual([]);
        } finally { db.off('query', record); }
      });
    } finally {
      process.env.FORCE_CAPABILITIES = 'co-managed:on';
      registerCoManagedCapability();
    }
  });
});
