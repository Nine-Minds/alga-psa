import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { runWithTenant, tenantDb } from '@alga-psa/db';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

/**
 * Integration coverage for the recurring-ticket sweep (plan §4.4) against a real, migrated database.
 * Events are captured instead of published: TicketModelEventPublisher and createTicketWithSideEffects
 * both publish through @alga-psa/event-bus/publishers.
 */
const published: Array<{ eventType: string; payload: Record<string, any> }> = [];

vi.mock('@alga-psa/event-bus/publishers', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/event-bus/publishers')>(
    '@alga-psa/event-bus/publishers'
  );
  return {
    ...actual,
    publishEvent: vi.fn(async (event: { eventType: string; payload: Record<string, any> }) => {
      published.push({ eventType: event.eventType, payload: event.payload });
    }),
    publishWorkflowEvent: vi.fn(async (event: { eventType: string; payload: Record<string, any> }) => {
      published.push({ eventType: event.eventType, payload: event.payload });
    }),
  };
});

const TZ = 'America/New_York';
const at = (iso: string) => new Date(iso);

let db: Knex;
let generate: typeof import('@alga-psa/tickets/lib/recurring/generateRecurringTicketsForTenant').generateRecurringTicketsForTenant;

interface Fixture {
  tenant: string;
  clientId: string;
  userId: string;
  boardId: string;
  statusOpenId: string;
  statusClosedId: string;
  priorityId: string;
  priorityHighId: string;
}

async function createFixture(): Promise<Fixture> {
  const tenant = await createTenant(db, `Recurring ${uuidv4().slice(0, 6)}`);
  const clientId = await createClient(db, tenant, 'Acme Corp');
  const userId = await createUser(db, tenant);
  const scoped = tenantDb(db, tenant);

  const boardId = uuidv4();
  await scoped.table('boards').insert({ tenant, board_id: boardId, board_name: 'Patching', is_default: true });
  const statusOpenId = uuidv4();
  const statusClosedId = uuidv4();
  await scoped.table('statuses').insert([
    { tenant, status_id: statusOpenId, board_id: boardId, name: 'New', status_type: 'ticket', item_type: 'ticket', order_number: 1, is_default: true, is_closed: false },
    { tenant, status_id: statusClosedId, board_id: boardId, name: 'Closed', status_type: 'ticket', item_type: 'ticket', order_number: 2, is_default: false, is_closed: true },
  ]);
  const priorityId = uuidv4();
  const priorityHighId = uuidv4();
  await scoped.table('priorities').insert([
    { tenant, priority_id: priorityId, priority_name: 'Medium', item_type: 'ticket', order_number: 1, color: '#ccc', created_by: userId },
    { tenant, priority_id: priorityHighId, priority_name: 'High', item_type: 'ticket', order_number: 2, color: '#f00', created_by: userId },
  ]);
  return { tenant, clientId, userId, boardId, statusOpenId, statusClosedId, priorityId, priorityHighId };
}

const monthlyOn1 = { frequency: 'monthly', interval: 1, on: { type: 'dayOfMonth', day: 1 }, end: { type: 'never' } };

interface DefinitionOptions {
  recurrence?: unknown;
  startDate?: string;
  leadDays?: number;
  policy?: 'keep' | 'previous' | 'next';
  openPrevious?: 'always_create' | 'skip';
  notify?: boolean;
  titleTemplate?: string;
  isActive?: boolean;
  archived?: boolean;
  tags?: string[];
  additionalAgentIds?: string[];
  evaluatedThrough: string;
  overrides?: Record<string, unknown>;
  clientActive?: boolean;
  clientId?: string;
}

