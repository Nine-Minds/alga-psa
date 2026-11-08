import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ redactedFields: [] as string[], writes: 0 }));
const taskId = '00000000-0000-4000-8000-000000000004';
const referenceId = '00000000-0000-4000-8000-000000000006';
const updatedAt = '2026-11-03T12:00:00.000Z';

vi.mock('@alga-psa/db', () => ({ tenantDb: () => ({ tenantJoin: () => undefined, table: (name: string) => {
  const builder: any = { where: () => builder, whereIn: () => builder, forUpdate: () => builder, select: async () => name === 'project_tasks as task' ? [{ task_id: taskId }] : [{
    reference_id: referenceId, task_id: taskId, revision: 4, task_name: 'Replace core switch', project_name: 'Network refresh', organization_name: 'Customer Co',
    assignee_name: 'QA Tester', assigned_to: '00000000-0000-4000-8000-000000000008', assigned_team_id: null,
  }], first: async () => ({ task_name: 'Replace core switch', due_date: null, project_status_mapping_id: null, updated_at: updatedAt, phase_id: 'phase-id', project_id: 'project-id' }),
  update: async () => { state.writes += 1; } };
  return builder;
} }) }));
vi.mock('../projectTaskGate', () => ({ assertCoManagedProjectWorkServed: async () => undefined }));
vi.mock('../sharedWork', () => ({ withCoManagedSharedWork: async (_db: any, actor: any, resource: any, action: string, work: any) =>
  work({ trx: {}, actor, resource, action, redactedFields: state.redactedFields }) }));
vi.mock('../projectTaskAudit', () => ({ coManagedRequestHash: () => 'hash', findCoManagedTaskReplay: async () => null, recordCoManagedTaskAudit: async () => undefined }));

import { editCoManagedProjectTask, CoManagedTaskEditError } from '../projectTaskEditing';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor: any = { tenant: U(1), userId: U(2), sessionId: U(3), kind: 'session' };
const resource: any = { kind: 'project_task', tenant: U(5), relationshipId: U(6), id: taskId };
const request = (expectedRevision = 4, expectedTaskUpdatedAt = updatedAt): any => ({ expectedRevision, expectedTaskUpdatedAt, patch: { task_name: 'Updated task' } });

describe('editCoManagedProjectTask conflict snapshots', () => {
  beforeEach(() => { state.redactedFields = []; state.writes = 0; });
  describe.each(['assignee_name', 'project_tasks.assignee_name', 'co_managed_project_task_references.assignee_name'])('redaction %s', alias => {
    it.each([
      ['revision', request(3, updatedAt)],
      ['customer_drift', request(4, '2026-11-02T12:00:00.000Z')],
    ] as const)('attaches a current-policy snapshot to %s conflict', async (_reason, editRequest) => {
      state.redactedFields = [alias];
      let failure: unknown;
      try { await editCoManagedProjectTask({} as any, actor, resource, editRequest, async () => { state.writes += 1; }); }
      catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(CoManagedTaskEditError);
      const fresh = (failure as CoManagedTaskEditError).snapshot!;
      expect(fresh.assignee).not.toBeNull();
      expect(fresh).toMatchObject({ revision: 4, assignee: { kind: 'user', name: null }, values: { task_name: 'Replace core switch' } });
      expect(JSON.stringify((failure as CoManagedTaskEditError).snapshot)).not.toContain('QA Tester');
      expect(state.writes).toBe(0);
    });
  });
});
