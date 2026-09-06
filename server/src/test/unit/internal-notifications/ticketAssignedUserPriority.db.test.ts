import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import type { IUserWithRoles } from '@alga-psa/types';
import type { InternalNotificationPriority } from '@alga-psa/notifications/types/internalNotification';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { randomUUID } from 'node:crypto';
import { runWithApiKeyUser } from '@alga-psa/auth';
import { internalNotificationSubscriberTestHarness } from '../../../lib/eventBus/subscribers/internalNotificationSubscriber';

// Behavioral regression test for the ticket-assigned creation path
// (task 29.8.46). It drives the REAL server action the settings UI invokes
// (updateUserInternalNotificationPreferenceAction) to persist the per-user
// override, then emits TICKET_ASSIGNED through the REAL event-bus entry point
// (handleInternalNotificationEvent — schema validation + dispatch, exactly
// what the Redis consumer calls) so the whole chain is exercised end to end:
//
//   updateUserInternalNotificationPreferenceAction  (the writer the UI calls)
//     -> handleInternalNotificationEvent -> handleTicketAssigned
//     -> createNotificationFromTemplateInternal
//     -> resolveNotificationPriority(user ?? tenant ?? subtype default ?? 'normal')
//     -> stamped internal_notifications.priority
//
// The override is persisted THROUGH THE WRITER ACTION — not inserted into the
// table directly — so the test cannot accidentally seed a row in the exact
// shape the reader expects while the product writes something different.
//
// If the resolution is removed from the creation path (the pre-draft / base
// branch behavior), every case below collapses to the column default 'normal'
// and the user-override case fails.
//
// The handler only reads the ticket row, so the suite creates its own
// throwaway ticket (assigned to the target user) and deletes it afterwards.

// The runner owns a migrated, seeded disposable database. Route database access
// to that connection while keeping the real authentication context, RBAC,
// writer actions, event dispatch and notification creation behavior.
let TENANT: string;
let USER: string;
let ASSIGNER: string;
let SUBTYPE_TICKET_ASSIGNED: number;
let CATEGORY_TICKETS: number;
let knex: Knex;
let fixtureTicketId: string;
let fixtureTicketNumber: string;
let sessionUser: IUserWithRoles;

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@alga-psa/db')>(),
  createTenantKnex: async () => ({ knex, tenant: TENANT }),
  getConnection: async () => knex,
}));
// Transport effects are not the assertion boundary of this database test.
vi.mock('@alga-psa/notifications/realtime/internalNotificationBroadcaster', () => ({
  broadcastNotification: vi.fn(async () => undefined),
  broadcastNotificationRead: vi.fn(async () => undefined),
  broadcastAllNotificationsRead: vi.fn(async () => undefined),
  broadcastUnreadCount: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishEvent: vi.fn(async () => undefined),
}));

/** Persist a per-user subtype override through the real server action the UI calls. */
async function setUserPriority(priority: InternalNotificationPriority | null) {
  await runWithApiKeyUser(sessionUser, async () => {
    const { updateUserInternalNotificationPreferenceAction } = await import(
      '@alga-psa/notifications/actions/internal-notification-actions/internalNotificationActions'
    );
    const result = await updateUserInternalNotificationPreferenceAction({
      tenant: TENANT,
      user_id: USER,
      category_id: CATEGORY_TICKETS,
      subtype_id: SUBTYPE_TICKET_ASSIGNED,
      is_enabled: true,
      priority,
    });
    expect(result).toMatchObject({ tenant: TENANT, user_id: USER, priority });
  });
}

/** Persist a tenant-level subtype override through the real server action the admin settings UI calls. */
async function setTenantPriority(priority: InternalNotificationPriority | null) {
  await runWithApiKeyUser(sessionUser, async () => {
    const { updateInternalSubtypeAction } = await import(
      '@alga-psa/notifications/actions/internal-notification-actions/internalNotificationActions'
    );
    const result = await updateInternalSubtypeAction(SUBTYPE_TICKET_ASSIGNED, {
      is_enabled: true,
      is_default_enabled: true,
      priority,
    });
    expect(result).not.toHaveProperty('error');
  });
}

/**
 * Emit TICKET_ASSIGNED through the REAL bus entry point — the same function the
 * Redis consumer invokes (schema validation + dispatch to handleTicketAssigned).
 */
async function driveTicketAssigned() {
  await internalNotificationSubscriberTestHarness.handleInternalNotificationEvent({
    eventType: 'TICKET_ASSIGNED',
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    payload: {
      tenantId: TENANT,
      ticketId: fixtureTicketId,
      userId: USER, // the assignee (recipient), as every publisher emits it
      assignedByUserId: ASSIGNER,
    },
  } as any);
}

