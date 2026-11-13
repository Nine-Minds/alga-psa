/** The generic shared-work summary denies a wholly hidden task outright (opaque error), matching the task editor and history;
 * per-field task redactions still project field by field. Regression for alga-2026-0003020. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ row: null as any, redactedFields: [] as string[], firstCalls: 0 }));

vi.mock('@alga-psa/db', () => ({
  withTransaction: async (_db: any, work: any) => work({}),
  tenantDb: () => {
    const builder: any = { where: () => builder, first: async () => { state.firstCalls += 1; return state.row; } };
    return { table: () => builder, tenantJoin: () => builder };
  },
}));
vi.mock('../sharedWork', async () => {
  const actual = await vi.importActual<typeof import('../sharedWork')>('../sharedWork');
  return { ...actual, withCoManagedSharedWork: async (_db: any, _actor: any, resource: any, _action: string, work: any) =>
    work({ trx: { raw: () => ({}) }, resource, revision: 1, redactedFields: state.redactedFields }) };
});

import { getCoManagedSharedWorkSummary } from '../sharedWorkRead';
import { CoManagedSharedWorkError } from '../sharedWorkIdentity';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// Actor tenant differs from the resource tenant so the read takes the shared-work (not customer-ticket) branch.
const actor: any = { tenant: U(1), userId: U(2) };
const task: any = { kind: 'project_task', tenant: U(3), id: U(4), relationshipId: U(5) };
const read = () => getCoManagedSharedWorkSummary({} as any, actor, task);

describe('getCoManagedSharedWorkSummary · project_task whole-resource redaction', () => {
  beforeEach(() => {
    state.redactedFields = [];
    state.firstCalls = 0;
    state.row = { task_name: 'Patch firewall', wbs_code: '1.2', due_date: '2026-02-01', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
      project_status_mapping_id: U(6), project_id: U(7), project_name: 'Network refresh', phase_id: U(8), phase_name: 'Rollout', status_name: 'In Progress', is_closed: false };
  });

  it('with no redactions returns the task summary', async () => {
    const summary = await read();
    expect(summary.fields.task_name).toBe('Patch firewall');
    expect(summary.fields.project).toMatchObject({ kind: 'project', id: U(7), name: 'Network refresh' });
    expect(summary.fields.phase).toMatchObject({ kind: 'project_phase', id: U(8), name: 'Rollout' });
  });

  it.each(['*', 'fields', 'tasks', 'project_tasks', 'fields.tasks', 'fields.project_tasks'])('denies the whole task before any read when %s is redacted', async redaction => {
    state.redactedFields = [redaction];
    await expect(read()).rejects.toBeInstanceOf(CoManagedSharedWorkError);
    expect(state.firstCalls).toBe(0);
  });

  it('a nested task-field redaction stays per-field: hides that field, keeps the rest', async () => {
    state.redactedFields = ['project_tasks.task_name'];
    const summary = await read();
    expect('task_name' in summary.fields).toBe(false);
    expect(summary.fields.wbs_code).toBe('1.2');
    expect(summary.fields.project).toMatchObject({ name: 'Network refresh' });
  });

  it('a whole-project redaction hides only the project reference on a task read', async () => {
    state.redactedFields = ['projects'];
    const summary = await read();
    expect('project' in summary.fields).toBe(false);
    expect(summary.fields.task_name).toBe('Patch firewall');
  });
});