async function createDefinition(f: Fixture, options: DefinitionOptions) {
  const scoped = tenantDb(db, f.tenant);
  const definitionId = uuidv4();
  const definitionClientId = uuidv4();
  await scoped.table('recurring_ticket_definitions').insert({
    tenant: f.tenant,
    definition_id: definitionId,
    name: 'Monthly patching',
    is_active: options.isActive ?? true,
    archived_at: options.archived ? new Date() : null,
    title_template: options.titleTemplate ?? '{{client}} patching — {{month}} {{year}}',
    board_id: f.boardId,
    priority_id: f.priorityId,
    additional_agent_ids: JSON.stringify(options.additionalAgentIds ?? []),
    tags: JSON.stringify(options.tags ?? []),
    recurrence: JSON.stringify(options.recurrence ?? monthlyOn1),
    start_date: options.startDate ?? '2026-01-01',
    create_time: '08:00',
    due_time: '17:00',
    lead_days: options.leadDays ?? 0,
    non_business_day_policy: options.policy ?? 'keep',
    open_previous_policy: options.openPrevious ?? 'always_create',
    notify_client_on_create: options.notify ?? false,
  });
  await scoped.table('recurring_ticket_definition_clients').insert({
    tenant: f.tenant,
    definition_client_id: definitionClientId,
    definition_id: definitionId,
    client_id: options.clientId ?? f.clientId,
    is_active: options.clientActive ?? true,
    overrides: JSON.stringify(options.overrides ?? {}),
    evaluated_through: at(options.evaluatedThrough),
  });
  return { definitionId, definitionClientId };
}

const sweep = (f: Fixture, now: string) =>
  runWithTenant(f.tenant, () => generate(db, f.tenant, { timeZone: TZ, locale: 'en', now: at(now) }));

const occurrences = (f: Fixture, definitionClientId: string) =>
  tenantDb(db, f.tenant)
    .table('recurring_ticket_occurrences')
    .where({ definition_client_id: definitionClientId })
    .orderBy('occurrence_date');

const countTickets = async (f: Fixture) =>
  Number((await tenantDb(db, f.tenant).table('tickets').count('* as n').first())?.n ?? 0);

