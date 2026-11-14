/** listCoManagedSharedProjectTasks applies the reader's CURRENT redactions to the assignee name. Mocked: the DB, admission wrapper, identity lock and licence gate. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ tasks: [] as any[], references: [] as any[], redactedFields: [] as string[] }));

vi.mock('@alga-psa/db', () => ({
  withTransaction: async (_db: any, work: any) => work({}),
  tenantDb: () => ({
    tenantJoin: () => undefined,
    table: (name: string) => {
      const builder: any = { where: () => builder, whereIn: () => builder, orderBy: () => builder, limit: () => builder,
        select: async () => name.startsWith('project_tasks') ? state.tasks : state.references };
      return builder;
    },
  }),
}));
vi.mock('../projectTaskGate', () => ({ assertCoManagedProjectWorkServed: async () => undefined }));
vi.mock('../sharedWorkIdentity', async () => {
  const actual = await vi.importActual<typeof import('../sharedWorkIdentity')>('../sharedWorkIdentity');
  return { ...actual, snapshotCoManagedSessionActor: (actor: any) => actor, lockCoManagedSessionIdentity: async () => ({ teamIds: [] }) };
});
vi.mock('../sharedWork', async () => ({ withCoManagedSharedWork: async (_db: any, _actor: any, _resource: any, _action: string, work: any) => work({ trx: {}, redactedFields: state.redactedFields }) }));

import { listCoManagedSharedProjectTasks } from '../projectTaskQueue';
import { CO_MANAGED_ASSIGNEE_NAME_ALIASES } from '../sharedWorkProjection';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor: any = { tenant: U(1), userId: U(2) };
const target = { customerTenant: U(3), relationshipId: U(4), projectId: U(5) };
const task = (n: number) => ({ task_id: U(200 + n), task_name: `Task ${n}`, due_date: '2026-12-01T00:00:00.000Z', updated_at: '2026-11-01T00:00:00.000Z' });
const ref = (n: number, assignedTo = U(2)) => ({ task_id: U(200 + n), revision: n, assignee_name: 'Alex', assigned_to: assignedTo });
const list = () => listCoManagedSharedProjectTasks({} as any, actor, target);

beforeEach(() => { state.tasks = [task(1), task(2), task(3)]; state.references = [ref(1), ref(2, U(9))]; state.redactedFields = []; });

describe('listCoManagedSharedProjectTasks assignee redaction', () => {
  it('with nothing redacted returns names and assignedToMe', async () => {
    const { rows } = await list();
    expect(rows[0].reference).toEqual({ revision: 1, assigneeName: 'Alex', assignedToMe: true });
    expect(rows[1].reference).toEqual({ revision: 2, assigneeName: 'Alex', assignedToMe: false });
  });
  it('a redacted assignee_name nulls only the name', async () => {
    const plain = await list();
    state.redactedFields = ['assignee_name'];
    const { rows } = await list();
    expect(rows).toHaveLength(3);
    expect(rows[0].reference).toEqual({ revision: 1, assigneeName: null, assignedToMe: true });
    expect(rows[1].reference).toEqual({ revision: 2, assigneeName: null, assignedToMe: false });
    expect(rows.map(r => [r.taskName, r.dueDate])).toEqual(plain.rows.map(r => [r.taskName, r.dueDate]));
    expect(JSON.stringify(rows)).not.toContain('Alex');
  });
  it('every assignee alias hides the name', async () => {
    for (const alias of [...CO_MANAGED_ASSIGNEE_NAME_ALIASES, 'assignee', 'users', 'teams', 'values.assignee_name']) {
      state.redactedFields = [alias];
      expect((await list()).rows[0].reference, alias).toMatchObject({ assigneeName: null, revision: 1, assignedToMe: true });
    }
  });
  it('a redacted task_name still drops the page', async () => {
    state.redactedFields = ['task_name'];
    expect(await list()).toEqual({ rows: [], nextAfterTaskId: null });
  });
  it('an unassigned task has no reference even under an assignee redaction', async () => {
    state.redactedFields = ['assignee_name'];
    expect((await list()).rows[2].reference).toBeNull();
  });
});
