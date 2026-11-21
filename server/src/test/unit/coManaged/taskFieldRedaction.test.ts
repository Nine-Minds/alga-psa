/** Real task commands/projections over the existing in-memory store. Authorization
 * supplies effective redactions; SQL joins and audit persistence are boundary doubles. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFake } from '../../../../../packages/co-managed/src/__tests__/fakeCoManagedDb';
import type { CoManagedSessionActor } from '@alga-psa/co-managed/sharedWorkIdentity';

const policy = vi.hoisted(() => ({ redactedFields: [] as string[] }));
vi.mock('@alga-psa/db', async () => {
  const { fakeTenantDb } = await import('../../../../../packages/co-managed/src/__tests__/fakeCoManagedDb');
  return { tenantDb: (db: any, tenant: string) => ({ ...fakeTenantDb(db, tenant), tenantJoin: () => undefined }),
    withTransaction: (db: any, work: any) => db.transaction(work) };
});
vi.mock('@alga-psa/co-managed/projectTaskGate', () => ({ assertCoManagedProjectWorkServed: async () => undefined }));
vi.mock('@alga-psa/co-managed/sharedWork', () => ({
  withCoManagedSharedWork: (db: any, actor: any, resource: any, _action: string, work: any) => db.transaction((trx: any) =>
    work({ trx, actor, resource, redactedFields: policy.redactedFields, assertCurrent: async () => undefined })),
}));
vi.mock('@alga-psa/co-managed/sharedWorkAudit', () => ({ recordCoManagedWorkAudit: vi.fn() }));

import { CO_MANAGED_TASK_EDIT_FIELDS, editCoManagedProjectTask, getCoManagedProjectTaskSnapshot,
  listCoManagedProjectTaskStatusOptions, CoManagedTaskEditError, type CoManagedTaskEditField } from '@alga-psa/co-managed/projectTaskEditing';
import { listCoManagedProjectTaskHistory } from '@alga-psa/co-managed/projectTaskAudit';
import { listCoManagedSharedProjectTasks } from '@alga-psa/co-managed/projectTaskQueue';
import { CoManagedSharedWorkError } from '@alga-psa/co-managed/sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from '@alga-psa/co-managed/sharedWorkRedaction';
import { isCoManagedTaskResourceHidden } from '@alga-psa/co-managed/sharedWorkProjection';
import { readCoManagedSummaryCandidates, visibleCoManagedFields } from '@alga-psa/co-managed/sharedWorkRead';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor: CoManagedSessionActor = { kind: 'session', tenant: U(1), userId: U(2), sessionId: U(3) };
const resource = { kind: 'project_task' as const, tenant: U(4), id: U(5), relationshipId: U(6) };
const initial = { task_name: 'Private task', due_date: '2026-12-01T00:00:00.000Z', project_status_mapping_id: U(7) };
const changed = { task_name: 'Edited task', due_date: '2026-12-02T00:00:00.000Z', project_status_mapping_id: U(8) };
const updatedAt = '2026-11-01T00:00:00.000Z';
let fixture: ReturnType<typeof createFake>;
const request = (field: CoManagedTaskEditField) => ({ expectedRevision: 1, expectedTaskUpdatedAt: updatedAt, patch: { [field]: changed[field] } });
const writer = vi.fn(async (_trx: any, _tenant: string, _taskId: string, patch: object) => {
  Object.assign(fixture.store.rows('project_tasks')[0], patch);
});
beforeEach(() => {
  policy.redactedFields = [];
  writer.mockClear();
  fixture = createFake();
  fixture.store.seed('project_tasks', { tenant: resource.tenant, task_id: resource.id, ...initial, updated_at: updatedAt, phase_id: U(9), project_id: U(10) });
  fixture.store.seed('co_managed_project_task_references', { tenant: actor.tenant, customer_tenant: resource.tenant,
    relationship_id: resource.relationshipId, task_id: resource.id, reference_id: U(11), revision: 1, active: true });
  fixture.store.seed('project_status_mappings', ...[U(7), U(8)].map(id => ({ tenant: resource.tenant, project_id: U(10), project_status_mapping_id: id, name: 'Open' })));
  fixture.store.seed('tenants', { tenant: resource.tenant, client_name: 'Customer' });
  fixture.store.seed('audit_logs', { tenant: resource.tenant, table_name: 'project_tasks', record_id: resource.id,
    operation: 'co_managed_project_task_update', audit_id: U(12), timestamp: updatedAt,
    changed_data: Object.fromEntries(CO_MANAGED_TASK_EDIT_FIELDS.map(field => [field, { from: initial[field], to: changed[field] }])) });
});

const cases = CO_MANAGED_TASK_EDIT_FIELDS.flatMap(field => [field, `values.${field}`, `tasks.${field}`, `project_tasks.${field}`,
  `tasks.*.${field}`, `fields.tasks.*.${field}`, `fields.tasks.${field}`, `fields.project_tasks.${field}`, `*.${field}`, `fields.*.${field}`].map(redaction => ({ field, redaction })));

describe('task field policy across reads and writes', () => {
  it.each(cases)('$redaction hides $field and rejects its edit without mutation', async ({ field, redaction }) => {
    policy.redactedFields = [redaction];
    const before = structuredClone(fixture.store.tables);
    const snapshot = await getCoManagedProjectTaskSnapshot(fixture.db, actor, resource);
    expect(snapshot.values).not.toHaveProperty(field);
    for (const other of CO_MANAGED_TASK_EDIT_FIELDS.filter(f => f !== field)) expect(snapshot.values[other]).toBe(initial[other]);
    const [history] = await listCoManagedProjectTaskHistory(fixture.db, actor, resource);
    expect(history.changes).not.toHaveProperty(field);
    expect(Object.keys(history.changes)).toHaveLength(2);
    await expect(editCoManagedProjectTask(fixture.db, actor, resource, request(field), writer)).rejects.toBeInstanceOf(CoManagedSharedWorkError);
    expect(writer).not.toHaveBeenCalled();
    expect(fixture.store.tables).toEqual(before);
    if (field === 'project_status_mapping_id') expect(await listCoManagedProjectTaskStatusOptions(fixture.db, actor, resource)).toEqual([]);
  });

  it.each(['status', 'selectedStatus', 'status_id', 'status_name', 'custom_name', 'standard_status_id',
    'project_status_mappings.custom_name', 'statuses.name', 'standard_statuses.name', 'fields.statuses.*'])('protects derived status source %s', async redaction => {
    policy.redactedFields = [redaction];
    expect((await getCoManagedProjectTaskSnapshot(fixture.db, actor, resource)).values).toEqual({ task_name: initial.task_name, due_date: initial.due_date });
    expect((await listCoManagedProjectTaskHistory(fixture.db, actor, resource))[0].changes).not.toHaveProperty('project_status_mapping_id');
    expect(await listCoManagedProjectTaskStatusOptions(fixture.db, actor, resource)).toEqual([]);
    await expect(editCoManagedProjectTask(fixture.db, actor, resource, request('project_status_mapping_id'), writer)).rejects.toBeInstanceOf(CoManagedSharedWorkError);
    expect(writer).not.toHaveBeenCalled();
  });

  it.each(['tasks.*', 'project_tasks.*', 'fields.tasks.*', 'values.*', '*.*'])('hides all editable fields under %s without hiding the resource', async redaction => {
    policy.redactedFields = [redaction];
    expect(isCoManagedTaskResourceHidden([redaction])).toBe(false);
    expect((await getCoManagedProjectTaskSnapshot(fixture.db, actor, resource)).values).toEqual({});
    expect((await listCoManagedProjectTaskHistory(fixture.db, actor, resource))[0].changes).toEqual({});
    for (const field of CO_MANAGED_TASK_EDIT_FIELDS) {
      await expect(editCoManagedProjectTask(fixture.db, actor, resource, request(field), writer)).rejects.toBeInstanceOf(CoManagedSharedWorkError);
    }
    expect(writer).not.toHaveBeenCalled();
  });

  it.each(CO_MANAGED_TASK_EDIT_FIELDS)('still permits visible %s edits when an unrelated field is hidden', async field => {
    policy.redactedFields = ['tasks.description'];
    const result = await editCoManagedProjectTask(fixture.db, actor, resource, request(field), writer);
    expect(result.revision).toBe(2);
    expect(writer).toHaveBeenCalledOnce();
    expect(fixture.store.rows('project_tasks')[0][field]).toBe(changed[field]);
    expect(fixture.store.rows('co_managed_project_task_references')[0].revision).toBe(2);
  });

  it('masks a conflict snapshot with the current policy', async () => {
    policy.redactedFields = ['tasks.due_date'];
    const error = await editCoManagedProjectTask(fixture.db, actor, resource, { ...request('task_name'), expectedRevision: 2 }, writer).catch(e => e);
    expect(error).toBeInstanceOf(CoManagedTaskEditError);
    expect(error.snapshot.values).toEqual({ task_name: initial.task_name, project_status_mapping_id: initial.project_status_mapping_id });
    expect(writer).not.toHaveBeenCalled();
  });

  it('rejects a mixed visible/hidden patch atomically', async () => {
    policy.redactedFields = ['tasks.due_date'];
    const before = structuredClone(fixture.store.tables);
    await expect(editCoManagedProjectTask(fixture.db, actor, resource, { ...request('task_name'), patch: changed }, writer)).rejects.toBeInstanceOf(CoManagedSharedWorkError);
    expect(writer).not.toHaveBeenCalled();
    expect(fixture.store.tables).toEqual(before);
  });

  it.each(['tasks', 'project_tasks', 'fields.tasks', '*', 'fields'])('refuses the whole task under %s', async redaction => {
    policy.redactedFields = [redaction];
    await expect(getCoManagedProjectTaskSnapshot(fixture.db, actor, resource)).rejects.toBeInstanceOf(CoManagedSharedWorkError);
    await expect(editCoManagedProjectTask(fixture.db, actor, resource, request('task_name'), writer)).rejects.toBeInstanceOf(CoManagedSharedWorkError);
    expect(writer).not.toHaveBeenCalled();
  });

  it.each(CO_MANAGED_TASK_EDIT_FIELDS)('uses the same sources in the task summary for %s', async field => {
    Object.assign(fixture.store.rows('project_tasks')[0], { status_name: 'Open', is_closed: false });
    const candidates = await readCoManagedSummaryCandidates(fixture.db, resource);
    const fields = visibleCoManagedFields(candidates, [`tasks.${field}`]);
    const visibleKey = field === 'project_status_mapping_id' ? 'status' : field;
    expect(visibleCoManagedFields(candidates, [])).toHaveProperty(visibleKey);
    expect(fields).not.toHaveProperty(visibleKey);
    if (field === 'project_status_mapping_id') expect(fields).not.toHaveProperty('is_closed');
  });

  it.each(['tasks.due_date', 'fields.tasks.due_date', '*.due_date', 'tasks.*.due_date'])('nulls queue due dates under %s but retains the task', async redaction => {
    policy.redactedFields = [redaction];
    const page = await listCoManagedSharedProjectTasks(fixture.db, actor, { customerTenant: resource.tenant, relationshipId: resource.relationshipId, projectId: U(10) });
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]).toMatchObject({ taskName: initial.task_name, dueDate: null });
  });

  it('keeps unrelated queue fields and status options visible', async () => {
    policy.redactedFields = ['tasks.description'];
    const page = await listCoManagedSharedProjectTasks(fixture.db, actor, { customerTenant: resource.tenant, relationshipId: resource.relationshipId, projectId: U(10) });
    expect(page.rows[0]).toMatchObject({ taskName: initial.task_name, dueDate: initial.due_date });
    expect(await listCoManagedProjectTaskStatusOptions(fixture.db, actor, resource)).toHaveLength(2);
  });
});

describe('segment-wise redaction matching', () => {
  it.each(['tasks.due_date', 'tasks.*', '*.due_date', 'fields.tasks.*', 'fields.*.due_date', 'tasks', 'tasks.due_date.value'])(
    '%s overlaps the due-date source', redaction => expect(isCoManagedReadFieldHidden([redaction], ['tasks.due_date'])).toBe(true));
  it('matches indexed collection paths without matching sibling fields', () => {
    expect(isCoManagedReadFieldHidden(['tasks.*.due_date'], ['tasks.0.due_date'])).toBe(true);
    expect(isCoManagedReadFieldHidden(['tasks.*.due_date'], ['tasks.0.task_name'])).toBe(false);
    expect(isCoManagedReadFieldHidden(['*.due_date'], ['task_name'])).toBe(false);
  });
  it.each(['task.*', 'tasks.due*', 'tasks.description', 'other.tasks.due_date'])(
    '%s does not overlap the due-date source', redaction => expect(isCoManagedReadFieldHidden([redaction], ['tasks.due_date'])).toBe(false));
});
