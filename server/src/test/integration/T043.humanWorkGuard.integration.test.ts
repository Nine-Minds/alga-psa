import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createServiceUser } from '../../../test-utils/serviceUserFixtures';
import {
  assertHumanWorkAssignee,
  assertHumanWorkOwner,
} from '../../../../shared/lib/humanWork/assertHumanWorkAssignee';
import {
  HumanWorkAssigneeInvalidError,
  HumanWorkOwnerRequiredError,
} from '../../../../shared/lib/humanWork/HumanWorkOwnerRequiredError';
import { addTicketResourceCore } from '../../../../shared/services/tickets/ticketResourceCore';
import { assignTeamToTicketCore } from '../../../../shared/services/tickets/teamAssignmentCore';
import ScheduleEntry from '../../../../shared/models/scheduleEntry';
import { TicketModel } from '../../../../shared/models/ticketModel';
import { ProjectTaskModel } from '../../../../packages/projects/src/models';
import { findOrCreateTimeSheetRow } from '../../../../packages/scheduling/src/lib/timeSheetResolution';
import { persistTimeEntry } from '../../../../packages/scheduling/src/lib/timeEntryWriteCore';
import {
  createInteractionRecord,
  resolveScheduleAssignees,
} from '../../../../packages/clients/src/actions/interactionCreateHelper';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

class Rollback extends Error {}

