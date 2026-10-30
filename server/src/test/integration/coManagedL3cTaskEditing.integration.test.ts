/**
 * CM L3c: task edit admission (two-sided guard, scope) and MSP assignment separation.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { configureL3cDbEnv, connectL3cDb, seedL3cWorld, seedL3cProject, shareProject, cleanupL3cTenants,
  sessionActor, type L3cWorld, type L3cProject } from './helpers/coManagedL3cFixture';

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({ getAppSecret: async () => undefined, getTenantSecret: async () => undefined }),
  getSecret: async (_n: string, e?: string, f = '') => (e ? process.env[e] : undefined) ?? f,
}));

import { editCoManagedProjectTask, getCoManagedProjectTaskSnapshot, CoManagedTaskEditError } from '@alga-psa/co-managed/projectTaskEditing';
import { assignCoManagedProjectTask } from '@alga-psa/co-managed/projectTaskAssignments';
import { listCoManagedAssignedTasks } from '@alga-psa/co-managed/projectTaskQueue';
import { isCoManagedSharedWorkError } from '@alga-psa/co-managed/sharedWorkIdentity';
import { writeCoManagedSharedTask } from '../../lib/co-managed/editProjectTask';

let db: Knex;
let world: L3cWorld;
let collab: L3cProject, readOnly: L3cProject, unshared: L3cProject;

const actor = () => sessionActor(world.sponsor, world.technician);
const viewerActor = () => sessionActor(world.sponsor, world.viewer);
const resource = (id: string) => ({ kind: 'project_task' as const, tenant: world.customer, relationshipId: world.relationshipId, id });
const self = () => ({ kind: 'user' as const, id: world.technician.userId });
const taskRow = (id: string) => db('project_tasks').where({ tenant: world.customer, task_id: id }).first();
const referenceRow = (id: string) => db('co_managed_project_task_references')
  .where({ tenant: world.sponsor, customer_tenant: world.customer, relationship_id: world.relationshipId, task_id: id }).first();
/** Creates the MSP participation reference (revision 1) and loads the snapshot an editor would hold. */
async function openTask(id: string) {
  await assignCoManagedProjectTask(db, actor(), resource(id), { assignee: self(), expectedRevision: null });
  return getCoManagedProjectTaskSnapshot(db, actor(), resource(id));
}
/** The queue row's Organization must be the CUSTOMER's name, never the assignee's own MSP organization. */
async function expectQueueShowsCustomerOrganization(id: string) {
  const customerName = (await db('tenants').where({ tenant: world.customer }).first('client_name')).client_name;
  const sponsorName = (await db('tenants').where({ tenant: world.sponsor }).first('client_name')).client_name;
  expect(customerName).toBeTruthy();
  expect(customerName).not.toBe(sponsorName);
  const row = (await listCoManagedAssignedTasks(db, actor(), { assigned: 'any', limit: 100 })).rows.find(r => r.taskId === id);
  expect(row?.organizationName).toBe(customerName);
  expect(row?.organizationName).not.toBe(sponsorName);
}
const conflictOf = async (promise: Promise<unknown>) => {
  const error = await promise.then(() => null, e => e);
  expect(error).toBeInstanceOf(CoManagedTaskEditError);
  expect(error.code).toBe('TASK_EDIT_CONFLICT');
  return error as CoManagedTaskEditError;
};

