import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { submitPortalServiceRequest } from '../../lib/service-requests/submissionService';
import {
  listDefinitionsForRequester,
  MspSubmissionError,
  resolveRequesterForMspSubmission,
  submitOnBehalfOfMsp,
} from '../../lib/service-requests/mspSubmissions';

let db: Knex;
const tenantsToCleanup = new Set<string>();

const t = (tenant: string, table: string) => tenantDb(db, tenant).table(table);
const tenantRows = () =>
  tenantDb(db, '__test_tenant_fixture__').unscoped('tenants', 'test fixture creates and removes tenant rows');

interface Fixture {
  tenant: string;
  technicianId: string;
  portalUserId: string;
  clientId: string;
  otherClientId: string;
  contactWithUser: string;
  contactWithoutUser: string;
  otherClientContact: string;
  boardId: string;
  statusId: string;
  priorityId: string;
}

async function createUser(tenant: string, userId: string, name: string, extra: Record<string, unknown> = {}) {
  await t(tenant, 'users').insert({
    tenant,
    user_id: userId,
    username: `${name}-${userId.slice(0, 8)}`,
    hashed_password: 'not-used',
    email: `${name}-${userId.slice(0, 8)}@example.com`,
    ...extra,
  });
}

async function createFixture(): Promise<Fixture> {
  const f: Fixture = {
    tenant: uuidv4(),
    technicianId: uuidv4(),
    portalUserId: uuidv4(),
    clientId: uuidv4(),
    otherClientId: uuidv4(),
    contactWithUser: uuidv4(),
    contactWithoutUser: uuidv4(),
    otherClientContact: uuidv4(),
    boardId: uuidv4(),
    statusId: uuidv4(),
    priorityId: uuidv4(),
  };
  const { tenant } = f;
  tenantsToCleanup.add(tenant);

  await tenantRows().insert({
    tenant,
    client_name: `Tenant ${tenant.slice(0, 8)}`,
    email: `tenant-${tenant.slice(0, 8)}@example.com`,
  });
  await createUser(tenant, f.technicianId, 'tech', { user_type: 'internal' });
  for (const [clientId, name] of [[f.clientId, 'A'], [f.otherClientId, 'B']] as const) {
    await t(tenant, 'clients').insert({
      tenant,
      client_id: clientId,
      client_name: `Client ${name} ${tenant.slice(0, 8)}`,
      is_inactive: false,
      billing_cycle: 'monthly',
      is_tax_exempt: false,
    });
  }
  for (const [contactId, clientId, name] of [
    [f.contactWithUser, f.clientId, 'with-user'],
    [f.contactWithoutUser, f.clientId, 'no-user'],
    [f.otherClientContact, f.otherClientId, 'other'],
  ] as const) {
    await t(tenant, 'contacts').insert({
      tenant,
      contact_name_id: contactId,
      full_name: `Contact ${name}`,
      email: `${name}-${tenant.slice(0, 8)}@example.com`,
      client_id: clientId,
    });
  }
  await createUser(tenant, f.portalUserId, 'portal', {
    user_type: 'client',
    contact_id: f.contactWithUser,
    is_inactive: false,
  });

  await t(tenant, 'boards').insert({
    tenant,
    board_id: f.boardId,
    board_name: `Support ${tenant.slice(0, 8)}`,
    description: 'Support board',
    display_order: 10,
    is_default: true,
    is_inactive: false,
    category_type: 'custom',
    priority_type: 'custom',
  });
  await t(tenant, 'priorities').insert({
    tenant,
    priority_id: f.priorityId,
    priority_name: 'High',
    item_type: 'ticket',
    order_number: 10,
    color: '#EF4444',
    created_by: f.technicianId,
  });
  await t(tenant, 'statuses').insert({
    tenant,
    status_id: f.statusId,
    board_id: f.boardId,
    name: 'Open',
    status_type: 'ticket',
    item_type: 'ticket',
    is_closed: false,
    is_default: true,
    order_number: 10,
    created_by: f.technicianId,
  });
  return f;
}

