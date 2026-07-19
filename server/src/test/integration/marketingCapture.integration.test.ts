/**
 * T003 — capture-form happy path.
 *
 * submitCaptureInternal with a previously unseen email must, in one flow:
 * create a prospect client + linked contact, upsert the marketing consent
 * row, record a 'Marketing: Form Submitted' interaction attributed to the
 * form's campaign, and persist an 'inbound-lead' opportunity suggestion with
 * the form/campaign attribution in evidence. A second submission with the
 * same email matches the existing contact and dedupes the suggestion.
 *
 * The marketing interaction-type seed migration inserts global
 * system_interaction_types rows at migrate time (zero on a fresh test DB), so the suite re-runs it for the
 * tenant created here before exercising engagement recording.
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

const describeDb = await describeWithDb();
const requireCjs = createRequire(import.meta.url);

// Suggestion persistence fires OPPORTUNITY_SUGGESTION_CREATED after commit;
// keep event publishing out of the test entirely.
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

describeDb('T003: marketing capture form submission', () => {
  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
    tenantId = await createTenant(db, 'Marketing Capture Tenant');
    userId = await createUser(db, tenantId, { username: 'marketing.capture.test' });

    const seedTypes = requireCjs('../../../migrations/20260719103000_seed_marketing_interaction_types.cjs');
    await seedTypes.up(db);
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it('creates prospect client, contact, consent, attributed interaction, and inbound-lead suggestion', async () => {
    const campaign = await createCampaignInternal(db, tenantId, { name: 'Spring Launch', status: 'active' }, userId);
    const form = await createFormInternal(db, tenantId, {
      name: 'Demo Request',
      slug: 'demo-request',
      campaign_id: campaign.campaign_id,
      creates_suggestion: true,
    }, userId);

    const result = await submitCaptureInternal(db, tenantId, 'demo-request', {
      name: 'Grace Hopper',
      email: 'Grace.Hopper@Example.COM',
      company: 'Compilers Inc',
      message: 'We need a demo next week',
    });

    expect(result.contactCreated).toBe(true);
    expect(result.clientCreated).toBe(true);
    expect(result.suggestionCreated).toBe(true);

    // Prospect client named after the submitted company.
    const client = await tenantTable('clients').where({ tenant: tenantId, client_id: result.clientId }).first();
    expect(client).toMatchObject({
      client_name: 'Compilers Inc',
      lifecycle_status: 'prospect',
    });

    // Contact created, email normalized, linked to the new client.
    const contact = await tenantTable('contacts')
      .where({ tenant: tenantId, contact_name_id: result.contactId })
      .first();
    expect(contact).toMatchObject({
      full_name: 'Grace Hopper',
      email: 'grace.hopper@example.com',
      client_id: result.clientId,
    });

    // Marketing consent state recorded for the contact.
    const contactState = await tenantTable('marketing_contact_state')
      .where({ tenant: tenantId, contact_id: result.contactId })
      .first();
    expect(contactState).toMatchObject({ consent: true, source: 'capture:demo-request' });

    // 'Marketing: Form Submitted' interaction logged against contact+client,
    // joined back to the campaign through marketing_engagements.
    const formType = await db('system_interaction_types')
      .where({ type_name: 'Marketing: Form Submitted' })
      .first('type_id');
    expect(formType).toBeDefined();

    const interaction = await tenantTable('interactions')
      .where({
        tenant: tenantId,
        type_id: formType.type_id,
        contact_name_id: result.contactId,
        client_id: result.clientId,
      })
      .first();
    expect(interaction).toMatchObject({
      title: 'Form submitted: Demo Request',
      notes: 'We need a demo next week',
      category: 'marketing',
      visibility: 'internal',
    });

    const engagement = await tenantTable('marketing_engagements')
      .where({ tenant: tenantId, interaction_id: interaction.interaction_id })
      .first();
    expect(engagement).toMatchObject({ campaign_id: campaign.campaign_id });

    // Inbound-lead suggestion carries the capture attribution.
    const suggestions = await tenantTable('opportunity_suggestions')
      .where({ tenant: tenantId, generator_key: 'inbound-lead' });
    expect(suggestions).toHaveLength(1);
    const suggestion = suggestions[0];
    expect(suggestion.client_id).toBe(result.clientId);
    expect(suggestion.dedupe_key).toBe(`inbound-lead:${form.form_id}:grace.hopper@example.com`);
    expect(suggestion.evidence).toMatchObject({
      source: 'capture_form',
      formId: form.form_id,
      formName: 'Demo Request',
      campaignId: campaign.campaign_id,
      contactId: result.contactId,
      contactEmail: 'grace.hopper@example.com',
    });
  });

  it('matches the existing contact and dedupes the suggestion on a repeat submission', async () => {
    const form = await createFormInternal(db, tenantId, {
      name: 'Newsletter',
      slug: 'newsletter',
      creates_suggestion: true,
    }, userId);

    const first = await submitCaptureInternal(db, tenantId, 'newsletter', {
      name: 'Alan Turing',
      email: 'alan@example.com',
      company: 'Computing Machinery',
      message: 'first touch',
    });
    expect(first.contactCreated).toBe(true);
    expect(first.suggestionCreated).toBe(true);

    const second = await submitCaptureInternal(db, tenantId, 'newsletter', {
      name: 'Alan T.',
      email: 'ALAN@example.com',
      company: 'Somewhere Else',
      message: 'second touch',
    });
    expect(second.contactCreated).toBe(false);
    expect(second.clientCreated).toBe(false);
    expect(second.contactId).toBe(first.contactId);
    expect(second.clientId).toBe(first.clientId);
    expect(second.suggestionCreated).toBe(false);

    const contacts = await tenantTable('contacts')
      .where({ tenant: tenantId })
      .whereRaw('lower(email) = ?', ['alan@example.com']);
    expect(contacts).toHaveLength(1);

    const suggestions = await tenantTable('opportunity_suggestions')
      .where({ tenant: tenantId, generator_key: 'inbound-lead' })
      .where('dedupe_key', `inbound-lead:${form.form_id}:alan@example.com`);
    expect(suggestions).toHaveLength(1);

    // Both submissions logged a form_submitted interaction on the same contact.
    const formType = await db('system_interaction_types')
      .where({ type_name: 'Marketing: Form Submitted' })
      .first('type_id');
    const interactions = await tenantTable('interactions')
      .where({ tenant: tenantId, type_id: formType.type_id, contact_name_id: first.contactId });
    expect(interactions).toHaveLength(2);
  });
});
