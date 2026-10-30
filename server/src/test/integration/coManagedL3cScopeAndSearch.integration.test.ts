/**
 * CM L3c: project-scope access. A project is invisible to the MSP technician until the customer shares
 * it, and an unshared sibling stays invisible in lists, tasks, snapshots, search, counts and typeahead.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { configureL3cDbEnv, connectL3cDb, seedL3cWorld, seedL3cProject, shareProject, indexProjectRows, cleanupL3cTenants,
  sessionActor, type L3cWorld, type L3cProject } from './helpers/coManagedL3cFixture';

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({ getAppSecret: async () => undefined, getTenantSecret: async () => undefined }),
  getSecret: async (_n: string, e?: string, f = '') => (e ? process.env[e] : undefined) ?? f,
}));

import { listCoManagedSharedProjects, listCoManagedSharedProjectTasks } from '@alga-psa/co-managed/projectTaskQueue';
import { getCoManagedProjectTaskSnapshot } from '@alga-psa/co-managed/projectTaskEditing';
import { assignCoManagedProjectTask } from '@alga-psa/co-managed/projectTaskAssignments';
import { isCoManagedSharedWorkError } from '@alga-psa/co-managed/sharedWorkIdentity';
import { withSharedProjectSearchAccess } from '@alga-psa/search/projectSearchAccess';
import { countSearchMatches, countSearchMatchesByType, runSearchQuery, runSearchTypeaheadQuery } from '@alga-psa/search/query';

const TERM = 'zephyrquartz';
const TYPES = ['project', 'project_phase', 'project_task'] as const;

let db: Knex;
let world: L3cWorld, emptyWorld: L3cWorld;
let shared: L3cProject, unshared: L3cProject;
// Vitest may shuffle test order: each test owns the projects it mutates; only `shared`/`unshared` are fixed.
const names = { shared: 'Zephyrquartz Shared', unshared: 'Zephyrquartz Hidden', late: 'Zephyrquartz Late' };
const taskNames = (n: string) => [`${n} task one`, `${n} task two`];
const actorOf = (w: L3cWorld) => sessionActor(w.sponsor, w.technician);
const actor = () => actorOf(world);

async function searchAll(w: L3cWorld) {
  return withSharedProjectSearchAccess(db, actorOf(w), w.relationshipId, async (knex, customerTenant, searchIndex) => {
    const base = { knex, tenant: customerTenant, query: TERM, allowedTypes: [...TYPES], searchIndex };
    return {
      customerTenant,
      hits: await runSearchQuery({ ...base, limit: 50 }),
      typeahead: await runSearchTypeaheadQuery(base),
      byType: await countSearchMatchesByType(base),
      total: await countSearchMatches(base),
    };
  });
}

const unshare = (w: L3cWorld, projectId: string) =>
  db('co_management_project_scopes').where({ tenant: w.customer, relationship_id: w.relationshipId, project_id: projectId }).delete();

describe('CM L3c project scope access and search', () => {
  beforeAll(async () => {
    configureL3cDbEnv();
    db = await connectL3cDb();
    world = await seedL3cWorld(db);
    emptyWorld = await seedL3cWorld(db);
    shared = await seedL3cProject(db, world, names.shared, taskNames(names.shared));
    unshared = await seedL3cProject(db, world, names.unshared, taskNames(names.unshared));
    await indexProjectRows(db, world.customer, names.shared, shared, taskNames(names.shared));
    await indexProjectRows(db, world.customer, names.unshared, unshared, taskNames(names.unshared));
    await shareProject(db, world, shared.projectId, true);
  }, 180_000);

  afterAll(async () => {
    await cleanupL3cTenants([...(world?.tenants ?? []), ...(emptyWorld?.tenants ?? [])]);
    await db?.destroy().catch(() => undefined);
  });

  it('lists only shared projects and denies the unshared one everywhere', async () => {
    const page = await listCoManagedSharedProjects(db, actor());
    const ids = page.rows.map(row => row.projectId);
    expect(ids).toContain(shared.projectId);
    expect(ids).not.toContain(unshared.projectId);
    expect(page.rows.find(row => row.projectId === shared.projectId)).toMatchObject({
      customerTenant: world.customer, relationshipId: world.relationshipId, projectName: names.shared, canCollaborate: true,
    });

    const tasks = await listCoManagedSharedProjectTasks(db, actor(), { customerTenant: world.customer, relationshipId: world.relationshipId, projectId: shared.projectId });
    expect(tasks.rows.map(row => row.taskName).sort()).toEqual(taskNames(names.shared).sort());

    const denied = { customerTenant: world.customer, relationshipId: world.relationshipId, projectId: unshared.projectId };
    await expect(listCoManagedSharedProjectTasks(db, actor(), denied)).rejects.toSatisfy(isCoManagedSharedWorkError);
    await expect(getCoManagedProjectTaskSnapshot(db, actor(), { kind: 'project_task', tenant: world.customer, relationshipId: world.relationshipId, id: unshared.taskIds[0] }))
      .rejects.toSatisfy(isCoManagedSharedWorkError);
  });

  it('exposes a project only after the customer shares it, with readable task fields', async () => {
    const late = await seedL3cProject(db, world, 'Late project', taskNames('Late project'));
    const target = { customerTenant: world.customer, relationshipId: world.relationshipId, projectId: late.projectId };
    const resource = { kind: 'project_task' as const, tenant: world.customer, relationshipId: world.relationshipId, id: late.taskIds[0] };
    expect((await listCoManagedSharedProjects(db, actor())).rows.map(row => row.projectId)).not.toContain(late.projectId);
    await expect(listCoManagedSharedProjectTasks(db, actor(), target)).rejects.toSatisfy(isCoManagedSharedWorkError);
    await expect(getCoManagedProjectTaskSnapshot(db, actor(), resource)).rejects.toSatisfy(isCoManagedSharedWorkError);

    await shareProject(db, world, late.projectId, true);

    expect((await listCoManagedSharedProjects(db, actor())).rows.map(row => row.projectId)).toContain(late.projectId);
    const tasks = await listCoManagedSharedProjectTasks(db, actor(), target);
    expect(tasks.rows.map(row => row.taskId).sort()).toEqual([...late.taskIds].sort());
    expect(tasks.rows.map(row => row.taskName).sort()).toEqual(taskNames('Late project').sort());

    // Snapshots require the MSP participation reference; creating it is the first shared command.
    await assignCoManagedProjectTask(db, actor(), resource, { assignee: { kind: 'user', id: world.technician.userId }, expectedRevision: null });
    const snapshot = await getCoManagedProjectTaskSnapshot(db, actor(), resource);
    expect(snapshot.revision).toBe(1);
    expect(snapshot.values.task_name).toBe(taskNames('Late project')[0]);

    // Revoking the share closes it again on the very next call.
    await unshare(world, late.projectId);
    expect((await listCoManagedSharedProjects(db, actor())).rows.map(row => row.projectId)).not.toContain(late.projectId);
    await expect(getCoManagedProjectTaskSnapshot(db, actor(), resource)).rejects.toSatisfy(isCoManagedSharedWorkError);
  });

  it('finds shared project, phase and task rows and never the unshared ones (results, counts, typeahead)', async () => {
    const late = await seedL3cProject(db, world, names.late, taskNames(names.late));
    await indexProjectRows(db, world.customer, names.late, late, taskNames(names.late));
    await shareProject(db, world, late.projectId, true);
    try {
      const found = await searchAll(world);
      expect(found.customerTenant).toBe(world.customer);

      const visibleIds = [shared.projectId, shared.phaseId, ...shared.taskIds, late.projectId, late.phaseId, ...late.taskIds];
      const hiddenIds = new Set([unshared.projectId, unshared.phaseId, ...unshared.taskIds]);
      const hitIds = found.hits.map(hit => hit.id);
      for (const id of visibleIds) expect(hitIds).toContain(id);
      for (const id of hiddenIds) expect(hitIds).not.toContain(id);
      expect(found.hits.find(hit => hit.id === shared.projectId)?.type).toBe('project');
      expect(found.hits.find(hit => hit.id === shared.taskIds[0])?.type).toBe('project_task');

      // 2 projects, 2 phases, 4 tasks are visible; the unshared trio adds nothing to any count.
      expect(found.byType).toMatchObject({ project: 2, project_phase: 2, project_task: 4 });
      expect(found.total).toBe(8);
      expect(found.typeahead.length).toBeGreaterThan(0);
      for (const hit of found.typeahead) expect(hiddenIds.has(hit.id)).toBe(false);
    } finally {
      await unshare(world, late.projectId);
    }

    // Un-sharing flips results, counts and typeahead together.
    const afterRevoke = await searchAll(world);
    expect(afterRevoke.total).toBe(4);
    expect(afterRevoke.hits.map(hit => hit.id)).not.toContain(late.projectId);
    expect(afterRevoke.byType).toMatchObject({ project: 1, project_phase: 1, project_task: 2 });
  });

  it('answers an empty relation, not an error, when nothing is shared with the technician', async () => {
    const hidden = await seedL3cProject(db, emptyWorld, names.unshared, taskNames(names.unshared));
    await indexProjectRows(db, emptyWorld.customer, names.unshared, hidden, taskNames(names.unshared));
    const found = await searchAll(emptyWorld);
    expect(found.hits).toEqual([]);
    expect(found.typeahead).toEqual([]);
    expect(found.total).toBe(0);
    expect(found.byType).toEqual({});
  });
});
