import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import knex, { type Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const state = vi.hoisted(() => ({ trx: null as Knex.Transaction | null, tenant: '', events: [] as any[], workflows: [] as any[] }));
vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return { ...actual,
    createTenantKnex: async () => ({ knex: state.trx, tenant: state.tenant }),
    runWithTenant: async (tenant: string, fn: () => Promise<unknown>) => {
      const previous = state.tenant; state.tenant = tenant;
      try { return await fn(); } finally { state.tenant = previous; }
    },
  };
});
vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: async () => state.trx }));
vi.mock('@alga-psa/auth', () => ({ localizeActionError: async (error: unknown) => error }));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: async (event: unknown) => { state.events.push(event); },
  publishWorkflowEvent: async (event: unknown) => { state.workflows.push(event); },
}));
import { getSurveyInvitationForToken, submitSurveyResponse } from './surveyResponseActions';
import { issueSurveyToken } from './surveyTokenService';
import { EventSchemas } from '@alga-psa/event-schemas';

const migration = createRequire(import.meta.url)('../../../../server/migrations/20260907190000_add_project_survey_subjects.cjs');
let db: Knex;
beforeAll(() => {
  const database = process.env.DB_NAME_SERVER;
  if (!database || ['server', 'production', 'postgres'].includes(database)) throw new Error('Explicit test database required');
  db = knex({ client: 'pg', connection: {
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database,
    user: process.env.DB_USER_ADMIN, password: process.env.DB_PASSWORD_ADMIN,
  }, pool: { min: 0, max: 1 } });
});
afterAll(async () => { await db?.destroy(); });
beforeEach(async () => {
  state.events = []; state.workflows = [];
  const trx = state.trx = await db.transaction();
  const schema = `survey_response_${randomUUID().replaceAll('-', '')}`;
  await trx.raw('CREATE SCHEMA ??', [schema]);
  await trx.raw('SET LOCAL search_path TO ??, public', [schema]);
  // Clone the migrated column/default/check definitions. Fixtures and all writes
  // remain in a transaction-owned schema; the shared baseline stays untouched.
  for (const table of ['projects', 'tickets', 'clients', 'contacts', 'survey_templates', 'survey_invitations', 'survey_responses']) {
    await trx.raw('CREATE TABLE ?? (LIKE ?? INCLUDING ALL)', [table, `public.${table}`]);
  }
  if (!(await trx.schema.hasColumn('survey_invitations', 'project_id'))) await migration.up(trx);
});
afterEach(async () => { await state.trx?.rollback(); state.trx = null; });

// Keep required fixture fields tied to the actual migrated schema. Column
// defaults supply unrelated product metadata; no query builder is mocked.
async function fixture(kind: 'ticket' | 'project') {
  const trx = state.trx!;
  const tenant = randomUUID(), otherTenant = randomUUID(), subjectId = randomUUID(), templateId = randomUUID();
  const clientId = randomUUID(), contactId = randomUUID();
  const name = 'Correct tenant';
  await trx('clients').insert({ tenant, client_id: clientId, client_name: name });
  await trx('contacts').insert({ tenant, contact_name_id: contactId, full_name: name, client_id: clientId });
  if (kind === 'project') {
    await trx('projects').insert({ tenant, project_id: subjectId, project_number: 'P-123', project_name: name, wbs_code: '1', client_id: clientId, contact_name_id: contactId, status: randomUUID() });
  } else {
    await trx('tickets').insert({ tenant, ticket_id: subjectId, ticket_number: 'T-123', title: name, client_id: clientId, contact_name_id: contactId, status_id: randomUUID(), priority_id: randomUUID(), board_id: randomUUID() });
  }
  await trx('survey_templates').insert({ tenant, template_id: templateId, template_name: 'Response test', rating_type: 'stars', rating_scale: 5, prompt_text: name, comment_prompt: 'Comment', thank_you_text: 'Thanks' });
  const token = issueSurveyToken();
  const invitationId = randomUUID();
  await trx('survey_invitations').insert({ tenant, invitation_id: invitationId, template_id: templateId,
    [`${kind}_id`]: subjectId, client_id: clientId, contact_id: contactId,
    survey_token_hash: token.hashedToken, token_expires_at: new Date(Date.now() + 3600000), sent_at: new Date(Date.now() - 60000),
  });
  return { tenant, otherTenant, subjectId, clientId, contactId, invitationId, token: token.plainToken };
}