async function createDefinition(f: Fixture, audience?: Record<string, unknown>): Promise<string> {
  const definitionId = uuidv4();
  const executionConfig = {
    boardId: f.boardId,
    statusId: f.statusId,
    priorityId: f.priorityId,
    titleFieldKey: 'request_title',
  };
  const formSchema = {
    fields: [{ key: 'request_title', type: 'short-text', label: 'Request Title', required: true }],
  };
  await t(f.tenant, 'service_request_definitions').insert({
    tenant: f.tenant,
    definition_id: definitionId,
    name: 'Employee Onboarding',
    form_schema: formSchema,
    execution_provider: 'ticket-only',
    execution_config: executionConfig,
    form_behavior_provider: 'basic',
    form_behavior_config: {},
    visibility_provider: 'all-authenticated-client-users',
    visibility_config: {},
    lifecycle_state: 'published',
    published_at: db.fn.now(),
    ...(audience ? { audience: JSON.stringify(audience) } : {}),
  });
  await t(f.tenant, 'service_request_definition_versions').insert({
    tenant: f.tenant,
    version_id: uuidv4(),
    definition_id: definitionId,
    version_number: 1,
    name: 'Employee Onboarding',
    form_schema_snapshot: formSchema,
    execution_provider: 'ticket-only',
    execution_config: executionConfig,
    form_behavior_provider: 'basic',
    form_behavior_config: {},
    visibility_provider: 'all-authenticated-client-users',
    visibility_config: {},
  });
  return definitionId;
}

async function cleanupTenant(tenant: string) {
  for (const table of [
    'ticket_audit_logs',
    'service_request_submission_attachments',
    'service_request_submissions',
    'service_request_definition_versions',
    'service_request_definitions',
    'tickets',
    'next_number',
    'statuses',
    'priorities',
    'boards',
    'contacts',
    'clients',
    'users',
    'tenant_settings',
  ]) {
    await t(tenant, table).del();
  }
  await tenantRows().where({ tenant }).del();
}

async function submitMsp(
  f: Fixture,
  definitionId: string,
  contactId: string,
  extra: { clientSubmissionKey?: string | null; clientId?: string } = {}
) {
  const requester = await resolveRequesterForMspSubmission(
    db,
    f.tenant,
    extra.clientId ?? f.clientId,
    contactId,
    f.technicianId
  );
  return submitOnBehalfOfMsp({
    knex: db,
    tenant: f.tenant,
    definitionId,
    requester,
    payload: { request_title: 'Laptop for new hire' },
    clientSubmissionKey: extra.clientSubmissionKey ?? null,
  });
}

const countRows = async (tenant: string, table: string) =>
  Number((await t(tenant, table).count('* as n').first())?.n ?? 0);

