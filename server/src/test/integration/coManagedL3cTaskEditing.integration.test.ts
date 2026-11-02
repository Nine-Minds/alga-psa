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
import { listCoManagedProjectTaskHistory } from '@alga-psa/co-managed/projectTaskAudit';
import { listCoManagedProjectTaskStatusOptions } from '@alga-psa/co-managed/projectTaskEditing';
import { assignCoManagedProjectTask } from '@alga-psa/co-managed/projectTaskAssignments';
import { listCoManagedAssignedTasks } from '@alga-psa/co-managed/projectTaskQueue';
import { isCoManagedSharedWorkError } from '@alga-psa/co-managed/sharedWorkIdentity';
import { writeCoManagedSharedTask } from '../../lib/co-managed/editProjectTask';

let db: Knex;
let world: L3cWorld;
let collab: L3cProject, readOnly: L3cProject, unshared: L3cProject;
/** A second, fully valid sponsor/customer pair: its staff are authorized there and nowhere else. */
let otherWorld: L3cWorld;

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
    collab = await seedL3cProject(db, world, 'Collab project', ['ok', 'stale', 'drift', 'viewer-edit', 'assign-sep', 'redact-tasks', 'redact-project-tasks', 'redact-assignee', 'control', 'redact-field-name', 'redact-field-desc', 'redact-assignee-conflict']);
    readOnly = await seedL3cProject(db, world, 'Read-only project', ['ro']);
    unshared = await seedL3cProject(db, world, 'Unshared project', ['hidden']);
    await shareProject(db, world, collab.projectId, true);
    await shareProject(db, world, readOnly.projectId, false);
    otherWorld = await seedL3cWorld(db);
  }, 180_000);

  afterAll(async () => {
    await cleanupL3cTenants([...(world?.tenants ?? []), ...(otherWorld?.tenants ?? [])]);
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

  // The relationship's redacted_fields join the home policy in the effective policy admission computes.
  const setRedactions = (fields: string[]) =>
    db('co_management_relationships').where({ tenant: world.customer, relationship_id: world.relationshipId }).update({ redacted_fields: fields });

  describe.each([['tasks', 5], ['project_tasks', 6]] as const)('whole-task redaction (%s)', (resourceAlias, index) => {
    it('denies snapshot, history, status options and edit before any read, writes nothing, and keeps the queue row', async () => {
      const id = collab.taskIds[index];
      const snapshot = await openTask(id);
      const taskBefore = await taskRow(id), referenceBefore = await referenceRow(id);
      await setRedactions([resourceAlias]);
      try {
        const writes: string[] = [];
        await expect(getCoManagedProjectTaskSnapshot(db, actor(), resource(id))).rejects.toSatisfy(isCoManagedSharedWorkError);
        await expect(listCoManagedProjectTaskHistory(db, actor(), resource(id))).rejects.toSatisfy(isCoManagedSharedWorkError);
        await expect(listCoManagedProjectTaskStatusOptions(db, actor(), resource(id))).rejects.toSatisfy(isCoManagedSharedWorkError);
        await expect(editCoManagedProjectTask(db, actor(), resource(id),
          { expectedRevision: snapshot.revision, expectedTaskUpdatedAt: snapshot.taskUpdatedAt, patch: { task_name: 'Overwritten', due_date: null } },
          async () => { writes.push('write'); })).rejects.toSatisfy(isCoManagedSharedWorkError);
        expect(writes).toEqual([]);

        const taskAfter = await taskRow(id);
        for (const column of ['task_name', 'due_date', 'project_status_mapping_id', 'updated_at']) expect(taskAfter[column]).toEqual(taskBefore[column]);
        expect((await referenceRow(id)).revision).toBe(referenceBefore.revision);

        // Deliberate asymmetry: the assignment is still shown, only the name is nulled.
        const row = (await listCoManagedAssignedTasks(db, actor(), { assigned: 'any', limit: 100 })).rows.find(r => r.taskId === id);
        expect(row).toBeDefined();
        expect(row?.taskName).toBeNull();
      } finally { await setRedactions([]); }
    });
  });

  it('serves the snapshot only to an admitted co-managed technician; staff without an assignment and other tenants are refused', async () => {
    const own = await seedL3cProject(db, world, 'Snapshot authz project', ['snapshot-authz']);
    await shareProject(db, world, own.projectId, true);
    const id = own.taskIds[0];
    // (a) Admitted: sponsor technician with a co-managed staff assignment on this relationship.
    const served = await openTask(id);
    expect(served.values.task_name).toBe('snapshot-authz');
    expect(served.assignee?.name).toBeTruthy();

    // (b) Same sponsor tenant, same home RBAC, but no co-managed staff assignment: refused.
    const assignment = { tenant: world.sponsor, customer_tenant: world.customer, relationship_id: world.relationshipId, principal_type: 'user', principal_id: world.technician.userId };
    const saved = await db('co_management_staff_assignments').where(assignment);
    expect(saved).toHaveLength(1);
    await db('co_management_staff_assignments').where(assignment).delete();
    try {
      await expect(getCoManagedProjectTaskSnapshot(db, actor(), resource(id))).rejects.toSatisfy(isCoManagedSharedWorkError);
    } finally { await db('co_management_staff_assignments').insert(saved); }
    expect((await getCoManagedProjectTaskSnapshot(db, actor(), resource(id))).values.task_name).toBe('snapshot-authz');

    // (c) Other tenants: a technician fully admitted in another sponsor's relationship, addressing this task
    // through this relationship or through its own; and the customer's own workspace user.
    const foreign = sessionActor(otherWorld.sponsor, otherWorld.technician);
    await expect(getCoManagedProjectTaskSnapshot(db, foreign, resource(id))).rejects.toSatisfy(isCoManagedSharedWorkError);
    await expect(getCoManagedProjectTaskSnapshot(db, foreign, { ...resource(id), relationshipId: otherWorld.relationshipId })).rejects.toSatisfy(isCoManagedSharedWorkError);
    await expect(getCoManagedProjectTaskSnapshot(db, sessionActor(world.customer, world.customerStaff), resource(id))).rejects.toSatisfy(isCoManagedSharedWorkError);
  });

  it('masks the snapshot assignee name when assignee is redacted', async () => {
    const id = collab.taskIds[7];
    const snapshot = await openTask(id);
    expect(snapshot.assignee?.name).toBeTruthy();
    await setRedactions(['assignee']);
    try {
      const hidden = await getCoManagedProjectTaskSnapshot(db, actor(), resource(id));
      expect(hidden.assignee?.name ?? null).toBeNull();
    } finally { await setRedactions([]); }
  });

  it('masks the assignee name in revision and customer-drift conflict snapshots when assignee is redacted', async () => {
    const id = collab.taskIds[11];
    const snapshot = await openTask(id);
    expect(snapshot.assignee?.name).toBeTruthy();
    const taskBefore = await taskRow(id);
    await setRedactions(['assignee']);
    try {
      const stale = await conflictOf(editCoManagedProjectTask(db, actor(), resource(id),
        { expectedRevision: snapshot.revision + 1, expectedTaskUpdatedAt: snapshot.taskUpdatedAt, patch: { task_name: 'Never written' } }, writeCoManagedSharedTask));
      expect(stale.reason).toBe('revision');
      expect(stale.snapshot?.revision).toBe(snapshot.revision);
      expect(stale.snapshot?.taskUpdatedAt).toBe(snapshot.taskUpdatedAt);
      expect(stale.snapshot?.assignee?.name ?? null).toBeNull();
      expect(stale.snapshot?.assignee?.kind).toBe('user');

      const drift = await conflictOf(editCoManagedProjectTask(db, actor(), resource(id),
        { expectedRevision: snapshot.revision, expectedTaskUpdatedAt: new Date(Date.parse(snapshot.taskUpdatedAt) + 1).toISOString(), patch: { task_name: 'Never written' } }, writeCoManagedSharedTask));
      expect(drift.reason).toBe('customer_drift');
      expect(drift.snapshot?.revision).toBe(snapshot.revision);
      expect(drift.snapshot?.taskUpdatedAt).toBe(snapshot.taskUpdatedAt);
      expect(drift.snapshot?.assignee?.name ?? null).toBeNull();
      expect(drift.snapshot?.assignee?.kind).toBe('user');

      const taskAfter = await taskRow(id);
      for (const column of ['task_name', 'due_date', 'project_status_mapping_id', 'updated_at']) expect(taskAfter[column]).toEqual(taskBefore[column]);
      expect((await referenceRow(id)).revision).toBe(snapshot.revision);
    } finally { await setRedactions([]); }
  });

  it('control: with no redactions snapshot, history and status options are served with the exact fixture values', async () => {
    // Own project: the suite runs shuffled, and other tests add project-level mappings to the collab project,
    // which would leak into this exact status-option list.
    const own = await seedL3cProject(db, world, 'Control project', ['control']);
    await shareProject(db, world, own.projectId, true);
    const id = own.taskIds[0];
    // The shared fixture seeds no status mappings, so give the project two (project-level) and put the task on the first.
    const [todo, doing] = [uuidv4(), uuidv4()];
    await db('project_status_mappings').insert([
      { tenant: world.customer, project_status_mapping_id: todo, project_id: own.projectId, status_id: world.statusId, custom_name: 'Control Todo', is_standard: false, display_order: 1, is_visible: true },
      { tenant: world.customer, project_status_mapping_id: doing, project_id: own.projectId, status_id: world.statusId, custom_name: 'Control Doing', is_standard: false, display_order: 2, is_visible: true },
    ]);
    await db('project_tasks').where({ tenant: world.customer, task_id: id }).update({ project_status_mapping_id: todo, due_date: new Date('2026-03-01T00:00:00.000Z') });
    await setRedactions([]);
    const snapshot = await openTask(id);
    const { name: assigneeName } = snapshot.assignee!;
    expect(assigneeName).toBeTruthy();
    expect(snapshot).toEqual({ revision: 1, taskUpdatedAt: new Date((await taskRow(id)).updated_at).toISOString(),
      values: { task_name: 'control', project_status_mapping_id: todo, due_date: '2026-03-01T00:00:00.000Z' }, assignee: { kind: 'user', name: assigneeName } });
    expect(await listCoManagedProjectTaskStatusOptions(db, actor(), resource(id))).toEqual([
      { statusMappingId: todo, name: 'Control Todo' }, { statusMappingId: doing, name: 'Control Doing' }]);
    // openTask's assignment is the only history entry so far.
    const before = await listCoManagedProjectTaskHistory(db, actor(), resource(id));
    expect(before).toEqual([{ auditId: expect.any(String), at: expect.any(String), operation: 'co_managed_project_task_assignment', authorName: assigneeName,
      organizationName: expect.any(String), changes: { msp_assignee: { kind: 'user', name: assigneeName } } }]);

    await editCoManagedProjectTask(db, actor(), resource(id),
      { expectedRevision: 1, expectedTaskUpdatedAt: snapshot.taskUpdatedAt, patch: { task_name: 'control renamed' } }, writeCoManagedSharedTask);
    const history = await listCoManagedProjectTaskHistory(db, actor(), resource(id));
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ operation: 'co_managed_project_task_update', changes: { task_name: { from: 'control', to: 'control renamed' } } });
    expect(history[1]).toEqual(before[0]);
    expect((await getCoManagedProjectTaskSnapshot(db, actor(), resource(id))).values.task_name).toBe('control renamed');
  });

  it('serves the snapshot without task_name when only project_tasks.task_name is redacted', async () => {
    const id = collab.taskIds[9];
    const mapping = uuidv4();
    await db('project_status_mappings').insert({ tenant: world.customer, project_status_mapping_id: mapping, project_id: collab.projectId, status_id: world.statusId, custom_name: 'Field Todo', is_standard: false, display_order: 3, is_visible: true });
    await db('project_tasks').where({ tenant: world.customer, task_id: id }).update({ project_status_mapping_id: mapping, due_date: new Date('2026-04-01T00:00:00.000Z') });
    await openTask(id);
    await setRedactions(['project_tasks.task_name']);
    try {
      const served = await getCoManagedProjectTaskSnapshot(db, actor(), resource(id));
      expect(served.values.task_name ?? null).toBeNull();
      expect(served.values.project_status_mapping_id).toBe(mapping);
      expect(served.values.due_date).toBe('2026-04-01T00:00:00.000Z');
      expect(await listCoManagedProjectTaskStatusOptions(db, actor(), resource(id))).toContainEqual({ statusMappingId: mapping, name: 'Field Todo' });
      expect((await listCoManagedProjectTaskHistory(db, actor(), resource(id))).length).toBeGreaterThan(0);
    } finally { await setRedactions([]); }
  });

  it('serves snapshot, history and status options when only tasks.description is redacted', async () => {
    const id = collab.taskIds[10];
    const mapping = uuidv4();
    await db('project_status_mappings').insert({ tenant: world.customer, project_status_mapping_id: mapping, project_id: collab.projectId, status_id: world.statusId, custom_name: 'Desc Todo', is_standard: false, display_order: 4, is_visible: true });
    await db('project_tasks').where({ tenant: world.customer, task_id: id }).update({ project_status_mapping_id: mapping });
    await openTask(id);
    await setRedactions(['tasks.description']);
    try {
      const served = await getCoManagedProjectTaskSnapshot(db, actor(), resource(id));
      expect(served.values.task_name).toBe('redact-field-desc');
      expect(served.values.project_status_mapping_id).toBe(mapping);
      expect(await listCoManagedProjectTaskStatusOptions(db, actor(), resource(id))).toContainEqual({ statusMappingId: mapping, name: 'Desc Todo' });
      expect((await listCoManagedProjectTaskHistory(db, actor(), resource(id))).length).toBeGreaterThan(0);
    } finally { await setRedactions([]); }
  });
});
