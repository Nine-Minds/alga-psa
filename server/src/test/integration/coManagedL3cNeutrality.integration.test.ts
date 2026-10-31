/**
 * CM L3c neutrality: when the co-managed capability is not served for a tenant (no participation, or the
 * FORCE_CAPABILITIES kill switch) every shared project/task entry point denies opaquely and the search
 * wrapper hands the caller's own knex through, untouched, with no transaction opened.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { configureL3cDbEnv, connectL3cDb, seedL3cWorld, seedL3cProject, shareProject, cleanupL3cTenants,
  sessionActor, type L3cWorld, type L3cProject } from './helpers/coManagedL3cFixture';

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({ getAppSecret: async () => undefined, getTenantSecret: async () => undefined }),
  getSecret: async (_n: string, e?: string, f = '') => (e ? process.env[e] : undefined) ?? f,
}));

import { listCoManagedSharedProjects, listCoManagedSharedProjectTasks } from '@alga-psa/co-managed/projectTaskQueue';
import { editCoManagedProjectTask } from '@alga-psa/co-managed/projectTaskEditing';
import { assignCoManagedProjectTask } from '@alga-psa/co-managed/projectTaskAssignments';
import { isCoManagedSharedWorkError } from '@alga-psa/co-managed/sharedWorkIdentity';
import { withProjectSearchAccess } from '@alga-psa/search/projectSearchAccess';

let db: Knex;
let plain: L3cWorld;   // participation removed: a plain PSA tenant with no co-managed footprint
let live: L3cWorld;    // fully participating, project shared
let liveProject: L3cProject;
let plainProject: L3cProject;
const originalForce = process.env.FORCE_CAPABILITIES;

const resourceOf = (w: L3cWorld, id: string) => ({ kind: 'project_task' as const, tenant: w.customer, relationshipId: w.relationshipId, id });
const actorOf = (w: L3cWorld) => sessionActor(w.sponsor, w.technician);
const self = (w: L3cWorld) => ({ kind: 'user' as const, id: w.technician.userId });

async function expectAllDenied(w: L3cWorld, project: L3cProject) {
  const id = project.taskIds[0];
  await expect(listCoManagedSharedProjects(db, actorOf(w))).rejects.toSatisfy(isCoManagedSharedWorkError);
  await expect(listCoManagedSharedProjectTasks(db, actorOf(w), { customerTenant: w.customer, relationshipId: w.relationshipId, projectId: project.projectId }))
    .rejects.toSatisfy(isCoManagedSharedWorkError);
  await expect(editCoManagedProjectTask(db, actorOf(w), resourceOf(w, id),
    { expectedRevision: 1, expectedTaskUpdatedAt: new Date().toISOString(), patch: { task_name: 'Nope' } }, async () => { throw new Error('writer must not run'); }))
    .rejects.toSatisfy(isCoManagedSharedWorkError);
  await expect(assignCoManagedProjectTask(db, actorOf(w), resourceOf(w, id), { assignee: self(w), expectedRevision: null }))
    .rejects.toSatisfy(isCoManagedSharedWorkError);
}

describe('CM L3c neutrality when the capability is not served', () => {
  beforeAll(async () => {
    configureL3cDbEnv();
    delete process.env.FORCE_CAPABILITIES;
    db = await connectL3cDb();
    plain = await seedL3cWorld(db);
    plainProject = await seedL3cProject(db, plain, 'Plain project', ['t']);
    await shareProject(db, plain, plainProject.projectId, true);
    // Strip every participation signal for the sponsor (relationship, allocation, assignments, entitlement)
    // before any capability decision for it is cached. The customer rows remain, but the sponsor is plain PSA.
    await db('co_management_project_scopes').where({ tenant: plain.customer }).delete();
    await db('co_management_staff_assignments').where({ tenant: plain.sponsor }).delete();
    await db('co_managed_allocations').where({ tenant: plain.sponsor }).delete();
    await db('co_management_relationships').where({ tenant: plain.customer }).delete();
    await db('co_managed_entitlements').where({ tenant: plain.sponsor }).delete();

    live = await seedL3cWorld(db);
    liveProject = await seedL3cProject(db, live, 'Live project', ['t']);
    await shareProject(db, live, liveProject.projectId, true);
  }, 180_000);

  afterEach(() => {
    if (originalForce === undefined) delete process.env.FORCE_CAPABILITIES; else process.env.FORCE_CAPABILITIES = originalForce;
  });

  afterAll(async () => {
    await cleanupL3cTenants([...(plain?.tenants ?? []), ...(live?.tenants ?? [])]);
    await db?.destroy().catch(() => undefined);
  });

  it('control: the participating world is served when nothing is forced', async () => {
    const page = await listCoManagedSharedProjects(db, actorOf(live));
    expect(page.rows.map(row => row.projectId)).toContain(liveProject.projectId);
  });

  it('denies list, edit and assign for a tenant with no entitlement or relationship (flag state is irrelevant)', async () => {
    await expectAllDenied(plain, plainProject);
    expect(await db('co_managed_project_task_references').where({ tenant: plain.sponsor }).count({ n: '*' }).first().then(r => Number(r?.n))).toBe(0);
    expect((await db('project_tasks').where({ tenant: plain.customer, task_id: plainProject.taskIds[0] }).first()).task_name).toBe('t');
  });

  it('denies list, edit and assign for a fully participating tenant under FORCE_CAPABILITIES=co-managed:off', async () => {
    process.env.FORCE_CAPABILITIES = 'co-managed:off';
    await expectAllDenied(live, liveProject);
    expect(await db('co_managed_project_task_references').where({ tenant: live.sponsor }).count({ n: '*' }).first().then(r => Number(r?.n))).toBe(0);
    expect((await db('project_tasks').where({ tenant: live.customer, task_id: liveProject.taskIds[0] }).first()).task_name).toBe('t');
    // Lifting the kill switch restores access on the very next call.
    delete process.env.FORCE_CAPABILITIES;
    const page = await listCoManagedSharedProjects(db, actorOf(live));
    expect(page.rows.map(row => row.projectId)).toContain(liveProject.projectId);
  });

  it('withProjectSearchAccess hands work the original knex and no searchIndex, opening no transaction', async () => {
    const user = { user_id: plain.technician.userId, tenant: plain.sponsor, user_type: 'internal' } as never;
    const resolveAuthentication = vi.fn(async () => undefined);
    const transactionSpy = vi.spyOn(db, 'transaction');
    let seenKnex: unknown, seenIndex: unknown = 'unset';
    const result = await withProjectSearchAccess(db, plain.sponsor, user, resolveAuthentication, async (knex, searchIndex) => {
      seenKnex = knex; seenIndex = searchIndex;
      return 'done';
    });
    expect(result).toBe('done');
    expect(seenKnex).toBe(db);
    expect(seenIndex).toBeUndefined();
    expect(resolveAuthentication).not.toHaveBeenCalled();
    expect(transactionSpy).not.toHaveBeenCalled();
    transactionSpy.mockRestore();
  });

  it('withProjectSearchAccess is also a pass-through under the kill switch, even for a participating tenant', async () => {
    process.env.FORCE_CAPABILITIES = 'co-managed:off';
    const user = { user_id: live.customerStaff.userId, tenant: live.customer, user_type: 'internal' } as never;
    const resolveAuthentication = vi.fn(async () => undefined);
    const transactionSpy = vi.spyOn(db, 'transaction');
    let seenKnex: unknown, seenIndex: unknown = 'unset';
    await withProjectSearchAccess(db, live.customer, user, resolveAuthentication, async (knex, searchIndex) => { seenKnex = knex; seenIndex = searchIndex; });
    expect(seenKnex).toBe(db);
    expect(seenIndex).toBeUndefined();
    expect(resolveAuthentication).not.toHaveBeenCalled();
    expect(transactionSpy).not.toHaveBeenCalled();
    transactionSpy.mockRestore();
  });
});
