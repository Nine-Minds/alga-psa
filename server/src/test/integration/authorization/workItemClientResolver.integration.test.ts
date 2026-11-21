import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { TestContext } from '../../../../test-utils/testContext';
import { clientResolvers } from '@alga-psa/authorization/kernel';
import {
  UNKNOWN_KIND,
  dropForeignTenant,
  polymorphicRowsAllowed,
  seedPolymorphicFixture,
  type PolymorphicFixture,
  type PolymorphicTemplate,
} from './polymorphicClientFixture';

// T004 (work_item). time_entries and schedule_entries have no client column: the
// client is the owner of the work item the (work_item_type, work_item_id) pair
// points at. The row facet and the SQL facet come from one registry entry and
// must agree on every row.

const helpers = TestContext.createHelpers();
const HOOK_TIMEOUT = 900_000;
const TEMPLATES: PolymorphicTemplate[] = ['client_portfolio', 'selected_clients'];

describe('work_item client resolver (time_entries, schedule_entries)', () => {
  let ctx: TestContext;
  let fx: PolymorphicFixture;
  /** time_entries.entry_id by label */
  const time: Record<string, string> = {};
  /** schedule_entries.entry_id by label */
  const sched: Record<string, string> = {};

  beforeAll(async () => {
    ctx = await helpers.beforeAll();
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await helpers.afterAll();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    ctx = await helpers.beforeEach();
    fx = await seedPolymorphicFixture(ctx.db, ctx.tenantId, ctx.userId);

    const targets: Array<[string, string, string]> = [
      ['ticketA', 'ticket', fx.a.ticketId],
      ['taskA', 'project_task', fx.a.taskId],
      ['interactionA', 'interaction', fx.a.interactionId],
      ['ticketB', 'ticket', fx.b.ticketId],
      ['taskB', 'project_task', fx.b.taskId],
      ['interactionB', 'interaction', fx.b.interactionId],
      // Kinds the tables allow but that have no client, also one pointing at a real ticket id (both tables' CHECK constraints reject an unlisted type).
      ['adHoc', 'ad_hoc', randomUUID()],
      ['unknown', 'ad_hoc', fx.a.ticketId],
      // A real id under the WRONG kind must not resolve through another kind's table.
      ['wrongKind', 'project_task', fx.a.ticketId],
      // A ticket id that exists only in another tenant.
      ['foreignTicket', 'ticket', fx.foreignTicketId],
    ];
    const now = new Date();
    for (const [label, type, id] of targets) {
      const entryId = randomUUID();
      time[label] = entryId;
      await ctx.db('time_entries').insert({
        tenant: ctx.tenantId, entry_id: entryId, user_id: ctx.userId, work_item_id: id, work_item_type: type,
        start_time: now, end_time: new Date(now.getTime() + 3_600_000), work_date: now.toISOString().slice(0, 10), work_timezone: 'UTC',
      });
      const [row] = await ctx.db('schedule_entries').insert({
        tenant: ctx.tenantId, title: label, status: 'scheduled', work_item_id: id, work_item_type: type,
        scheduled_start: now, scheduled_end: new Date(now.getTime() + 3_600_000),
      }).returning('entry_id');
      sched[label] = String(row.entry_id);
    }
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    await dropForeignTenant(ctx.db, fx);
    await helpers.afterEach();
  }, HOOK_TIMEOUT);

  const resolve = (type: string, id: string) =>
    clientResolvers.resolveClient(ctx.db, ctx.tenantId, 'work_item', type, id);

  it('row facet: a time entry on a ticket, a project task and an interaction resolves to that work item\'s client', async () => {
    expect(await resolve('ticket', fx.a.ticketId)).toBe(fx.a.clientId);
    expect(await resolve('project_task', fx.a.taskId)).toBe(fx.a.clientId);
    expect(await resolve('interaction', fx.a.interactionId)).toBe(fx.a.clientId);
    expect(await resolve('ticket', fx.b.ticketId)).toBe(fx.b.clientId);
    expect(await resolve('project_task', fx.b.taskId)).toBe(fx.b.clientId);
    expect(await resolve('interaction', fx.b.interactionId)).toBe(fx.b.clientId);
  });

  it('row facet: an unknown discriminator, a kind with no client, the wrong kind and another tenant\'s record resolve to null', async () => {
    expect(await resolve(UNKNOWN_KIND, fx.a.ticketId)).toBeNull();
    expect(await resolve('ad_hoc', randomUUID())).toBeNull();
    expect(await resolve('project_task', fx.a.ticketId)).toBeNull();
    expect(await resolve('ticket', fx.foreignTicketId)).toBeNull();
    expect(await resolve('ticket', randomUUID())).toBeNull();
    expect(await clientResolvers.resolveClient(ctx.db, ctx.tenantId, 'no_such_resolver', 'ticket', fx.a.ticketId)).toBeNull();
  });

  describe.each([
    ['time_entries', 'te', time],
    ['schedule_entries', 'se', sched],
  ] as const)('SQL facet on %s', (table, alias, ids) => {
    const allowed = (template: PolymorphicTemplate, clientIds: string[]) =>
      polymorphicRowsAllowed(ctx.db, ctx.tenantId, { table, alias, pk: 'entry_id', template, clientIds });

    it.each(TEMPLATES)('%s with client A returns only A\'s rows', async (template) => {
      expect(await allowed(template, [fx.a.clientId])).toEqual(
        [ids.ticketA, ids.taskA, ids.interactionA].sort()
      );
      expect(await allowed(template, [fx.b.clientId])).toEqual(
        [ids.ticketB, ids.taskB, ids.interactionB].sort()
      );
      expect(await allowed(template, [fx.a.clientId, fx.b.clientId])).toHaveLength(6);
    });

    it.each(TEMPLATES)('%s never returns unknown-kind, wrong-kind or cross-tenant rows, and an empty set returns nothing', async (template) => {
      const everyone = await allowed(template, [fx.a.clientId, fx.b.clientId, fx.foreignClientId]);
      for (const label of ['adHoc', 'unknown', 'wrongKind', 'foreignTicket']) {
        expect(everyone).not.toContain(ids[label]);
      }
      expect(await allowed(template, [])).toEqual([]);
    });

    it('same_client narrows to the subject\'s client through the same hook', async () => {
      expect(await allowed('same_client', [fx.a.clientId])).toEqual(
        [ids.ticketA, ids.taskA, ids.interactionA].sort()
      );
    });

    it('parity: the SQL facet selects exactly the rows whose row-facet client is in the set', async () => {
      const rows = await ctx.db(table).where({ tenant: ctx.tenantId }).select<Array<Record<string, string>>>('entry_id', 'work_item_type', 'work_item_id');
      for (const clientId of [fx.a.clientId, fx.b.clientId]) {
        const viaRowFacet: string[] = [];
        for (const row of rows) {
          if ((await resolve(row.work_item_type, row.work_item_id)) === clientId) viaRowFacet.push(String(row.entry_id));
        }
        expect(await allowed('client_portfolio', [clientId])).toEqual(viaRowFacet.sort());
      }
    });
  });
});