describe.each(['ticket', 'project'] as const)('%s survey response persistence', kind => {
  it('resolves the token, persists feedback once and publishes tenant-scoped subject metadata', async () => {
    const f = await fixture(kind);
    const view = await getSurveyInvitationForToken(f.token);
    expect(view).toMatchObject({ [`${kind}Id`]: f.subjectId, template: { promptText: 'Correct tenant' } });
    const result = await submitSurveyResponse({ token: f.token, rating: 1, comment: '  Needs improvement  ' });
    expect(result).toHaveProperty('responseId');
    const rows = await state.trx!('survey_responses').select('*');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenant: f.tenant, [`${kind}_id`]: f.subjectId, [kind === 'ticket' ? 'project_id' : 'ticket_id']: null, rating: 1, comment: 'Needs improvement' });
    expect(await state.trx!('survey_invitations').where({ tenant: f.tenant, invitation_id: f.invitationId }).first()).toMatchObject({ responded: true });
    expect(state.events).toHaveLength(2);
    for (const event of state.events) {
      expect(EventSchemas[event.eventType as keyof typeof EventSchemas].safeParse({ id: randomUUID(), timestamp: new Date().toISOString(), ...event }).success).toBe(true);
      expect(event.payload).toMatchObject({ tenantId: f.tenant, [`${kind}Id`]: f.subjectId });
      expect(event.payload).not.toHaveProperty(kind === 'ticket' ? 'projectId' : 'ticketId');
    }
    expect(state.events[1].payload).toMatchObject({ companyName: 'Correct tenant', contactName: 'Correct tenant', [`${kind}Number`]: kind === 'ticket' ? 'T-123' : 'P-123' });
    expect(state.workflows.find(event => event.eventType === 'SURVEY_RESPONSE_RECEIVED')?.payload).toMatchObject({ [`${kind}Id`]: f.subjectId, score: 1 });
    expect(await submitSurveyResponse({ token: f.token, rating: 5 })).toHaveProperty('actionError');
    expect(await state.trx!('survey_responses').select('*')).toHaveLength(1);
    expect(state.events).toHaveLength(2);
  });
  it('does not publish contact or client metadata owned by another tenant', async () => {
    const f = await fixture(kind);
    // Corrupt references model the absence of composite FKs in legacy data.
    // The production tenant joins must still prevent information disclosure.
    await state.trx!('clients').where({ client_id: f.clientId }).update({ tenant: f.otherTenant, client_name: 'Foreign client' });
    await state.trx!('contacts').where({ contact_name_id: f.contactId }).update({ tenant: f.otherTenant, full_name: 'Foreign contact' });
    expect(await submitSurveyResponse({ token: f.token, rating: 1 })).toHaveProperty('responseId');
    expect(state.events[1].payload.companyName).toBeUndefined();
    expect(state.events[1].payload.contactName).toBeUndefined();
  });
  it('rejects an out-of-range rating without consuming the invitation', async () => {
    const f = await fixture(kind);
    expect(await submitSurveyResponse({ token: f.token, rating: 6 })).toHaveProperty('actionError');
    expect(await state.trx!('survey_responses').select('*')).toHaveLength(0);
    expect(await state.trx!('survey_invitations').where({ invitation_id: f.invitationId }).first()).toMatchObject({ responded: false });
    expect(state.events).toHaveLength(0);
  });
});
