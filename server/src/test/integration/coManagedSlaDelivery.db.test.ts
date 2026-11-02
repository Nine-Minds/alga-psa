/**
 * CM L6b: organization SLA notices on the REAL escalation path, fanned out and delivered through L5's ledger.
 * The only seam mocked is the email transport (TenantEmailService.sendEmail); sendEventEmail, the ledger claim/finish,
 * recipient re-authorization and preference checks all run for real. Own scratch database; tests run in order.
 */
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { escalateCoManagedTicket, enqueueCoManagedSlaDeliveries, flagStaleCoManagedSlaSending, pendingCoManagedSlaDeliveries,
  type CoManagedSessionActor } from '@alga-psa/co-managed';
import { registerCoManagedTicketSlaHandlers } from '@alga-psa/co-managed/ticketSlaRegistration';
import { persistCoManagedSlaNotifications } from '@alga-psa/notifications/lib/coManagedSlaNotifications';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

let testDb: Knex;
const sends: Array<{ to: string; tenantId: string }> = [];

vi.mock('../../lib/db/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../lib/db/db')>()), getConnection: async () => testDb }));
vi.mock('../../lib/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../lib/db')>()),
  createTenantKnex: async (tenant?: string) => ({ knex: testDb, tenant }) }));
vi.mock('@alga-psa/email', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/email')>();
  const service = { sendEmail: async (p: { to: string; tenantId: string }) => { sends.push({ to: p.to, tenantId: p.tenantId }); return { success: true, messageId: 'm' }; } };
  return { ...actual, TenantEmailService: { ...actual.TenantEmailService, getInstance: () => service } };
});

const { deliverCoManagedSlaNotifications, deliverCoManagedSlaRow } = await import('../../lib/notifications/coManagedSlaDelivery');
const describeDb = await describeWithDb();

