/**
 * Read-path integration coverage for interactions tied to an opportunity.
 *
 * A single interaction created through the real write path with
 * opportunity_id + client_id + contact_name_id (the shape the opportunity
 * feed's QuickAddInteraction writes) must:
 *   - be returned by getForEntity for the opportunity, and
 *   - be returned by getForEntity for the deal's contact,
 * which is what puts the deal's history on the contact record too.
 * The same write must bump the opportunity's last_activity_at.
 *
 * Requires the standard test DB; skipped automatically when no database is
 * reachable unless REQUIRE_DB=1.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

// createInteractionRecord imports the event publishers and next/cache for its
// side-effect helpers; this suite exercises only the record write + read.
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn().mockResolvedValue(undefined),
  publishWorkflowEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

// The model opens its own tenant pool through createTenantKnex; bind it to the
// suite connection so it sees the fixture rows.
const dbRef = vi.hoisted(() => ({
  knex: null as any,
  tenant: '' as string,
}));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
}));

import InteractionModel from '../../../../packages/clients/src/models/interactions';
import { createInteractionRecord } from '../../../../packages/clients/src/actions/interactionCreateHelper';

const describeDb = await describeWithDb();

const INTERACTION_DATE = '2026-07-16T14:30:00.000Z';

let db: Knex;
let tenantId: string;
let userId: string;
let clientId: string;
let contactId: string;
let opportunityId: string;
let statusId: string;
let callTypeId: string;

function tenantTable(table: string) {
  return tenantDb(db, tenantId).table(table);
}

describeDb('interactions read path: opportunity and contact', () => {
  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
    tenantId = await createTenant(db, 'Opportunity Interactions Tenant');
    userId = await createUser(db, tenantId, { username: 'opportunity.interactions.test' });
    clientId = await createClient(db, tenantId, 'Opportunity Interactions Client');

    dbRef.knex = db;
    dbRef.tenant = tenantId;

    contactId = randomUUID();
    opportunityId = randomUUID();

    await tenantTable('contacts').insert({
      tenant: tenantId,
      contact_name_id: contactId,
      client_id: clientId,
      full_name: 'Dana Decisionmaker',
      email: 'dana@example.com',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await tenantTable('opportunities').insert({
      tenant: tenantId,
      opportunity_id: opportunityId,
      opportunity_number: `OPP-${opportunityId.slice(0, 8)}`,
      client_id: clientId,
      contact_id: contactId,
      title: 'Managed services agreement',
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

    statusId = randomUUID();
    await tenantTable('statuses').insert({
      tenant: tenantId,
      status_id: statusId,
      name: 'Planned',
      status_type: 'interaction',
      order_number: 1,
      is_closed: false,
      is_default: true,
      created_by: userId,
      created_at: db.fn.now(),
    });

    const callType = await tenantTable('system_interaction_types')
      .where({ type_name: 'Call' })
      .first('type_id');
    if (!callType?.type_id) {
      throw new Error('System Call interaction type is required for the interactions read-path test');
    }
    callTypeId = callType.type_id;
  }, 180_000);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, 60_000);

  it('creates one interaction and reads it back on both the opportunity and its contact', async () => {
    const created = await createInteractionRecord({
      tenant: tenantId,
      trx: db as unknown as Knex.Transaction,
      interactionData: {
        type_id: callTypeId,
        title: 'Discovery call',
        user_id: userId,
        client_id: clientId,
        contact_name_id: contactId,
        opportunity_id: opportunityId,
        interaction_date: INTERACTION_DATE,
        duration: 25,
      },
    });

    expect(created).toMatchObject({
      interaction_id: expect.any(String),
      opportunity_id: opportunityId,
      client_id: clientId,
      contact_name_id: contactId,
      title: 'Discovery call',
    });

    // The write path must move the opportunity's activity clock.
    const opportunity = await tenantTable('opportunities')
      .where({ opportunity_id: opportunityId })
      .first('last_activity_at');
    expect(new Date(opportunity.last_activity_at).toISOString()).toBe(INTERACTION_DATE);

    const forOpportunity = await InteractionModel.getForEntity(opportunityId, 'opportunity', tenantId);
    const forContact = await InteractionModel.getForEntity(contactId, 'contact', tenantId);

    expect(forOpportunity.map((row) => row.interaction_id)).toContain(created.interaction_id);
    expect(forContact.map((row) => row.interaction_id)).toContain(created.interaction_id);

    expect(forOpportunity[0]).toMatchObject({
      interaction_id: created.interaction_id,
      opportunity_id: opportunityId,
      client_id: clientId,
      contact_name_id: contactId,
      title: 'Discovery call',
    });
  });

  it('does not return the interaction for an unrelated opportunity', async () => {
    const other = await InteractionModel.getForEntity(randomUUID(), 'opportunity', tenantId);
    expect(other).toHaveLength(0);
  });
});
