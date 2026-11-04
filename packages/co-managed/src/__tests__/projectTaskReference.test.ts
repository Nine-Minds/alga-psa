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
      assigneeName: 'QA Tester', hasAssigneeName: true, assigneeKind: 'user', assignedToMe: true,
    });
    expect(JSON.stringify(result)).not.toContain(reference.assigned_to);
  });

  it('applies bundled redactions tightened after the cached snapshot was assigned', async () => {
    const initial = (await readCoManagedProjectTaskReferences(context, [taskId])).get(taskId);
    expect(initial?.assigneeName).toBe('QA Tester');

    context.redactedFields = ['assignee', 'fields.projects.project_name', 'organizationName'];
    const tightened = (await readCoManagedProjectTaskReferences(context, [taskId])).get(taskId);
    expect(tightened).toMatchObject({
      taskName: 'Replace core switch', projectName: null, organizationName: null, assigneeName: null,
      hasAssigneeName: null, assigneeKind: null, assignedToMe: null, revision: 4,
    });
    expect(JSON.stringify(tightened)).not.toMatch(/QA Tester|Network refresh|Customer Co/);
  });

  it.each(['assignee_name', 'users', 'teams'])('masks an assignee under alias %s', async redaction => {
    context.redactedFields = [redaction];
    expect((await readCoManagedProjectTaskReferences(context, [taskId])).get(taskId)?.assigneeName).toBeNull();
  });

  it('returns an empty map for no candidate tasks without reading cached references', async () => {
    expect(await readCoManagedProjectTaskReferences(context, [])).toEqual(new Map());
  });

  it('keeps task-detail reference reads bound to the admitted task identity', async () => {
    context.resource = { ...context.resource, kind: 'project_task', id: taskId };
    await expect(readCoManagedProjectTaskReferences(context, ['00000000-0000-4000-8000-000000000099'])).rejects.toThrow();
  });
});
