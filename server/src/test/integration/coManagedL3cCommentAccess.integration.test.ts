/**
 * CM L3c: native task-comment access is keyset-bounded. A project (or an id set) with more than the old
 * 1000-task cap is admitted whole, and unknown ids are ignored (they have no comments to count).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { configureL3cDbEnv, connectL3cDb, seedL3cWorld, seedL3cProject, cleanupL3cTenants, sessionActor, type L3cWorld, type L3cProject } from './helpers/coManagedL3cFixture';

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({ getAppSecret: async () => undefined, getTenantSecret: async () => undefined }),
  getSecret: async (_n: string, e?: string, f = '') => (e ? process.env[e] : undefined) ?? f,
}));

import { admitCoManagedNativeTaskCommentAccess, countCoManagedNativeTaskComments, CO_MANAGED_TASK_LOCATOR_PAGE } from '@alga-psa/co-managed/nativeTaskCommentAccess';
import { isCoManagedSharedWorkError } from '@alga-psa/co-managed/sharedWorkIdentity';

const TASKS = 1200;
let db: Knex;
let world: L3cWorld;
let big: L3cProject;
let other: L3cProject;

/** The customer's own staff member acts on their own workspace. */
const actor = () => sessionActor(world.customer, world.customerStaff);

describe('CM L3c native task comment access beyond the old 1000-task cap', () => {
  beforeAll(async () => {
    configureL3cDbEnv();
    db = await connectL3cDb();
    world = await seedL3cWorld(db);
    // Commenting (the 'update' action) needs project:update on the customer's own workspace; the fixture grants read only.
    const updateId = uuidv4();
    await db('permissions').insert({ tenant: world.customer, permission_id: updateId, resource: 'project', action: 'update', msp: true, client: false });
    const adminRole = await db('roles').where({ tenant: world.customer, role_name: 'Admin', msp: true, client: false }).first();
    await db('role_permissions').insert({ tenant: world.customer, role_id: adminRole.role_id, permission_id: updateId });
    big = await seedL3cProject(db, world, 'Big project', []);
    other = await seedL3cProject(db, world, 'Other project', ['lonely']);

    // Bulk tasks (ordered by task_id inside the locator) with one comment each; the last created gets two.
    const { rows } = await db.raw(
      `INSERT INTO project_tasks (tenant, phase_id, task_name, wbs_code)
       SELECT ?::uuid, ?::uuid, 'Bulk ' || g, '900.1.' || g FROM generate_series(1, ?) g RETURNING task_id`,
      [world.customer, big.phaseId, TASKS]);
    big.taskIds = rows.map((row: { task_id: string }) => row.task_id);
    const comments: Array<{ taskId: string; commentId: string; threadId: string }> = [];
    for (const taskId of big.taskIds) comments.push({ taskId, commentId: uuidv4(), threadId: uuidv4() });
    comments.push({ taskId: big.taskIds[TASKS - 1], commentId: uuidv4(), threadId: uuidv4() });
    for (let i = 0; i < comments.length; i += 400) {
      const chunk = comments.slice(i, i + 400);
      await db('comment_threads').insert(chunk.map(c => ({ tenant: world.customer, thread_id: c.threadId, project_task_id: c.taskId, root_comment_id: c.commentId })));
      await db('project_task_comments').insert(chunk.map(c => ({
        tenant: world.customer, task_comment_id: c.commentId, task_id: c.taskId, user_id: world.customerStaff.userId, note: 'hello', thread_id: c.threadId,
      })));
    }
  }, 300_000);

  afterAll(async () => {
    await cleanupL3cTenants(world?.tenants ?? []);
    await db?.destroy().catch(() => undefined);
  });

  it('seeds beyond both the old cap and the locator page size', () => {
    expect(big.taskIds.length).toBe(TASKS);
    expect(TASKS).toBeGreaterThan(1000);
    expect(TASKS).toBeGreaterThan(CO_MANAGED_TASK_LOCATOR_PAGE * 2);
  });

  it('admits a whole project of 1200 tasks and counts every comment past 1000', async () => {
    await db.transaction(async trx => {
      const access = await admitCoManagedNativeTaskCommentAccess(trx, actor(), { projectId: big.projectId }, 'read');
      expect(access.hidden(big.taskIds[TASKS - 1], ['note'])).toBe(false);
      expect(access.hidden(big.taskIds[0].toUpperCase(), ['author'])).toBe(false);
      expect(() => access.hidden(uuidv4(), ['note'])).toThrow();
      await access.assertCurrent();
      const count = await trx('project_task_comments').where('tenant', world.customer).whereIn('task_id', big.taskIds).count({ n: '*' }).first();
      expect(Number(count?.n)).toBe(TASKS + 1);
    });
  });

  it('admits an explicit id set of all 1200 tasks for read and update', async () => {
    for (const action of ['read', 'update'] as const) {
      await db.transaction(async trx => {
        const access = await admitCoManagedNativeTaskCommentAccess(trx, actor(), { taskIds: big.taskIds }, action);
        for (const taskId of [big.taskIds[0], big.taskIds[999], big.taskIds[1000], big.taskIds[TASKS - 1]]) {
          expect(access.hidden(taskId, ['note'])).toBe(false);
        }
        // The same ids, duplicated and re-cased, are one set.
        const again = await admitCoManagedNativeTaskCommentAccess(trx, actor(), { taskIds: [...big.taskIds, ...big.taskIds.map(id => id.toUpperCase())] }, action);
        expect(again.hidden(big.taskIds[TASKS - 1], ['note'])).toBe(false);
        const rows = await trx('project_task_comments').where('tenant', world.customer).whereIn('task_id', big.taskIds).count({ n: '*' }).first();
        expect(Number(rows?.n)).toBe(TASKS + 1);
      });
    }
  });

  it('counts through the locator for tasks at index >= 1000 (the old cap) and ignores unknown ids', async () => {
    const ids = [...big.taskIds, uuidv4()];
    const counts = await countCoManagedNativeTaskComments(db, actor(), ids);
    expect(Object.keys(counts).length).toBe(TASKS);
    for (const index of [0, 999, 1000, 1100, TASKS - 2]) expect(counts[big.taskIds[index]]).toBe(1);
    expect(counts[big.taskIds[TASKS - 1]]).toBe(2);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(TASKS + 1);
  });

  it('still denies a malformed task id', async () => {
    await db.transaction(async trx => {
      await expect(admitCoManagedNativeTaskCommentAccess(trx, actor(), { taskIds: ['not-a-uuid'] }, 'read')).rejects.toSatisfy(isCoManagedSharedWorkError);
    });
  });

  it('does not treat another workspace as local: a task of a different tenant is unknown and ignored', async () => {
    const sponsorActor = sessionActor(world.sponsor, world.technician);
    await db.transaction(async trx => {
      // The sponsor's own tenant has none of the customer's task ids.
      const access = await admitCoManagedNativeTaskCommentAccess(trx, sponsorActor, { taskIds: [other.taskIds[0]] }, 'read');
      expect(access.taskIds).toEqual([]);
      expect(() => access.hidden(other.taskIds[0], ['note'])).toThrow();
    });
  });
});
