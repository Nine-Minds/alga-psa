import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '@main-test-utils/dbConfig';
import { createDateTriggerScanHandler } from '../../../../../packages/jobs/src/lib/handlers/dateTriggerScanHandler';
import { ticketDueDateSource } from '../../../../../packages/jobs/src/lib/dateTriggers/sources/ticketDueDate';
import { launchDateTriggeredWorkflows } from '../../../../packages/workflows/src/lib/dateTriggerLauncher';
import { dateTriggerPayloadSchemas } from '@alga-psa/event-schemas/schemas';
import { runWithTenant, tenantDb } from '@alga-psa/db';
import { createTenant, createClient, createUser } from '@main-test-utils/testDataFactory';
import { generateRecurringTicketsForTenant } from '../../../../../packages/tickets/src/lib/recurring/generateRecurringTicketsForTenant';
import { loadTicketRecurringProvenance } from '../../../../../shared/lib/tickets/ticketRecurringProvenance';
import { resumeSla } from '../../../../../packages/sla/src/services/slaPauseService';

/**
 * The `ticket.due_date` date trigger against a real database: the query (window, closed status,
 * tenant-local date, recurring provenance) and the scan (one run per ticket and due date, a changed due
 * date fires again, a stale fire date does not). A recurring schedule's due date is seen before the
 * generator creates the ticket, so an early reminder does not depend on lead_days. Scenario tests run in a
 * transaction that is rolled back; the generator tests use their own tenant.
 */

const mocks = vi.hoisted(() => ({ publish: vi.fn(), temporalStart: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: mocks.publish, publishEvent: vi.fn(async () => undefined), publishNonCatalogWorkflowEvent: vi.fn(async () => undefined), publishStoredWorkflowEvent: vi.fn(async () => undefined), publishBuiltWorkflowPayload: vi.fn(async () => undefined), publishNonCatalogEventByName: vi.fn(async () => undefined), publishUnregisteredEventType: vi.fn(async () => undefined) }));
vi.mock('../../../../packages/workflows/src/lib/workflowRuntimeV2Temporal', async (importOriginal) => ({
  ...((await importOriginal()) as typeof import('../../../../packages/workflows/src/lib/workflowRuntimeV2Temporal')),
  startWorkflowRuntimeV2TemporalRun: mocks.temporalStart,
}));

const REF = 'payload.TicketDueDate.v1';

