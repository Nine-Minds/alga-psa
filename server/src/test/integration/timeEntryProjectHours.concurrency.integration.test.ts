import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { recalculateProjectTaskActualHours } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { ProjectTaskModel } from '../../../../packages/projects/src/models';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

/**
 * Two time-entry saves against the same project task, each in its own transaction, must leave
 * project_tasks.actual_hours equal to the true sum of the entries. Without a lock on the task
 * rows both recomputes read the total before the other's entry is committed and the second
 * UPDATE overwrites the first with a stale sum.
 *
 * Deterministic, not sleep-based: transaction A saves its entry and recomputes (holding the
 * task row), then holds its transaction open until Postgres reports transaction B's backend
 * blocked on a lock. Only then does A commit. B was blocked either on the task row lock (fixed
 * code: B has not yet read the total) or on its UPDATE (unfixed code: B already read a stale
 * total), so the same script distinguishes the two.
 */

let knex: Knex;
let tenant: string;
let userId: string;
let phaseId: string;
let statusMappingId: string;
const createdTaskIds: string[] = [];
const createdEntryIds: string[] = [];

async function insertEntry(trx: Knex.Transaction, taskId: string, minutes: number): Promise<void> {
  const entryId = uuidv4();
  createdEntryIds.push(entryId);
  const start = new Date('2026-10-12T13:00:00Z');
  await tenantDb(trx, tenant).table('time_entries').insert({
    tenant,
    entry_id: entryId,
    user_id: userId,
    work_item_type: 'project_task',
    work_item_id: taskId,
    work_date: '2026-10-12',
    work_timezone: 'UTC',
    start_time: start,
    end_time: new Date(start.getTime() + minutes * 60_000),
    billable_duration: minutes,
    approval_status: 'DRAFT',
  });
}

async function waitUntilBlocked(pid: number, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await knex.raw(
      `SELECT 1 FROM pg_stat_activity WHERE pid = ? AND wait_event_type = 'Lock'`,
      [pid]
    );
    if (rows.length > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

async function createTask(name: string): Promise<string> {
  const task = await ProjectTaskModel.addTask(knex, tenant, phaseId, {
    task_name: name,
    project_status_mapping_id: statusMappingId,
    assigned_to: userId,
  } as any);
  createdTaskIds.push(task.task_id);
  return task.task_id;
}

const actualHours = async (taskId: string): Promise<number> => {
  const row = await tenantDb(knex, tenant).table('project_tasks').where({ task_id: taskId }).first('actual_hours');
  return Number(row.actual_hours);
};

/** Two overlapping saves; returns once both have committed. */
async function overlappingSaves(
  first: { taskIds: string[]; minutes: number },
  second: { taskIds: string[]; minutes: number }
): Promise<void> {
  let resolveBPid!: (pid: number) => void;
  const bPid = new Promise<number>((resolve) => (resolveBPid = resolve));

  // One recalc call per save, like the real callers: the lock order (sorted ids) is
  // established inside that call, whatever order the entries were written in.
  const save = async (side: { taskIds: string[]; minutes: number }, trx: Knex.Transaction) => {
    for (const taskId of side.taskIds) await insertEntry(trx, taskId, side.minutes);
    await recalculateProjectTaskActualHours(trx, tenant, side.taskIds);
  };

  const a = knex.transaction(async (trx) => {
    await save(first, trx);
    // Hold A open until B is stuck behind it.
    const blocked = await waitUntilBlocked(await bPid);
    expect(blocked).toBe(true);
  });

  const b = knex.transaction(async (trx) => {
    const { rows } = await trx.raw('SELECT pg_backend_pid() AS pid');
    resolveBPid(rows[0].pid);
    await save(second, trx);
  });

  await Promise.all([a, b]);
}

describe('project task actual_hours under concurrent time saves', () => {
  beforeAll(async () => {
    knex = await createTestDbConnection();
    const discovery = tenantDb(knex, '__test_discovery__');
    const q = discovery.unscoped('project_phases as ph', 'concurrency test discovery of seeded project context');
    discovery.tenantJoin(q, 'users as u', 'u.tenant', 'ph.tenant');
    const ctx = await q
      .where('u.user_type', 'internal')
      .select('ph.tenant', 'ph.phase_id', 'ph.project_id', 'u.user_id')
      .first();
    tenant = ctx.tenant;
    userId = ctx.user_id;
    phaseId = ctx.phase_id;
    const mapping = await tenantDb(knex, tenant).table('project_status_mappings').where({ project_id: ctx.project_id }).first();
    statusMappingId = mapping.project_status_mapping_id;
  });

  afterAll(async () => {
    if (!knex) return;
    if (createdEntryIds.length) await tenantDb(knex, tenant).table('time_entries').whereIn('entry_id', createdEntryIds).del();
    if (createdTaskIds.length) await tenantDb(knex, tenant).table('project_tasks').whereIn('task_id', createdTaskIds).del();
    await knex.destroy();
  });

  it('two parallel saves on the same task end with the true sum, not the last writer', async () => {
    const taskId = await createTask('concurrency same task');

    await overlappingSaves({ taskIds: [taskId], minutes: 60 }, { taskIds: [taskId], minutes: 30 });

    expect(await actualHours(taskId)).toBe(90);
  });

  it('opposite task order across two tasks neither deadlocks nor loses an update', async () => {
    const t1 = await createTask('concurrency task 1');
    const t2 = await createTask('concurrency task 2');

    // Task ids are locked sorted, so A(t1,t2) and B(t2,t1) cannot lock in opposite orders.
    const [low, high] = [t1, t2].sort();
    await overlappingSaves({ taskIds: [low, high], minutes: 10 }, { taskIds: [high, low], minutes: 20 });

    expect(await actualHours(t1)).toBe(30);
    expect(await actualHours(t2)).toBe(30);
  });
});
