import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { isoDateTimeSchema } from '../../../../shared/workflow/runtime/actions/businessOperations/shared';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

/**
 * The workflow `tickets.create` action against a real, migrated database. The real
 * withTenantTransaction (an owning withTransaction frame) is used so the after-commit
 * ticket events actually flush; only the permission check and the event bus are replaced.
 */
const published: Array<{ eventType: string; payload: Record<string, any> }> = [];

vi.mock('@alga-psa/event-bus/publishers', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/event-bus/publishers')>(
    '@alga-psa/event-bus/publishers'
  );
  const capture = async (event: { eventType: string; payload: Record<string, any> }) => {
    published.push({ eventType: event.eventType, payload: event.payload });
  };
  return { ...actual, publishEvent: vi.fn(capture), publishWorkflowEvent: vi.fn(capture) };
});

vi.mock('../../../../shared/workflow/runtime/actions/businessOperations/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../shared/workflow/runtime/actions/businessOperations/shared')>();
  return { ...actual, requirePermission: async () => undefined };
});

let db: Knex;

interface Fixture {
  tenant: string;
  clientId: string;
  actorId: string;
  boardId: string;
  statusId: string;
  priorityId: string;
  workflowId: string;
}

const WORKFLOW_A = uuidv4();

async function createFixture(lineage: string[] = [WORKFLOW_A]): Promise<Fixture & { runId: string }> {
  const tenant = await createTenant(db, `WfTicket ${uuidv4().slice(0, 6)}`);
  const clientId = await createClient(db, tenant, 'Acme Corp');
  const actorId = await createUser(db, tenant);
  const scoped = tenantDb(db, tenant);
  const boardId = uuidv4();
  await scoped.table('boards').insert({ tenant, board_id: boardId, board_name: 'Support', is_default: true });
  const statusId = uuidv4();
  await scoped.table('statuses').insert({
    tenant, status_id: statusId, board_id: boardId, name: 'New', status_type: 'ticket',
    item_type: 'ticket', order_number: 1, is_default: true, is_closed: false,
  });
  const priorityId = uuidv4();
  await scoped.table('priorities').insert({
    tenant, priority_id: priorityId, priority_name: 'Medium', item_type: 'ticket',
    order_number: 1, color: '#ccc', created_by: actorId,
  });

  const workflowId = uuidv4();
  const now = new Date().toISOString();
  await scoped.table('workflow_definitions').insert({
    workflow_id: workflowId, tenant, name: 'Create ticket', description: null,
    payload_schema_ref: 'schema://test', trigger: {}, draft_definition: { id: workflowId },
    draft_version: 1, status: 'published', created_by: actorId, updated_by: actorId,
    created_at: now, updated_at: now,
  });
  await scoped.table('workflow_definition_versions').insert({
    version_id: uuidv4(), workflow_id: workflowId, tenant, version: 1,
    definition_json: { id: workflowId }, payload_schema_json: {},
    published_by: actorId, published_at: now, created_at: now, updated_at: now,
  });
  const runId = uuidv4();
  await scoped.table('workflow_runs').insert({
    run_id: runId, workflow_id: workflowId, workflow_version: 1, tenant, status: 'running',
    trigger_metadata_json: JSON.stringify(lineage.length ? { workflowLineage: lineage } : {}),
    started_at: now, updated_at: now,
  });
  return { tenant, clientId, actorId, boardId, statusId, priorityId, workflowId, runId };
}

const baseInput = (f: Fixture, extra: Record<string, unknown> = {}) => ({
  client_id: f.clientId,
  title: 'Disk full on SRV-01',
  board_id: f.boardId,
  status_id: f.statusId,
  priority_id: f.priorityId,
  ...extra,
});

const run = async (f: Fixture & { runId: string }, extra: Record<string, unknown> = {}) =>
  runWith(f, baseInput(f, extra));

async function runWith(f: Fixture & { runId: string }, input: Record<string, unknown>) {
  const { getActionRegistryV2 } = await import('../../../../shared/workflow/runtime/registries/actionRegistry');
  const action = getActionRegistryV2().get('tickets.create', 1)!;
  const parsed = action.inputSchema.parse(input);
  const result = await action.handler(parsed, {
    runId: f.runId,
    stepPath: 'steps.create',
    idempotencyKey: uuidv4(),
    attempt: 1,
    nowIso: () => new Date().toISOString(),
    env: {},
    tenantId: f.tenant,
    knex: db,
  } as any);
  // The real runtime validates handler output against outputSchema; do the same here
  // so output-contract regressions (e.g. created_at as Date) fail these tests.
  const validated = action.outputSchema.parse(result) as { created_at?: unknown };
  expect(typeof validated.created_at).toBe('string');
  expect(isoDateTimeSchema.safeParse(validated.created_at).success).toBe(true);
  return result;
}

const byType = (type: string) => published.filter((e) => e.eventType === type);

