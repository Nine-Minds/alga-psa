import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTenantKnex } from '@alga-psa/db';
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

// Opt-in: this repro drives the REAL server actions and event bus against a
// live, seeded database (the Glinda tenant fixtures below only exist in the
// local dev DB). The DB-less unit CI job has neither a database nor those
// rows, so — following the repo convention for DB-backed suites — it is gated
// behind RUN_DB_TESTS=1 and skipped at collection time otherwise (so beforeAll
// never attempts a connection there). The priority-resolution logic itself is
// covered in CI by priorityResolution.test.ts and the publisher-recipient test.
const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';

const TENANT = 'dd8cb218-d46d-47f3-be27-8aa50aad5fce';
const USER = '6684ee32-8f0a-46fb-b84c-4563337b2766'; // glinda
const ASSIGNER = '00000000-0000-4000-8000-000000000001'; // smoke actor
const SUBTYPE_TICKET_ASSIGNED = 1; // ticket-assigned
const CATEGORY_TICKETS = 1;

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

// The session identity the withAuth-wrapped actions see. Mirrors the profile
// page session for glinda in the Glinda tenant.
const sessionUser = {
  user_id: USER,
  user_type: 'internal',
  tenant: TENANT,
  roles: [] as any[],
};

/** Persist a per-user subtype override through the real server action the UI calls. */
async function setUserPriority(priority: string | null) {
  await runWithApiKeyUser(sessionUser, async () => {
    const { updateUserInternalNotificationPreferenceAction } = await import(
      '@alga-psa/notifications/actions/internal-notification-actions/internalNotificationActions'
    );
    await updateUserInternalNotificationPreferenceAction({
      tenant: TENANT,
      user_id: USER,
      category_id: CATEGORY_TICKETS,
      subtype_id: SUBTYPE_TICKET_ASSIGNED,
      is_enabled: true,
      priority,
    });
  });
}

/** Persist a tenant-level subtype override through the real server action the admin settings UI calls. */
async function setTenantPriority(priority: string | null) {
  await runWithApiKeyUser(sessionUser, async () => {
    const { updateInternalSubtypeAction } = await import(
      '@alga-psa/notifications/actions/internal-notification-actions/internalNotificationActions'
    );
    await updateInternalSubtypeAction(SUBTYPE_TICKET_ASSIGNED, {
      is_enabled: true,
      is_default_enabled: true,
      priority,
    });
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
    await knex('internal_notifications').where({ internal_notification_id: row.internal_notification_id }).delete();
  }
  return row;
}

// Hooks live inside the gated describe so that, when RUN_DB_TESTS is unset,
// skipIf skips the whole block at collection time and beforeAll never runs
// (no connection attempt, no throw) in the DB-less unit CI job.
describe.skipIf(!RUN_DB_TESTS)('behavioral: per-user priority override honored on the ticket-assigned creation path', () => {
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
