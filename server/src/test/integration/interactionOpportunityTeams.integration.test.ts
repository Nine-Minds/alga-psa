/**
 * Teams-path integration coverage for interactions tied to an opportunity.
 *
 * The opportunity feed's QuickAddInteraction "Online Meeting" branch routes
 * through scheduleTeamsMeeting (the Teams scheduling action) instead of the
 * plain addInteraction path. That seam must carry the deal context through:
 * the created interaction must keep the user's notes (join link appended),
 * carry opportunity_id, and therefore surface on both the opportunity and the
 * deal contact's feeds. An opportunity owned by a different client must be
 * rejected by the shared createInteractionRecord ownership check.
 *
 * The Teams service is mocked (as in appointmentRequests.integration.test.ts)
 * because no live Microsoft Graph is available in the test DB.
 *
 * Requires the standard test DB; skipped automatically when no database is
 * reachable unless REQUIRE_DB=1.
 */
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';
import { createMockUser, setupCommonMocks } from '../../../test-utils/testMocks';

// Hoisted refs let the vi.mock factories (evaluated before imports) reach the
// suite connection and the Teams doubles.
const dbRef = vi.hoisted(() => ({
  knex: null as any,
  tenant: '' as string,
}));
const teamsCapabilityMock = vi.hoisted(() => vi.fn());
const createTeamsMeetingMock = vi.hoisted(() => vi.fn());
const deleteTeamsMeetingMock = vi.hoisted(() => vi.fn());

const JOIN_URL = 'https://teams.example.com/meeting/opportunity-123';

vi.mock('@alga-psa/scheduling/lib/teamsMeetingService', () => ({
  resolveTeamsMeetingService: vi.fn(async () => ({
    getTeamsMeetingCapability: teamsCapabilityMock,
    createTeamsMeeting: createTeamsMeetingMock,
    deleteTeamsMeeting: deleteTeamsMeetingMock,
  })),
}));

// The action opens its own tenant pool through createTenantKnex; bind it to the
// suite connection so it sees the fixture rows.
vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
  runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
  getTenantContext: vi.fn(() => dbRef.tenant),
}));

// withAuth resolves the request tenant from server/src/lib/db.
vi.mock('server/src/lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('server/src/lib/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
  getCurrentTenantId: vi.fn(() => dbRef.tenant),
  runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn()),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn().mockResolvedValue(undefined),
  publishWorkflowEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import InteractionModel from '../../../../packages/clients/src/models/interactions';
import { getInteractionsForEntity } from '../../../../packages/clients/src/actions/interactionActions';

const describeDb = await describeWithDb();

const START = '2026-08-20T14:00:00.000Z';
const END = '2026-08-20T14:30:00.000Z';

let db: Knex;
let tenantId: string;
let userId: string;
let clientId: string;
let contactId: string;
let opportunityId: string;
let otherClientId: string;
let otherOpportunityId: string;

function tenantTable(table: string) {
  return tenantDb(db, tenantId).table(table);
}

