import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '@main-test-utils/dbConfig';
import { createDateTriggerScanHandler } from '../../../../../packages/jobs/src/lib/handlers/dateTriggerScanHandler';
import { launchDateTriggeredWorkflows } from '../../../../packages/workflows/src/lib/dateTriggerLauncher';
import { dateTriggerPayloadSchemas } from '../../../../../shared/workflow/runtime/schemas/dateTriggerPayloadSchemas';
import { TicketModel } from '../../../../../shared/models/ticketModel';
import {
  writeTicketActivity,
  TICKET_ACTIVITY_ACTOR,
  TICKET_ACTIVITY_ENTITY,
  TICKET_ACTIVITY_EVENT,
  TICKET_ACTIVITY_SOURCE,
} from '../../../../../shared/lib/ticketActivity';
import { ticketStatusClockPatch } from '../../../../../shared/lib/ticketStatusClock';

/**
 * "Ticket in status for N days" against a real database: dedup across scans, clock resets, board
 * scope, repeats, the no-activity condition and the payload. Every test runs in a transaction that is
 * rolled back. Status-change timing uses the real DB clock (ticketStatusClockPatch writes now()), so
 * those tests anchor their scan dates on the current time.
 */

const mocks = vi.hoisted(() => ({ publish: vi.fn(), temporalStart: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: mocks.publish }));
vi.mock('../../../../packages/workflows/src/lib/workflowRuntimeV2Temporal', async (importOriginal) => ({
  ...((await importOriginal()) as typeof import('../../../../packages/workflows/src/lib/workflowRuntimeV2Temporal')),
  startWorkflowRuntimeV2TemporalRun: mocks.temporalStart,
}));

const REF = 'payload.TicketStatusAge.v1';
const DAY = 86_400_000;

type Params = { statusName: string; boardId?: string | null; days: number; repeatEveryDays?: number | null; requireNoActivity?: boolean };