describe('MSP submit service request on behalf of a client contact', () => {
  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
  });
  afterEach(async () => {
    for (const tenant of tenantsToCleanup) {
      await cleanupTenant(tenant);
      tenantsToCleanup.delete(tenant);
    }
  });
  afterAll(async () => {
    await db?.destroy();
  });

  it('contact WITH a portal user: portal user is requester, technician is submitter/entered_by', async () => {
    const f = await createFixture();
    const definitionId = await createDefinition(f);
    const result = await submitMsp(f, definitionId, f.contactWithUser);
    expect(result.executionStatus).toBe('succeeded');

    const submission = await t(f.tenant, 'service_request_submissions').where({ submission_id: result.submissionId }).first();
    expect(submission).toMatchObject({
      requester_user_id: f.portalUserId,
      submitted_by_user_id: f.technicianId,
      contact_id: f.contactWithUser,
      client_id: f.clientId,
    });
    const ticket = await t(f.tenant, 'tickets').where({ ticket_id: result.createdTicketId }).first();
    expect(ticket).toMatchObject({
      contact_name_id: f.contactWithUser,
      client_id: f.clientId,
      entered_by: f.technicianId,
      ticket_origin: 'internal',
      source: 'msp',
    });
    const audit = await db('audit_logs')
      .where({ tenant: f.tenant, operation: 'service_request_submission_created' })
      .first();
    expect(audit?.user_id).toBe(f.technicianId);
    expect(JSON.stringify(audit?.details)).toContain(f.portalUserId);
  });

  it('contact WITHOUT a portal user: requester_user_id is NULL, technician is never the requester', async () => {
    const f = await createFixture();
    const definitionId = await createDefinition(f);
    const result = await submitMsp(f, definitionId, f.contactWithoutUser);
    expect(result.executionStatus).toBe('succeeded');

    const submission = await t(f.tenant, 'service_request_submissions').where({ submission_id: result.submissionId }).first();
    expect(submission.requester_user_id).toBeNull();
    expect(submission.submitted_by_user_id).toBe(f.technicianId);
    expect(submission.contact_id).toBe(f.contactWithoutUser);
    const ticket = await t(f.tenant, 'tickets').where({ ticket_id: result.createdTicketId }).first();
    expect(ticket).toMatchObject({
      contact_name_id: f.contactWithoutUser,
      client_id: f.clientId,
      entered_by: f.technicianId,
      ticket_origin: 'internal',
      source: 'msp',
    });
  });

  it('an inactive portal user is treated as no portal user', async () => {
    const f = await createFixture();
    await t(f.tenant, 'users').where({ user_id: f.portalUserId }).update({ is_inactive: true });
    const requester = await resolveRequesterForMspSubmission(db, f.tenant, f.clientId, f.contactWithUser, f.technicianId);
    expect(requester.requesterUserId).toBeNull();
    expect(requester.submittedByUserId).toBe(f.technicianId);
  });

  it('audience refusal: an excluded contact cannot be submitted for; no submission or ticket is created', async () => {
    const f = await createFixture();
    const audience = {
      join: 'or',
      clauses: [{ path: 'contact.id', operator: 'in', value: [f.contactWithUser] }],
    };
    const definitionId = await createDefinition(f, audience);

    const requester = await resolveRequesterForMspSubmission(db, f.tenant, f.clientId, f.contactWithoutUser, f.technicianId);
    expect((await listDefinitionsForRequester(db, f.tenant, requester)).map((item) => item.definitionId)).not.toContain(definitionId);

    await expect(submitMsp(f, definitionId, f.contactWithoutUser)).rejects.toMatchObject({
      code: 'definition_not_visible',
    });
    expect(await countRows(f.tenant, 'service_request_submissions')).toBe(0);
    expect(await countRows(f.tenant, 'tickets')).toBe(0);

    // The included contact still sees and can file it.
    const visible = await listDefinitionsForRequester(
      db,
      f.tenant,
      await resolveRequesterForMspSubmission(db, f.tenant, f.clientId, f.contactWithUser, f.technicianId)
    );
    expect(visible.map((item) => item.definitionId)).toContain(definitionId);
    expect((await submitMsp(f, definitionId, f.contactWithUser)).executionStatus).toBe('succeeded');
  });

  it('rejects a contact that does not belong to the client', async () => {
    const f = await createFixture();
    const definitionId = await createDefinition(f);
    await expect(submitMsp(f, definitionId, f.otherClientContact)).rejects.toBeInstanceOf(MspSubmissionError);
    await expect(submitMsp(f, definitionId, uuidv4())).rejects.toMatchObject({ code: 'contact_not_found' });
    expect(await countRows(f.tenant, 'service_request_submissions')).toBe(0);
    expect(await countRows(f.tenant, 'tickets')).toBe(0);
  });

  for (const [label, pick] of [
    ['portal-user contact', (f: Fixture) => f.contactWithUser],
    ['NULL-requester contact', (f: Fixture) => f.contactWithoutUser],
  ] as const) {
    it(`same-key replay yields one submission and one ticket (${label})`, async () => {
      const f = await createFixture();
      const definitionId = await createDefinition(f);
      const key = uuidv4();
      const first = await submitMsp(f, definitionId, pick(f), { clientSubmissionKey: key });
      const second = await submitMsp(f, definitionId, pick(f), { clientSubmissionKey: key });
      expect(second.replayed).toBe(true);
      expect(second.submissionId).toBe(first.submissionId);
      expect(second.createdTicketId).toBe(first.createdTicketId);
      expect(await countRows(f.tenant, 'service_request_submissions')).toBe(1);
      expect(await countRows(f.tenant, 'tickets')).toBe(1);
    });
  }

  it('concurrent same-key submits for a NULL-requester contact collapse to one submission', async () => {
    const f = await createFixture();
    const definitionId = await createDefinition(f);
    const key = uuidv4();
    const results = await Promise.all([
      submitMsp(f, definitionId, f.contactWithoutUser, { clientSubmissionKey: key }),
      submitMsp(f, definitionId, f.contactWithoutUser, { clientSubmissionKey: key }),
    ]);
    expect(new Set(results.map((r) => r.submissionId)).size).toBe(1);
    expect(await countRows(f.tenant, 'service_request_submissions')).toBe(1);
  });

  it('portal regression: portal submissions stay client_portal, requester-owned, with no submitter', async () => {
    const f = await createFixture();
    const definitionId = await createDefinition(f);
    const result = await submitPortalServiceRequest({
      knex: db,
      tenant: f.tenant,
      definitionId,
      requesterUserId: f.portalUserId,
      clientId: f.clientId,
      contactId: f.contactWithUser,
      payload: { request_title: 'From the portal' },
    });
    expect(result.executionStatus).toBe('succeeded');
    const submission = await t(f.tenant, 'service_request_submissions').where({ submission_id: result.submissionId }).first();
    expect(submission.requester_user_id).toBe(f.portalUserId);
    expect(submission.submitted_by_user_id).toBeNull();
    const ticket = await t(f.tenant, 'tickets').where({ ticket_id: result.createdTicketId }).first();
    expect(ticket).toMatchObject({
      entered_by: f.portalUserId,
      ticket_origin: 'client_portal',
      source: 'client_portal',
      contact_name_id: f.contactWithUser,
    });
  });
});
