/** Whole-task redactions deny the generic shared-work summary (opaque 404) before any task row is read. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFake } from './fakeCoManagedDb';

const policy = vi.hoisted(() => ({ redactedFields: [] as string[], tables: [] as string[] }));
vi.mock('@alga-psa/db', async () => {
  const { fakeTenantDb } = await import('./fakeCoManagedDb');
  return { tenantDb: (db: any, tenant: string) => {
    const owner = fakeTenantDb(db, tenant);
    return { ...owner, tenantJoin: () => undefined, table: (name: string) => { policy.tables.push(name); return owner.table(name); } };
  }, withTransaction: (db: any, work: any) => db.transaction(work) };
});
vi.mock('../sharedWork', async () => ({
  ...(await vi.importActual<any>('../sharedWork')),
  withCoManagedSharedWork: (db: any, actor: any, resource: any, _action: string, work: any) => db.transaction((trx: any) =>
    work({ trx, actor, resource, revision: 4, redactedFields: policy.redactedFields, assertCurrent: async () => undefined })),
}));

import { getCoManagedSharedWorkSummary } from '../sharedWorkRead';
import { CoManagedSharedWorkError } from '../sharedWorkIdentity';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = { kind: 'session' as const, tenant: U(1), userId: U(2), sessionId: U(3) };
const resource = { kind: 'project_task' as const, tenant: U(4), id: U(5), relationshipId: U(6) };
let fixture: ReturnType<typeof createFake>;
beforeEach(() => {
  policy.redactedFields = [];
  policy.tables = [];
  fixture = createFake();
  fixture.store.seed('project_tasks', { tenant: resource.tenant, task_id: resource.id, task_name: 'Private task', wbs_code: '1.2',
    project_id: U(10), project_name: 'Rollout', phase_id: U(9), phase_name: 'Build', due_date: '2026-12-01T00:00:00.000Z' });
});

describe('getCoManagedSharedWorkSummary whole-task redaction', () => {
  it.each(['*', 'fields', 'tasks', 'project_tasks', 'fields.tasks', 'fields.project_tasks'])('denies project_task summary for %s before reading the task row', async redaction => {
    policy.redactedFields = [redaction];
    await expect(getCoManagedSharedWorkSummary(fixture.db, actor, resource)).rejects.toBeInstanceOf(CoManagedSharedWorkError);
    expect(policy.tables).not.toContain('project_tasks');
  });

  it('returns the summary with no redaction', async () => {
    const summary = await getCoManagedSharedWorkSummary(fixture.db, actor, resource);
    expect(policy.tables).toContain('project_tasks');
    expect(summary).toMatchObject({ resource, revision: 4 });
    expect(summary.fields).toMatchObject({ task_name: 'Private task', wbs_code: '1.2', project: { kind: 'project', id: U(10), name: 'Rollout' },
      phase: { kind: 'project_phase', id: U(9), name: 'Build' }, due_date: expect.any(String) });
  });

  it('keeps a nested field redaction as a per-field omission', async () => {
    policy.redactedFields = ['project_tasks.task_name'];
    const { fields } = await getCoManagedSharedWorkSummary(fixture.db, actor, resource);
    expect(fields).not.toHaveProperty('task_name');
    expect(fields).toMatchObject({ wbs_code: '1.2', project: { name: 'Rollout' }, phase: { name: 'Build' } });
  });

  it('does not treat a whole-projects redaction as a whole-task denial', async () => {
    policy.redactedFields = ['projects'];
    const { fields } = await getCoManagedSharedWorkSummary(fixture.db, actor, resource);
    expect(fields).not.toHaveProperty('project');
    expect(fields).toMatchObject({ task_name: 'Private task', wbs_code: '1.2', phase: { name: 'Build' } });
  });
});