describeDb('interactions Teams path: opportunity and contact', () => {
  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
    tenantId = await createTenant(db, 'Opportunity Teams Tenant');
    userId = await createUser(db, tenantId, { username: 'opportunity.teams.test' });
    clientId = await createClient(db, tenantId, 'Opportunity Teams Client');
    otherClientId = await createClient(db, tenantId, 'Opportunity Teams Other Client');

    dbRef.knex = db;
    dbRef.tenant = tenantId;

    contactId = randomUUID();
    opportunityId = randomUUID();
    otherOpportunityId = randomUUID();

    await tenantTable('contacts').insert({
      tenant: tenantId,
      contact_name_id: contactId,
      client_id: clientId,
      full_name: 'Dana Decisionmaker',
      email: 'dana@example.com',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    const opportunity = (id: string, client: string, number: string, title: string) => ({
      tenant: tenantId,
      opportunity_id: id,
      opportunity_number: number,
      client_id: client,
      contact_id: contactId,
      title,
      opportunity_type: 'new_logo',
      owner_id: userId,
      status: 'open',
      stage: 'identified',
      confidence: 'medium',
      mrr_cents: 0,
      nrr_cents: 0,
      hardware_cents: 0,
      currency_code: 'USD',
      values_locked_by_quote: false,
      last_activity_at: '2026-01-01T00:00:00.000Z',
      created_by: userId,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await tenantTable('opportunities').insert([
      opportunity(opportunityId, clientId, `OPP-${opportunityId.slice(0, 8)}`, 'Managed services agreement'),
      opportunity(otherOpportunityId, otherClientId, `OPP-${otherOpportunityId.slice(0, 8)}`, 'Unrelated deal'),
    ]);

    await tenantTable('statuses').insert({
      tenant: tenantId,
      status_id: randomUUID(),
      name: 'Planned',
      status_type: 'interaction',
      order_number: 1,
      is_closed: false,
      is_default: true,
      created_by: userId,
      created_at: db.fn.now(),
    });

    const staffUser = createMockUser('internal', { user_id: userId, tenant: tenantId });
    setupCommonMocks({
      tenantId,
      userId,
      user: staffUser,
      permissionCheck: () => true,
    });

    teamsCapabilityMock.mockResolvedValue({ available: true });
    createTeamsMeetingMock.mockResolvedValue({
      joinWebUrl: JOIN_URL,
      meetingId: 'meeting-opportunity-123',
      organizerUpn: 'organizer@example.com',
      organizerUserId: 'organizer-object-1',
      eventId: 'event-opportunity-123',
    });
    deleteTeamsMeetingMock.mockResolvedValue(true);
  }, 180_000);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, 60_000);

  it('keeps opportunity_id and notes, and surfaces on both the opportunity and contact', async () => {
    const { scheduleTeamsMeeting } = await import('@alga-psa/scheduling/actions/onlineMeetingSchedulingActions');

    const result = await scheduleTeamsMeeting({
      subject: 'Deal review',
      startDateTime: START,
      endDateTime: END,
      client_id: clientId,
      contact_name_id: contactId,
      opportunity_id: opportunityId,
      notes: 'Discussed pricing and rollout plan',
      interactionUserId: userId,
      createScheduleEntry: true,
      attendees: [
        {
          emailAddress: { address: 'client-attendee@example.com', name: 'Client Attendee' },
          type: 'required',
        },
      ],
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error(result.error);
    }
    const interactionId = result.data.interaction_id;
    expect(interactionId).toBeTruthy();

    const interaction = await tenantTable('interactions')
      .where({ tenant: tenantId, interaction_id: interactionId })
      .first();

    expect(interaction).toMatchObject({
      opportunity_id: opportunityId,
      client_id: clientId,
      contact_name_id: contactId,
      user_id: userId,
    });
    expect(interaction.notes).toContain('Discussed pricing and rollout plan');
    expect(interaction.notes).toContain(JOIN_URL);

    // The AlgaPSA calendar entry rides on the interaction work item.
    const scheduleEntry = await tenantTable('schedule_entries')
      .where({ tenant: tenantId, work_item_type: 'interaction', work_item_id: interactionId })
      .first();
    expect(scheduleEntry).toBeTruthy();

    const onlineMeeting = await tenantTable('online_meetings')
      .where({ tenant: tenantId, meeting_id: result.data.meeting_id })
      .first();
    expect(onlineMeeting).toMatchObject({
      interaction_id: interactionId,
      schedule_entry_id: scheduleEntry.entry_id,
      join_url: JOIN_URL,
    });

    // The shared write helper must also move the deal's activity clock.
    const opportunity = await tenantTable('opportunities')
      .where({ opportunity_id: opportunityId })
      .first('last_activity_at');
    expect(new Date(opportunity.last_activity_at).getTime())
      .toBeGreaterThan(new Date('2026-01-01T00:00:00.000Z').getTime());

    const forOpportunity = await InteractionModel.getForEntity(opportunityId, 'opportunity', tenantId);
    const forContact = await InteractionModel.getForEntity(contactId, 'contact', tenantId);

    expect(forOpportunity.map((row) => row.interaction_id)).toContain(interactionId);
    expect(forContact.map((row) => row.interaction_id)).toContain(interactionId);

    // Read back through the public action the opportunity/contact feeds actually call.
    const actionForOpportunity = await getInteractionsForEntity(opportunityId, 'opportunity');
    const actionForContact = await getInteractionsForEntity(contactId, 'contact');
    if (!Array.isArray(actionForOpportunity) || !Array.isArray(actionForContact)) {
      throw new Error('getInteractionsForEntity returned an action error instead of interactions');
    }
    expect(actionForOpportunity.map((row) => row.interaction_id)).toContain(interactionId);
    expect(actionForContact.map((row) => row.interaction_id)).toContain(interactionId);
  });

  it('rejects an opportunity that belongs to a different client', async () => {
    const { scheduleTeamsMeeting } = await import('@alga-psa/scheduling/actions/onlineMeetingSchedulingActions');

    const result = await scheduleTeamsMeeting({
      subject: 'Cross-client deal review',
      startDateTime: START,
      endDateTime: END,
      client_id: clientId,
      contact_name_id: contactId,
      opportunity_id: otherOpportunityId,
      notes: 'Should not be written',
      interactionUserId: userId,
      createScheduleEntry: true,
    });

    expect(result.success).toBe(false);

    const leaked = await tenantTable('interactions')
      .where({ tenant: tenantId, opportunity_id: otherOpportunityId })
      .first();
    expect(leaked).toBeFalsy();
  });
});
