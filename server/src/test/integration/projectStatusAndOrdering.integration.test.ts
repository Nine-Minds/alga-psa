/**
 * CM T0-9b (C4, C5, C6, S4): project status/task ordering and after-commit events.
 *
 *  - C4: swapping two tenant project statuses must not trip
 *    statuses_non_ticket_order_unique_idx.
 *  - C5: task reorder validates neighbour scope and repairs bad keys inside the
 *    same transaction; a cross-phase neighbour is an error.
 *  - C6: ProjectService and the project task actions publish events only after
 *    their transaction commits.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

const dbRef = vi.hoisted(() => ({ knex: null as Knex | null, tenant: '' }));
const userRef = vi.hoisted(() => ({ user: null as any }));
const publishEventMock = vi.hoisted(() => vi.fn(async () => undefined));
const publishWorkflowEventMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
}));

vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/auth')>()),
  withAuth: (action: any) => (...args: any[]) => action(userRef.user, { tenant: dbRef.tenant }, ...args),
}));

vi.mock('@alga-psa/auth/rbac', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/auth/rbac')>()),
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: publishEventMock,
  publishWorkflowEvent: publishWorkflowEventMock,
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishEvent: publishEventMock,
  publishWorkflowEvent: publishWorkflowEventMock,
}));

import { withTransaction } from '@alga-psa/db';
import { reorderTenantProjectStatuses } from '../../../../packages/projects/src/actions/projectTaskStatusActions';
import {
  addTaskResourceAction,
  moveTaskToPhase,
  reorderTask,
} from '../../../../packages/projects/src/actions/projectTaskActions';
import { ProjectService } from '../../lib/api/services/ProjectService';

type Fixture = {
  tenant: string;
  userId: string;
  clientId: string;
  projectId: string;
  phaseA: string;
  phaseB: string;
  mappingId: string;
  statusIds: string[];
  tasksA: string[];
  taskB: string;
};

async function createFixture(db: Knex): Promise<Fixture> {
  const tenant = uuidv4();
  const short = tenant.slice(0, 8);
  await db('tenants').insert({
    tenant, client_name: `Ordering ${short}`, email: `ordering-${short}@example.com`, billing_source: 'internal',
  });
  const userId = uuidv4();
  await db('users').insert({
    tenant, user_id: userId, username: `ordering-${short}`, email: `ordering-user-${short}@example.com`,
    hashed_password: 'not-used', user_type: 'internal',
  });
  const clientId = uuidv4();
  await db('clients').insert({
    tenant, client_id: clientId, client_name: `Client ${short}`, client_type: 'company', is_tax_exempt: false,
  });
  const projectStatusId = uuidv4();
  await db('statuses').insert({
    tenant, status_id: projectStatusId, name: 'Planned', status_type: 'project', item_type: 'project',
    is_closed: false, order_number: 1,
  });

  const statusIds: string[] = [];
  for (let index = 0; index < 3; index++) {
    const statusId = uuidv4();
    statusIds.push(statusId);
    await db('statuses').insert({
      tenant, status_id: statusId, name: `Task status ${index + 1}`, status_type: 'project_task',
      item_type: 'project_task', is_closed: false, order_number: index + 1,
    });
  }

  const projectId = uuidv4();
  await db('projects').insert({
    tenant, project_id: projectId, client_id: clientId, project_name: `Ordering project ${short}`,
    wbs_code: '1', project_number: `P-${short}`, status: projectStatusId, is_inactive: false,
  });
  const mappingId = uuidv4();
  await db('project_status_mappings').insert({
    tenant, project_status_mapping_id: mappingId, project_id: projectId, status_id: statusIds[0],
    is_standard: false, display_order: 1, is_visible: true,
  });

  const phaseA = uuidv4();
  const phaseB = uuidv4();
  for (const [phaseId, wbs, name] of [[phaseA, '1.1', 'Phase A'], [phaseB, '1.2', 'Phase B']] as const) {
    await db('project_phases').insert({
      tenant, phase_id: phaseId, project_id: projectId, phase_name: name, wbs_code: wbs,
      status: 'active', order_number: phaseId === phaseA ? 1 : 2, order_key: phaseId === phaseA ? 'a0' : 'a1',
    });
  }

  const tasksA: string[] = [];
  for (const [index, key] of ['a0', 'a1', 'a2'].entries()) {
    const taskId = uuidv4();
    tasksA.push(taskId);
    await db('project_tasks').insert({
      tenant, task_id: taskId, phase_id: phaseA, project_status_mapping_id: mappingId,
      task_name: `Task ${index + 1}`, wbs_code: `1.1.${index + 1}`, order_key: key,
    });
  }
  const taskB = uuidv4();
  await db('project_tasks').insert({
    tenant, task_id: taskB, phase_id: phaseB, project_status_mapping_id: mappingId,
    task_name: 'Other phase task', wbs_code: '1.2.1', order_key: 'a0',
  });

  return { tenant, userId, clientId, projectId, phaseA, phaseB, mappingId, statusIds, tasksA, taskB };
}

describe('project status and ordering (CM T0-9b)', () => {
  let db: Knex;
  let fx: Fixture;

  beforeAll(async () => {
    db = await createTestDbConnection();
    dbRef.knex = db;
  }, 600_000);

  afterAll(async () => {
    await db?.destroy();
  }, 120_000);

  beforeEach(async () => {
    fx = await createFixture(db);
    dbRef.tenant = fx.tenant;
    userRef.user = { user_id: fx.userId, tenant: fx.tenant, user_type: 'internal', roles: [] };
    publishEventMock.mockClear();
    publishWorkflowEventMock.mockClear();
  });

  const statusOrder = async () =>
    (await db('statuses').where({ tenant: fx.tenant, status_type: 'project_task' }).orderBy('order_number')
      .select('status_id', 'order_number'));

  describe('C4: tenant project status reorder', () => {
    it('swaps two statuses without tripping statuses_non_ticket_order_unique_idx', async () => {
      const [a, b] = fx.statusIds;
      const result = await reorderTenantProjectStatuses([
        { status_id: a, order_number: 2 },
        { status_id: b, order_number: 1 },
      ]);
      expect(result).toBeUndefined();
      const order = await statusOrder();
      expect(order.map((row) => row.status_id)).toEqual([b, a, fx.statusIds[2]]);
    });

    it('rotates a longer run and leaves untouched statuses in place', async () => {
      const [a, b, c] = fx.statusIds;
      const result = await reorderTenantProjectStatuses([
        { status_id: a, order_number: 3 },
        { status_id: b, order_number: 1 },
        { status_id: c, order_number: 2 },
      ]);
      expect(result).toBeUndefined();
      expect((await statusOrder()).map((row) => row.status_id)).toEqual([b, c, a]);
    });

    it('rejects ids that are not tenant project statuses and leaves the order unchanged', async () => {
      const before = await statusOrder();
      await expect(reorderTenantProjectStatuses([
        { status_id: fx.statusIds[0], order_number: 2 },
        { status_id: uuidv4(), order_number: 1 },
      ])).resolves.toMatchObject({ actionError: 'Project task status not found' });
      expect(await statusOrder()).toEqual(before);
    });

    it('rejects duplicate positions', async () => {
      const before = await statusOrder();
      const result = await reorderTenantProjectStatuses([
        { status_id: fx.statusIds[0], order_number: 1 },
        { status_id: fx.statusIds[1], order_number: 1 },
      ]);
      expect(result).toBeDefined();
      expect(await statusOrder()).toEqual(before);
    });
  });

  describe('C5: task reorder', () => {
    const taskOrder = async (phaseId: string) =>
      (await db('project_tasks').where({ tenant: fx.tenant, phase_id: phaseId }).orderBy('order_key')
        .select('task_id')).map((row) => row.task_id);

    it('swaps two tasks within a phase', async () => {
      const [t1, t2, t3] = fx.tasksA;
      // Move t1 between t2 and t3, then t3 between t2 and t1: a full swap of the outer pair.
      expect(await reorderTask(t1, t2, t3)).toBeUndefined();
      expect(await taskOrder(fx.phaseA)).toEqual([t2, t1, t3]);
      expect(await reorderTask(t3, t2, t1)).toBeUndefined();
      expect(await taskOrder(fx.phaseA)).toEqual([t2, t3, t1]);
    });

    it('rejects a neighbour from another phase', async () => {
      const before = await taskOrder(fx.phaseA);
      const result = await reorderTask(fx.tasksA[0], fx.taskB, fx.tasksA[2]);
      expect(result).toMatchObject({ actionError: expect.stringContaining('same phase') });
      expect(await taskOrder(fx.phaseA)).toEqual(before);
    });

    it('repairs unusable order keys in the same transaction and completes the move', async () => {
      const [t1, t2, t3] = fx.tasksA;
      // 'a' is not a valid fractional-index key; generation throws and must be repaired in place.
      await db('project_tasks').where({ tenant: fx.tenant, task_id: t2 }).update({ order_key: 'a' });
      await db('project_tasks').where({ tenant: fx.tenant, task_id: t3 }).update({ order_key: 'b' });
      const result = await reorderTask(t1, t2, t3);
      expect(result).toBeUndefined();
      const rows = await db('project_tasks').where({ tenant: fx.tenant, phase_id: fx.phaseA }).orderBy('order_key')
        .select('task_id', 'order_key');
      expect(rows.map((row) => row.task_id)).toEqual([t2, t1, t3]);
      expect(new Set(rows.map((row) => row.order_key)).size).toBe(3);
    });
  });

  describe('C6: events publish only after commit', () => {
    const service = () => new ProjectService();
    const context = () => ({ tenant: fx.tenant, userId: fx.userId, user: userRef.user } as any);

    it('publishes no event when the surrounding transaction rolls back', async () => {
      await expect(withTransaction(db, async (trx) => {
        await service().update(fx.projectId, { project_name: 'Renamed in rolled-back trx' } as any, { ...context(), db: trx });
        expect(publishWorkflowEventMock).not.toHaveBeenCalled();
        throw new Error('force rollback');
      })).rejects.toThrow('force rollback');

      expect(publishWorkflowEventMock).not.toHaveBeenCalled();
      const row = await db('projects').where({ tenant: fx.tenant, project_id: fx.projectId }).first();
      expect(row.project_name).not.toBe('Renamed in rolled-back trx');
    });

    it('publishes exactly once, after commit', async () => {
      await withTransaction(db, async (trx) => {
        await service().update(fx.projectId, { project_name: 'Renamed and committed' } as any, { ...context(), db: trx });
        expect(publishWorkflowEventMock).not.toHaveBeenCalled();
      });

      expect(publishWorkflowEventMock).toHaveBeenCalledTimes(1);
      expect(publishWorkflowEventMock.mock.calls[0][0]).toMatchObject({ eventType: 'PROJECT_UPDATED' });
      const row = await db('projects').where({ tenant: fx.tenant, project_id: fx.projectId }).first();
      expect(row.project_name).toBe('Renamed and committed');
    });

    it('publishes PROJECT_DELETED once, only after the delete commits', async () => {
      await withTransaction(db, async (trx) => {
        await service().delete(fx.projectId, { ...context(), db: trx });
        expect(publishEventMock).not.toHaveBeenCalled();
      });

      expect(publishEventMock).toHaveBeenCalledTimes(1);
      expect(publishEventMock.mock.calls[0][0]).toMatchObject({ eventType: 'PROJECT_DELETED' });
      expect(await db('projects').where({ tenant: fx.tenant, project_id: fx.projectId }).first()).toBeUndefined();
    });

    it('publishes no PROJECT_DELETED when the delete rolls back', async () => {
      await expect(withTransaction(db, async (trx) => {
        await service().delete(fx.projectId, { ...context(), db: trx });
        throw new Error('force rollback');
      })).rejects.toThrow('force rollback');

      expect(publishEventMock).not.toHaveBeenCalled();
      expect(await db('projects').where({ tenant: fx.tenant, project_id: fx.projectId }).first()).toBeTruthy();
    });

    // The actions open their own transaction on createTenantKnex(). Pointing that at an
    // outer transaction nests the action's frame inside it, so the test owns the commit or rollback.
    const insideOuterTransaction = async (work: () => Promise<void>, rollback: boolean) => {
      const run = withTransaction(db, async (trx) => {
        dbRef.knex = trx;
        try {
          await work();
        } finally {
          dbRef.knex = db;
        }
        if (rollback) throw new Error('force rollback');
      });
      if (rollback) await expect(run).rejects.toThrow('force rollback');
      else await run;
    };
    const workflowEventTypes = () => publishWorkflowEventMock.mock.calls.map((call: any[]) => call[0].eventType);
    // An additional agent sits beside the task's primary assignee, so give the task one
    // and return a second internal user to add.
    const additionalAgent = async () => {
      const agentId = uuidv4();
      await db('users').insert({
        tenant: fx.tenant, user_id: agentId, username: `agent-${agentId.slice(0, 8)}`,
        email: `agent-${agentId.slice(0, 8)}@example.com`, hashed_password: 'not-used', user_type: 'internal',
      });
      await db('project_tasks').where({ tenant: fx.tenant, task_id: fx.tasksA[0] }).update({ assigned_to: fx.userId });
      return agentId;
    };

    it('addTaskResourceAction publishes nothing when its transaction rolls back', async () => {
      const agentId = await additionalAgent();
      await insideOuterTransaction(async () => {
        expect(await addTaskResourceAction(fx.tasksA[0], agentId)).toBeUndefined();
        expect(publishWorkflowEventMock).not.toHaveBeenCalled();
      }, true);

      expect(publishWorkflowEventMock).not.toHaveBeenCalled();
      expect(await db('task_resources').where({ tenant: fx.tenant, task_id: fx.tasksA[0] }).first()).toBeUndefined();
    });

    it('addTaskResourceAction publishes PROJECT_TASK_ADDITIONAL_AGENT_ASSIGNED once, after commit', async () => {
      const agentId = await additionalAgent();
      await insideOuterTransaction(async () => {
        expect(await addTaskResourceAction(fx.tasksA[0], agentId)).toBeUndefined();
        expect(publishWorkflowEventMock).not.toHaveBeenCalled();
      }, false);

      expect(workflowEventTypes()).toEqual(['PROJECT_TASK_ADDITIONAL_AGENT_ASSIGNED']);
      expect(await db('task_resources').where({ tenant: fx.tenant, task_id: fx.tasksA[0] }).first()).toBeTruthy();
    });

    it('moveTaskToPhase publishes nothing when its transaction rolls back', async () => {
      await insideOuterTransaction(async () => {
        const moved = await moveTaskToPhase(fx.tasksA[0], fx.phaseB, fx.mappingId);
        expect(moved).toMatchObject({ task_id: fx.tasksA[0], phase_id: fx.phaseB });
        expect(publishWorkflowEventMock).not.toHaveBeenCalled();
      }, true);

      expect(publishWorkflowEventMock).not.toHaveBeenCalled();
      const row = await db('project_tasks').where({ tenant: fx.tenant, task_id: fx.tasksA[0] }).first();
      expect(row.phase_id).toBe(fx.phaseA);
    });

    it('moveTaskToPhase publishes PROJECT_TASK_UPDATED once, after commit', async () => {
      await insideOuterTransaction(async () => {
        const moved = await moveTaskToPhase(fx.tasksA[0], fx.phaseB, fx.mappingId);
        expect(moved).toMatchObject({ task_id: fx.tasksA[0], phase_id: fx.phaseB });
        expect(publishWorkflowEventMock).not.toHaveBeenCalled();
      }, false);

      expect(workflowEventTypes()).toEqual(['PROJECT_TASK_UPDATED']);
      const row = await db('project_tasks').where({ tenant: fx.tenant, task_id: fx.tasksA[0] }).first();
      expect(row.phase_id).toBe(fx.phaseB);
    });
  });
});