/**
 * The notification the handler just stamped: the newest ticket-assigned row
 * for the assignee. Each case deletes the row it asserted against, so there is
 * never a newer one from a sibling case.
 */
async function newestStampedNotification() {
  const row = await knex('internal_notifications')
    .where({ tenant: TENANT, user_id: USER, template_name: 'ticket-assigned' })
    .orderBy('created_at', 'desc')
    .orderBy('internal_notification_id', 'desc')
    .first();
  if (row) {
    await knex('internal_notifications').where({ tenant: TENANT, internal_notification_id: row.internal_notification_id }).delete();
  }
  return row;
}

describe('behavioral: per-user priority override honored on the ticket-assigned creation path', () => {
  beforeAll(async () => {
    knex = await createTestDbConnection();
    TENANT = (await knex('tenants').first('tenant')).tenant;
    const admin = await knex('users as u')
      .join('user_roles as ur', function () { this.on('ur.user_id', 'u.user_id').andOn('ur.tenant', 'u.tenant'); })
      .join('roles as r', function () { this.on('r.role_id', 'ur.role_id').andOn('r.tenant', 'ur.tenant'); })
      .where({ 'u.tenant': TENANT, 'r.role_name': 'Admin', 'u.user_type': 'internal' })
      .select('u.*').first();
    if (!admin) throw new Error('Workspace seed must provide an internal administrator');
    USER = admin.user_id;
    ASSIGNER = USER;
    sessionUser = { ...admin, roles: [] };
    const reference = await knex('tickets').where({ tenant: TENANT }).first();
    if (!reference) throw new Error('Workspace seed must provide a ticket');
    const subtype = await knex('internal_notification_templates as t')
      .join('internal_notification_subtypes as s', 's.internal_notification_subtype_id', 't.subtype_id')
      .where({ 't.name': 'ticket-assigned' })
      .select('s.internal_notification_subtype_id', 's.internal_category_id').first();
    if (!subtype) throw new Error('Workspace seed must provide the ticket-assigned template');
    SUBTYPE_TICKET_ASSIGNED = subtype.internal_notification_subtype_id;
    CATEGORY_TICKETS = subtype.internal_category_id;

    // Throwaway ticket assigned to the target user (the handler reads it only).
    fixtureTicketId = randomUUID();
    fixtureTicketNumber = `PRIORITY-REPRO-${Date.now()}`;
    await knex('tickets').insert({
      tenant: TENANT,
      ticket_id: fixtureTicketId,
      ticket_number: fixtureTicketNumber,
      title: 'behavioral priority repro',
      client_id: reference.client_id,
      status_id: reference.status_id,
      priority_id: reference.priority_id,
      board_id: reference.board_id,
      assigned_to: USER,
      source: 'api',
      ticket_origin: 'internal',
      entered_at: new Date().toISOString(),
    });

    await setTenantPriority(null);
    await setUserPriority(null);
  });

  afterAll(async () => {
    if (!knex) return;
    try {
      if (fixtureTicketId) await knex('tickets').where({ tenant: TENANT, ticket_id: fixtureTicketId }).delete();
      if (SUBTYPE_TICKET_ASSIGNED) {
        await knex('user_internal_notification_preferences').where({ tenant: TENANT, user_id: USER, subtype_id: SUBTYPE_TICKET_ASSIGNED }).delete();
        await knex('tenant_internal_notification_subtype_settings').where({ tenant: TENANT, subtype_id: SUBTYPE_TICKET_ASSIGNED }).delete();
        await knex('internal_notifications').where({ tenant: TENANT, user_id: USER, template_name: 'ticket-assigned' }).delete();
      }
    } finally {
      await knex.destroy();
    }
  });

  it('user=high, tenant=none -> stamps high (the reported defect case)', async () => {
    await setTenantPriority(null);
    await setUserPriority('high');
    await driveTicketAssigned();
    const row = await newestStampedNotification();
    expect(row).toBeTruthy();
    expect(row.template_name).toBe('ticket-assigned');
    expect(row.user_id).toBe(USER);
    expect(row.priority).toBe('high');
  });

  it('user=high, tenant=low -> user still wins', async () => {
    await setTenantPriority('low');
    await setUserPriority('high');
    await driveTicketAssigned();
    const row = await newestStampedNotification();
    expect(row?.priority).toBe('high');
  });

  it('user=none, tenant=high -> tenant wins', async () => {
    await setTenantPriority('high');
    await setUserPriority(null);
    await driveTicketAssigned();
    const row = await newestStampedNotification();
    expect(row?.priority).toBe('high');
  });

  it('user=none, tenant=none -> subtype default (normal)', async () => {
    await setTenantPriority(null);
    await setUserPriority(null);
    await driveTicketAssigned();
    const row = await newestStampedNotification();
    expect(row?.priority).toBe('normal');
  });
});