describe('ticket.due_date date trigger integration', () => {
  let db: Knex;
  beforeAll(async () => {
    db = await createTestDbConnection();
    mocks.publish.mockResolvedValue(undefined);
    mocks.temporalStart.mockImplementation(async ({ runId }: { runId: string }) => ({ workflowId: `stub:${runId}`, firstExecutionRunId: null }));
  });
  afterAll(async () => { await db?.destroy(); });

  async function withScenario(timezone: string, body: (s: any) => Promise<void>) {
    const tenantRow = await db('tenants').first('tenant');
    if (!tenantRow) throw new Error('The integration database must have its standard tenant seed.');
    const tenant = String(tenantRow.tenant);
    const trx = await db.transaction();
    try {
      await trx('tenant_settings').where({ tenant }).update({ settings: trx.raw("COALESCE(settings, '{}'::jsonb) || ?::jsonb", [JSON.stringify({ timezone })]) });
      const clientId = uuidv4();
      await trx('clients').insert({ tenant, client_id: clientId, client_name: 'Due date client', created_at: '2020-01-01T00:00:00Z', updated_at: '2020-01-01T00:00:00Z' });
      const boardId = uuidv4();
      await trx('boards').insert({ tenant, board_id: boardId, board_name: 'Renewals', display_order: 0 });
      let order = 0;
      const status = async (name: string, isClosed = false) => {
        const statusId = uuidv4();
        order += 1;
        await trx('statuses').insert({ tenant, status_id: statusId, board_id: boardId, name, status_type: 'ticket', order_number: order, is_closed: isClosed });
        return statusId;
      };
      const openStatus = await status('Open');
      const closedStatus = await status('Done', true);
      const ticket = async (dueDate: string | null, extra: Record<string, unknown> = {}) => {
        const ticketId = uuidv4();
        await trx('tickets').insert({
          tenant, ticket_id: ticketId, ticket_number: `DD-${ticketId.slice(0, 8)}`, title: `Renewal ${ticketId.slice(0, 4)}`, board_id: boardId,
          status_id: openStatus, client_id: clientId, entered_at: '2026-01-01T00:00:00Z', due_date: dueDate, ...extra,
        });
        return ticketId;
      };
      const occurrence = async (ticketId: string, dueAt: string, status = 'created') => {
        const definitionId = uuidv4();
        const definitionClientId = uuidv4();
        const occurrenceId = uuidv4();
        await trx('recurring_ticket_definitions').insert({
          tenant, definition_id: definitionId, name: 'Renewal reminder', title_template: 'Renewal', board_id: boardId, priority_id: uuidv4(),
          recurrence: JSON.stringify({ frequency: 'yearly' }), start_date: '2026-01-01', lead_days: 60,
        });
        await trx('recurring_ticket_definition_clients').insert({
          tenant, definition_client_id: definitionClientId, definition_id: definitionId, client_id: clientId, evaluated_through: '2026-01-01T00:00:00Z',
        });
        await trx('recurring_ticket_occurrences').insert({
          tenant, occurrence_id: occurrenceId, definition_id: definitionId, definition_client_id: definitionClientId, client_id: clientId,
          occurrence_date: dueAt.slice(0, 10), due_date: dueAt.slice(0, 10), create_at: '2026-01-01T00:00:00Z', due_at: dueAt, status, ticket_id: ticketId,
        });
        return { definitionId, occurrenceId, occurrenceDate: dueAt.slice(0, 10) };
      };
      const workflow = async (offsetDays: number) => {
        const workflowId = uuidv4();
        const trigger = { type: 'date', source: 'ticket.due_date', offsetDays, localTime: '00:00', timezone: 'UTC' };
        const definition = { trigger, payloadSchemaRef: REF, steps: [] };
        await trx('workflow_definitions').insert({ workflow_id: workflowId, tenant, name: `Due date ${workflowId.slice(0, 4)}`, payload_schema_ref: REF, trigger: JSON.stringify(trigger), draft_definition: JSON.stringify(definition), draft_version: 1, status: 'published' });
        await trx('workflow_definition_versions').insert({ workflow_id: workflowId, tenant, version: 1, definition_json: JSON.stringify(definition), published_at: '2026-01-01' });
        return workflowId;
      };
      const scan = async (at: string) => {
        const when = new Date(at);
        const handler = createDateTriggerScanHandler((p) => launchDateTriggeredWorkflows(p), () => when, async () => 'UTC', async () => ({ knex: trx }));
        await handler({ tenantId: tenant });
      };
      const runs = async (workflowId: string) =>
        trx('workflow_runs').where({ workflow_id: workflowId, tenant }).select('trigger_fire_key', 'input_json').orderBy('trigger_fire_key');
      await body({ trx, tenant, openStatus, closedStatus, ticket, occurrence, workflow, scan, runs });
    } finally {
      await trx.rollback();
    }
  }

  it('selects an open recurring ticket due in 60 days, with its origin and schedule ids; not the same ticket on a closed status', async () => {
    await withScenario('UTC', async ({ trx, tenant, closedStatus, ticket, occurrence, workflow, scan, runs }) => {
      const dueAt = '2027-01-08T17:00:00.000Z';
      const t = await ticket(dueAt, { ticket_origin: 'recurring', source: 'recurring_ticket' });
      const ids = await occurrence(t, dueAt);
      const plain = await ticket(dueAt); // manual ticket, same due date
      const wf = await workflow(-60);

      // 60 days before 2027-01-08 is 2026-11-09.
      await scan('2026-11-09T12:00:00Z');
      const rows = await runs(wf);
      expect(rows.map((r: any) => r.input_json.ticketId).sort()).toEqual([t, plain].sort());
      const recurring = rows.find((r: any) => r.input_json.ticketId === t)!.input_json;
      expect(dateTriggerPayloadSchemas[REF].safeParse(recurring).success).toBe(true);
      expect(recurring).toMatchObject({
        ticketOrigin: 'recurring', dueDate: '2027-01-08', dueAt, occursOn: '2027-01-08', fireDate: '2026-11-09', offsetDays: -60,
        recurrence: { definitionId: ids.definitionId, occurrenceId: ids.occurrenceId, occurrenceDate: ids.occurrenceDate },
      });
      const manual = rows.find((r: any) => r.input_json.ticketId === plain)!.input_json;
      expect(manual.ticketOrigin).toBe('internal');
      expect(manual).not.toHaveProperty('recurrence');

      // The same ticket on a closed status (statuses.is_closed, not tickets.is_closed) is not selected.
      await trx('tickets').where({ tenant, ticket_id: t }).update({ status_id: closedStatus });
      const found = await ticketDueDateSource.findOccurrences(trx, tenant, '2027-01-08', '2027-01-08');
      expect(found.map((o) => o.entityId)).toContain(plain);
      expect(found.map((o) => o.entityId)).not.toContain(t);
    });
  });

  it('excludes tickets without a due date and finds a 23:30 due date on the tenant-local day', async () => {
    await withScenario('America/Los_Angeles', async ({ trx, tenant, ticket, workflow }) => {
      const none = await ticket(null);
      // 2027-01-09T07:30Z is 23:30 on 2027-01-08 in Los Angeles (UTC-8).
      const late = await ticket('2027-01-09T07:30:00.000Z');
      await workflow(0);
      const found = await ticketDueDateSource.findOccurrences(trx, tenant, '2027-01-08', '2027-01-09');
      expect(found.find((o) => o.entityId === none)).toBeUndefined();
      expect(found.find((o) => o.entityId === late)).toMatchObject({ occursOn: '2027-01-08', cycleKey: '2027-01-08', payload: { dueDate: '2027-01-08' } });
    });
  });

  it('fires once per ticket and due date; a changed due date is a new occurrence; a stale fire date does not fire', async () => {
    await withScenario('UTC', async ({ trx, tenant, ticket, workflow, scan, runs }) => {
      const t = await ticket('2027-01-08T17:00:00.000Z');
      const wf = await workflow(-30); // fires 2026-12-09
      await scan('2026-12-09T12:00:00Z');
      await scan('2026-12-09T18:00:00Z');
      await scan('2026-12-10T12:00:00Z');
      expect(await runs(wf)).toHaveLength(1);

      // Time-only move on the same day: same key, no second firing.
      await trx('tickets').where({ tenant, ticket_id: t }).update({ due_date: '2027-01-08T20:00:00.000Z' });
      await scan('2026-12-10T12:00:00Z');
      expect(await runs(wf)).toHaveLength(1);

      // Moved to another day: new occurrence key, fires for the new date when its fire date comes round.
      await trx('tickets').where({ tenant, ticket_id: t }).update({ due_date: '2027-01-15T17:00:00.000Z' });
      await scan('2026-12-16T12:00:00Z');
      const rows = await runs(wf);
      expect(rows).toHaveLength(2);
      expect(rows.map((r: any) => r.trigger_fire_key).join('|')).toContain(`${t}:2027-01-08:-30`);
      expect(rows.map((r: any) => r.trigger_fire_key).join('|')).toContain(`${t}:2027-01-15:-30`);

      // Fire date more than three days in the past (the ticket got its due date late): never back-filled.
      const late = await ticket('2027-02-01T17:00:00.000Z'); // fire date 2027-01-02
      await scan('2027-01-06T12:00:00Z');
      expect((await runs(wf)).some((r: any) => r.input_json.ticketId === late)).toBe(false);
    });
  });

  it('does not fire for a ticket on a closed status (statuses.is_closed), and fires once it is reopened in the window', async () => {
    await withScenario('UTC', async ({ trx, tenant, openStatus, closedStatus, ticket, workflow, scan, runs }) => {
      const t = await ticket('2027-01-08T17:00:00.000Z', { status_id: closedStatus });
      // tickets.is_closed is not the signal: leave it false so only the status can exclude the ticket.
      await trx('tickets').where({ tenant, ticket_id: t }).update({ is_closed: false });
      const wf = await workflow(-60); // fires 2026-11-09
      await scan('2026-11-09T12:00:00Z');
      expect(await runs(wf)).toHaveLength(0);

      await trx('tickets').where({ tenant, ticket_id: t }).update({ status_id: openStatus });
      await scan('2026-11-10T12:00:00Z');
      const rows = await runs(wf);
      expect(rows).toHaveLength(1);
      expect(rows[0].input_json).toMatchObject({ ticketId: t, ticketExists: true });
    });
  });

  it('fires again when an SLA resume moves the due date (a new occurrence, by design)', async () => {
    await withScenario('UTC', async ({ trx, tenant, ticket, workflow, scan, runs }) => {
      const policyId = uuidv4();
      await trx('sla_policies').insert({ tenant, sla_policy_id: policyId, policy_name: 'Due date SLA' });
      const dueAt = '2027-01-08T17:00:00.000Z';
      // The due date was auto-filled from the SLA resolution deadline, and the SLA has been paused 3 days.
      const t = await ticket(dueAt, {
        sla_policy_id: policyId, sla_resolution_due_at: dueAt, sla_paused_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      });
      const wf = await workflow(-30); // fires 2026-12-09 for 2027-01-08
      await scan('2026-12-09T12:00:00Z');
      expect(await runs(wf)).toHaveLength(1);

      // The real resume path shifts sla_resolution_due_at and, because they matched, due_date with it.
      const resumed = await resumeSla(trx, tenant, t);
      expect(resumed).toMatchObject({ success: true, was_paused: true });
      const moved = await trx('tickets').where({ tenant, ticket_id: t }).first('due_date');
      expect(new Date(moved.due_date).toISOString().slice(0, 10)).toBe('2027-01-11');

      await scan('2026-12-12T12:00:00Z'); // the new fire date
      const keys = (await runs(wf)).map((r: any) => r.trigger_fire_key);
      expect(keys).toHaveLength(2);
      expect(keys.join('|')).toContain(`${t}:2027-01-08:-30`);
      expect(keys.join('|')).toContain(`${t}:2027-01-11:-30`);
    });
  });

  it('loadTicketRecurringProvenance returns the created occurrence and ignores other statuses', async () => {
    await withScenario('UTC', async ({ trx, tenant, ticket, occurrence }) => {
      const t = await ticket('2027-01-08T17:00:00.000Z', { ticket_origin: 'recurring' });
      const other = await ticket('2027-01-08T17:00:00.000Z', { ticket_origin: 'recurring' });
      const ids = await occurrence(t, '2027-01-08T17:00:00.000Z');
      await occurrence(other, '2027-01-08T17:00:00.000Z', 'failed');
      const map = await loadTicketRecurringProvenance(trx, tenant, [t, other]);
      expect(map.get(t)).toEqual(ids);
      expect(map.has(other)).toBe(false);
    });
  });

  /**
   * A real recurring schedule in its own tenant (America/New_York): yearly on Jan 1, created at 08:00
   * `leadDays` before, due at 17:00. Everything after this runs the real generator and the real scan.
   */
  async function generatedSchedule(leadDays: number) {
    const timeZone = 'America/New_York';
    const tenant = await createTenant(db, `DueDate gen ${uuidv4().slice(0, 6)}`);
    await db('tenant_settings').insert({ tenant, settings: JSON.stringify({ timezone: timeZone }) })
      .onConflict('tenant').merge({ settings: db.raw("COALESCE(tenant_settings.settings, '{}'::jsonb) || ?::jsonb", [JSON.stringify({ timezone: timeZone })]) });
    const clientId = await createClient(db, tenant, 'Acme Corp');
    const userId = await createUser(db, tenant);
    const scoped = tenantDb(db, tenant);
    const boardId = uuidv4();
    await scoped.table('boards').insert({ tenant, board_id: boardId, board_name: 'Renewals', is_default: true });
    await scoped.table('statuses').insert({ tenant, status_id: uuidv4(), board_id: boardId, name: 'New', status_type: 'ticket', item_type: 'ticket', order_number: 1, is_default: true, is_closed: false });
    const priorityId = uuidv4();
    await scoped.table('priorities').insert({ tenant, priority_id: priorityId, priority_name: 'Medium', item_type: 'ticket', order_number: 1, color: '#ccc', created_by: userId });
    const templateId = uuidv4();
    await scoped.table('ticket_templates').insert({ tenant, template_id: templateId, name: 'Renewal', title: 'Renewal {{year}}', board_id: boardId, priority_id: priorityId, tags: JSON.stringify([]), offer_for_manual_use: false });
    const definitionId = uuidv4();
    await scoped.table('recurring_ticket_definitions').insert({
      tenant, definition_id: definitionId, name: 'Annual renewal', is_active: true, ticket_template_id: templateId, additional_agent_ids: JSON.stringify([]),
      recurrence: JSON.stringify({ frequency: 'yearly', month: 1, day: 1, end: { type: 'never' } }),
      start_date: '2026-01-01', create_time: '08:00', due_time: '17:00', lead_days: leadDays, non_business_day_policy: 'keep', open_previous_policy: 'always_create', notify_client_on_create: false,
    });
    const definitionClientId = uuidv4();
    await scoped.table('recurring_ticket_definition_clients').insert({
      tenant, definition_client_id: definitionClientId, definition_id: definitionId, client_id: clientId, is_active: true, overrides: JSON.stringify({}),
      evaluated_through: new Date('2026-10-01T12:00:00Z'),
    });

    const workflow = async (offsetDays: number) => {
      const workflowId = uuidv4();
      const trigger = { type: 'date', source: 'ticket.due_date', offsetDays, localTime: '00:00', timezone: 'UTC' };
      const definition = { trigger, payloadSchemaRef: REF, steps: [] };
      await db('workflow_definitions').insert({ workflow_id: workflowId, tenant, name: `Due date gen ${workflowId.slice(0, 4)}`, payload_schema_ref: REF, trigger: JSON.stringify(trigger), draft_definition: JSON.stringify(definition), draft_version: 1, status: 'published' });
      await db('workflow_definition_versions').insert({ workflow_id: workflowId, tenant, version: 1, definition_json: JSON.stringify(definition), published_at: '2026-01-01' });
      return workflowId;
    };
    const scan = async (at: string) => {
      const handler = createDateTriggerScanHandler((p) => launchDateTriggeredWorkflows(p), () => new Date(at), async () => 'UTC', async () => ({ knex: db }));
      await handler({ tenantId: tenant });
    };
    const runs = (workflowId: string) => db('workflow_runs').where({ workflow_id: workflowId, tenant }).select('trigger_fire_key', 'input_json');
    const generate = (now: string) =>
      runWithTenant(tenant, () => generateRecurringTicketsForTenant(db, tenant, { timeZone, locale: 'en', now: new Date(now) }));
    const occurrence = () => scoped.table('recurring_ticket_occurrences').where({ definition_client_id: definitionClientId })
      .first('*', db.raw('occurrence_date::text as occurrence_date_text'));
    return { tenant, clientId, definitionId, definitionClientId, workflow, scan, runs, generate, occurrence };
  }

  // The whole chain with no hand-built rows: the real generator creates the ticket and occurrence (lead_days 60,
  // so the ticket exists 60 days ahead), TICKET_CREATED carries the schedule ids, and a -60 trigger then selects it.
  it('a ticket created by the real recurring generator is picked up by a -60 trigger with its definition id', async () => {
    const s = await generatedSchedule(60);
    mocks.publish.mockClear();
    // Due 2027-01-01 17:00 New York; created 60 days earlier at 08:00 New York (2026-11-02).
    const summary = await s.generate('2026-11-02T14:00:00Z');
    expect(summary).toMatchObject({ created: 1, failed: 0 });

    const occurrence = await s.occurrence();
    expect(occurrence.status).toBe('created');
    const createdEvents = mocks.publish.mock.calls.map((c: any[]) => c[0]).filter((e: any) => e?.eventType === 'TICKET_CREATED');
    expect(createdEvents).toHaveLength(1);
    expect(createdEvents[0].payload).toMatchObject({
      ticketId: occurrence.ticket_id, ticketOrigin: 'recurring', dueDate: new Date(occurrence.due_at).toISOString(),
      recurrence: { definitionId: s.definitionId, occurrenceId: occurrence.occurrence_id, occurrenceDate: occurrence.occurrence_date_text },
    });

    const workflowId = await s.workflow(-60);
    await s.scan('2026-11-02T12:00:00Z');
    const rows = await s.runs(workflowId);
    expect(rows).toHaveLength(1);
    expect(dateTriggerPayloadSchemas[REF].safeParse(rows[0].input_json).success).toBe(true);
    expect(rows[0].input_json).toMatchObject({
      ticketExists: true, ticketId: occurrence.ticket_id, ticketOrigin: 'recurring', offsetDays: -60,
      recurrence: { definitionId: s.definitionId, definitionClientId: s.definitionClientId, definitionName: 'Annual renewal', occurrenceId: occurrence.occurrence_id },
    });
  }, 120_000);

  // lead_days 0: the generator only creates the ticket on its due date. The -60 reminder still fires, from
  // the schedule, 60 days ahead; it never depends on how early the schedule creates its tickets.
  it('a recurring ticket created with a near-term due date (lead_days 0) still gets its -60 reminder, before the ticket exists', async () => {
    const s = await generatedSchedule(0);
    const early = await s.workflow(-60);
    await s.scan('2026-11-02T12:00:00Z'); // 60 days before 2027-01-01
    const rows = await s.runs(early);
    expect(rows).toHaveLength(1);
    const payload = rows[0].input_json;
    expect(dateTriggerPayloadSchemas[REF].safeParse(payload).success).toBe(true);
    expect(payload).toMatchObject({
      ticketExists: false, ticketOrigin: 'recurring', dueDate: '2027-01-01', dueAt: '2027-01-01T22:00:00.000Z',
      occursOn: '2027-01-01', fireDate: '2026-11-02', offsetDays: -60, clientId: s.clientId, clientName: 'Acme Corp',
      recurrence: { definitionId: s.definitionId, definitionClientId: s.definitionClientId, definitionName: 'Annual renewal', occurrenceDate: '2027-01-01' },
    });
    expect(payload).not.toHaveProperty('ticketId');
    expect(payload.recurrence).not.toHaveProperty('occurrenceId');
    expect(rows[0].trigger_fire_key).toContain(`recurring:${s.definitionClientId}:2027-01-01:2027-01-01:-60`);
    expect(await s.occurrence()).toBeUndefined(); // nothing generated yet

    // On the due date the generator creates the ticket; a due-day workflow sees it as a ticket, and the
    // -60 workflow does not fire a second time.
    expect(await s.generate('2027-01-01T14:00:00Z')).toMatchObject({ created: 1 });
    const onTheDay = await s.workflow(0);
    await s.scan('2027-01-01T12:00:00Z');
    const created = await s.occurrence();
    expect((await s.runs(onTheDay)).map((r: any) => r.input_json)).toEqual([
      expect.objectContaining({ ticketExists: true, ticketId: created.ticket_id, recurrence: expect.objectContaining({ occurrenceId: created.occurrence_id }) }),
    ]);
    expect(await s.runs(early)).toHaveLength(1);
  }, 120_000);

  // The schedule and the ticket share one fire key: a reminder fired from the schedule is not fired again
  // when the ticket appears inside the same catch-up window.
  it('fires once across the handover from scheduled occurrence to created ticket (lead_days 59, -60 trigger)', async () => {
    const s = await generatedSchedule(59);
    const wf = await s.workflow(-60);
    await s.scan('2026-11-02T12:00:00Z');
    expect((await s.runs(wf)).map((r: any) => r.input_json.ticketExists)).toEqual([false]);

    // Created 59 days ahead (2026-11-03 08:00 New York), then scanned again inside the 3-day lookback.
    expect(await s.generate('2026-11-03T14:00:00Z')).toMatchObject({ created: 1 });
    const found = await ticketDueDateSource.findOccurrences(db, s.tenant, '2027-01-01', '2027-01-01', { today: '2026-11-04', timezone: 'UTC', now: new Date('2026-11-04T12:00:00Z') });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ entityId: `recurring:${s.definitionClientId}:2027-01-01`, payload: { ticketExists: true } });
    await s.scan('2026-11-04T12:00:00Z');
    expect(await s.runs(wf)).toHaveLength(1);
  }, 120_000);

  it('does not report a scheduled occurrence for an inactive client, a paused schedule, or one already due', async () => {
    const s = await generatedSchedule(0);
    const window = (now: string) => ticketDueDateSource.findOccurrences(db, s.tenant, '2027-01-01', '2027-01-01', { today: now.slice(0, 10), timezone: 'UTC', now: new Date(now) });
    expect(await window('2026-11-02T12:00:00Z')).toHaveLength(1);
    // Already due: the generator would record it as missed, so the schedule no longer reports it.
    expect(await window('2027-01-01T22:30:00Z')).toHaveLength(0);
    await tenantDb(db, s.tenant).table('clients').where({ client_id: s.clientId }).update({ is_inactive: true });
    expect(await window('2026-11-02T12:00:00Z')).toHaveLength(0);
    await tenantDb(db, s.tenant).table('clients').where({ client_id: s.clientId }).update({ is_inactive: false });
    await tenantDb(db, s.tenant).table('recurring_ticket_definitions').where({ definition_id: s.definitionId }).update({ is_active: false });
    expect(await window('2026-11-02T12:00:00Z')).toHaveLength(0);
  }, 120_000);
});
