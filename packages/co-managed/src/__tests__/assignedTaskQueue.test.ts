/** listCoManagedAssignedTasks applies the reader's CURRENT redactions to the cached reference snapshots. Mocked: the DB, admission wrapper, identity lock and licence gate. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ references: [] as any[], redactedFields: [] as string[], denied: new Set<string>() }));

vi.mock('@alga-psa/db', () => ({
  withTransaction: async (_db: any, work: any) => work({}),
  tenantDb: () => ({ table: () => {
    const builder: any = { where: () => builder, orderBy: () => builder, limit: () => builder, select: async () => state.references, first: async () => ({ client_name: 'Acme' }) };
    return builder;
  } }),
}));
vi.mock('../projectTaskGate', () => ({ assertCoManagedProjectWorkServed: async () => undefined }));
vi.mock('../sharedWorkIdentity', async () => {
  const actual = await vi.importActual<typeof import('../sharedWorkIdentity')>('../sharedWorkIdentity');
  return { ...actual, snapshotCoManagedSessionActor: (actor: any) => actor, lockCoManagedSessionIdentity: async () => ({ teamIds: [] }) };
});
vi.mock('../sharedWork', async () => {
  const actual = await vi.importActual<typeof import('../sharedWorkIdentity')>('../sharedWorkIdentity');
  return { withCoManagedSharedWork: async (_db: any, _actor: any, resource: any, _action: string, work: any) => {
    if (state.denied.has(resource.id)) throw new actual.CoManagedSharedWorkError();
    return work({ trx: {}, redactedFields: state.redactedFields });
  } };
});

import { listCoManagedAssignedTasks, readCoManagedCustomerOrganizationName } from '../projectTaskQueue';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor: any = { tenant: U(1), userId: U(2) };
const reference = (n: number, assignedTo = U(2)) => ({ reference_id: U(100 + n), customer_tenant: U(3), relationship_id: U(4), task_id: U(200 + n),
  task_name: `Task ${n}`, project_name: 'Rollout', organization_name: 'Acme', assignee_name: 'Alex', assigned_to: assignedTo, revision: n });

beforeEach(() => { state.references = [reference(1), reference(2, U(9))]; state.redactedFields = []; state.denied = new Set(); });

describe('listCoManagedAssignedTasks redaction', () => {
  it('with nothing redacted returns the old shape', async () => {
    const page = await listCoManagedAssignedTasks({} as any, actor);
    expect(page.rows[0]).toEqual({ customerTenant: U(3), relationshipId: U(4), taskId: U(201), taskName: 'Task 1', projectName: 'Rollout', organizationName: 'Acme', assigneeName: 'Alex', assignedToMe: true, revision: 1 });
    expect(page.rows[1].assignedToMe).toBe(false);
  });
  it('a redacted task_name nulls only taskName', async () => {
    state.redactedFields = ['task_name'];
    const [row] = (await listCoManagedAssignedTasks({} as any, actor)).rows;
    expect(row).toMatchObject({ taskName: null, projectName: 'Rollout', organizationName: 'Acme', assigneeName: 'Alex' });
  });
  it('redacted project_name and client_name null both, keep task name and assignedToMe', async () => {
    state.redactedFields = ['project_name', 'client_name'];
    const [row] = (await listCoManagedAssignedTasks({} as any, actor)).rows;
    expect(row).toMatchObject({ taskName: 'Task 1', projectName: null, organizationName: null, assigneeName: 'Alex', assignedToMe: true });
  });
  it('redactions change neither row count nor cursor', async () => {
    const plain = await listCoManagedAssignedTasks({} as any, actor, { limit: 1 });
    state.redactedFields = ['*'];
    const redacted = await listCoManagedAssignedTasks({} as any, actor, { limit: 1 });
    expect(redacted.rows).toHaveLength(plain.rows.length);
    expect(redacted.next).toEqual(plain.next);
    expect(redacted.rows[0]).toMatchObject({ taskName: null, assigneeName: null, taskId: U(201) });
  });
  it('still drops a denied row', async () => {
    state.denied.add(U(201));
    expect((await listCoManagedAssignedTasks({} as any, actor)).rows.map(r => r.taskId)).toEqual([U(202)]);
  });
  // Hand-fed redactedFields; organizationNameRedaction.behaviour.test.ts derives them through the real admission wrapper.
  it.each(['organization_name', 'values.organization_name', 'client_name', 'organizationName', 'tenants'])('a redacted %s hides the organization name on the queue row and the live read', async field => {
    state.redactedFields = [field];
    const [row] = (await listCoManagedAssignedTasks({} as any, actor)).rows;
    expect(row).toMatchObject({ taskName: 'Task 1', projectName: 'Rollout', organizationName: null, assigneeName: 'Alex' });
    expect(await readCoManagedCustomerOrganizationName({} as any, U(3), state.redactedFields)).toBe('');
  });
  it('with nothing redacted the live read returns the real organization name', async () => {
    expect(await readCoManagedCustomerOrganizationName({} as any, U(3), [])).toBe('Acme');
  });
});
