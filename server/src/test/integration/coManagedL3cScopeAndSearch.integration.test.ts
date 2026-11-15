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
const extraWorlds: L3cWorld[] = [];
// Vitest may shuffle test order: each test owns the projects it mutates; only `shared`/`unshared` are fixed.
const names = { shared: 'Zephyrquartz Shared', unshared: 'Zephyrquartz Hidden', late: 'Zephyrquartz Late' };
const taskNames = (n: string) => [`${n} task one`, `${n} task two`];
const actorOf = (w: L3cWorld) => sessionActor(w.sponsor, w.technician);
const actor = () => actorOf(world);

async function searchAll(w: L3cWorld, query = TERM) {
  return withSharedProjectSearchAccess(db, actorOf(w), w.relationshipId, async (knex, customerTenant, searchIndex) => {
    const base = { knex, tenant: customerTenant, query, allowedTypes: [...TYPES], searchIndex };
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
    await cleanupL3cTenants([...(world?.tenants ?? []), ...(emptyWorld?.tenants ?? []), ...extraWorlds.flatMap(w => w.tenants)]);
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

  // The relationship's redacted_fields join the home policy in the effective policy admission computes.
  const setRelationshipRedactions = (w: L3cWorld, fields: string[]) =>
    db('co_management_relationships').where({ tenant: w.customer, relationship_id: w.relationshipId }).update({ redacted_fields: fields });
  async function redactionWorld(titleTerm: string, descriptionTerm: string) {
    const w = await seedL3cWorld(db);
    extraWorlds.push(w);
    const taskTitle = `Plain ${titleTerm} chore`, project = await seedL3cProject(db, w, 'Redaction project', [taskTitle]);
    await db('project_tasks').where({ tenant: w.customer, task_id: project.taskIds[0] }).update({ description: `Notes about ${descriptionTerm} here` });
    await indexProjectRows(db, w.customer, 'Redaction project', project, [taskTitle]);
    await shareProject(db, w, project.projectId, true);
    return { w, taskId: project.taskIds[0] };
  }

  it('A: a hidden task_name matches nothing in results, typeahead, counts or groups; an unredacted reader still finds it', async () => {
    const { w, taskId } = await redactionWorld('quokkafrost', 'narwhalmist');
    const open = await searchAll(w, 'quokkafrost');
    expect(open.hits.map(hit => hit.id)).toContain(taskId);
    expect(open.total).toBe(1);

    await setRelationshipRedactions(w, ['task_name']);
    const masked = await searchAll(w, 'quokkafrost');
    expect(masked.hits.map(hit => hit.id)).not.toContain(taskId);
    expect(masked.typeahead.map(hit => hit.id)).not.toContain(taskId);
    expect(masked.total).toBe(0);
    expect(masked.byType).toEqual({});
  });

  it('B: a hidden description nulls the body and stops body-only matches, while title terms still match', async () => {
    const { w, taskId } = await redactionWorld('lemurbramble', 'okapidrift');
    const open = await searchAll(w, 'okapidrift');
    expect(open.hits.map(hit => hit.id)).toContain(taskId);

    await setRelationshipRedactions(w, ['description']);
    const byTitle = await searchAll(w, 'lemurbramble');
    const hit = byTitle.hits.find(h => h.id === taskId);
    expect(hit).toBeDefined();
    expect(hit?.body ?? null).toBeNull();
    const byBody = await searchAll(w, 'okapidrift');
    expect(byBody.hits.map(h => h.id)).not.toContain(taskId);
    expect(byBody.typeahead.map(h => h.id)).not.toContain(taskId);
    expect(byBody.total).toBe(0);
  });

  it.each(['tasks', 'project_tasks'])('C: a redacted whole-resource "%s" removes every task hit (results, typeahead, counts, groups, hidden description) and leaves project and phase alone', async resource => {
    const { w, taskId } = await redactionWorld('gryphonslate', 'axolotlmoss');
    const open = await searchAll(w, 'Redaction');
    await setRelationshipRedactions(w, [resource]);
    for (const term of ['gryphonslate', 'axolotlmoss']) {
      const masked = await searchAll(w, term);
      expect(masked.hits.filter(hit => hit.type === 'project_task')).toEqual([]);
      expect(masked.typeahead.map(hit => hit.id)).not.toContain(taskId);
      expect(masked.total).toBe(0);
      expect(masked.byType).toEqual({});
    }
    const masked = await searchAll(w, 'Redaction');
    expect(masked.hits.some(hit => hit.type === 'project_task')).toBe(false);
    expect(masked.byType.project_task ?? 0).toBe(0);
    expect(Object.keys(masked.byType)).not.toContain('project_task');
    expect(masked.byType).toMatchObject({ project: open.byType.project, project_phase: open.byType.project_phase });
    expect(masked.hits.filter(hit => hit.type !== 'project_task').map(hit => hit.id).sort())
      .toEqual(open.hits.filter(hit => hit.type !== 'project_task').map(hit => hit.id).sort());
  });

  it('control: with no redactions the reader sees identical results, order and counts as before', async () => {
    const { w, taskId } = await redactionWorld('basiliskfern', 'tapirdust');
    const before = await searchAll(w, 'Redaction');
    await setRelationshipRedactions(w, []);
    const after = await searchAll(w, 'Redaction');
    expect(after.hits.map(hit => hit.id)).toEqual(before.hits.map(hit => hit.id));
    expect(after.byType).toEqual(before.byType);
    expect(after.total).toBe(before.total);
    expect(after.hits.map(hit => hit.id)).toContain(taskId);
    expect(after.byType.project_task).toBe(1);
  });

  it('field-only: a hidden task_name keeps the task row under the placeholder title, and a field-level tasks.description does not drop it', async () => {
    const { w, taskId } = await redactionWorld('ocelotbirch', 'wombatreed');
    await setRelationshipRedactions(w, ['task_name']);
    const hit = (await searchAll(w, 'Redaction')).hits.find(h => h.id === taskId);
    expect(hit).toBeDefined();
    expect(hit?.title).toBe('Project task');
    // The same row is invisible to its real title: this is case A, seen from the other side.
    expect((await searchAll(w, 'ocelotbirch')).total).toBe(0);

    await setRelationshipRedactions(w, ['project_tasks.description']);
    const byTerm = await searchAll(w, 'Redaction');
    expect(byTerm.byType.project_task).toBe(1);
    expect((await searchAll(w, 'wombatreed')).total).toBe(0);
  });

  it('D: a redacted tasks.description nulls the body and stops body-only matches, keeping the task row', async () => {
    const { w, taskId } = await redactionWorld('marmotvale', 'pangolinash');
    // Hits have no `body` field: the body is exposed only through `snippet` (ts_headline over the indexed body, undefined when empty).
    // Sanity: unredacted, the snippet carries the description, so the undefined assertion below is meaningful.
    const open = await searchAll(w, 'pangolinash');
    expect(open.hits.find(h => h.id === taskId)?.snippet).toContain('pangolinash');

    await setRelationshipRedactions(w, ['tasks.description']);
    const hit = (await searchAll(w, 'Redaction')).hits.find(h => h.id === taskId);
    expect(hit).toBeDefined();
    expect(hit?.title).toBe('Project task');
    expect(hit?.snippet).toBeUndefined();
    const byBody = await searchAll(w, 'pangolinash');
    expect(byBody.hits.map(h => h.id)).not.toContain(taskId);
    expect(byBody.typeahead.map(h => h.id)).not.toContain(taskId);
    expect(byBody.byType).toEqual({});
    expect(byBody.total).toBe(0);
  });

  it('E: a redacted tasks.task_id removes every task hit (results, typeahead, counts, groups) and leaves project and phase alone', async () => {
    const { w, taskId } = await redactionWorld('civetmarsh', 'dugongfern');
    const open = await searchAll(w, 'Redaction');
    await setRelationshipRedactions(w, ['tasks.task_id']);
    const masked = await searchAll(w, 'Redaction');
    expect(masked.hits.filter(hit => hit.type === 'project_task')).toEqual([]);
    expect(masked.hits.map(hit => hit.id)).not.toContain(taskId);
    expect(masked.typeahead.map(hit => hit.id)).not.toContain(taskId);
    expect(masked.byType.project_task ?? 0).toBe(0);
    expect(masked.byType).toMatchObject({ project: open.byType.project, project_phase: open.byType.project_phase });
    expect(masked.hits.map(hit => hit.id).sort()).toEqual(open.hits.filter(hit => hit.type !== 'project_task').map(hit => hit.id).sort());
  });
});
