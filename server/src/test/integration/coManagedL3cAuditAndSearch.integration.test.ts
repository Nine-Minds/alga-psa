/**
 * CM L3c: idempotent replay (A1), customer-visible history (plan step 5) and the shared search surface
 * (counts, page and typeahead read one relation).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { configureL3cDbEnv, connectL3cDb, seedL3cWorld, seedL3cProject, shareProject, indexProjectRows, cleanupL3cTenants,
  sessionActor, type L3cWorld, type L3cProject } from './helpers/coManagedL3cFixture';

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({ getAppSecret: async () => undefined, getTenantSecret: async () => undefined }),
  getSecret: async (_n: string, e?: string, f = '') => (e ? process.env[e] : undefined) ?? f,
}));

import { editCoManagedProjectTask, getCoManagedProjectTaskSnapshot } from '@alga-psa/co-managed/projectTaskEditing';
import { assignCoManagedProjectTask } from '@alga-psa/co-managed/projectTaskAssignments';
import { listCoManagedProjectTaskHistory } from '@alga-psa/co-managed/projectTaskAudit';
import { isCoManagedSharedWorkError } from '@alga-psa/co-managed/sharedWorkIdentity';
import { searchSharedProjects } from '@alga-psa/search/projectSearchAccess';
import { writeCoManagedSharedTask } from '../../lib/co-managed/editProjectTask';

let db: Knex;
let world: L3cWorld;
let collab: L3cProject;
const TERM = 'Quuxalpha';
const actor = () => sessionActor(world.sponsor, world.technician);
const resource = (id: string) => ({ kind: 'project_task' as const, tenant: world.customer, relationshipId: world.relationshipId, id });
const self = () => ({ kind: 'user' as const, id: world.technician.userId });
const taskRow = (id: string) => db('project_tasks').where({ tenant: world.customer, task_id: id }).first();
const referenceRow = (id: string) => db('co_managed_project_task_references')
  .where({ tenant: world.sponsor, customer_tenant: world.customer, task_id: id }).first();
const auditCount = (id: string) => db('audit_logs').where({ tenant: world.customer, table_name: 'project_tasks', record_id: id })
  .count({ n: '*' }).first().then(r => Number(r?.n));

describe('CM L3c idempotency, history and shared search', () => {
  beforeAll(async () => {
    configureL3cDbEnv();
    db = await connectL3cDb();
    world = await seedL3cWorld(db);
    collab = await seedL3cProject(db, world, `${TERM} project`, ['replay', 'history', 'other', 'refuse', 'race', 'race-other', 'snap']);
    await shareProject(db, world, collab.projectId, true);
    await indexProjectRows(db, world.customer, `${TERM} project`, collab, [`${TERM} one`, `${TERM} two`, `${TERM} three`, `${TERM} four`, `${TERM} five`, `${TERM} six`, `${TERM} seven`]);
  }, 180_000);

  afterAll(async () => {
    await cleanupL3cTenants(world?.tenants ?? []);
    await db?.destroy().catch(() => undefined);
  });

  it('replays an edit with the same operation id as a no-op returning the original receipt', async () => {
    const id = collab.taskIds[0];
    await assignCoManagedProjectTask(db, actor(), resource(id), { assignee: self(), expectedRevision: null });
    const snapshot = await getCoManagedProjectTaskSnapshot(db, actor(), resource(id));
    const request = { operationId: uuidv4(), expectedRevision: snapshot.revision, expectedTaskUpdatedAt: snapshot.taskUpdatedAt, patch: { task_name: 'Replayed once' } };
    const writes: string[] = [];
    const writer: typeof writeCoManagedSharedTask = async (...args) => { writes.push('w'); return writeCoManagedSharedTask(...args); };

    const first = await editCoManagedProjectTask(db, actor(), resource(id), request, writer);
    const auditsAfterFirst = await auditCount(id);
    const second = await editCoManagedProjectTask(db, actor(), resource(id), request, writer);

    expect(second).toEqual(first);
    expect(writes).toEqual(['w']);
    expect(await auditCount(id)).toBe(auditsAfterFirst);
    expect((await referenceRow(id)).revision).toBe(first.revision);
    expect((await taskRow(id)).task_name).toBe('Replayed once');
  });

  it('refuses the same operation id with a different request, and replays an assignment', async () => {
    const id = collab.taskIds[3];
    await assignCoManagedProjectTask(db, actor(), resource(id), { assignee: self(), expectedRevision: null });
    const snapshot = await getCoManagedProjectTaskSnapshot(db, actor(), resource(id));
    const operationId = uuidv4();
    const ok = await editCoManagedProjectTask(db, actor(), resource(id),
      { operationId, expectedRevision: snapshot.revision, expectedTaskUpdatedAt: snapshot.taskUpdatedAt, patch: { task_name: 'Original body' } }, writeCoManagedSharedTask);
    await expect(editCoManagedProjectTask(db, actor(), resource(id),
      { operationId, expectedRevision: snapshot.revision, expectedTaskUpdatedAt: snapshot.taskUpdatedAt, patch: { task_name: 'Different body' } }, writeCoManagedSharedTask))
      .rejects.toSatisfy(isCoManagedSharedWorkError);
    expect((await taskRow(id)).task_name).toBe('Original body');
    expect((await referenceRow(id)).revision).toBe(ok.revision);

    const assignId = collab.taskIds[2];
    const assignOp = uuidv4();
    const firstAssign = await assignCoManagedProjectTask(db, actor(), resource(assignId), { operationId: assignOp, assignee: self(), expectedRevision: null });
    const audits = await auditCount(assignId);
    const secondAssign = await assignCoManagedProjectTask(db, actor(), resource(assignId), { operationId: assignOp, assignee: self(), expectedRevision: null });
    expect(secondAssign).toEqual(firstAssign);
    expect(await auditCount(assignId)).toBe(audits);
    expect((await referenceRow(assignId)).revision).toBe(1);
  });

  it('writes a qualified-author history row into the customer tenant, newest first, from edit and assign', async () => {
    const id = collab.taskIds[1];
    await assignCoManagedProjectTask(db, actor(), resource(id), { operationId: uuidv4(), assignee: self(), expectedRevision: null });
    const snapshot = await getCoManagedProjectTaskSnapshot(db, actor(), resource(id));
    await editCoManagedProjectTask(db, actor(), resource(id),
      { operationId: uuidv4(), expectedRevision: snapshot.revision, expectedTaskUpdatedAt: snapshot.taskUpdatedAt, patch: { task_name: 'History rename' } }, writeCoManagedSharedTask);

    const history = await listCoManagedProjectTaskHistory(db, actor(), resource(id));
    expect(history.map(entry => entry.operation)).toEqual(['co_managed_project_task_update', 'co_managed_project_task_assignment']);
    for (const entry of history) {
      expect(entry.authorName).toBeTruthy();
      expect(entry.organizationName).toBeTruthy();
      expect(JSON.stringify(entry)).not.toContain(world.technician.userId);
    }
    expect(JSON.stringify(history[0].changes)).toContain('History rename');
    // Lives in the customer's tenant audit log, not the sponsor's.
    expect(await db('audit_logs').where({ tenant: world.sponsor, record_id: id }).count({ n: '*' }).first().then(r => Number(r?.n))).toBe(0);
    // Out-of-scope readers get the opaque denial.
    const outsider = sessionActor(world.customer, world.customerStaff);
    await expect(listCoManagedProjectTaskHistory(db, outsider, resource(id))).rejects.toSatisfy(isCoManagedSharedWorkError);
  });

  it('shared search: page, typeahead and counts come from the same relation', async () => {
    const result = await searchSharedProjects(db, actor(), world.relationshipId, { query: TERM });
    expect(result.totalCount).toBe(9);
    expect(result.results.length).toBe(result.totalCount);
    expect(Object.values(result.groups).reduce((a, b) => a + b, 0)).toBe(result.totalCount);
    expect(result.typeahead.length).toBeGreaterThan(0);
    const pageIds = new Set(result.results.map(hit => hit.objectId ?? (hit as { object_id?: string }).object_id));
    for (const hit of result.typeahead) expect(pageIds.has((hit as { objectId?: string }).objectId ?? (hit as { object_id?: string }).object_id)).toBe(true);
    const urls = JSON.stringify(result.results);
    expect(urls).toContain(`/msp/co-management/tasks/${world.customer}/${world.relationshipId}/`);
    expect(urls).toContain(`/msp/co-management/projects/${world.customer}/${world.relationshipId}/`);
  });

  it('concurrent first assignments: same operation id replays one receipt; a different id takes the revision conflict', async () => {
    const id = collab.taskIds[4];
    const operationId = uuidv4();
    const call = (opId: string) => assignCoManagedProjectTask(db, actor(), resource(id), { operationId: opId, assignee: self(), expectedRevision: null });
    const results = await Promise.allSettled([call(operationId), call(operationId)]);
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'fulfilled']);
    const [a, b] = results.map(r => (r as PromiseFulfilledResult<unknown>).value);
    expect(a).toEqual(b);
    expect(await db('co_managed_project_task_references').where({ tenant: world.sponsor, task_id: id }).count({ n: '*' }).first().then(r => Number(r?.n))).toBe(1);
    expect(await auditCount(id)).toBe(1);

    const other = collab.taskIds[5];
    const raced = await Promise.allSettled([call2(other, uuidv4()), call2(other, uuidv4())]);
    const rejected = raced.filter(r => r.status === 'rejected') as PromiseRejectedResult[];
    expect(raced.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ code: 'TASK_EDIT_CONFLICT', reason: 'revision' });
    expect((await referenceRow(other)).revision).toBe(1);

    function call2(taskId: string, opId: string) {
      return assignCoManagedProjectTask(db, actor(), resource(taskId), { operationId: opId, assignee: self(), expectedRevision: null });
    }
  });

  it('snapshot carries the MSP assignee as display name and kind only', async () => {
    const id = collab.taskIds[6];
    await assignCoManagedProjectTask(db, actor(), resource(id), { assignee: self(), expectedRevision: null });
    const snapshot = await getCoManagedProjectTaskSnapshot(db, actor(), resource(id));
    expect(snapshot.assignee).toEqual({ kind: 'user', name: expect.any(String) });
    expect(JSON.stringify(snapshot)).not.toContain(world.technician.userId);
  });
});
