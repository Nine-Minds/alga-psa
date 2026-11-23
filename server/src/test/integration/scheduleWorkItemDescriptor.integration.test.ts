import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { TestContext } from '../../../test-utils/testContext';
import {
  describeScheduleWorkItems,
  scheduleWorkItemKey,
  type FoundScheduleWorkItem,
  type ScheduleWorkItemRef,
} from '@alga-psa/scheduling/lib/scheduleWorkItemDescriptor';

// T001 (S1, alga0002339): describeScheduleWorkItems resolves every work item type to label, link, ticketId and
// done-state in batched, tenant-scoped queries, and reports a deleted work item as missing.

const helpers = TestContext.createHelpers();
const HOOK_TIMEOUT = 900_000;

describe('describeScheduleWorkItems (T001)', () => {
  let ctx: TestContext;
  let tenant: string;
  let ids: Record<string, string>;
  let projectId: string;
  let phaseId: string;

  beforeAll(async () => {
    ctx = await helpers.beforeAll({ cleanupTables: ['schedule_entry_assignees'] });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await helpers.afterAll();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    ctx = await helpers.beforeEach();
    tenant = ctx.tenantId;
    const db = ctx.db;
    const userId = ctx.userId;
    const clientId = ctx.clientId;
    ids = {};
    const id = (name: string) => (ids[name] = randomUUID());

    let statusOrder = 1000;
    const mkStatus = async (type: string, name: string, isClosed: boolean) => {
      const statusId = randomUUID();
      await db('statuses').insert({
        tenant, status_id: statusId, name: `${name} ${statusId.slice(0, 6)}`, status_type: type,
        order_number: statusOrder++, is_closed: isClosed, is_default: false, created_by: userId,
      });
      return statusId;
    };

    // Tickets: open; closed through both the flag and the status; closed only through its status (flag false);
    // closed only through the denormalized flag (status still open).
    const ticketOpenStatus = await mkStatus('ticket', 'Open', false);
    const ticketClosedStatus = await mkStatus('ticket', 'Closed', true);
    const mkTicket = async (name: string, statusId: string, isClosed = false) => {
      await db('tickets').insert({
        tenant, ticket_id: id(name), ticket_number: `T-${name}-${randomUUID().slice(0, 6)}`, title: `Title ${name}`,
        client_id: clientId, status_id: statusId, is_closed: isClosed,
      });
    };
    await mkTicket('ticketOpen', ticketOpenStatus);
    await mkTicket('ticketClosed', ticketClosedStatus, true);
    await mkTicket('ticketClosedByStatusOnly', ticketClosedStatus, false);
    await mkTicket('ticketClosedByFlagOnly', ticketOpenStatus, true);

    // Interactions: with ticket, without ticket, closed.
    const interactionOpen = await mkStatus('interaction', 'Planned', false);
    const interactionClosed = await mkStatus('interaction', 'Done', true);
    const tenantType = randomUUID();
    await db('interaction_types').insert({ tenant, type_id: tenantType, type_name: 'Site visit' });
    const systemType = await db('system_interaction_types').where({ type_name: 'Call' }).first('type_id');
    const mkInteraction = async (name: string, typeId: string, statusId: string, ticketId: string | null) => {
      await db('interactions').insert({
        tenant, interaction_id: id(name), type_id: typeId, user_id: userId, client_id: clientId,
        title: `Interaction ${name}`, status_id: statusId, ticket_id: ticketId,
        interaction_date: new Date(), start_time: new Date(), end_time: new Date(),
      });
    };
    await mkInteraction('interactionWithTicket', systemType.type_id, interactionOpen, ids.ticketOpen);
    await mkInteraction('interactionNoTicket', tenantType, interactionOpen, null);
    await mkInteraction('interactionClosed', systemType.type_id, interactionClosed, null);

    // Project tasks: one in an open status mapping, one in a closed one.
    const projectStatus = await mkStatus('project', 'Active', false);
    projectId = randomUUID();
    await db('projects').insert({
      tenant, project_id: projectId, project_name: 'Descriptor project', status: projectStatus,
      wbs_code: `S1-${projectId.slice(0, 8)}`, client_id: clientId, project_number: `P-${projectId.slice(0, 6)}`,
    });
    phaseId = randomUUID();
    await db('project_phases').insert({
      tenant, phase_id: phaseId, project_id: projectId, phase_name: 'Phase 1', status: 'active', order_number: 1, wbs_code: '1.1',
    });
    const mkMapping = async (isClosed: boolean, order: number) => {
      const statusId = await mkStatus('project_task', isClosed ? 'Done' : 'Todo', isClosed);
      const mappingId = randomUUID();
      await db('project_status_mappings').insert({
        tenant, project_status_mapping_id: mappingId, project_id: projectId, phase_id: phaseId, status_id: statusId,
        display_order: order, is_standard: false,
      });
      return mappingId;
    };
    const openMapping = await mkMapping(false, 1);
    const closedMapping = await mkMapping(true, 2);
    const mkTask = async (name: string, mappingId: string) => {
      await db('project_tasks').insert({
        tenant, task_id: id(name), phase_id: phaseId, task_name: `Task ${name}`, wbs_code: `1.1.${name.length}`,
        project_status_mapping_id: mappingId,
      });
    };
    await mkTask('taskOpen', openMapping);
    await mkTask('taskClosed', closedMapping);

    // Opportunity steps: every status in the CHECK (planned | current | done | skipped).
    const opportunityId = id('opportunity');
    const client = await db('clients').where({ tenant, client_id: clientId }).first('default_currency_code');
    await db('opportunities').insert({
      tenant, opportunity_id: opportunityId, opportunity_number: `OPP-${opportunityId.slice(0, 8)}`, client_id: clientId,
      title: 'Deal', opportunity_type: 'new_logo', owner_id: userId, status: 'open', stage: 'identified', confidence: 'medium',
      mrr_cents: 0, nrr_cents: 0, hardware_cents: 0, currency_code: client.default_currency_code,
      values_locked_by_quote: false, last_activity_at: new Date(), created_by: userId,
    });
    const mkStep = async (name: string, status: string) => {
      await db('opportunity_steps').insert({ tenant, step_id: id(name), opportunity_id: opportunityId, title: `Step ${name}`, status });
    };
    await mkStep('stepCurrent', 'current');
    await mkStep('stepDone', 'done');
    await mkStep('stepPlanned', 'planned');
    await mkStep('stepSkipped', 'skipped');

    // Appointment requests: every status in the CHECK (pending | approved | declined | cancelled).
    const serviceId = randomUUID();
    const serviceTypeId = randomUUID();
    await db('service_types').insert({
      id: serviceTypeId, tenant, name: `Visit type ${serviceTypeId.slice(0, 6)}`,
      is_active: true, order_number: 9000, standard_service_type_id: null,
    });
    await db('service_catalog').insert({
      tenant, service_id: serviceId, service_name: 'Onsite visit', billing_method: 'fixed', default_rate: 0,
      custom_service_type_id: serviceTypeId, unit_of_measure: 'each',
    });
    const mkRequest = async (name: string, status: string) => {
      await db('appointment_requests').insert({
        tenant, appointment_request_id: id(name), service_id: serviceId, status,
        requested_date: '2031-03-10', requested_time: '09:00', requested_duration: 60,
      });
    };
    await mkRequest('requestApproved', 'approved');
    await mkRequest('requestPending', 'pending');
    await mkRequest('requestDeclined', 'declined');
    await mkRequest('requestCancelled', 'cancelled');
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    await helpers.afterEach();
  }, HOOK_TIMEOUT);

  const ref = (type: string, name: string, extra: Partial<ScheduleWorkItemRef> = {}): ScheduleWorkItemRef => ({
    work_item_type: type, work_item_id: ids[name], ...extra,
  });
  const found = (map: Map<string, any>, type: string, name: string): FoundScheduleWorkItem => {
    const d = map.get(scheduleWorkItemKey(type, ids[name]));
    expect(d, `${type}:${name}`).toBeDefined();
    expect(d.missing).toBe(false);
    return d;
  };

  it('resolves every work item type in one batch', async () => {
    const entryId = randomUUID();
    const occurrence = new Date('2031-03-10T09:00:00.000Z');
    const entryRef = { entry_id: entryId, occurrence };
    const result = await describeScheduleWorkItems(ctx.db, tenant, [
      ref('ticket', 'ticketOpen'),
      ref('ticket', 'ticketClosed'),
      ref('ticket', 'ticketClosedByStatusOnly'),
      ref('ticket', 'ticketClosedByFlagOnly'),
      ref('interaction', 'interactionWithTicket', entryRef),
      ref('interaction', 'interactionNoTicket', entryRef),
      ref('interaction', 'interactionClosed', entryRef),
      ref('project_task', 'taskOpen'),
      ref('project_task', 'taskClosed'),
      ref('opportunity_step', 'stepCurrent'),
      ref('opportunity_step', 'stepDone'),
      ref('opportunity_step', 'stepPlanned'),
      ref('opportunity_step', 'stepSkipped'),
      ref('appointment_request', 'requestApproved'),
      ref('appointment_request', 'requestPending'),
      ref('appointment_request', 'requestDeclined'),
      ref('appointment_request', 'requestCancelled'),
      { work_item_type: 'ad_hoc', work_item_id: null, entry_id: entryId, entry_title: 'Lunch', occurrence },
    ]);

    const ticketOpen = found(result, 'ticket', 'ticketOpen');
    expect(ticketOpen.link).toBe(`/msp/tickets/${ids.ticketOpen}`);
    expect(ticketOpen.ticketId).toBe(ids.ticketOpen);
    expect(ticketOpen.label).toBe('Ticket');
    expect(ticketOpen.title).toContain('Title ticketOpen');
    expect(ticketOpen.done).toBe(false);
    expect(found(result, 'ticket', 'ticketClosed').done).toBe(true);
    // Either signal alone closes the ticket.
    expect(found(result, 'ticket', 'ticketClosedByStatusOnly').done).toBe(true);
    expect(found(result, 'ticket', 'ticketClosedByFlagOnly').done).toBe(true);

    // Interaction on a ticket: the ticket page, ticketId set, label is the interaction type name.
    const withTicket = found(result, 'interaction', 'interactionWithTicket');
    expect(withTicket.link).toBe(`/msp/tickets/${ids.ticketOpen}`);
    expect(withTicket.ticketId).toBe(ids.ticketOpen);
    expect(withTicket.label).toBe('Call');
    expect(withTicket.labelKey).toBeUndefined();
    expect(withTicket.done).toBe(false);

    // Interaction without a ticket: the schedule deep link for its entry (tenant-defined type name).
    const noTicket = found(result, 'interaction', 'interactionNoTicket');
    expect(noTicket.link).toBe(`/msp/schedule?entryId=${entryId}&occurrence=2031-03-10T09%3A00%3A00.000Z`);
    expect(noTicket.ticketId).toBeUndefined();
    expect(noTicket.label).toBe('Site visit');
    expect(found(result, 'interaction', 'interactionClosed').done).toBe(true);

    const taskOpen = found(result, 'project_task', 'taskOpen');
    expect(taskOpen.link).toBe(`/msp/projects/${projectId}?taskId=${ids.taskOpen}&phaseId=${phaseId}`);
    expect(taskOpen.title).toBe('Task taskOpen');
    expect(taskOpen.done).toBe(false);
    expect(found(result, 'project_task', 'taskClosed').done).toBe(true);

    const stepCurrent = found(result, 'opportunity_step', 'stepCurrent');
    expect(stepCurrent.link).toBe(`/msp/opportunities/${ids.opportunity}`);
    expect(stepCurrent.done).toBe(false);
    expect(found(result, 'opportunity_step', 'stepDone').done).toBe(true);
    expect(found(result, 'opportunity_step', 'stepPlanned').done).toBe(false);
    // A skipped step needs no reminder: it counts as done.
    expect(found(result, 'opportunity_step', 'stepSkipped').done).toBe(true);

    const approved = found(result, 'appointment_request', 'requestApproved');
    expect(approved.link).toBe(`/msp/schedule?requestId=${ids.requestApproved}`);
    expect(approved.done).toBe(false);
    expect(approved.title).toBe('Onsite visit');
    // Only an approved request is still live work; pending, declined and cancelled all count as done.
    expect(found(result, 'appointment_request', 'requestPending').done).toBe(true);
    expect(found(result, 'appointment_request', 'requestDeclined').done).toBe(true);
    expect(found(result, 'appointment_request', 'requestCancelled').done).toBe(true);

    const adHoc = result.get(scheduleWorkItemKey('ad_hoc', null, entryId)) as FoundScheduleWorkItem;
    expect(adHoc.missing).toBe(false);
    expect(adHoc.link).toBe(`/msp/schedule?entryId=${entryId}&occurrence=2031-03-10T09%3A00%3A00.000Z`);
    expect(adHoc.title).toBe('Lunch');
    expect(adHoc.done).toBe(false);
  });

  it('reports deleted work items as missing', async () => {
    const del = (table: string, column: string, name: string) => ctx.db(table).where({ tenant, [column]: ids[name] }).del();
    await del('opportunity_steps', 'step_id', 'stepCurrent');
    await del('appointment_requests', 'appointment_request_id', 'requestPending');
    await del('project_tasks', 'task_id', 'taskOpen');
    await del('interactions', 'interaction_id', 'interactionNoTicket');
    await del('tickets', 'ticket_id', 'ticketClosed');
    const result = await describeScheduleWorkItems(ctx.db, tenant, [
      ref('opportunity_step', 'stepCurrent'),
      ref('appointment_request', 'requestPending'),
      ref('project_task', 'taskOpen'),
      ref('interaction', 'interactionNoTicket'),
      ref('ticket', 'ticketClosed'),
      ref('ticket', 'ticketOpen'),
    ]);
    for (const [type, name] of [
      ['opportunity_step', 'stepCurrent'], ['appointment_request', 'requestPending'], ['project_task', 'taskOpen'],
      ['interaction', 'interactionNoTicket'], ['ticket', 'ticketClosed'],
    ]) {
      expect(result.get(scheduleWorkItemKey(type, ids[name]))).toMatchObject({ missing: true, workItemType: type });
    }
    // The survivors in the same batch still resolve.
    expect(found(result, 'ticket', 'ticketOpen').done).toBe(false);
  });

  it('does not resolve another tenant\'s work items', async () => {
    const other = await ctx.db('tenants').whereNot({ tenant }).first('tenant');
    if (!other) return; // single-tenant database: nothing foreign to probe
    const result = await describeScheduleWorkItems(ctx.db, other.tenant, [ref('ticket', 'ticketOpen')]);
    expect(result.get(scheduleWorkItemKey('ticket', ids.ticketOpen))).toMatchObject({ missing: true });
  });

  it('issues a fixed number of queries regardless of batch size', async () => {
    const counts: number[] = [];
    for (const copies of [1, 5]) {
      let queries = 0;
      const onQuery = () => { queries += 1; };
      ctx.db.client.on?.('query', onQuery);
      const items = Array.from({ length: copies }, () => [
        ref('ticket', 'ticketOpen'), ref('ticket', 'ticketClosed'),
        ref('interaction', 'interactionWithTicket'), ref('interaction', 'interactionClosed'),
        ref('project_task', 'taskOpen'), ref('project_task', 'taskClosed'),
        ref('opportunity_step', 'stepDone'), ref('appointment_request', 'requestPending'),
      ]).flat();
      await describeScheduleWorkItems(ctx.db, tenant, items);
      ctx.db.client.removeListener?.('query', onQuery);
      counts.push(queries);
    }
    expect(counts[1]).toBe(counts[0]);
    expect(counts[0]).toBeLessThanOrEqual(6);
  });
});