// T043 (F052-F060), T021 (F058), T022 (F061): CE human-work guard against a real database.
describe('T043/T021/T022 human-work guard', () => {
  let knex: Knex;
  let tenant: string;
  let internalId: string;
  let serviceId: string;
  let ticketRow: { ticket_id: string; board_id: string; status_id: string; client_id: string };
  let otherStatusId: string;
  let phaseId: string;
  let statusMappingId: string;

  // Run fn in a transaction that is always rolled back, so fixtures never leak.
  async function rolledBack(fn: (trx: Knex.Transaction) => Promise<void>): Promise<void> {
    try {
      await knex.transaction(async (trx) => {
        await fn(trx);
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
  }

  async function insertUser(trx: Knex.Transaction, opts: { type?: string; inactive?: boolean } = {}) {
    const id = uuidv4();
    await tenantDb(trx, tenant).table('users').insert({
      tenant,
      user_id: id,
      username: `t043-${id.slice(0, 8)}`,
      email: `t043-${id.slice(0, 8)}@example.test`,
      first_name: 'T043',
      last_name: 'User',
      hashed_password: 'x',
      user_type: opts.type ?? 'internal',
      is_inactive: opts.inactive ?? false,
    });
    return id;
  }

  async function insertTicket(trx: Knex.Transaction, assignedTo: string | null) {
    const id = uuidv4();
    await tenantDb(trx, tenant).table('tickets').insert({
      tenant,
      ticket_id: id,
      ticket_number: `T043-${id.slice(0, 8)}`,
      title: 'T043 ticket',
      client_id: ticketRow.client_id,
      board_id: ticketRow.board_id,
      status_id: ticketRow.status_id,
      assigned_to: assignedTo,
      entered_by: internalId,
      entered_at: new Date(),
      is_closed: false,
    });
    return id;
  }

  beforeAll(async () => {
    knex = await createTestDbConnection();
    const discovery = tenantDb(knex, '__test_discovery__');
    const q = discovery.unscoped('tickets as t', 'T043 discovery of seeded ticket/user context');
    discovery.tenantJoin(q, 'users as u', 'u.tenant', 't.tenant');
    const ctx = await q
      .where('u.user_type', 'internal')
      .select('t.tenant', 't.ticket_id', 't.board_id', 't.status_id', 't.client_id', 'u.user_id')
      .first();
    tenant = ctx.tenant;
    internalId = ctx.user_id;
    ticketRow = ctx;
    serviceId = (await createServiceUser(knex, tenant)).userId;

    const other = await tenantDb(knex, tenant)
      .table('statuses')
      .where({ status_type: 'ticket', board_id: ticketRow.board_id, is_closed: false })
      .whereNot({ status_id: ticketRow.status_id })
      .first();
    otherStatusId = other.status_id;

    const phase = await tenantDb(knex, tenant).table('project_phases as ph').first('ph.phase_id', 'ph.project_id');
    phaseId = phase.phase_id;
    const mapping = await tenantDb(knex, tenant)
      .table('project_status_mappings')
      .where({ project_id: phase.project_id })
      .first();
    statusMappingId = mapping.project_status_mapping_id;
  });

  afterAll(async () => {
    await tenantDb(knex, tenant).table('users').where({ user_id: serviceId }).delete();
    await knex.destroy();
  });

  describe('assertHumanWorkAssignee (F052)', () => {
    it('passes active internal ids, ignores null/undefined, dedupes', async () => {
      await expect(assertHumanWorkAssignee(knex, tenant, [internalId, internalId, null, undefined])).resolves.toBeUndefined();
      await expect(assertHumanWorkAssignee(knex, tenant, [])).resolves.toBeUndefined();
    });

    it('rejects service, client, inactive and unknown ids with the offending ids', async () => {
      await rolledBack(async (trx) => {
        const clientUser = await insertUser(trx, { type: 'client' });
        const inactive = await insertUser(trx, { inactive: true });
        const unknown = uuidv4();
        for (const bad of [serviceId, clientUser, inactive, unknown]) {
          const error = await assertHumanWorkAssignee(trx, tenant, [internalId, bad]).catch((e) => e);
          expect(error).toBeInstanceOf(HumanWorkAssigneeInvalidError);
          expect(error.code).toBe('HUMAN_WORK_ASSIGNEE_INVALID');
          expect(error.userIds).toEqual([bad]);
        }
      });
    });

    it('is tenant scoped: an id from another tenant is invalid', async () => {
      await expect(assertHumanWorkAssignee(knex, uuidv4(), [internalId])).rejects.toBeInstanceOf(HumanWorkAssigneeInvalidError);
    });
  });

  describe('assertHumanWorkOwner', () => {
    it('throws HumanWorkOwnerRequiredError(field) for non-internal or missing owners', async () => {
      const error = await assertHumanWorkOwner(knex, tenant, serviceId, 'user_id').catch((e) => e);
      expect(error).toBeInstanceOf(HumanWorkOwnerRequiredError);
      expect(error.field).toBe('user_id');
      await expect(assertHumanWorkOwner(knex, tenant, null, 'approved_by')).rejects.toBeInstanceOf(HumanWorkOwnerRequiredError);
      await expect(assertHumanWorkOwner(knex, tenant, internalId, 'user_id')).resolves.toBeUndefined();
    });
  });

  describe('ticket writes (F053)', () => {
    it('addTicketResourceCore rejects a service id (additional agent and promoted primary)', async () => {
      await rolledBack(async (trx) => {
        const promote = await insertTicket(trx, null);
        await expect(addTicketResourceCore(trx, tenant, internalId, promote, serviceId, 'support'))
          .rejects.toBeInstanceOf(HumanWorkAssigneeInvalidError);
        const assigned = await insertTicket(trx, internalId);
        await expect(addTicketResourceCore(trx, tenant, internalId, assigned, serviceId, 'support'))
          .rejects.toBeInstanceOf(HumanWorkAssigneeInvalidError);
        const agent = await insertUser(trx);
        const ok = await addTicketResourceCore(trx, tenant, internalId, assigned, agent, 'support');
        expect(ok.resource?.additional_user_id).toBe(agent);
      });
    });

    it('assignTeamToTicketCore rejects a service team member and writes nothing', async () => {
      await rolledBack(async (trx) => {
        const lead = await insertUser(trx);
        const teamId = uuidv4();
        await tenantDb(trx, tenant).table('teams').insert({ tenant, team_id: teamId, team_name: `t043-${teamId.slice(0, 6)}`, manager_id: lead });
        await tenantDb(trx, tenant).table('team_members').insert({ tenant, team_id: teamId, user_id: serviceId });
        const ticket = await insertTicket(trx, lead);
        await expect(assignTeamToTicketCore(trx, tenant, internalId, ticket, teamId))
          .rejects.toBeInstanceOf(HumanWorkAssigneeInvalidError);
        const row = await tenantDb(trx, tenant).table('tickets').where({ ticket_id: ticket }).first();
        expect(row.assigned_team_id).toBeNull();
      });
    });

    it('TicketModel.updateTicket rejects assigned_to = service user but allows an internal user', async () => {
      await rolledBack(async (trx) => {
        const ticket = await insertTicket(trx, internalId);
        await expect(TicketModel.updateTicket(ticket, { assigned_to: serviceId } as any, tenant, trx))
          .rejects.toBeInstanceOf(HumanWorkAssigneeInvalidError);
        const agent = await insertUser(trx);
        const updated = await TicketModel.updateTicket(ticket, { assigned_to: agent } as any, tenant, trx);
        expect(updated.assigned_to).toBe(agent);
      });
    });

    it('TicketModel.createTicket path rejects a service assignee (insert guard)', async () => {
      await rolledBack(async (trx) => {
        const error = await TicketModel.createTicket(
          {
            title: 'T043 create',
            client_id: ticketRow.client_id,
            board_id: ticketRow.board_id,
            status_id: ticketRow.status_id,
            priority_id: (await tenantDb(trx, tenant).table('priorities').first('priority_id')).priority_id,
            entered_by: internalId,
            assigned_to: serviceId,
          } as any,
          tenant,
          trx,
          { skipLocationValidation: true, skipCategoryValidation: true } as any,
          { silent: true } as any,
        ).catch((e) => e);
        expect(error).toBeInstanceOf(HumanWorkAssigneeInvalidError);
      });
    });
  });

  describe('T022 legacy references (F061)', () => {
    it('a ticket whose assigned_to is a service user can still change status; reassigning to it is rejected', async () => {
      await rolledBack(async (trx) => {
        const legacy = await insertTicket(trx, serviceId);
        const updated = await TicketModel.updateTicket(legacy, { status_id: otherStatusId } as any, tenant, trx);
        expect(updated.status_id).toBe(otherStatusId);
        expect(updated.assigned_to).toBe(serviceId);
        // Re-sending the unchanged legacy value is not a change.
        await expect(TicketModel.updateTicket(legacy, { assigned_to: serviceId, title: 'renamed' } as any, tenant, trx))
          .resolves.toBeTruthy();

        const fresh = await insertTicket(trx, internalId);
        await expect(TicketModel.updateTicket(fresh, { assigned_to: serviceId } as any, tenant, trx))
          .rejects.toBeInstanceOf(HumanWorkAssigneeInvalidError);
      });
    });

    it('schedule updateAssignees keeps a legacy assignee but rejects adding a service one', async () => {
      await rolledBack(async (trx) => {
        const entry = await ScheduleEntry.create(
          trx,
          tenant,
          { title: 'T043 legacy', scheduled_start: new Date('2030-01-01T10:00:00Z'), scheduled_end: new Date('2030-01-01T11:00:00Z'), work_item_type: 'ad_hoc', status: 'scheduled' } as any,
          { assignedUserIds: [internalId] },
        );
        // Plant a legacy service assignee directly, as a migration would have left it.
        await tenantDb(trx, tenant).table('schedule_entry_assignees').insert({ tenant, entry_id: entry.entry_id, user_id: serviceId });
        const other = await insertUser(trx);
        await expect(ScheduleEntry.updateAssignees(trx, tenant, entry.entry_id, [internalId, serviceId, other])).resolves.toBeUndefined();
        const entry2 = await ScheduleEntry.create(
          trx,
          tenant,
          { title: 'T043 fresh', scheduled_start: new Date('2030-01-02T10:00:00Z'), scheduled_end: new Date('2030-01-02T11:00:00Z'), work_item_type: 'ad_hoc', status: 'scheduled' } as any,
          { assignedUserIds: [internalId] },
        );
        await expect(ScheduleEntry.updateAssignees(trx, tenant, entry2.entry_id, [internalId, serviceId]))
          .rejects.toBeInstanceOf(HumanWorkAssigneeInvalidError);
      });
    });
  });

  describe('schedule entries (F054)', () => {
    it('ScheduleEntry.create rejects a service assignee and accepts internal', async () => {
      await rolledBack(async (trx) => {
        const base = { title: 'T043', scheduled_start: new Date('2030-02-01T10:00:00Z'), scheduled_end: new Date('2030-02-01T11:00:00Z'), work_item_type: 'ad_hoc', status: 'scheduled' } as any;
        await expect(ScheduleEntry.create(trx, tenant, base, { assignedUserIds: [serviceId] }))
          .rejects.toBeInstanceOf(HumanWorkAssigneeInvalidError);
        const ok = await ScheduleEntry.create(trx, tenant, base, { assignedUserIds: [internalId] });
        expect(ok.assigned_user_ids).toEqual([internalId]);
      });
    });
  });

  describe('time sheet and time entry owners (F055-F057)', () => {
    it('a new time sheet defaulted to a service user throws HumanWorkOwnerRequiredError(user_id)', async () => {
      await rolledBack(async (trx) => {
        const error = await findOrCreateTimeSheetRow(trx, tenant, serviceId, uuidv4()).catch((e) => e);
        expect(error).toBeInstanceOf(HumanWorkOwnerRequiredError);
        expect(error.field).toBe('user_id');
      });
    });

    it('persistTimeEntry rejects a service actor (defaulted) and a service explicit owner', async () => {
      await rolledBack(async (trx) => {
        const entry = {
          work_item_id: uuidv4(),
          work_item_type: 'ad_hoc',
          start_time: '2030-03-01T10:00:00.000Z',
          end_time: '2030-03-01T11:00:00.000Z',
          billable_duration: 60,
          service_id: uuidv4(),
        } as any;
        const asService = { user_id: serviceId, user_type: 'service', tenant } as any;
        const defaulted = await persistTimeEntry(trx, { tenant, actor: asService, entry }).catch((e) => e);
        expect(defaulted).toBeInstanceOf(HumanWorkOwnerRequiredError);
        expect(defaulted.field).toBe('user_id');

        // Explicit service owner, from a self-acting service actor (avoids the delegation permission gate).
        const explicit = await persistTimeEntry(trx, { tenant, actor: asService, entry: { ...entry, user_id: serviceId } }).catch((e) => e);
        expect(explicit).toBeInstanceOf(HumanWorkAssigneeInvalidError);
      });
    });

    it('time-entry / time-sheet approval requires a human approver (approved_by)', async () => {
      const error = await assertHumanWorkOwner(knex, tenant, serviceId, 'approved_by').catch((e) => e);
      expect(error).toBeInstanceOf(HumanWorkOwnerRequiredError);
      expect(error.field).toBe('approved_by');
      await expect(assertHumanWorkOwner(knex, tenant, internalId, 'approved_by')).resolves.toBeUndefined();
    });
  });

  describe('interactions (F059, F060)', () => {
    it('createInteractionRecord: defaulted service caller -> OwnerRequired; explicit service owner -> AssigneeInvalid', async () => {
      await rolledBack(async (trx) => {
        const base = { type_id: uuidv4(), title: 'T043', client_id: ticketRow.client_id } as any;
        const defaulted = await createInteractionRecord({
          tenant, trx, user: { user_id: serviceId }, interactionData: { ...base, user_id: serviceId },
        }).catch((e) => e);
        expect(defaulted).toBeInstanceOf(HumanWorkOwnerRequiredError);
        expect(defaulted.field).toBe('user_id');
        const explicit = await createInteractionRecord({
          tenant, trx, user: { user_id: internalId }, interactionData: { ...base, user_id: serviceId },
        }).catch((e) => e);
        expect(explicit).toBeInstanceOf(HumanWorkAssigneeInvalidError);
      });
    });

    it('resolveScheduleAssignees never defaults to a non-internal caller', () => {
      expect(resolveScheduleAssignees('u1', undefined, 'internal')).toEqual(['u1']);
      for (const type of ['service', 'client', null, undefined]) {
        const attempt = () => resolveScheduleAssignees('u1', [], type as any);
        expect(attempt).toThrow(HumanWorkOwnerRequiredError);
        try { attempt(); } catch (e) { expect((e as HumanWorkOwnerRequiredError).field).toBe('assignees'); }
      }
      // Explicit assignees are returned untouched (validated later by the schedule write).
      expect(resolveScheduleAssignees('u1', ['u2'], 'service')).toEqual(['u2']);
    });
  });

  describe('T021 project tasks (F058)', () => {
    it('addTask / updateTask / addTaskResource reject a service user', async () => {
      await rolledBack(async (trx) => {
        const taskData = { task_name: 'T021 task', project_status_mapping_id: statusMappingId } as any;
        await expect(ProjectTaskModel.addTask(trx, tenant, phaseId, { ...taskData, assigned_to: serviceId }))
          .rejects.toBeInstanceOf(HumanWorkAssigneeInvalidError);

        const task = await ProjectTaskModel.addTask(trx, tenant, phaseId, { ...taskData, assigned_to: internalId });
        expect(task.assigned_to).toBe(internalId);

        await expect(ProjectTaskModel.updateTask(trx, tenant, task.task_id, { assigned_to: serviceId }))
          .rejects.toBeInstanceOf(HumanWorkAssigneeInvalidError);
        await expect(ProjectTaskModel.addTaskResource(trx, tenant, task.task_id, serviceId))
          .rejects.toBeInstanceOf(HumanWorkAssigneeInvalidError);

        // Internal user as resource still works.
        const agent = await insertUser(trx);
        await ProjectTaskModel.addTaskResource(trx, tenant, task.task_id, agent, 'support');
        const resources = await tenantDb(trx, tenant).table('task_resources').where({ task_id: task.task_id });
        expect(resources.map((r: any) => r.additional_user_id)).toEqual([agent]);
      });
    });

    it('legacy service assignee on a task does not block unrelated updates', async () => {
      await rolledBack(async (trx) => {
        const task = await ProjectTaskModel.addTask(trx, tenant, phaseId, { task_name: 'T021 legacy', project_status_mapping_id: statusMappingId, assigned_to: internalId } as any);
        await tenantDb(trx, tenant).table('project_tasks').where({ task_id: task.task_id }).update({ assigned_to: serviceId });
        const renamed = await ProjectTaskModel.updateTask(trx, tenant, task.task_id, { task_name: 'renamed', assigned_to: serviceId });
        expect(renamed.task_name).toBe('renamed');
      });
    });
  });
});