describe('recurring ticket generator (integration)', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
    ({ generateRecurringTicketsForTenant: generate } = await import(
      '@alga-psa/tickets/lib/recurring/generateRecurringTicketsForTenant'
    ));
  }, 900_000);

  afterAll(async () => {
    await db?.destroy();
  });

  beforeEach(() => {
    published.length = 0;
  });

  it('creates a system-generated ticket with the recurring origin, title tokens and an occurrence row', async () => {
    const f = await createFixture();
    const { definitionClientId } = await createDefinition(f, { evaluatedThrough: '2026-02-28T12:00:00Z' });

    const summary = await sweep(f, '2026-03-01T14:00:00Z'); // 09:00 EST, due 17:00 EST
    expect(summary).toMatchObject({ definitions: 1, definitionClients: 1, created: 1, failed: 0, missed: 0 });

    const [occurrence] = await occurrences(f, definitionClientId);
    expect(occurrence.status).toBe('created');
    expect(occurrence.attempts).toBe(1);
    expect(occurrence.ticket_id).toBeTruthy();
    expect(new Date(occurrence.due_at).toISOString()).toBe('2026-03-01T22:00:00.000Z');

    const ticket = await tenantDb(db, f.tenant).table('tickets').where({ ticket_id: occurrence.ticket_id }).first();
    expect(ticket).toMatchObject({
      title: 'Acme Corp patching — March 2026',
      ticket_origin: 'recurring',
      source: 'recurring_ticket',
      entered_by: null,
      client_id: f.clientId,
      board_id: f.boardId,
      status_id: f.statusOpenId,
      priority_id: f.priorityId,
    });
    expect(new Date(ticket.due_date).toISOString()).toBe('2026-03-01T22:00:00.000Z');

    // TICKET_CREATED is published (SLA, notifications, webhooks, search all hang off it) with a
    // SYSTEM identity and the client email suppressed because notify_client_on_create defaults off.
    const created = published.filter((event) => event.eventType === 'TICKET_CREATED');
    expect(created).toHaveLength(1);
    expect(created[0].payload).toMatchObject({
      tenantId: f.tenant,
      ticketId: occurrence.ticket_id,
      suppressContactNotifications: true,
    });
    expect(created[0].payload.userId).toBeUndefined();

    const activity = await tenantDb(db, f.tenant)
      .table('ticket_audit_logs')
      .where({ ticket_id: occurrence.ticket_id, event_type: 'TICKET_CREATED' })
      .first();
    expect(activity).toMatchObject({ actor_type: 'system', actor_user_id: null });

    const row = await tenantDb(db, f.tenant)
      .table('recurring_ticket_definition_clients')
      .where({ definition_client_id: definitionClientId })
      .first();
    expect(new Date(row.evaluated_through).toISOString()).toBe('2026-03-01T14:00:00.000Z');
  });

  it('is idempotent: re-running the sweep, or running two at once, never duplicates a ticket', async () => {
    const f = await createFixture();
    const { definitionClientId } = await createDefinition(f, { evaluatedThrough: '2026-02-28T12:00:00Z' });

    // Re-run with the watermark reset so the candidate is considered again: the ledger row is the guard.
    await sweep(f, '2026-03-01T14:00:00Z');
    await tenantDb(db, f.tenant)
      .table('recurring_ticket_definition_clients')
      .where({ definition_client_id: definitionClientId })
      .update({ evaluated_through: at('2026-02-28T12:00:00Z') });
    await sweep(f, '2026-03-01T15:00:00Z');
    expect(await countTickets(f)).toBe(1);

    // Two sweeps racing on a fresh occurrence.
    await tenantDb(db, f.tenant).table('recurring_ticket_definition_clients').update({ evaluated_through: at('2026-03-31T12:00:00Z') });
    await Promise.all([sweep(f, '2026-04-01T14:00:00Z'), sweep(f, '2026-04-01T14:00:00Z')]);
    expect(await countTickets(f)).toBe(2);
    const rows = await occurrences(f, definitionClientId);
    expect(rows.map((row) => [String(row.occurrence_date).slice(0, 10), row.status])).toHaveLength(2);
    expect(rows.every((row) => row.status === 'created')).toBe(true);
  });

  it('does nothing before the create time, and honours lead days', async () => {
    const f = await createFixture();
    const { definitionClientId } = await createDefinition(f, { leadDays: 3, evaluatedThrough: '2026-03-20T12:00:00Z' });

    // Due 2026-04-01 17:00 EDT; created from 2026-03-29 08:00 EDT (12:00Z).
    await sweep(f, '2026-03-29T11:59:00Z');
    expect(await countTickets(f)).toBe(0);

    await sweep(f, '2026-03-29T12:00:00Z');
    const [occurrence] = await occurrences(f, definitionClientId);
    expect(occurrence.status).toBe('created');
    expect(String(occurrence.due_date)).toContain('2026');
    const ticket = await tenantDb(db, f.tenant).table('tickets').where({ ticket_id: occurrence.ticket_id }).first();
    expect(new Date(ticket.due_date).toISOString()).toBe('2026-04-01T21:00:00.000Z');
    expect(ticket.title).toContain('April 2026');
  });

  it('does not backfill: an occurrence already due when the client was added is never created', async () => {
    const f = await createFixture();
    const { definitionClientId } = await createDefinition(f, { evaluatedThrough: '2026-03-01T23:00:00Z' });

    const summary = await sweep(f, '2026-03-01T23:30:00Z');
    expect(summary).toMatchObject({ created: 0, missed: 0 });
    expect(await occurrences(f, definitionClientId)).toEqual([]);
  });

  it('records occurrences that came due during an outage as missed, and creates nothing for them', async () => {
    const f = await createFixture();
    const { definitionClientId } = await createDefinition(f, {
      recurrence: { frequency: 'weekly', interval: 1, weekdays: ['mon'], end: { type: 'never' } },
      startDate: '2026-01-05',
      evaluatedThrough: '2026-03-01T00:00:00Z',
    });

    const summary = await sweep(f, '2026-03-16T13:00:00Z'); // Mar 2 and 9 are past; Mar 16 is due 17:00 EDT (21:00Z), still ahead
    expect(summary).toMatchObject({ missed: 2, created: 1 });
    const rows = await occurrences(f, definitionClientId);
    expect(rows.map((row) => row.status)).toEqual(['missed', 'missed', 'created']);
    expect(await countTickets(f)).toBe(1);

    // A later sweep leaves missed rows alone.
    await sweep(f, '2026-03-16T14:00:00Z');
    expect((await occurrences(f, definitionClientId)).map((row) => row.status)).toEqual(['missed', 'missed', 'created']);
  });

  it('skip policy: skips while the previous ticket is open, creates again once it is closed', async () => {
    const f = await createFixture();
    const { definitionClientId } = await createDefinition(f, {
      openPrevious: 'skip',
      recurrence: { frequency: 'weekly', interval: 1, weekdays: ['mon'], end: { type: 'never' } },
      startDate: '2026-01-05',
      evaluatedThrough: '2026-03-01T00:00:00Z',
    });

    await sweep(f, '2026-03-02T14:00:00Z');
    const first = (await occurrences(f, definitionClientId))[0];
    expect(first.status).toBe('created');
    const firstTicket = await tenantDb(db, f.tenant).table('tickets').where({ ticket_id: first.ticket_id }).first();

    await sweep(f, '2026-03-09T14:00:00Z');
    const second = (await occurrences(f, definitionClientId))[1];
    expect(second.status).toBe('skipped');
    expect(second.reason).toBe(`previous_open:${firstTicket.ticket_number}`);
    expect(second.ticket_id).toBeNull();

    await tenantDb(db, f.tenant).table('tickets').where({ ticket_id: first.ticket_id }).update({ status_id: f.statusClosedId, is_closed: true });
    await sweep(f, '2026-03-16T14:00:00Z');
    const third = (await occurrences(f, definitionClientId))[2];
    expect(third.status).toBe('created');
    expect(await countTickets(f)).toBe(2);
  });

  it('records a failed occurrence with an actionable reason and retries the same row while it is not yet due', async () => {
    const f = await createFixture();
    const { definitionClientId } = await createDefinition(f, { evaluatedThrough: '2026-02-28T12:00:00Z' });
    await tenantDb(db, f.tenant).table('boards').where({ board_id: f.boardId }).update({ is_inactive: true });

    const first = await sweep(f, '2026-03-01T14:00:00Z');
    expect(first).toMatchObject({ failed: 1, created: 0 });
    let [row] = await occurrences(f, definitionClientId);
    expect(row.status).toBe('failed');
    expect(row.attempts).toBe(1);
    expect(row.reason).toBe('Board ‘Patching’ is inactive');
    expect(await countTickets(f)).toBe(0);

    // The watermark advanced to 14:00Z, but the failed row is still due later today, so it retries.
    await tenantDb(db, f.tenant).table('boards').where({ board_id: f.boardId }).update({ is_inactive: false });
    const retry = await sweep(f, '2026-03-01T15:00:00Z');
    expect(retry).toMatchObject({ created: 1, failed: 0 });
    const rows = await occurrences(f, definitionClientId);
    expect(rows).toHaveLength(1);
    [row] = rows;
    expect(row.status).toBe('created');
    expect(row.attempts).toBe(2);
    expect(row.reason).toBeNull();
    expect(await countTickets(f)).toBe(1);
  });

  it('keeps a failed occurrence failed once it is due, and bumps attempts while retrying', async () => {
    const f = await createFixture();
    const { definitionClientId } = await createDefinition(f, { evaluatedThrough: '2026-02-28T12:00:00Z' });
    await tenantDb(db, f.tenant).table('boards').where({ board_id: f.boardId }).delete().catch(() => undefined);
    await tenantDb(db, f.tenant).table('boards').where({ board_id: f.boardId }).update({ is_inactive: true });

    await sweep(f, '2026-03-01T14:00:00Z');
    await sweep(f, '2026-03-01T15:00:00Z');
    let [row] = await occurrences(f, definitionClientId);
    expect(row.status).toBe('failed');
    expect(row.attempts).toBe(2);

    await tenantDb(db, f.tenant).table('boards').where({ board_id: f.boardId }).update({ is_inactive: false });
    await sweep(f, '2026-03-01T23:00:00Z'); // after 17:00 EST due time
    [row] = await occurrences(f, definitionClientId);
    expect(row.status).toBe('failed');
    expect(await countTickets(f)).toBe(0);
  });

  it('fails with the assigned user named when that user has been deactivated', async () => {
    const f = await createFixture();
    const { definitionId, definitionClientId } = await createDefinition(f, { evaluatedThrough: '2026-02-28T12:00:00Z' });
    const assignee = await createUser(db, f.tenant, { first_name: 'Dana', last_name: 'Tech', is_inactive: true });
    await tenantDb(db, f.tenant).table('recurring_ticket_definitions').where({ definition_id: definitionId }).update({ assigned_to: assignee });

    await sweep(f, '2026-03-01T14:00:00Z');
    const [row] = await occurrences(f, definitionClientId);
    expect(row.status).toBe('failed');
    expect(row.reason).toBe('Assigned user Dana Tech is inactive');
  });

  it('applies per-client overrides over the definition defaults', async () => {
    const f = await createFixture();
    const { definitionClientId } = await createDefinition(f, {
      evaluatedThrough: '2026-02-28T12:00:00Z',
      overrides: { priority: { priority_id: undefined } },
    });
    await tenantDb(db, f.tenant)
      .table('recurring_ticket_definition_clients')
      .where({ definition_client_id: definitionClientId })
      .update({ overrides: JSON.stringify({ priority: { priority_id: f.priorityHighId } }) });

    await sweep(f, '2026-03-01T14:00:00Z');
    const [row] = await occurrences(f, definitionClientId);
    const ticket = await tenantDb(db, f.tenant).table('tickets').where({ ticket_id: row.ticket_id }).first();
    expect(ticket.priority_id).toBe(f.priorityHighId);
  });

  it('applies tags and additional agents, and sends nothing it was not asked to', async () => {
    const f = await createFixture();
    const agent = await createUser(db, f.tenant, { first_name: 'Sam', last_name: 'Agent' });
    const { definitionId, definitionClientId } = await createDefinition(f, {
      evaluatedThrough: '2026-02-28T12:00:00Z',
      tags: ['patching', 'monthly'],
      additionalAgentIds: [agent],
    });

    await tenantDb(db, f.tenant).table('recurring_ticket_definitions').where({ definition_id: definitionId }).update({ assigned_to: f.userId });

    await sweep(f, '2026-03-01T14:00:00Z');
    const [row] = await occurrences(f, definitionClientId);
    expect(row.status).toBe('created');

    const tags = await tenantDb(db, f.tenant)
      .table('tag_mappings')
      .where({ tagged_id: row.ticket_id, tagged_type: 'ticket' });
    expect(tags).toHaveLength(2);
    const resources = await tenantDb(db, f.tenant).table('ticket_resources').where({ ticket_id: row.ticket_id });
    expect(resources.map((resource) => resource.additional_user_id)).toEqual([agent]);
    expect(resources[0].assigned_to).toBe(f.userId);
  });

  it('does not fail the occurrence when an additional agent is also a member of the assigned team', async () => {
    const f = await createFixture();
    const scoped = tenantDb(db, f.tenant);
    const lead = await createUser(db, f.tenant, { first_name: 'Lee', last_name: 'Lead' });
    const member = await createUser(db, f.tenant, { first_name: 'Mia', last_name: 'Member' });
    const outsider = await createUser(db, f.tenant, { first_name: 'Otto', last_name: 'Outside' });
    const teamId = uuidv4();
    await scoped.table('teams').insert({ tenant: f.tenant, team_id: teamId, team_name: 'Patch Team', manager_id: lead });
    await scoped.table('team_members').insert([
      { tenant: f.tenant, team_id: teamId, user_id: lead },
      { tenant: f.tenant, team_id: teamId, user_id: member },
    ]);
    const { definitionId, definitionClientId } = await createDefinition(f, {
      evaluatedThrough: '2026-02-28T12:00:00Z',
      additionalAgentIds: [member, outsider],
    });
    await scoped.table('recurring_ticket_definitions').where({ definition_id: definitionId }).update({ assigned_team_id: teamId });

    const summary = await sweep(f, '2026-03-01T14:00:00Z');
    expect(summary).toMatchObject({ created: 1, failed: 0 });
    const [row] = await occurrences(f, definitionClientId);
    expect(row.status).toBe('created');

    const resources = await scoped.table('ticket_resources').where({ ticket_id: row.ticket_id });
    const byAgent = new Map(resources.map((r) => [r.additional_user_id, r.role]));
    // The team member keeps the team role; only the non-member is added as support.
    expect(byAgent.get(member)).toBe('team_member');
    expect(byAgent.get(outsider)).toBe('support');
    expect(resources.filter((r) => r.additional_user_id === member)).toHaveLength(1);
    const agentEvents = published.filter((e) => e.eventType === 'TICKET_ADDITIONAL_AGENT_ASSIGNED');
    // Exactly one agent event, for the explicit non-member; the team member is not announced again.
    expect(agentEvents.map((e) => e.payload.additionalAgentId)).toEqual([outsider]);
  });

  it('passes notify_client_on_create through: suppression is lifted only when the definition opts in', async () => {
    const f = await createFixture();
    await createDefinition(f, { evaluatedThrough: '2026-02-28T12:00:00Z', notify: true });
    await sweep(f, '2026-03-01T14:00:00Z');
    const created = published.find((event) => event.eventType === 'TICKET_CREATED');
    expect(created?.payload.suppressContactNotifications).toBe(false);
    expect(created?.payload.suppressInternalNotifications).toBe(false);
  });

  it('keys occurrences on the nominal date: a non-business-day shift, then a policy change, does not duplicate', async () => {
    const f = await createFixture();
    // Sun 2026-03-01 -> Mon 2026-03-02 with "next" (no business-hours schedule: Mon-Fri fallback).
    const { definitionId, definitionClientId } = await createDefinition(f, {
      policy: 'next',
      evaluatedThrough: '2026-02-28T12:00:00Z',
    });

    await sweep(f, '2026-03-02T14:00:00Z');
    let rows = await occurrences(f, definitionClientId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('created');
    expect(String(rows[0].occurrence_date)).toContain('Mar 01 2026');
    expect(new Date(rows[0].due_at).toISOString()).toBe('2026-03-02T22:00:00.000Z');

    await tenantDb(db, f.tenant).table('recurring_ticket_definitions').where({ definition_id: definitionId }).update({ non_business_day_policy: 'keep' });
    await tenantDb(db, f.tenant).table('recurring_ticket_definition_clients').update({ evaluated_through: at('2026-02-28T12:00:00Z') });
    await sweep(f, '2026-03-01T14:00:00Z');
    rows = await occurrences(f, definitionClientId);
    expect(rows).toHaveLength(1);
    expect(await countTickets(f)).toBe(1);
  });

  it('skips an inactive client instead of creating a ticket for it', async () => {
    const f = await createFixture();
    const { definitionClientId } = await createDefinition(f, { evaluatedThrough: '2026-02-28T12:00:00Z' });
    await tenantDb(db, f.tenant).table('clients').where({ client_id: f.clientId }).update({ is_inactive: true });

    await sweep(f, '2026-03-01T14:00:00Z');
    const [row] = await occurrences(f, definitionClientId);
    expect(row).toMatchObject({ status: 'skipped', reason: 'client_inactive' });
    expect(await countTickets(f)).toBe(0);
  });

  it('ignores paused and archived definitions and inactive definition-clients', async () => {
    const f = await createFixture();
    await createDefinition(f, { evaluatedThrough: '2026-02-28T12:00:00Z', isActive: false });
    await createDefinition(f, { evaluatedThrough: '2026-02-28T12:00:00Z', archived: true });
    await createDefinition(f, { evaluatedThrough: '2026-02-28T12:00:00Z', clientActive: false });

    const summary = await sweep(f, '2026-03-01T14:00:00Z');
    expect(summary).toMatchObject({ created: 0, missed: 0, failed: 0 });
    expect(await countTickets(f)).toBe(0);
  });

  it('isolates tenants: one tenant sweep never touches another tenant definitions', async () => {
    const a = await createFixture();
    const b = await createFixture();
    await createDefinition(a, { evaluatedThrough: '2026-02-28T12:00:00Z' });
    await createDefinition(b, { evaluatedThrough: '2026-02-28T12:00:00Z' });

    await sweep(a, '2026-03-01T14:00:00Z');
    expect(await countTickets(a)).toBe(1);
    expect(await countTickets(b)).toBe(0);
  });

  it('an unevaluable schedule is counted and logged without blocking other definitions', async () => {
    const f = await createFixture();
    await createDefinition(f, { evaluatedThrough: '2026-02-28T12:00:00Z', recurrence: { frequency: 'hourly' } });
    const good = await createDefinition(f, { evaluatedThrough: '2026-02-28T12:00:00Z' });

    const summary = await sweep(f, '2026-03-01T14:00:00Z');
    expect(summary).toMatchObject({ evaluationErrors: 1, created: 1 });
    expect((await occurrences(f, good.definitionClientId))[0].status).toBe('created');
  });
});