describe('CM L3c task editing and assignment', () => {
  beforeAll(async () => {
    configureL3cDbEnv();
    db = await connectL3cDb();
    world = await seedL3cWorld(db);
    collab = await seedL3cProject(db, world, 'Collab project', ['ok', 'stale', 'drift', 'viewer-edit', 'assign-sep']);
    readOnly = await seedL3cProject(db, world, 'Read-only project', ['ro']);
    unshared = await seedL3cProject(db, world, 'Unshared project', ['hidden']);
    await shareProject(db, world, collab.projectId, true);
    await shareProject(db, world, readOnly.projectId, false);
  }, 180_000);

  afterAll(async () => {
    await cleanupL3cTenants(world?.tenants ?? []);
    await db?.destroy().catch(() => undefined);
  });

  it('applies an in-scope edit to the customer task and bumps the reference revision', async () => {
    const id = collab.taskIds[0];
    const snapshot = await openTask(id);
    expect(snapshot.revision).toBe(1);
    await expectQueueShowsCustomerOrganization(id);
    // A stale snapshot is repaired by the next edit.
    await db('co_managed_project_task_references').where({ tenant: world.sponsor, task_id: id }).update({ organization_name: 'stale' });

    const receipt = await editCoManagedProjectTask(db, actor(), resource(id),
      { expectedRevision: snapshot.revision, expectedTaskUpdatedAt: snapshot.taskUpdatedAt, patch: { task_name: 'Renamed by MSP' } }, writeCoManagedSharedTask);
    await expectQueueShowsCustomerOrganization(id);

    expect(receipt.revision).toBe(2);
    expect((await taskRow(id)).task_name).toBe('Renamed by MSP');
    expect(new Date((await taskRow(id)).updated_at).toISOString()).toBe(receipt.taskUpdatedAt);
    expect(receipt.taskUpdatedAt).not.toBe(snapshot.taskUpdatedAt);
    expect(await referenceRow(id)).toMatchObject({ revision: 2, task_name: 'Renamed by MSP', active: true });

    // The editor's old tokens are now stale on both sides.
    const again = await conflictOf(editCoManagedProjectTask(db, actor(), resource(id),
      { expectedRevision: 1, expectedTaskUpdatedAt: snapshot.taskUpdatedAt, patch: { task_name: 'Second write' } }, writeCoManagedSharedTask));
    expect(again.reason).toBe('revision');
    expect((await taskRow(id)).task_name).toBe('Renamed by MSP');
  });

  it('rejects a stale expected revision and leaves the customer task untouched', async () => {
    const id = collab.taskIds[1];
    const snapshot = await openTask(id);
    const before = await taskRow(id);

    const error = await conflictOf(editCoManagedProjectTask(db, actor(), resource(id),
      { expectedRevision: snapshot.revision + 4, expectedTaskUpdatedAt: snapshot.taskUpdatedAt, patch: { task_name: 'Never written' } }, writeCoManagedSharedTask));

    expect(error.reason).toBe('revision');
    expect(error.snapshot?.revision).toBe(snapshot.revision);
    expect(await taskRow(id)).toEqual(before);
    expect((await referenceRow(id)).revision).toBe(snapshot.revision);
  });

  it('rejects customer-side drift after the snapshot and writes nothing', async () => {
    const id = collab.taskIds[2];
    const snapshot = await openTask(id);
    // The customer edits its own task after the MSP loaded it.
    await db('project_tasks').where({ tenant: world.customer, task_id: id })
      .update({ task_name: 'Customer rename', updated_at: new Date('2026-02-02T00:00:00.000Z') });
    const before = await taskRow(id);

    const error = await conflictOf(editCoManagedProjectTask(db, actor(), resource(id),
      { expectedRevision: snapshot.revision, expectedTaskUpdatedAt: snapshot.taskUpdatedAt, patch: { task_name: 'MSP overwrite' } }, writeCoManagedSharedTask));

    expect(error.reason).toBe('customer_drift');
    expect(error.snapshot?.taskUpdatedAt).toBe('2026-02-02T00:00:00.000Z');
    expect(await taskRow(id)).toEqual(before);
    expect(before.task_name).toBe('Customer rename');
    expect((await referenceRow(id)).revision).toBe(snapshot.revision);

    // Reloading the fresh tokens lets the edit through.
    const fresh = await getCoManagedProjectTaskSnapshot(db, actor(), resource(id));
    const receipt = await editCoManagedProjectTask(db, actor(), resource(id),
      { expectedRevision: fresh.revision, expectedTaskUpdatedAt: fresh.taskUpdatedAt, patch: { task_name: 'MSP after reload' } }, writeCoManagedSharedTask);
    expect(receipt.revision).toBe(snapshot.revision + 1);
  });

  it('denies edits out of scope with the opaque shared-work error', async () => {
    const patch = { expectedRevision: 1, expectedTaskUpdatedAt: new Date().toISOString(), patch: { task_name: 'Nope' } };
    const writes: string[] = [];
    const writer = async () => { writes.push('write'); };

    // Unshared project.
    await expect(editCoManagedProjectTask(db, actor(), resource(unshared.taskIds[0]), patch, writer)).rejects.toSatisfy(isCoManagedSharedWorkError);
    // Shared with can_collaborate = false.
    await expect(editCoManagedProjectTask(db, actor(), resource(readOnly.taskIds[0]), patch, writer)).rejects.toSatisfy(isCoManagedSharedWorkError);
    // Staff `viewer` assignment on a collaborate project, even with a reference in place.
    await openTask(collab.taskIds[3]);
    await expect(editCoManagedProjectTask(db, viewerActor(), resource(collab.taskIds[3]), patch, writer)).rejects.toSatisfy(isCoManagedSharedWorkError);
    // The viewer may read, never assign.
    await expect(assignCoManagedProjectTask(db, viewerActor(), resource(collab.taskIds[3]), { assignee: self(), expectedRevision: 1 }))
      .rejects.toSatisfy(isCoManagedSharedWorkError);

    expect(writes).toEqual([]);
    expect((await taskRow(unshared.taskIds[0])).task_name).toBe('hidden');
    expect((await taskRow(readOnly.taskIds[0])).task_name).toBe('ro');
    expect((await taskRow(collab.taskIds[3])).task_name).toBe('viewer-edit');
    expect(await referenceRow(unshared.taskIds[0])).toBeUndefined();
  });

  it('assigns MSP staff on the reference only; the customer task and its resources stay byte-identical', async () => {
    const id = collab.taskIds[4];
    const customerUser = world.customerStaff.userId;
    await db('project_tasks').where({ tenant: world.customer, task_id: id }).update({ assigned_to: customerUser });
    await db('task_resources').insert({ tenant: world.customer, assignment_id: uuidv4(), task_id: id, assigned_to: customerUser, role: 'support' });
    const snapshotTables = async () => JSON.stringify({
      task: await taskRow(id),
      resources: await db('task_resources').where({ tenant: world.customer, task_id: id }).orderBy('assignment_id'),
      customerTaskCount: (await db('project_tasks').where({ tenant: world.customer }).count({ n: '*' }).first())?.n,
    });
    const before = await snapshotTables();

    const created = await assignCoManagedProjectTask(db, actor(), resource(id), { assignee: self(), expectedRevision: null });
    expect(created.revision).toBe(1);
    expect(await snapshotTables()).toBe(before);
    expect(await referenceRow(id)).toMatchObject({ assigned_to: world.technician.userId, assigned_team_id: null, revision: 1, active: true, client_id: world.sponsorClientId });

    // Re-assigning (revision 1 -> 2) still never touches the customer's rows.
    const again = await assignCoManagedProjectTask(db, actor(), resource(id), { assignee: self(), expectedRevision: 1 });
    expect(again.revision).toBe(2);
    expect(await snapshotTables()).toBe(before);
    expect((await taskRow(id)).assigned_to).toBe(customerUser);

    // Stale revision on re-assign is a conflict, not a silent overwrite.
    const error = await conflictOf(assignCoManagedProjectTask(db, actor(), resource(id), { assignee: self(), expectedRevision: 1 }));
    expect(error.reason).toBe('revision');
    expect((await referenceRow(id)).revision).toBe(2);
  });
});