describeDb('co-managed organization SLA notices: fanout and delivery through the L5 ledger', { shuffle: false }, () => {
  let db: Knex, msp: string, mspBoard: string, eventId: string, subtypeId: number;
  let tech: CoManagedSessionActor, admin: CoManagedSessionActor;
  const U = {} as Record<'assignee' | 'manager' | 'escalation', string>;
  const email = (k: string) => `${k}-${randomUUID().slice(0, 8)}@example.com`;
  const emails = {} as Record<string, string>;
  const previousForce = process.env.FORCE_CAPABILITIES;

  async function actorFor(tenant: string, permissions: Array<[string, string]>): Promise<CoManagedSessionActor> {
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
  const rows = (kind?: string) => db('co_management_deliveries').where({ tenant: msp, source_id: eventId }).modify(q => { if (kind) q.where('delivery_kind', kind); }).orderBy('recipient');
  const notifications = (userId: string) => db('internal_notifications').where({ tenant: msp, user_id: userId });
  const deliverRows = async (kind: string, userIds: string[]) => {
    // Pending order is by created_at (not stable across recipients), so report outcomes in the caller's user order.
    const byUser = new Map<string, string>();
    for (const row of await pendingCoManagedSlaDeliveries(db, msp)) if (row.deliveryKind === kind && userIds.includes(row.userId)) byUser.set(row.userId, await deliverCoManagedSlaRow(db, row));
    return userIds.flatMap(id => byUser.has(id) ? [byUser.get(id)!] : []);
  };

  beforeAll(async () => {
    process.env.FORCE_CAPABILITIES = 'co-managed:on';
    registerCoManagedTicketSlaHandlers();
    db = testDb = await createTestDbConnection({ databaseName: 'l6b_sla_delivery_test' });
    msp = await createTenant(db, 'Sponsor MSP', { productCode: 'psa' });
    mspBoard = randomUUID();
    await db('boards').insert({ tenant: msp, board_id: mspBoard, board_name: 'Escalations', is_inactive: false });
    const customer = await createTenant(db, 'Customer', { productCode: 'co_managed' });
    const customerClient = await createClient(db, customer, 'Customer client');
    const sponsorClient = await createClient(db, msp, 'Sponsor client');
    const relationshipId = randomUUID();
    admin = await actorFor(customer, [['ticket', 'read'], ['ticket', 'update'], ['co_management', 'manage']]);
    tech = await actorFor(msp, [['ticket', 'read'], ['ticket', 'update']]);
    const board = randomUUID(), status = randomUUID(), priority = randomUUID(), mspPriority = randomUUID(), ticketId = randomUUID();
    await db('boards').insert({ tenant: customer, board_id: board, board_name: 'Customer board' });
    await db('statuses').insert({ tenant: customer, status_id: status, name: 'Open', status_type: 'ticket', order_number: 1, is_closed: false });
    await db('priorities').insert({ tenant: customer, priority_id: priority, priority_name: 'Normal', order_number: 1 });
    await db('priorities').insert({ tenant: msp, priority_id: mspPriority, priority_name: 'MSP Normal', order_number: 1, item_type: 'ticket' });
    await db('co_management_relationships').insert({ tenant: customer, relationship_id: relationshipId, sponsor_tenant: msp, sponsor_client_id: sponsorClient,
      state: 'active', visibility_mode: 'board_scope', escalation_board_id: mspBoard, accepted_by: admin.userId, accepted_at: new Date() });
    await db('co_management_board_scopes').insert({ tenant: customer, relationship_id: relationshipId, board_id: board, can_collaborate: true });
    await db('co_managed_sla_priority_mappings').insert({ tenant: msp, customer_tenant: customer, relationship_id: relationshipId, customer_priority_id: priority, msp_priority_id: mspPriority });
    const schedule = randomUUID(), policy = randomUUID();
    await db('business_hours_schedules').insert({ tenant: msp, schedule_id: schedule, schedule_name: 'Always', timezone: 'UTC', is_default: true, is_24x7: true });
    await db('sla_policies').insert({ tenant: msp, sla_policy_id: policy, policy_name: 'Default', is_default: true, business_hours_schedule_id: schedule });
    await db('sla_policy_targets').insert({ tenant: msp, target_id: randomUUID(), sla_policy_id: policy, priority_id: mspPriority,
      response_time_minutes: 60, resolution_time_minutes: 480, escalation_1_percent: 50, escalation_2_percent: 75, escalation_3_percent: 90, is_24x7: true });
    const stamp = new Date(Date.UTC(2026, 0, 1));
    await db('tickets').insert({ tenant: customer, ticket_id: ticketId, ticket_number: '1001', title: 'Printer down', client_id: customerClient, board_id: board,
      status_id: status, priority_id: priority, is_closed: false, entered_by: admin.userId, entered_at: stamp, updated_at: stamp });
    await db('co_management_staff_assignments').insert({ tenant: msp, customer_tenant: customer, relationship_id: relationshipId,
      principal_type: 'user', principal_id: tech.userId, relationship_role: 'technician' });

    // Real escalation starts the obligation (and its 'started' event).
    await escalateCoManagedTicket(db, admin, { tenant: customer, relationshipId, kind: 'ticket', id: ticketId }, { operationId: randomUUID(), expectedRevision: 0, note: 'n' });
    const obligation = await db('sla_organization_obligations').where({ tenant: msp, ticket_id: ticketId }).first();
    const started = await db('sla_organization_events').where({ tenant: msp, obligation_id: obligation.obligation_id, event_type: 'started' }).first();

    // Three MSP recipients (assignee, board manager, escalation manager), each a staff-assigned internal user with a real email.
    for (const key of ['assignee', 'manager', 'escalation'] as const) {
      U[key] = (await actorFor(msp, [['ticket', 'read']])).userId;
      emails[key] = email(key);
      await db('users').where({ tenant: msp, user_id: U[key] }).update({ email: emails[key] });
      await db('co_management_staff_assignments').insert({ tenant: msp, customer_tenant: customer, relationship_id: relationshipId,
        principal_type: 'user', principal_id: U[key], relationship_role: 'technician' });
    }
    await db('co_managed_ticket_references').where({ tenant: msp, ticket_id: ticketId }).update({ assigned_to: U.assignee });
    await db('boards').where({ tenant: msp, board_id: mspBoard }).update({ manager_user_id: U.manager });
    await db('escalation_managers').insert({ config_id: randomUUID(), tenant: msp, board_id: mspBoard, escalation_level: 1, manager_user_id: U.escalation });
    const thresholdId = randomUUID();
    await db('sla_notification_thresholds').insert({ tenant: msp, threshold_id: thresholdId, sla_policy_id: obligation.sla_policy_id, threshold_percent: 100,
      notification_type: 'breach', notify_assignee: true, notify_board_manager: true, notify_escalation_manager: true, channels: ['in_app', 'email'] });
    eventId = randomUUID();
    await db('sla_organization_notification_events').insert({ tenant: msp, notification_event_id: eventId, obligation_id: obligation.obligation_id,
      source_operation_id: started.operation_id, threshold_id: thresholdId, threshold_percent: 100, sla_type: 'resolution', notification_type: 'breach',
      configuration: JSON.stringify({ channels: ['in_app', 'email'], notifyAssignee: true, notifyBoardManager: true, notifyEscalationManager: true }),
      elapsed_milliseconds: 29_000_000, target_minutes: 480, occurred_at: new Date(), status: 'pending' });
    subtypeId = (await db('notification_subtypes').where({ name: 'SLA Breach' }).first()).id;
  }, 300_000);

  afterAll(async () => {
    if (previousForce === undefined) delete process.env.FORCE_CAPABILITIES; else process.env.FORCE_CAPABILITIES = previousForce;
    await db?.destroy();
  });

  it('(a) a retained breach fans out to one in-app and one email row per eligible MSP recipient, exactly once', async () => {
    expect(await persistCoManagedSlaNotifications(db, msp)).toEqual({ examined: 1, completed: 1 });
    const inApp = await rows('sla_in_app'), mail = await rows('sla_email');
    expect(inApp.map(r => r.recipient).sort()).toEqual(Object.values(U).sort());
    expect(mail.map(r => r.recipient).sort()).toEqual(Object.values(emails).sort());
    for (const r of [...inApp, ...mail]) expect(r).toMatchObject({ state: 'pending', recipient_kind: 'msp_user', attempts: 0 });
    expect((await db('sla_organization_notification_events').where({ tenant: msp, notification_event_id: eventId }).first()).status).toBe('completed');
    // Re-running adds nothing: the event is completed, and a direct re-enqueue is idempotent per (kind, event, recipient).
    expect(await persistCoManagedSlaNotifications(db, msp)).toEqual({ examined: 0, completed: 0 });
    await enqueueCoManagedSlaDeliveries(db, msp, eventId);
    expect(await rows()).toHaveLength(6);
  });

  it('(b) delivering the in-app row creates exactly one notification and marks the row sent; redelivery creates nothing', async () => {
    expect(await deliverRows('sla_in_app', [U.assignee, U.manager])).toEqual(['sent', 'sent']);
    for (const id of [U.assignee, U.manager]) expect(await notifications(id)).toHaveLength(1);
    expect((await rows('sla_in_app')).filter(r => r.state === 'sent').map(r => r.recipient).sort()).toEqual([U.assignee, U.manager].sort());
    // The same row delivered again (e.g. a duplicate scan) is a no-op, not a second notification.
    const again = { tenant: msp, deliveryKind: 'sla_in_app', eventId, userId: U.assignee, recipient: U.assignee };
    await deliverCoManagedSlaRow(db, again);
    expect(await notifications(U.assignee)).toHaveLength(1);
    expect(await deliverRows('sla_in_app', [U.assignee, U.manager])).toEqual([]);
    expect(await notifications(U.assignee)).toHaveLength(1);
  });

  it('(c) the email row goes out through sendEventEmail once; a user who disabled the subtype is skipped with recipient_not_permitted', async () => {
    await db('user_notification_preferences').insert({ tenant: msp, user_id: U.manager, subtype_id: subtypeId, is_enabled: false });
    expect(await deliverRows('sla_email', [U.assignee, U.manager])).toEqual(['sent', 'skipped']);
    expect(sends).toEqual([{ to: emails.assignee, tenantId: msp }]);
    const assignee = await db('co_management_deliveries').where({ tenant: msp, delivery_kind: 'sla_email', recipient: emails.assignee }).first();
    const manager = await db('co_management_deliveries').where({ tenant: msp, delivery_kind: 'sla_email', recipient: emails.manager }).first();
    expect(assignee).toMatchObject({ state: 'sent', error_code: null });
    expect(manager).toMatchObject({ state: 'sent', error_code: 'recipient_not_permitted' });
    expect(await deliverRows('sla_email', [U.assignee, U.manager])).toEqual([]);
    await deliverCoManagedSlaRow(db, { tenant: msp, deliveryKind: 'sla_email', eventId, userId: U.assignee, recipient: emails.assignee });
    expect(sends).toHaveLength(1);
    expect(await notifications(U.manager)).toHaveLength(1); // opting out of email never touches the in-app notice
  });

  it('(d) a recipient who is no longer permitted before delivery is skipped: no notification, no email', async () => {
    await db('users').where({ tenant: msp, user_id: U.escalation }).update({ is_inactive: true });
    const tally = await deliverCoManagedSlaNotifications(db, msp);
    expect(tally).toEqual({ sent: 0, skipped: 2, failed: 0 });
    expect(await notifications(U.escalation)).toHaveLength(0);
    expect(sends).toHaveLength(1);
    for (const kind of ['sla_in_app', 'sla_email']) {
      expect(await db('co_management_deliveries').where({ tenant: msp, delivery_kind: kind, source_id: eventId, recipient_kind: 'msp_user' })
        .whereIn('recipient', [U.escalation, emails.escalation]).first()).toMatchObject({ state: 'sent', error_code: 'recipient_not_permitted' });
    }
  });

  it('(e) a stale sending row is flagged for reconciliation and never resent; a fresh one is left alone', async () => {
    const stale = emails.assignee.replace('assignee', 'stale'), fresh = emails.assignee.replace('assignee', 'fresh');
    const base = { tenant: msp, delivery_kind: 'sla_email', source_id: eventId, recipient_kind: 'msp_user', state: 'sending', attempts: 1 };
    const payload = JSON.stringify({ eventId, userId: U.assignee });
    await db('co_management_deliveries').insert([
      { ...base, recipient: stale, payload, updated_at: new Date(Date.now() - 3600_000) },
      { ...base, recipient: fresh, payload, updated_at: new Date() },
    ]);
    expect(await flagStaleCoManagedSlaSending(db, msp)).toBe(1);
    const get = (recipient: string) => db('co_management_deliveries').where({ tenant: msp, delivery_kind: 'sla_email', recipient }).first();
    expect(await get(stale)).toMatchObject({ state: 'sending', requires_reconciliation: true, error_code: 'unknown_outcome' });
    expect(await get(fresh)).toMatchObject({ state: 'sending', requires_reconciliation: false, error_code: null });
    expect(await deliverCoManagedSlaNotifications(db, msp)).toEqual({ sent: 0, skipped: 0, failed: 0 });
    expect(sends).toHaveLength(1);
    expect(await get(stale)).toMatchObject({ state: 'sending', requires_reconciliation: true });
    expect(await notifications(U.assignee)).toHaveLength(1);
  });

  it('(f) a missing SLA Breach subtype fails the email row with sla_subtype_missing', async () => {
    const recipient = emails.assignee.replace('assignee', 'late'), late = (await actorFor(msp, [['ticket', 'read']])).userId;
    await db('users').where({ tenant: msp, user_id: late }).update({ email: recipient });
    await db('co_management_staff_assignments').insert({ tenant: msp, customer_tenant: (await db('co_management_relationships').where({ sponsor_tenant: msp }).first()).tenant,
      relationship_id: (await db('co_management_relationships').where({ sponsor_tenant: msp }).first()).relationship_id, principal_type: 'user', principal_id: late, relationship_role: 'technician' });
    await db('co_managed_ticket_references').where({ tenant: msp }).update({ assigned_to: late });
    await enqueueCoManagedSlaDeliveries(db, msp, eventId);
    const owed = (await pendingCoManagedSlaDeliveries(db, msp)).filter(r => r.userId === late && r.deliveryKind === 'sla_email');
    expect(owed).toHaveLength(1);
    await db.transaction(async trx => {
      await trx.raw('SET CONSTRAINTS ALL DEFERRED');
      await trx('notification_subtypes').where({ id: subtypeId }).update({ name: 'SLA Breach (renamed)' });
      try { expect(await deliverCoManagedSlaRow(trx as unknown as Knex, owed[0])).toBe('failed'); }
      finally { await trx('notification_subtypes').where({ id: subtypeId }).update({ name: 'SLA Breach' }); }
    });
    expect(await db('co_management_deliveries').where({ tenant: msp, delivery_kind: 'sla_email', recipient: recipient }).first())
      .toMatchObject({ state: 'failed', error_code: 'sla_subtype_missing' });
    expect(sends).toHaveLength(1);
  });
});
