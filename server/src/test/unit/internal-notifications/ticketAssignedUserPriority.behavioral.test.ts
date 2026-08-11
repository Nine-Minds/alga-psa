import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTenantKnex } from '@alga-psa/db';
import { internalNotificationSubscriberTestHarness } from '../../../lib/eventBus/subscribers/internalNotificationSubscriber';

// Behavioral regression test for the ticket-assigned creation path
// (task 29.8.46). It drives the REAL subscriber handler (handleTicketAssigned,
// the function the event bus invokes for TICKET_ASSIGNED) through the REAL
// creation function (createNotificationFromTemplateInternal) against the live
// dev DB — not the pure precedence helper. The per-user override on the
// ticket-assigned subtype (subtype 1) is written straight to the DB exactly as
// the profile UI writes it, so the whole chain is exercised end to end:
//
//   handleTicketAssigned -> createNotificationFromTemplateInternal
//     -> resolveNotificationPriority(user ?? tenant ?? subtype default ?? 'normal')
//     -> stamped internal_notifications.priority
//
// If the resolution is removed from the creation path (the pre-draft / base
// branch behavior), every case below collapses to the column default 'normal'
// and the user-override case fails.
//
// The handler only reads the ticket row, so the suite creates its own
// throwaway ticket (assigned to the target user) and deletes it afterwards.

const TENANT = 'dd8cb218-d46d-47f3-be27-8aa50aad5fce';
const USER = '6684ee32-8f0a-46fb-b84c-4563337b2766'; // glinda
const ASSIGNER = '00000000-0000-4000-8000-000000000001'; // smoke actor
const SUBTYPE_TICKET_ASSIGNED = 1; // ticket-assigned

// Real reference values for a valid ticket row in the Glinda tenant.
const FIXTURE_REFERENCE = {
  client_id: '66229c62-a609-41b1-93c2-e870d9926195',
  status_id: '55069d07-a8d9-451f-a825-dd1ca82d485a',
  priority_id: 'eaa5550f-b8f6-470d-ad34-61a292a0c87f',
  board_id: '4b18fabc-b0f6-4200-bc63-cbd514840257',
};

let knex: any;
let fixtureTicketId: string;
let fixtureTicketNumber: string;

async function setUserPriority(priority: string | null) {
  const existing = await knex('user_internal_notification_preferences')
    .where({ tenant: TENANT, user_id: USER, subtype_id: SUBTYPE_TICKET_ASSIGNED })
    .first();
  if (existing) {
    await knex('user_internal_notification_preferences')
      .where({ preference_id: existing.preference_id })
      .update({ priority, is_enabled: true });
  } else {
    await knex('user_internal_notification_preferences').insert({
      tenant: TENANT,
      user_id: USER,
      category_id: 1,
      subtype_id: SUBTYPE_TICKET_ASSIGNED,
      is_enabled: true,
      priority,
    });
  }
}

async function setTenantPriority(priority: string | null) {
  const existing = await knex('tenant_internal_notification_subtype_settings')
    .where({ tenant: TENANT, subtype_id: SUBTYPE_TICKET_ASSIGNED })
    .first();
  if (existing) {
    await knex('tenant_internal_notification_subtype_settings')
      .where({ tenant: TENANT, subtype_id: SUBTYPE_TICKET_ASSIGNED })
      .update({ priority });
  } else {
    await knex('tenant_internal_notification_subtype_settings').insert({
      tenant: TENANT,
      subtype_id: SUBTYPE_TICKET_ASSIGNED,
      is_enabled: true,
      is_default_enabled: true,
      priority,
    });
  }
}

/** Drive the real subscriber handler exactly as the event bus does for TICKET_ASSIGNED. */
async function driveTicketAssigned() {
  await internalNotificationSubscriberTestHarness.handleTicketAssigned({
    eventType: 'TICKET_ASSIGNED',
    payload: {
      tenantId: TENANT,
      ticketId: fixtureTicketId,
      userId: USER, // the assignee (recipient), as every publisher emits it
      assignedByUserId: ASSIGNER,
    },
  });
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
    await knex('internal_notifications').where({ internal_notification_id: row.internal_notification_id }).delete();
  }
  return row;
}

beforeAll(async () => {
  knex = (await createTenantKnex()).knex;

  // Throwaway ticket assigned to the target user (the handler reads it only).
  fixtureTicketId = randomUUID();
  fixtureTicketNumber = `PRIORITY-REPRO-${Date.now()}`;
  await knex('tickets').insert({
    tenant: TENANT,
    ticket_id: fixtureTicketId,
    ticket_number: fixtureTicketNumber,
    title: 'behavioral priority repro',
    client_id: FIXTURE_REFERENCE.client_id,
    status_id: FIXTURE_REFERENCE.status_id,
    priority_id: FIXTURE_REFERENCE.priority_id,
    board_id: FIXTURE_REFERENCE.board_id,
    assigned_to: USER,
    source: 'api',
    ticket_origin: 'internal',
    entered_at: new Date().toISOString(),
  });

  await setTenantPriority(null);
  await setUserPriority(null);
});

afterAll(async () => {
  await knex('tickets').where({ tenant: TENANT, ticket_id: fixtureTicketId }).delete();
  await setTenantPriority(null);
  await setUserPriority(null);
});

describe('behavioral: per-user priority override honored on the ticket-assigned creation path', () => {
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
