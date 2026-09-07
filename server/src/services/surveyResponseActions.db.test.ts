import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import knex, { type Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const state = vi.hoisted(() => ({ trx: null as Knex.Transaction | null, tenant: '', events: [] as any[], workflows: [] as any[], emails: [] as any[], emailError: null as string | null }));
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
vi.mock('@alga-psa/auth', () => ({ localizeActionError: async (error: unknown) => error, withAuth: (fn: any) => (...args: any[]) => fn({}, { tenant: state.tenant }, ...args) }));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: async (event: unknown) => { state.events.push(event); },
  publishWorkflowEvent: async (event: unknown) => { state.workflows.push(event); },
}));
vi.mock('../lib/db', async () => {
  const db = await import('@alga-psa/db');
  return { createTenantKnex: db.createTenantKnex, runWithTenant: db.runWithTenant };
});
vi.mock('../lib/eventBus/publishers', () => ({
  publishWorkflowEvent: async (event: unknown) => { state.workflows.push(event); },
}));
vi.mock('@alga-psa/email', async () => {
  const { DatabaseTemplateProcessor } = await import('../../../packages/email/src/templateProcessors');
  return { DatabaseTemplateProcessor, TenantEmailService: { getInstance: () => ({
    sendEmail: async (options: any) => {
      const rendered = await options.templateProcessor.process(options);
      state.emails.push({ ...rendered, to: options.to, headers: options.headers });
      return state.emailError ? { success: false, error: state.emailError } : { success: true, messageId: 'test-message' };
    },
  }) } };
});
import SurveyAnalyticsService from '../../../packages/surveys/src/services/SurveyAnalyticsService';
import { getSurveyFilterOptions } from '../../../packages/surveys/src/actions/survey-actions/surveyResponseFilterActions';
import { sendSurveyInvitation } from './surveyService';
import { getSurveyInvitationForToken, submitSurveyResponse } from '../../../packages/surveys/src/actions/surveyResponseActions';
import { issueSurveyToken } from '../../../packages/surveys/src/actions/surveyTokenService';
import { EventSchemas } from '@alga-psa/event-schemas';

const require = createRequire(import.meta.url);
const emailMigration = require('../../migrations/20260907200000_add_project_survey_email_template.cjs');
const { upsertEmailTemplate } = require('../../migrations/utils/templates/_shared/upsertEmailTemplates.cjs');
const ticketTemplate = require('../../migrations/utils/templates/email/surveys/surveyTicketClosed.cjs');
const migration = createRequire(import.meta.url)('../../migrations/20260907190000_add_project_survey_subjects.cjs');
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
  state.events = []; state.workflows = []; state.emails = []; state.emailError = null;
  const trx = state.trx = await db.transaction();
  const schema = `survey_response_${randomUUID().replaceAll('-', '')}`;
  await trx.raw('CREATE SCHEMA ??', [schema]);
  await trx.raw('SET LOCAL search_path TO ??, public', [schema]);
  // Clone the migrated column/default/check definitions. Fixtures and all writes
  // remain in a transaction-owned schema; the shared baseline stays untouched.
  for (const table of ['projects', 'tickets', 'clients', 'contacts', 'users', 'tenants', 'survey_templates', 'survey_invitations', 'survey_responses', 'notification_categories', 'notification_subtypes', 'system_email_templates', 'tenant_email_templates']) {
    await trx.raw('CREATE TABLE ?? (LIKE ?? INCLUDING ALL)', [table, `public.${table}`]);
  }
  if (!(await trx.schema.hasColumn('survey_invitations', 'project_id'))) await migration.up(trx);
  await emailMigration.up(trx);
  await upsertEmailTemplate(trx, ticketTemplate.getTemplate());
});
afterEach(async () => { await state.trx?.rollback(); state.trx = null; });

