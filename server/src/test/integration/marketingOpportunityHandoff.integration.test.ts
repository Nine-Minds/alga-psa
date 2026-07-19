/**
 * T004 — inbound-lead opportunity handoff.
 *
 * Accepting a persisted inbound-lead suggestion (via the opportunities
 * module's real accept path, acceptSuggestionInternal) must create an
 * opportunity that carries the marketing provenance: opportunity_type
 * 'new_logo', generator_key 'inbound-lead', the suggestion evidence verbatim
 * as generator_context, and a follow-up next_action. The marketing
 * interaction that produced the lead stays on the account timeline
 * (interactions keyed by client/contact — no UI registration needed).
 *
 * Requires the standard test DB; skipped automatically when no database is
 * reachable unless REQUIRE_DB=1.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createTenant, createUser } from '../../../test-utils/testDataFactory';

import { submitCaptureInternal } from '../../../../packages/marketing/src/lib/capture';
import { createCampaignInternal } from '../../../../packages/marketing/src/lib/campaigns';
import { createFormInternal } from '../../../../packages/marketing/src/lib/forms';
import { acceptSuggestionInternal } from '../../../../packages/opportunities/src/lib/suggestions';

const describeDb = await describeWithDb();
const requireCjs = createRequire(import.meta.url);

// Accepting a suggestion publishes OPPORTUNITY_CREATED after commit; keep
// event publishing out of the test entirely.
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(() => Promise.resolve()),
  publishWorkflowEvent: vi.fn(() => Promise.resolve()),
}));

let db: Knex;
let tenantId: string;
let userId: string;

function tenantTable(table: string) {
  return tenantDb(db, tenantId).table(table);
}

describeDb('T004: inbound-lead opportunity handoff', () => {
  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
    tenantId = await createTenant(db, 'Marketing Handoff Tenant');
    userId = await createUser(db, tenantId, { username: 'marketing.handoff.test' });

    const seedTypes = requireCjs('../../../migrations/20260719103000_seed_marketing_interaction_types.cjs');
    await seedTypes.up(db);
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it('creates a new_logo opportunity carrying the capture attribution', async () => {
    const campaign = await createCampaignInternal(db, tenantId, { name: 'Q3 Push', status: 'active' }, userId);
    const form = await createFormInternal(db, tenantId, {
      name: 'Contact Sales',
      slug: 'contact-sales',
      campaign_id: campaign.campaign_id,
      creates_suggestion: true,
    }, userId);

    const capture = await submitCaptureInternal(db, tenantId, 'contact-sales', {
      name: 'Katherine Johnson',
      email: 'katherine@example.com',
      company: 'Orbital Mechanics',
      message: 'Pricing question',
    });
    expect(capture.suggestionCreated).toBe(true);

    const suggestion = await tenantTable('opportunity_suggestions')
      .where({ tenant: tenantId, generator_key: 'inbound-lead' })
      .first();
    expect(suggestion).toBeDefined();

    const opportunity = await acceptSuggestionInternal(db, tenantId, suggestion.suggestion_id, userId);

    expect(opportunity).toMatchObject({
      client_id: capture.clientId,
      opportunity_type: 'new_logo',
      generator_key: 'inbound-lead',
      next_action: 'Follow up on the inbound enquiry',
      suggestion_id: suggestion.suggestion_id,
      status: 'open',
    });

    // generator_context is the suggestion evidence verbatim: the marketing
    // attribution survives the handoff onto the opportunity itself.
    const opportunityRow = await tenantTable('opportunities')
      .where({ tenant: tenantId, opportunity_id: opportunity.opportunity_id })
      .first();
    expect(opportunityRow.generator_context).toMatchObject({
      source: 'capture_form',
      formId: form.form_id,
      formName: 'Contact Sales',
      campaignId: campaign.campaign_id,
      contactId: capture.contactId,
      contactEmail: 'katherine@example.com',
    });

    // The suggestion points at the created opportunity.
    const acceptedSuggestion = await tenantTable('opportunity_suggestions')
      .where({ tenant: tenantId, suggestion_id: suggestion.suggestion_id })
      .first();
    expect(acceptedSuggestion).toMatchObject({
      status: 'accepted',
      created_opportunity_id: opportunity.opportunity_id,
    });

    // The marketing interaction that produced the lead sits on the same
    // account timeline the opportunity belongs to (interactions are keyed by
    // client/contact), linked back to the campaign via marketing_engagements.
    const formType = await db('system_interaction_types')
      .where({ type_name: 'Marketing: Form Submitted' })
      .first('type_id');
    const timelineInteraction = await tenantTable('interactions')
      .where({
        tenant: tenantId,
        type_id: formType.type_id,
        client_id: opportunity.client_id,
        contact_name_id: capture.contactId,
      })
      .first();
    expect(timelineInteraction).toBeDefined();

    const engagement = await tenantTable('marketing_engagements')
      .where({ tenant: tenantId, interaction_id: timelineInteraction.interaction_id })
      .first();
    expect(engagement).toMatchObject({ campaign_id: campaign.campaign_id });
  });
});
