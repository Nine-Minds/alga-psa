/** Task history omits redacted changes (never nulls them). The assignee name rides on `msp_assignee`, so every assignee-name alias hides it. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ rows: [] as any[], redactedFields: [] as string[] }));

vi.mock('@alga-psa/db', () => ({
  withTransaction: async (_db: any, work: any) => work({}),
  tenantDb: () => ({ table: () => {
    const builder: any = { where: () => builder, whereIn: () => builder, whereRaw: () => builder, orderBy: () => builder, limit: () => builder, select: async () => state.rows };
    return builder;
  } }),
}));
vi.mock('../projectTaskGate', () => ({ assertCoManagedProjectWorkServed: async () => undefined }));
vi.mock('../sharedWorkIdentity', async () => {
  const actual = await vi.importActual<typeof import('../sharedWorkIdentity')>('../sharedWorkIdentity');
  return { ...actual, snapshotCoManagedSessionActor: (actor: any) => actor };
});
vi.mock('../sharedWork', () => ({ withCoManagedSharedWork: async (_db: any, _actor: any, _resource: any, _action: string, work: any) =>
  work({ trx: {}, redactedFields: state.redactedFields }) }));

import { listCoManagedProjectTaskHistory } from '../projectTaskAudit';
import { coManagedAuditFieldAliases, projectCoManagedChanges } from '../sharedWorkProjection';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor: any = { tenant: U(1), userId: U(2) };
const resource: any = { kind: 'project_task', tenant: U(3), id: U(4), relationshipId: U(5) };
const assignee = { from: U(90), to: U(91), kind: 'user', name: 'Alex MSP' };
const changed = { msp_assignee: assignee, task_name: { from: 'a', to: 'b' } };

describe('projectCoManagedChanges', () => {
  it('derives the assignee-name aliases for msp_assignee only', () => {
    expect(coManagedAuditFieldAliases('msp_assignee')).toEqual(expect.arrayContaining(['msp_assignee', 'values.msp_assignee', 'assignee_name', 'users', 'teams', 'assignee']));
    expect(coManagedAuditFieldAliases('task_name')).toEqual(['task_name', 'values.task_name', 'project_tasks.task_name']);
  });
  it.each(['assignee_name', 'values.assignee_name', 'users', 'teams', 'assignee', 'msp_assignee', 'values.msp_assignee', '*', 'fields', 'fields.assignee_name'])(
    'omits msp_assignee when %s is redacted', redaction => {
      const result = projectCoManagedChanges([redaction], changed);
      expect('msp_assignee' in result).toBe(false);
    });
  it('keeps unrelated changes under assignee redactions and hides them by their own aliases', () => {
    expect(projectCoManagedChanges(['assignee_name'], changed).task_name).toEqual({ from: 'a', to: 'b' });
    const result = projectCoManagedChanges(['task_name'], changed);
    expect('task_name' in result).toBe(false);
    expect(result.msp_assignee).toEqual(assignee);
  });
  it('passes everything through with no redactions and tolerates empty data', () => {
    expect(projectCoManagedChanges([], changed)).toEqual(changed);
    expect(projectCoManagedChanges([], null)).toEqual({});
  });
});

describe('listCoManagedProjectTaskHistory', () => {
  beforeEach(() => {
    state.redactedFields = [];
    state.rows = [{ audit_id: U(7), timestamp: '2026-01-02T03:04:05Z', operation: 'co_managed_project_task_assignment', changed_data: { msp_assignee: assignee },
      details: { actor_display_name: 'Sam', actor_organization_name: 'MSP Co' } }];
  });
  it('with no redactions returns {kind, name} only, with no user ids', async () => {
    const [entry] = await listCoManagedProjectTaskHistory({} as any, actor, resource);
    expect(entry.changes).toEqual({ msp_assignee: { kind: 'user', name: 'Alex MSP' } });
    expect(JSON.stringify(entry)).not.toContain(U(91));
  });
  it.each([['assignee_name'], ['users']])('omits msp_assignee for a reader with %s redacted but keeps the header', async redaction => {
    state.redactedFields = [redaction];
    const [entry] = await listCoManagedProjectTaskHistory({} as any, actor, resource);
    expect(entry).toMatchObject({ auditId: U(7), operation: 'co_managed_project_task_assignment', authorName: 'Sam', organizationName: 'MSP Co', changes: {} });
    expect(JSON.stringify(entry)).not.toContain('Alex MSP');
  });
  it.each([['*'], ['tasks'], ['project_tasks']])('denies the whole history when the task resource is redacted (%s)', async redaction => {
    state.redactedFields = [redaction];
    await expect(listCoManagedProjectTaskHistory({} as any, actor, resource)).rejects.toThrow();
  });
});
