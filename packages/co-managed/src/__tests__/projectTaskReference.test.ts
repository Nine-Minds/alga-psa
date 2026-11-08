import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ rows: [] as any[] }));

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({ tenantJoin: () => undefined, table: (name: string) => {
    const builder: any = {
      where: () => builder,
      whereIn: () => builder,
      forUpdate: () => builder,
      select: async () => name === 'project_tasks as task' ? [{ task_id: taskId }] : state.rows,
    };
    return builder;
  } }),
}));

import { readCoManagedProjectTaskReferences } from '../projectTaskReference';

const taskId = '00000000-0000-4000-8000-000000000004';
const reference = {
  reference_id: '00000000-0000-4000-8000-000000000006', task_id: taskId, revision: 4,
  task_name: 'Replace core switch', project_name: 'Network refresh', organization_name: 'Customer Co',
  assignee_name: 'QA Tester', assigned_to: '00000000-0000-4000-8000-000000000008', assigned_team_id: null,
};
const context: any = {
  trx: {}, actor: { tenant: '00000000-0000-4000-8000-000000000001', userId: reference.assigned_to },
  resource: { kind: 'project', tenant: '00000000-0000-4000-8000-000000000002', relationshipId: '00000000-0000-4000-8000-000000000003', id: '00000000-0000-4000-8000-000000000005' },
  redactedFields: [],
};

describe('readCoManagedProjectTaskReferences', () => {
  beforeEach(() => { state.rows = [reference]; context.redactedFields = []; });

  it('returns cached display values when the current reader has no matching redactions', async () => {
    const result = (await readCoManagedProjectTaskReferences(context, [taskId])).get(taskId);
    expect(result).toMatchObject({
      revision: 4, taskName: 'Replace core switch', projectName: 'Network refresh', organizationName: 'Customer Co',
      assigneeName: 'QA Tester', hasAssignment: true, assigneeKind: 'user', assignedToMe: true,
    });
    expect(JSON.stringify(result)).not.toContain(reference.assigned_to);
  });

  it('applies current redactions to cached snapshots without rewriting them', async () => {
    const stored = structuredClone(state.rows[0]);
    const initial = (await readCoManagedProjectTaskReferences(context, [taskId])).get(taskId);
    expect(initial?.assigneeName).toBe('QA Tester');

    context.redactedFields = ['assignee', 'fields.projects.project_name', 'values.organizationName'];
    const tightened = (await readCoManagedProjectTaskReferences(context, [taskId])).get(taskId);
    expect(tightened).toMatchObject({
      taskName: 'Replace core switch', projectName: null, organizationName: null, assigneeName: null,
      hasAssignment: true, assigneeKind: 'user', assignedToMe: null, revision: 4,
    });
    expect(JSON.stringify(tightened)).not.toMatch(/QA Tester|Network refresh|Customer Co/);
    expect(state.rows[0]).toEqual(stored);
  });

  it('distinguishes an unassigned reference from a hidden assigned reference', async () => {
    state.rows = [{ ...reference, assigned_to: null, assigned_team_id: null, assignee_name: null }];
    const unassigned = (await readCoManagedProjectTaskReferences(context, [taskId])).get(taskId);
    expect(unassigned).toMatchObject({ hasAssignment: false, assigneeKind: null, assigneeName: null });
    context.redactedFields = ['assignee_name'];
    state.rows = [reference];
    const hidden = (await readCoManagedProjectTaskReferences(context, [taskId])).get(taskId);
    expect(hidden).toMatchObject({ hasAssignment: true, assigneeKind: 'user', assigneeName: null });
  });

  it.each(['assignee_name', 'users', 'teams'])('masks an assignee under alias %s', async redaction => {
    context.redactedFields = [redaction];
    expect((await readCoManagedProjectTaskReferences(context, [taskId])).get(taskId)?.assigneeName).toBeNull();
  });

  it('masks shared task and project organization display under values.organizationName', async () => {
    const visible = (await readCoManagedProjectTaskReferences(context, [taskId])).get(taskId);
    expect(visible?.organizationName).toBe('Customer Co');

    context.redactedFields = ['values.organizationName'];
    const hidden = (await readCoManagedProjectTaskReferences(context, [taskId])).get(taskId);
    expect(hidden?.organizationName).toBeNull();
    expect(state.rows[0].organization_name).toBe('Customer Co');
  });

  it('returns an empty map for no candidate tasks without reading cached references', async () => {
    expect(await readCoManagedProjectTaskReferences(context, [])).toEqual(new Map());
  });

  it('keeps task-detail reference reads bound to the admitted task identity', async () => {
    context.resource = { ...context.resource, kind: 'project_task', id: taskId };
    await expect(readCoManagedProjectTaskReferences(context, ['00000000-0000-4000-8000-000000000099'])).rejects.toThrow();
  });
});