describe('workflow tickets.create publishes ticket events (integration)', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
    const { registerTicketActions } = await import(
      '../../../../shared/workflow/runtime/actions/businessOperations/tickets'
    );
    registerTicketActions();
  }, 900_000);

  afterAll(async () => {
    await db?.destroy();
  });

  beforeEach(() => {
    published.length = 0;
  });

  it('user primary: stamps the run actor, workflow activity and provenance on TICKET_CREATED and TICKET_ASSIGNED', async () => {
    const f = await createFixture();
    const result = await run(f, { assignment: { primary: { type: 'user', id: f.actorId } } });

    const ticket = await tenantDb(db, f.tenant).table('tickets').where({ ticket_id: result.ticket_id }).first();
    expect(ticket).toMatchObject({ entered_by: f.actorId, source: 'workflow', assigned_to: f.actorId });

    const activity = await tenantDb(db, f.tenant)
      .table('ticket_audit_logs')
      .where({ ticket_id: result.ticket_id, event_type: 'TICKET_CREATED' })
      .first();
    expect(activity).toMatchObject({ actor_type: 'workflow', source: 'workflow' });

    const created = byType('TICKET_CREATED');
    expect(created).toHaveLength(1);
    expect(created[0].payload).toMatchObject({
      tenantId: f.tenant,
      ticketId: result.ticket_id,
      userId: f.actorId,
      workflowRunId: f.runId,
      workflowLineage: [WORKFLOW_A, f.workflowId],
    });
    const assigned = byType('TICKET_ASSIGNED');
    expect(assigned).toHaveLength(1);
    expect(assigned[0].payload).toMatchObject({
      ticketId: result.ticket_id,
      workflowRunId: f.runId,
      workflowLineage: [WORKFLOW_A, f.workflowId],
    });
  });

  it('team primary with an explicit agent who is also a member: no conflict, one agent event for the outsider', async () => {
    const f = await createFixture();
    const scoped = tenantDb(db, f.tenant);
    const lead = await createUser(db, f.tenant);
    const member = await createUser(db, f.tenant);
    const outsider = await createUser(db, f.tenant);
    const teamId = uuidv4();
    await scoped.table('teams').insert({ tenant: f.tenant, team_id: teamId, team_name: 'Team', manager_id: lead });
    await scoped.table('team_members').insert([
      { tenant: f.tenant, team_id: teamId, user_id: lead },
      { tenant: f.tenant, team_id: teamId, user_id: member },
    ]);

    const result = await run(f, {
      assignment: { primary: { type: 'team', id: teamId }, additional_user_ids: [member, outsider] },
    });

    const resources = await scoped.table('ticket_resources').where({ ticket_id: result.ticket_id });
    const roles = new Map(resources.map((r) => [r.additional_user_id, r.role]));
    expect(roles.get(member)).toBe('team_member');
    expect(roles.get(outsider)).toBe('support');
    expect(resources.filter((r) => r.additional_user_id === member)).toHaveLength(1);
    expect(byType('TICKET_ADDITIONAL_AGENT_ASSIGNED').map((e) => e.payload.additionalAgentId)).toEqual([outsider]);
  });

  it('maps notify to the suppression flags', async () => {
    const f = await createFixture();

    await run(f);
    let created = byType('TICKET_CREATED').pop()!;
    expect(created.payload).toMatchObject({ suppressContactNotifications: true, suppressInternalNotifications: false });

    published.length = 0;
    await run(f, { notify: { internal: false } });
    created = byType('TICKET_CREATED').pop()!;
    expect(created.payload).toMatchObject({ suppressContactNotifications: true, suppressInternalNotifications: true });

    published.length = 0;
    await run(f, { notify: { contact: true } });
    created = byType('TICKET_CREATED').pop()!;
    expect(created.payload).toMatchObject({ suppressContactNotifications: false, suppressInternalNotifications: false });
  });

  it('rolls back the ticket and publishes nothing when a later step fails', async () => {
    const f = await createFixture();
    await expect(
      run(f, { title: 'Rollback me', attachments: [{ source: { document_id: uuidv4() } }] })
    ).rejects.toBeTruthy();

    const rows = await tenantDb(db, f.tenant).table('tickets').where({ title: 'Rollback me' });
    expect(rows).toHaveLength(0);
    expect(published).toHaveLength(0);
  });

  it('persists tags to tag_mappings and attributes.tags', async () => {
    const f = await createFixture();
    const result = await run(f, { tags: ['Urgent', 'disk'] });

    const mappings = await tenantDb(db, f.tenant)
      .table('tag_mappings')
      .where({ tagged_id: result.ticket_id, tagged_type: 'ticket' });
    expect(mappings).toHaveLength(2);
    const ticket = await tenantDb(db, f.tenant).table('tickets').where({ ticket_id: result.ticket_id }).first();
    const attributes = typeof ticket.attributes === 'string' ? JSON.parse(ticket.attributes) : ticket.attributes;
    expect(attributes.tags).toHaveLength(2);
  });
});
