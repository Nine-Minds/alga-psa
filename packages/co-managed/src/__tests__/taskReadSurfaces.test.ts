import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ redactedFields: [] as string[] }));
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const task = { task_id: U(4), task_name: 'Replace core switch', due_date: null, updated_at: '2026-11-03T12:00:00Z' };
const reference = { reference_id: U(6), task_id: task.task_id, customer_tenant: U(5), relationship_id: U(7), revision: 4,
  task_name: task.task_name, project_name: 'Network refresh', organization_name: 'Customer Co',
  assignee_name: 'QA Tester', assigned_to: U(2), assigned_team_id: null };
const actor: any = { tenant: U(1), userId: U(2), sessionId: U(3), kind: 'session' };
const resource: any = { kind: 'project_task', tenant: U(5), relationshipId: U(7), id: task.task_id };

vi.mock('@alga-psa/db', () => ({
  withTransaction: async (_db: any, work: any) => work({}),
  tenantDb: () => ({ tenantJoin: () => undefined, table: (name: string) => {
    const builder: any = { where: () => builder, whereIn: () => builder, orderBy: () => builder, limit: () => builder,
      select: async () => name === 'co_managed_project_task_references' ? [reference] : name === 'team_members' ? [] : [task],
      first: async () => name === 'tenants' ? { client_name: reference.organization_name } : task };
    return builder;
  } }),
}));
vi.mock('../projectTaskGate', () => ({ assertCoManagedProjectWorkServed: async () => undefined }));
vi.mock('../sharedWorkIdentity', async () => ({
  ...await vi.importActual<typeof import('../sharedWorkIdentity')>('../sharedWorkIdentity'),
  lockCoManagedSessionIdentity: async () => ({ teamIds: [] }),
}));
vi.mock('../sharedWork', () => ({ withCoManagedSharedWork: async (_db: any, actor: any, resource: any, _action: string, read: any) =>
  read({ trx: {}, actor, resource, redactedFields: state.redactedFields }) }));

import { getCoManagedProjectTaskSnapshot } from '../projectTaskEditing';
import { listCoManagedAssignedTasks, listCoManagedSharedProjectTasks, readCoManagedCustomerOrganizationName } from '../projectTaskQueue';
import { readCoManagedProjectTaskReferences } from '../projectTaskReference';

beforeEach(() => { state.redactedFields = []; });

describe.each(['project_tasks', 'co_managed_project_task_references'])('qualified task policy: %s', namespace => {
  it('masks detail, project task list and assignment metadata after policy tightening', async () => {
    expect((await getCoManagedProjectTaskSnapshot({} as any, actor, resource)).assignee?.name).toBe('QA Tester');
    state.redactedFields = [`${namespace}.assignee_name`];
    const hidden = await getCoManagedProjectTaskSnapshot({} as any, actor, resource);
    expect(hidden.assignee).not.toBeNull();
    expect(hidden.assignee).toMatchObject({ kind: 'user', name: null });
    const list = await listCoManagedSharedProjectTasks({} as any, actor, {
      customerTenant: resource.tenant, relationshipId: resource.relationshipId, projectId: U(8),
    });
    expect(list.rows[0].reference).toMatchObject({ isAssigned: true, assigneeName: null, assignedToMe: null });
    const context: any = { trx: {}, actor, resource, redactedFields: state.redactedFields };
    expect((await readCoManagedProjectTaskReferences(context, [task.task_id])).get(task.task_id)).toMatchObject({
      assigneeName: null, hasAssignment: true, assigneeKind: 'user', assignedToMe: null,
    });
    expect(reference.assignee_name).toBe('QA Tester');
  });
  it('masks qualified organization snapshots independently of the assignee', async () => {
    state.redactedFields = [`${namespace}.organization_name`];
    const context: any = { trx: {}, actor, resource, redactedFields: state.redactedFields };
    const projected = (await readCoManagedProjectTaskReferences(context, [task.task_id])).get(task.task_id);
    expect(projected).toMatchObject({ organizationName: null, assigneeName: 'QA Tester', assignedToMe: true });
    expect(await readCoManagedCustomerOrganizationName({} as any, resource.tenant, state.redactedFields)).toBe('');
  });
  it('masks qualified assignee and organization fields in the assigned queue and live organization fallback', async () => {
    state.redactedFields = [`${namespace}.assignee_name`, `${namespace}.organization_name`];
    const page = await listCoManagedAssignedTasks({} as any, actor);
    expect(page.rows[0]).toMatchObject({ isAssigned: true, assigneeName: null, organizationName: null, assignedToMe: null, taskName: task.task_name });
    expect(await readCoManagedCustomerOrganizationName({} as any, resource.tenant, state.redactedFields)).toBe('');
    expect(reference.organization_name).toBe('Customer Co');
  });
});

it.each(['taskName', 'values.taskName', 'co_managed_project_task_references.task_name'])('omits editor values and project-list task names under %s', async alias => {
  state.redactedFields = [alias];
  expect((await getCoManagedProjectTaskSnapshot({} as any, actor, resource)).values).not.toHaveProperty('task_name');
  const list = await listCoManagedSharedProjectTasks({} as any, actor, {
    customerTenant: resource.tenant, relationshipId: resource.relationshipId, projectId: U(8),
  });
  expect(list.rows).toEqual([]);
});