// Keep required fixture fields tied to the actual migrated schema. Column
// defaults supply unrelated product metadata; no query builder is mocked.
async function fixture(kind: 'ticket' | 'project') {
  const trx = state.trx!;
  const tenant = randomUUID(), otherTenant = randomUUID(), subjectId = randomUUID(), templateId = randomUUID();
  const clientId = randomUUID(), contactId = randomUUID();
  const name = 'Correct tenant';
  await trx('tenants').insert({ tenant, client_name: name, email: 'tenant@example.test' });
  await trx('clients').insert({ tenant, client_id: clientId, client_name: name });
  await trx('contacts').insert({ tenant, contact_name_id: contactId, full_name: name, client_id: clientId, email: 'survey@example.test' });
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
  it('renders an invitation whose link resolves and accepts a response', async () => {
    const f = await fixture(kind);
    await state.trx!('survey_invitations').delete();
    const params = { tenantId: f.tenant, locale: 'en', ...(kind === 'project' ? { projectId: f.subjectId } : { ticketId: f.subjectId }) };
    const invitation = await sendSurveyInvitation(params);
    const delivered = state.emails[0];
    expect(delivered.to).toBe('survey@example.test');
    expect(delivered.subject).toContain(`${kind} ${kind === 'project' ? 'P-123' : 'T-123'}`);
    expect(delivered.text).toContain('Correct tenant');
    expect(delivered.html).toContain(invitation.surveyUrl);
    expect(delivered.html).not.toContain('{{');
    expect(delivered.text).not.toContain('{{');
    const token = decodeURIComponent(new URL(invitation.surveyUrl).pathname.split('/').at(-1)!);
    expect(await getSurveyInvitationForToken(token)).toMatchObject({ [`${kind}Id`]: f.subjectId });
    expect(await submitSurveyResponse({ token, rating: 5 })).toHaveProperty('responseId');
    expect(state.workflows.find(event => event.eventType === 'SURVEY_SENT')?.payload).toMatchObject({ [`${kind}Id`]: f.subjectId });
    await sendSurveyInvitation(params);
    expect(state.workflows.find(event => event.eventType === 'SURVEY_REMINDER_SENT')?.payload).toMatchObject({ [`${kind}Id`]: f.subjectId, reminderNumber: 2 });
  });
  it('rejects a recipient from another tenant before sending or persisting an invitation', async () => {
    const f = await fixture(kind);
    await state.trx!('survey_invitations').delete();
    await state.trx!('contacts').where({ contact_name_id: f.contactId }).update({ tenant: f.otherTenant });
    await expect(sendSurveyInvitation({ tenantId: f.tenant, locale: 'en', ...(kind === 'project' ? { projectId: f.subjectId } : { ticketId: f.subjectId }) })).rejects.toThrow('active contact with an email address');
    expect(await state.trx!('survey_invitations').select('*')).toHaveLength(0);
    expect(state.emails).toHaveLength(0);
  });
  it.each(['Synthetic transport failure', 'Sender domain is not verified'])('rejects delivery failure (%s) without persisting an invitation or publishing sent events', async error => {
    const f = await fixture(kind);
    await state.trx!('survey_invitations').delete();
    state.emailError = error;
    await expect(sendSurveyInvitation({ tenantId: f.tenant, locale: 'en', ...(kind === 'project' ? { projectId: f.subjectId } : { ticketId: f.subjectId }) })).rejects.toThrow(error);
    expect(await state.trx!('survey_invitations').select('*')).toHaveLength(0);
    expect(state.workflows).toHaveLength(0);
    state.emailError = null;
    const retry = await sendSurveyInvitation({ tenantId: f.tenant, locale: 'en', ...(kind === 'project' ? { projectId: f.subjectId } : { ticketId: f.subjectId }) });
    expect(await state.trx!('survey_invitations').select('*')).toHaveLength(1);
    expect(state.workflows.map(event => event.eventType)).toEqual(['SURVEY_SENT']);
    const token = decodeURIComponent(new URL(retry.surveyUrl).pathname.split('/').at(-1)!);
    expect(await getSurveyInvitationForToken(token)).toMatchObject({ [`${kind}Id`]: f.subjectId });
  });
  it('reports the subject and assigned technician in lists, negative feedback and filters', async () => {
    const f = await fixture(kind);
    const userId = randomUUID();
    await state.trx!('users').insert({ tenant: f.tenant, user_id: userId, username: 'report-agent', first_name: 'Report', last_name: 'Agent', email: 'agent@example.test', hashed_password: 'synthetic', user_type: 'internal' });
    await state.trx!(kind === 'project' ? 'projects' : 'tickets').where({ [`${kind}_id`]: f.subjectId }).update({ assigned_to: userId });
    expect(await submitSurveyResponse({ token: f.token, rating: 1 })).toHaveProperty('responseId');
    const expected = { [`${kind}Id`]: f.subjectId, [`${kind}Number`]: kind === 'project' ? 'P-123' : 'T-123' };
    const page = await SurveyAnalyticsService.getResponsesPage(state.trx!, f.tenant, { filters: { technicianId: userId } });
    expect(page.totalCount).toBe(1);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ ...expected, technicianName: 'Report Agent' });
    const issues = await SurveyAnalyticsService.getTopNegativeResponses(state.trx!, f.tenant, { technicianId: userId });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ ...expected, assignedAgentName: 'Report Agent' });
    expect((await SurveyAnalyticsService.getResponsesPage(state.trx!, f.tenant, { filters: { technicianId: randomUUID() } })).totalCount).toBe(0);
    expect((await SurveyAnalyticsService.getResponsesPage(state.trx!, f.otherTenant)).totalCount).toBe(0);
    state.tenant = f.tenant;
    expect((await getSurveyFilterOptions()).technicians).toEqual([{ value: userId, label: 'Report Agent' }]);
    await state.trx!('users').where({ user_id: userId }).update({ tenant: f.otherTenant });
    expect((await SurveyAnalyticsService.getResponsesPage(state.trx!, f.tenant)).items[0].technicianName).toBeNull();
    expect((await getSurveyFilterOptions()).technicians).toEqual([]);
  });
  it('rejects an out-of-range rating without consuming the invitation', async () => {
    const f = await fixture(kind);
    expect(await submitSurveyResponse({ token: f.token, rating: 6 })).toHaveProperty('actionError');
    expect(await state.trx!('survey_responses').select('*')).toHaveLength(0);
    expect(await state.trx!('survey_invitations').where({ invitation_id: f.invitationId }).first()).toMatchObject({ responded: false });
    expect(state.events).toHaveLength(0);
  });
});