describe('ticket.status_age date trigger integration', () => {
  let db: Knex;
  beforeAll(async () => {
    db = await createTestDbConnection();
    mocks.publish.mockResolvedValue(undefined);
    mocks.temporalStart.mockImplementation(async ({ runId }: { runId: string }) => ({ workflowId: `stub:${runId}`, firstExecutionRunId: null }));
  });
  afterAll(async () => { await db?.destroy(); });

  async function withScenario(body: (s: Scenario) => Promise<void>) {
    const tenantRow = await db('tenants').first('tenant');
    if (!tenantRow) throw new Error('The integration database must have its standard tenant seed.');
    const tenant = String(tenantRow.tenant);
    const trx = await db.transaction();
    try {
      await trx('tenant_settings').where({ tenant }).update({ settings: trx.raw("COALESCE(settings, '{}'::jsonb) || '{\"timezone\":\"UTC\"}'::jsonb") });
      const user = await trx('users').where({ tenant }).first('user_id');
      const clientId = uuidv4();
      const contactId = uuidv4();
      await trx('clients').insert({ tenant, client_id: clientId, client_name: 'Status age client', created_at: '2020-01-01T00:00:00Z', updated_at: '2020-01-01T00:00:00Z' });
      await trx('contacts').insert({ tenant, contact_name_id: contactId, full_name: 'Casey Contact', client_id: clientId, email: `casey-${contactId}@example.com` });

      const board = async (name: string) => {
        const boardId = uuidv4();
        await trx('boards').insert({ tenant, board_id: boardId, board_name: name, display_order: 0 });
        return boardId;
      };
      let statusOrder = 0;
      const status = async (boardId: string, name: string, isClosed = false) => {
        const statusId = uuidv4();
        statusOrder += 1;
        await trx('statuses').insert({ tenant, status_id: statusId, board_id: boardId, name, status_type: 'ticket', order_number: statusOrder, is_closed: isClosed });
        return statusId;
      };
      const ticket = async (boardId: string, statusId: string, enteredAt: string, extra: Record<string, unknown> = {}) => {
        const ticketId = uuidv4();
        await trx('tickets').insert({
          tenant, ticket_id: ticketId, ticket_number: `SA-${ticketId.slice(0, 8)}`, title: `Ticket ${ticketId.slice(0, 4)}`, board_id: boardId,
          status_id: statusId, client_id: clientId, contact_name_id: contactId, assigned_to: user?.user_id ?? null, entered_at: enteredAt,
          status_changed_at: enteredAt, ...extra,
        });
        return ticketId;
      };
      const workflow = async (params: Params | undefined) => {
        const workflowId = uuidv4();
        const trigger = { type: 'date', source: 'ticket.status_age', offsetDays: 0, localTime: '00:00', timezone: 'UTC', ...(params ? { params } : {}) };
        const definition = { trigger, payloadSchemaRef: REF, steps: [] };
        await trx('workflow_definitions').insert({ workflow_id: workflowId, tenant, name: `Status age ${workflowId.slice(0, 4)}`, payload_schema_ref: REF, trigger: JSON.stringify(trigger), draft_definition: JSON.stringify(definition), draft_version: 1, status: 'published' });
        await trx('workflow_definition_versions').insert({ workflow_id: workflowId, version: 1, definition_json: JSON.stringify(definition), published_at: '2026-01-01' });
        return workflowId;
      };
      const scan = async (at: Date | string) => {
        const when = typeof at === 'string' ? new Date(at) : at;
        const handler = createDateTriggerScanHandler((p) => launchDateTriggeredWorkflows(p), () => when, async () => 'UTC', async () => ({ knex: trx }));
        await handler({ tenantId: tenant });
      };
      // Runs created in one transaction share a timestamp, so order by what the payload says.
      const runs = async (workflowId: string) => {
        const rows = await trx('workflow_runs').where({ workflow_id: workflowId, tenant }).select('trigger_fire_key', 'input_json');
        return rows.sort((a: any, b: any) => `${a.input_json.occursOn}${a.input_json.enteredStatusAt}`.localeCompare(`${b.input_json.occursOn}${b.input_json.enteredStatusAt}`));
      };
      await body({ trx, tenant, userId: user?.user_id ?? null, clientId, contactId, board, status, ticket, workflow, scan, runs });
    } finally {
      await trx.rollback();
    }
  }

  it('fires once per occurrence: two same-day scans and a next-day scan make one run, with a payload for the follow-up steps', async () => {
    await withScenario(async ({ trx, userId, contactId, board, status, ticket, workflow, scan, runs }) => {
      const b = await board('Support');
      const waiting = await status(b, 'Waiting for client');
      const closed = await status(await board('Archive'), 'Waiting for client', true);
      const due = await ticket(b, waiting, '2026-09-10T09:00:00.000Z');
      await ticket(b, waiting, '2026-09-15T09:00:00.000Z'); // 5 days: not due yet
      await ticket(b, closed, '2026-09-01T09:00:00.000Z'); // closed status never qualifies
      const wf = await workflow({ statusName: 'waiting for CLIENT', days: 7 });

      await scan('2026-09-20T12:00:00Z');
      await scan('2026-09-20T18:00:00Z');
      await scan('2026-09-21T12:00:00Z');

      const rows = await runs(wf);
      expect(rows).toHaveLength(1);
      expect(rows[0].trigger_fire_key).toMatch(new RegExp(`^date:${wf}:ticket\\.status_age:${due}:2026-09-17:0:2026-09-10T09:00:00\\.000Z:[0-9a-f]{16}$`));
      const payload = rows[0].input_json;
      expect(dateTriggerPayloadSchemas[REF].safeParse(payload).success).toBe(true);
      expect(payload).toMatchObject({
        ticketId: due, statusName: 'Waiting for client', boardName: 'Support', contactId, assignedUserId: userId ?? undefined,
        enteredStatusAt: '2026-09-10T09:00:00.000Z', daysInStatus: 10, repeatIndex: 0, occursOn: '2026-09-17', fireDate: '2026-09-17', offsetDays: 0,
      });
      expect(await trx('workflow_runs').where({ workflow_id: wf }).count('* as n')).toEqual([{ n: '1' }]);
    });
  });

  it('a status change resets the clock; a re-save with the same status does not move it', async () => {
    await withScenario(async ({ trx, tenant, board, status, ticket, workflow, scan, runs }) => {
      const b = await board('Support');
      const waiting = await status(b, 'Waiting for client');
      const working = await status(b, 'In progress');
      const t = await ticket(b, waiting, new Date(Date.now() - 10 * DAY).toISOString());
      const wf = await workflow({ statusName: 'Waiting for client', days: 7 });
      const clock = async () => (await trx('tickets').where({ tenant, ticket_id: t }).first('status_changed_at')).status_changed_at as Date;
      const save = (statusId: string) => trx('tickets').where({ tenant, ticket_id: t }).update({ status_id: statusId, title: 'edited', ...ticketStatusClockPatch(trx, statusId) });

      await scan(new Date());
      expect(await runs(wf)).toHaveLength(1);

      const before = await clock();
      await save(waiting); // same status
      expect((await clock()).getTime()).toBe(before.getTime());

      await save(working);
      const enteredWorking = await clock();
      expect(enteredWorking.getTime()).toBeGreaterThan(before.getTime());
      await save(waiting); // back again: a new entry
      const reentered = await clock();
      expect(reentered.getTime()).toBeGreaterThan(before.getTime());

      await scan(new Date()); // 0 days in the new entry
      expect(await runs(wf)).toHaveLength(1);
      await scan(new Date(Date.now() + 8 * DAY));
      const rows = await runs(wf);
      expect(rows).toHaveLength(2);
      expect(rows[1].trigger_fire_key).toContain(reentered.toISOString());
    });
  });

  it('scopes to a board when one is set (two boards each with "Waiting for client")', async () => {
    await withScenario(async ({ board, status, ticket, workflow, scan, runs }) => {
      const b1 = await board('Support');
      const b2 = await board('Billing');
      const s1 = await status(b1, 'Waiting for client');
      const s2 = await status(b2, 'Waiting for client');
      const t1 = await ticket(b1, s1, '2026-09-01T09:00:00.000Z');
      const t2 = await ticket(b2, s2, '2026-09-01T09:00:00.000Z');
      const scoped = await workflow({ statusName: 'Waiting for client', boardId: b1, days: 7 });
      const unscoped = await workflow({ statusName: 'Waiting for client', days: 7 });

      await scan('2026-09-20T12:00:00Z');

      expect((await runs(scoped)).map((r) => r.input_json.ticketId)).toEqual([t1]);
      expect((await runs(unscoped)).map((r) => r.input_json.ticketId).sort()).toEqual([t1, t2].sort());
    });
  });

  it('repeats at N, N+R and N+2R, collapses missed periods, and stops once the ticket leaves the status', async () => {
    await withScenario(async ({ trx, tenant, board, status, ticket, workflow, scan, runs }) => {
      const b = await board('Support');
      const waiting = await status(b, 'Waiting for client');
      const working = await status(b, 'In progress');
      const t = await ticket(b, waiting, '2026-09-01T09:00:00.000Z');
      const wf = await workflow({ statusName: 'Waiting for client', days: 3, repeatEveryDays: 2 });
      const occurrences = async () => (await runs(wf)).map((r) => [r.input_json.occursOn, r.input_json.repeatIndex]);

      await scan('2026-09-03T12:00:00Z'); // 2 days: not yet
      expect(await occurrences()).toEqual([]);
      await scan('2026-09-04T12:00:00Z'); // N
      await scan('2026-09-05T12:00:00Z'); // between periods
      expect(await occurrences()).toEqual([['2026-09-04', 0]]);
      await scan('2026-09-06T12:00:00Z'); // N+R
      await scan('2026-09-08T12:00:00Z'); // N+2R
      expect(await occurrences()).toEqual([['2026-09-04', 0], ['2026-09-06', 1], ['2026-09-08', 2]]);
      // Scans missed for ten days: only the latest period fires.
      await scan('2026-09-19T12:00:00Z');
      expect((await occurrences()).slice(3)).toEqual([['2026-09-18', 7]]);

      await trx('tickets').where({ tenant, ticket_id: t }).update({ status_id: working, ...ticketStatusClockPatch(trx, working) });
      await scan('2026-09-21T12:00:00Z');
      expect(await occurrences()).toHaveLength(4);
    });
  });

  it('with requireNoActivity, a comment pushes the anchor forward; system activity does not', async () => {
    await withScenario(async ({ trx, tenant, board, status, ticket, workflow, scan, runs }) => {
      const b = await board('Support');
      const waiting = await status(b, 'Waiting for client');
      const t = await ticket(b, waiting, '2026-09-01T09:00:00.000Z');
      const quiet = await workflow({ statusName: 'Waiting for client', days: 7, requireNoActivity: true });
      const plain = await workflow({ statusName: 'Waiting for client', days: 7 });
      const commentId = uuidv4();
      const threadId = uuidv4();
      await trx.raw('SET CONSTRAINTS ALL DEFERRED');
      await trx('comment_threads').insert({ tenant, thread_id: threadId, ticket_id: t, root_comment_id: commentId, is_internal: false });
      await trx('comments').insert({ tenant, comment_id: commentId, thread_id: threadId, ticket_id: t, note: 'Any update?', is_internal: false, is_resolution: false, created_at: '2026-09-05T10:00:00Z' });
      await trx('ticket_audit_logs').insert({ tenant, ticket_id: t, event_type: 'TICKET_UPDATED', entity_type: 'ticket', actor_type: 'system', source: 'system', occurred_at: '2026-09-11T10:00:00Z', changes: JSON.stringify({ sla: { old: 1, new: 2 } }) });
      await trx('ticket_audit_logs').insert({ tenant, ticket_id: t, event_type: 'TICKET_AUTO_CLOSE_WARNING_SENT', entity_type: 'ticket', actor_type: 'user', source: 'system', occurred_at: '2026-09-11T11:00:00Z' });

      await scan('2026-09-10T12:00:00Z');
      expect(await runs(quiet)).toHaveLength(0);
      expect(await runs(plain)).toHaveLength(1);

      await scan('2026-09-12T12:00:00Z'); // comment 09-05 + 7 days; the system rows at 09-11 do not count
      const rows = await runs(quiet);
      expect(rows).toHaveLength(1);
      expect(rows[0].input_json).toMatchObject({ occursOn: '2026-09-12', enteredStatusAt: '2026-09-01T09:00:00.000Z' });
      expect(rows[0].trigger_fire_key).toContain(':2026-09-05T10:00:00.000Z:');
    });
  });

  it('with requireNoActivity, a workflow-authored comment or audit row does not move the clock; a human comment does', async () => {
    await withScenario(async ({ trx, tenant, userId, board, status, ticket, workflow, scan, runs }) => {
      const b = await board('Support');
      const waiting = await status(b, 'Waiting for client');
      const t = await ticket(b, waiting, '2026-09-01T09:00:00.000Z');
      const quiet = await workflow({ statusName: 'Waiting for client', days: 7, requireNoActivity: true });
      const comment = async (at: string, workflowAuthored: boolean) => {
        // Same inputs as the tickets.add_comment action (internal: so it needs no contact/portal setup).
        const created = await TicketModel.createComment(
          {
            ticket_id: t, content: 'Checking in', is_internal: true, is_resolution: false,
            author_type: workflowAuthored ? 'system' : 'internal', author_id: userId ?? undefined,
            ...(workflowAuthored ? { metadata: { source: 'workflow', run_id: uuidv4(), step_path: 'root.steps[0]' } } : {}),
          },
          tenant, trx, undefined, undefined, userId ?? undefined,
        );
        await trx('comments').where({ tenant, comment_id: created.comment_id }).update({ created_at: at });
        return created.comment_id;
      };

      // (a) 7 days after entering the status: fires once.
      await scan('2026-09-08T12:00:00Z');
      await scan('2026-09-09T12:00:00Z');
      expect(await runs(quiet)).toHaveLength(1);

      // (b) The run comments (and audits as the workflow actor); scanning 3 and 8 days later launches nothing.
      const workflowCommentId = await comment('2026-09-09T13:00:00Z', true);
      const stored = await trx('comments').where({ tenant, comment_id: workflowCommentId }).first('metadata');
      expect(stored.metadata).toMatchObject({ source: 'workflow' });
      // Real write path: the same helper + workflow actor/source the workflow actions pass
      // (auditCloseRulesBypassIfGated, applyChecklistTemplateToTicket in tickets.ts).
      await writeTicketActivity(trx, {
        tenant, ticketId: t, eventType: TICKET_ACTIVITY_EVENT.UPDATED, entityType: TICKET_ACTIVITY_ENTITY.TICKET,
        actor: { actorType: TICKET_ACTIVITY_ACTOR.WORKFLOW, userId: userId ?? null },
        source: TICKET_ACTIVITY_SOURCE.WORKFLOW, occurredAt: '2026-09-09T13:00:01Z',
        changes: { priority_id: { old: 'a', new: 'b' } },
      });
      // Defensive: a row tagged only by source (actor 'user') is also ignored.
      await trx('ticket_audit_logs').insert({ tenant, ticket_id: t, event_type: 'TICKET_UPDATED', entity_type: 'ticket', actor_type: 'user', source: 'workflow', occurred_at: '2026-09-09T13:00:02Z', changes: JSON.stringify({ priority: { old: 2, new: 3 } }) });
      const wfAudit = await trx('ticket_audit_logs').where({ tenant, ticket_id: t, actor_type: 'workflow', source: 'workflow' });
      expect(wfAudit).toHaveLength(1);
      await scan('2026-09-12T12:00:00Z');
      await scan('2026-09-17T12:00:00Z');
      expect(await runs(quiet)).toHaveLength(1);

      // (c) A person comments: that moves the clock. Nothing before 7 days later, one run after.
      await comment('2026-09-18T10:00:00Z', false);
      await scan('2026-09-24T12:00:00Z');
      expect(await runs(quiet)).toHaveLength(1);
      await scan('2026-09-25T12:00:00Z');
      const rows = await runs(quiet);
      expect(rows).toHaveLength(2);
      expect(rows[1].trigger_fire_key).toContain(':2026-09-18T10:00:00.000Z:');
    });
  });

  it('skips a published workflow whose params are missing', async () => {
    await withScenario(async ({ board, status, ticket, workflow, scan, runs }) => {
      const b = await board('Support');
      const waiting = await status(b, 'Waiting for client');
      await ticket(b, waiting, '2026-09-01T09:00:00.000Z');
      const wf = await workflow(undefined);
      await scan('2026-09-20T12:00:00Z');
      expect(await runs(wf)).toHaveLength(0);
    });
  });
});

type Scenario = {
  trx: Knex.Transaction; tenant: string; userId: string | null; clientId: string; contactId: string;
  board: (name: string) => Promise<string>;
  status: (boardId: string, name: string, isClosed?: boolean) => Promise<string>;
  ticket: (boardId: string, statusId: string, enteredAt: string, extra?: Record<string, unknown>) => Promise<string>;
  workflow: (params: Params | undefined) => Promise<string>;
  scan: (at: Date | string) => Promise<void>;
  runs: (workflowId: string) => Promise<Array<{ trigger_fire_key: string; input_json: any }>>;
};