it('installs all project email translations idempotently and rolls back without removing ticket templates', async () => {
  const trx = state.trx!;
  await emailMigration.up(trx);
  const projects = await trx('system_email_templates').where({ name: 'SURVEY_PROJECT_CLOSED' });
  expect(projects.map(row => row.language_code).sort()).toEqual(['de', 'en', 'es', 'fr', 'it', 'nl', 'pl', 'pt']);
  const { DatabaseTemplateProcessor } = await import('@alga-psa/email');
  for (const row of projects) {
    const rendered = await new DatabaseTemplateProcessor(trx, 'SURVEY_PROJECT_CLOSED').process({ locale: row.language_code,
      templateData: { project_number: 'P-123', project_name: 'Migration project', project_closed_at: '', contact_name: 'Customer', technician_name: 'Technician', prompt_text: 'Rate your project', thank_you_text: 'Thanks', tenant_name: 'Team', survey_url: 'https://example.test/survey', rating_buttons_html: '<a href="https://example.test/survey">5</a>', rating_links_text: '5: https://example.test/survey' },
    });
    expect(rendered.subject).toContain('P-123');
    expect(rendered.html).toContain('Migration project');
    expect(rendered.html).not.toContain('{{');
    expect(rendered.text).not.toContain('{{');
  }
  await emailMigration.down(trx);
  expect(await trx('system_email_templates').where({ name: 'SURVEY_PROJECT_CLOSED' })).toHaveLength(0);
  expect(await trx('system_email_templates').where({ name: 'SURVEY_TICKET_CLOSED' })).toHaveLength(8);
  await emailMigration.up(trx);
  expect(await trx('system_email_templates').where({ name: 'SURVEY_PROJECT_CLOSED' })).toHaveLength(8);
});
