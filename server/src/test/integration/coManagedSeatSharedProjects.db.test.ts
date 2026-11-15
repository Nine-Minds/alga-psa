/**
 * Co-managed seat shape, slice S29 (F071, F072, F073 / T038) on real Postgres.
 *
 * The MSP shares individual projects of the arrangement's client. A seat technician sees only those, in lists,
 * pickers, search and by direct id; opens one on the native project actions with no budget, billing or rate key in any
 * payload; and on its tasks updates status, assigns a technician of their own client, comments with an audience and
 * logs operational time. Every one of those writes is refused on a project that is not shared.
 *
 * `tech` holds exactly the seat role. `widened` holds the seat role plus `project:update` and the service permissions
 * an administrator could have added: what still holds for them is the seat authority, not the role.
 */
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

const holder = vi.hoisted(() => ({ db: null as any, user: null as any, tenant: '' }));

vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/auth')>()),
  withAuth: (fn: any) => (...args: any[]) => fn(holder.user, { tenant: holder.tenant }, ...args),
}));
vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: async () => ({ knex: holder.db, tenant: holder.tenant }),
  getAdminConnection: async () => holder.db,
}));
// The principal read (`loadProductPrincipal`, which decides a save's billing mode) goes through the admin connection.
vi.mock('@alga-psa/db/admin', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAdminConnection: async () => holder.db,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock('@alga-psa/event-bus/publishers', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  publishWorkflowEvent: async () => undefined,
  publishNonCatalogWorkflowEvent: async () => undefined,
  publishEvent: async () => undefined,
}));

import { createCoManagedSeatArrangement, setCoManagedSeatProjectShared, readCoManagedSeatProjectShares, CO_MANAGED_SEAT_ROLE_GRANTS } from '@alga-psa/co-managed';
import { CO_MANAGED_SEAT_RESOLVER_ID, coManagedSeatResolver } from '@alga-psa/co-managed/seatAuthority';
import { registerBuiltinRuleResolver } from '@alga-psa/authorization/kernel';
import { retainBuiltinResolverSubject } from '@alga-psa/authorization/subject';
import { resolveCommentAudience } from '@alga-psa/shared/lib/commentAudience';
import {
  authorizeProjectIds, getProject, getProjectDetails, getProjectMetadata, getProjectPhase, getProjects,
  getProjectsWithPhases, getProjectSurfaceAccess, getProjectTreeData, loadProjectListItemsByIds, searchProjectListIds,
} from '@alga-psa/projects/actions/projectActions';
import {
  addTaskResourcesAction, getAllProjectTasksForListView, getEffectiveTaskService, getProjectTaskData, getTaskById,
  getTasksForPhase, getTaskWithDetails, updateTaskStatus, updateTaskWithChecklist,
} from '@alga-psa/projects/actions/projectTaskActions';
import { createTaskComment, getTaskComments } from '@alga-psa/projects/actions/projectTaskCommentActions';
import { getServices } from '@alga-psa/projects/actions/serviceCatalogActions';
import { listProjectMaterials, searchServiceCatalogForPicker } from '@alga-psa/projects/actions/materialCatalogActions';
import { calculateProjectCompletion } from '@alga-psa/projects/lib/projectUtils';
import { saveTimeEntry } from '@alga-psa/scheduling/actions/timeEntryCrudActions';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';
import { insertTestServiceType } from '../../../test-utils/serviceTypeFixtures';

const DAY = 86_400_000;
const describeDb = await describeWithDb();

const BUDGET_MINUTES = 6000;
/** Every key a budget, billing or rate column can surface under, in any of the three tables. */
const CLOSED_KEYS = ['budgeted_hours', 'billing_profile_id', 'service_id'];

const asRecord = (value: unknown) => value as Record<string, any>;
const failureOf = (result: unknown): string | null => {
  const r = asRecord(result);
  if (r && typeof r.permissionError === 'string') return r.permissionError;
  if (r && typeof r.actionError === 'string') return r.actionError;
  return null;
};
/** What an action did when called: its failure message (returned or thrown), or null when it succeeded. */
const attempt = async (run: () => Promise<unknown>): Promise<string | null> => {
  try {
    const result = await run();
    return failureOf(result);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};
const expectNoClosedKey = (record: unknown, label: string) => {
  for (const key of CLOSED_KEYS) expect(record, `${label}: ${key}`).not.toHaveProperty(key);
};

describeDb('co-managed seat shared projects on real Postgres', { shuffle: false }, () => {
  let db: Knex;
  let tenant: string;
  let ownClient: string;
  let otherClient: string;
  let arrangementId: string;
  let serviceId: string;
  let profileId: string;
  let taskStatus: string;
  let doneStatus: string;
  let tech: any;
  let widened: any;
  let peer: any;       // another technician of the same client
  let foreignTech: any; // a technician of the other client's arrangement
  let mspStaff: any;   // MSP staff on no ticket the technician can see
  let msp: any;
  const queries: string[] = [];

  type Project = { projectId: string; phaseId: string; taskId: string; todo: string; done: string };
  let shared: Project;
  let unshared: Project;
  let otherClientProject: Project;

  const roleFor = async (permissions: Array<[string, string]>) => {
    const userId = await createUser(db, tenant, { user_type: 'internal' });
    const roleId = randomUUID();
    await db('roles').insert({ tenant, role_id: roleId, role_name: `role-${roleId.slice(0, 8)}`, msp: true, client: false });
    for (const [resource, action] of permissions) {
      const permission = await db('permissions').where({ tenant, resource, action, msp: true }).first('permission_id');
      const permissionId = permission?.permission_id ?? randomUUID();
      if (!permission) await db('permissions').insert({ tenant, permission_id: permissionId, resource, action, msp: true, client: false });
      await db('role_permissions').insert({ tenant, role_id: roleId, permission_id: permissionId });
    }
    await db('user_roles').insert({ tenant, user_id: userId, role_id: roleId });
    return userId;
  };
  const seatGrants = () => CO_MANAGED_SEAT_ROLE_GRANTS.map((grant) => grant.split(':') as [string, string]);
  const makeSeat = async (forArrangement: string, extra: Array<[string, string]> = []) => {
    const userId = await roleFor([...seatGrants(), ...extra]);
    await db.transaction(async (trx) => {
      await retainBuiltinResolverSubject(trx, { tenant, userId }, CO_MANAGED_SEAT_RESOLVER_ID);
      await trx('co_managed_seat_assignments').insert({
        tenant, assignment_id: randomUUID(), arrangement_id: forArrangement, user_id: userId, state: 'active',
      });
    });
    return db('users').where({ tenant, user_id: userId }).first();
  };
  const as = (user: any) => { holder.user = user; };

  const makeProject = async (clientId: string, name: string, projectStatus: string): Promise<Project> => {
    const projectId = randomUUID(); const phaseId = randomUUID(); const taskId = randomUUID();
    const todo = randomUUID(); const done = randomUUID();
    await db('projects').insert({
      tenant, project_id: projectId, project_name: name, client_id: clientId, status: projectStatus,
      wbs_code: `W-${projectId.slice(0, 4)}`, project_number: `P-${projectId.slice(0, 6)}`, is_inactive: false,
      budgeted_hours: BUDGET_MINUTES, billing_profile_id: profileId, service_id: serviceId,
    });
    await db('project_status_mappings').insert([
      { tenant, project_status_mapping_id: todo, project_id: projectId, status_id: taskStatus, display_order: 1, is_visible: true, is_standard: false },
      { tenant, project_status_mapping_id: done, project_id: projectId, status_id: doneStatus, display_order: 2, is_visible: true, is_standard: false },
    ]);
    await db('project_phases').insert({
      tenant, phase_id: phaseId, project_id: projectId, phase_name: `Phase ${name}`, status: 'active', order_number: 1,
      wbs_code: `W-${projectId.slice(0, 4)}.1`, order_key: 'a0', service_id: serviceId,
    });
    await db('project_tasks').insert({
      tenant, task_id: taskId, phase_id: phaseId, task_name: `Task ${name}`, wbs_code: `W-${projectId.slice(0, 4)}.1.1`,
      project_status_mapping_id: todo, order_key: 'a0', task_type_key: 'task', service_id: serviceId, estimated_hours: 120,
    });
    return { projectId, phaseId, taskId, todo, done };
  };
  const share = (project: Project, on: boolean) =>
    setCoManagedSeatProjectShared(db, { sponsorTenant: tenant, arrangementId, projectId: project.projectId, shared: on });
  const taskRow = (taskId: string) => db('project_tasks').where({ tenant, task_id: taskId }).first();

  beforeAll(async () => {
    process.env.FORCE_CAPABILITIES = 'co-managed-seat:on';
    db = await createTestDbConnection({ databaseName: 's29_shared_projects_test' });
    holder.db = db;
    registerBuiltinRuleResolver(coManagedSeatResolver);

    tenant = await createTenant(db, `Shared projects sponsor ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    holder.tenant = tenant;
    await db('co_managed_entitlements').insert({
      tenant, source: 'hosted', source_reference: `sub_${randomUUID()}`, capacity: 6,
      verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY),
    });
    ownClient = await createClient(db, tenant, `Seat client ${randomUUID().slice(0, 8)}`);
    otherClient = await createClient(db, tenant, `Other client ${randomUUID().slice(0, 8)}`);

    const { serviceTypeId } = await insertTestServiceType(db, tenant);
    serviceId = randomUUID();
    await db('service_catalog').insert({
      tenant, service_id: serviceId, service_name: 'Premium project hours', billing_method: 'hourly', custom_service_type_id: serviceTypeId,
      default_rate: 18_500, unit_of_measure: 'hour',
    });
    const profile = await db('client_billing_profiles').where({ tenant, client_id: ownClient }).first('billing_profile_id');
    profileId = profile?.billing_profile_id ?? randomUUID();
    if (profile) await db('client_billing_profiles').where({ tenant, billing_profile_id: profileId }).update({ name: 'Quarterly project billing' });
    else await db('client_billing_profiles').insert({ tenant, billing_profile_id: profileId, client_id: ownClient, name: 'Quarterly project billing', is_default: true });
    const projectStatus = randomUUID();
    taskStatus = randomUUID(); doneStatus = randomUUID();
    await db('statuses').insert([
      { tenant, status_id: projectStatus, name: 'Active', status_type: 'project', order_number: 1, is_closed: false },
      { tenant, status_id: taskStatus, name: 'To do', status_type: 'project_task', order_number: 1, is_closed: false },
      { tenant, status_id: doneStatus, name: 'Done', status_type: 'project_task', order_number: 2, is_closed: true },
    ]);

    const arrangement = await createCoManagedSeatArrangement(db, { sponsorTenant: tenant, clientId: ownClient, operationId: randomUUID(), seats: 3 });
    arrangementId = arrangement.arrangement_id;
    const foreignArrangement = await createCoManagedSeatArrangement(db, { sponsorTenant: tenant, clientId: otherClient, operationId: randomUUID(), seats: 1 });

    tech = await makeSeat(arrangementId);
    peer = await makeSeat(arrangementId);
    foreignTech = await makeSeat(foreignArrangement.arrangement_id);
    widened = await makeSeat(arrangementId, [['project', 'update'], ['service', 'read'], ['billing', 'read'], ['project_task', 'create'], ['project_task', 'delete']]);
    const mspStaffId = await roleFor([['project', 'read'], ['project', 'update']]);
    mspStaff = await db('users').where({ tenant, user_id: mspStaffId }).first();
    const mspId = await roleFor([
      ['project', 'read'], ['project', 'update'], ['project', 'create'], ['project_task', 'read'], ['project_task', 'update'],
      ['project_task', 'create'], ['service', 'read'], ['billing', 'read'], ['time_entry', 'read'], ['time_entry', 'create'],
    ]);
    msp = await db('users').where({ tenant, user_id: mspId }).first();

    shared = await makeProject(ownClient, 'Shared rollout', projectStatus);
    unshared = await makeProject(ownClient, 'Unshared rollout', projectStatus);
    otherClientProject = await makeProject(otherClient, 'Other client rollout', projectStatus);
    await share(shared, true);
    // The search index holds a row per project, as the indexer writes it; search reads it through the same authorization.
    for (const [project, name] of [[shared, 'Shared rollout'], [unshared, 'Unshared rollout'], [otherClientProject, 'Other client rollout']] as const) {
      await db('app_search_index').insert({
        tenant, object_type: 'project', object_id: project.projectId, title: name, url: `/msp/projects/${project.projectId}`,
        required_permission: 'project:read', search_vector: db.raw("to_tsvector('english', ?)", [name]), source_updated_at: new Date(),
      });
    }

    db.on('query', (q: { sql: string }) => { queries.push(q.sql); });
  }, 300_000);
  afterAll(async () => {
    db?.removeAllListeners('query');
    await db?.destroy();
  });
  beforeEach(() => { process.env.FORCE_CAPABILITIES = 'co-managed-seat:on'; });

  // F071
  it('lists only the shared project to a seat technician, and both of the client\'s projects to MSP staff', async () => {
    as(tech);
    const list = (await getProjects()) as any[];
    expect(list.map((p) => p.project_id)).toEqual([shared.projectId]);
    for (const row of list) expectNoClosedKey(row, 'project list row');

    const withPhases = (await getProjectsWithPhases()) as any[];
    expect(withPhases.map((p) => p.project_id)).toEqual([shared.projectId]);

    const tree = (await getProjectTreeData()) as any[];
    expect(tree.map((p) => p.value)).toEqual([shared.projectId]);

    const everyId = [shared.projectId, unshared.projectId, otherClientProject.projectId];
    expect(await authorizeProjectIds(everyId)).toEqual([shared.projectId]);
    const byIds = asRecord(await loadProjectListItemsByIds(everyId));
    expect(byIds.projects.map((p: any) => p.project_id)).toEqual([shared.projectId]);
    for (const row of byIds.projects) expectNoClosedKey(row, 'list item by id');

    as(msp);
    const mspList = ((await getProjects()) as any[]).map((p) => p.project_id);
    expect(mspList).toEqual(expect.arrayContaining([shared.projectId, unshared.projectId, otherClientProject.projectId]));
    const mspRow = ((await getProjects()) as any[]).find((p) => p.project_id === shared.projectId);
    expect(mspRow).toMatchObject({ budgeted_hours: String(BUDGET_MINUTES), billing_profile_id: profileId, service_id: serviceId });
  });

  it('finds only the shared project by search, and answers a direct id for another with nothing', async () => {
    as(tech);
    const ids = (await searchProjectListIds('rollout')) as string[];
    expect(ids).toContain(shared.projectId);
    expect(ids).not.toContain(unshared.projectId);
    expect(ids).not.toContain(otherClientProject.projectId);

    for (const hidden of [unshared, otherClientProject]) {
      expect(await getProject(hidden.projectId)).toBeNull();
      expect(await attempt(() => getProjectDetails(hidden.projectId))).toMatch(/permission denied/i);
      expect(await attempt(() => getProjectMetadata(hidden.projectId))).toMatch(/permission denied/i);
      expect(await attempt(() => getTaskById(hidden.taskId))).toMatch(/permission denied/i);
      expect(await attempt(() => getTasksForPhase(hidden.phaseId))).toMatch(/permission denied/i);
      expect(await attempt(() => getProjectTaskData(hidden.projectId))).toMatch(/permission denied/i);
      expect(await attempt(() => calculateProjectCompletion(hidden.projectId))).toMatch(/permission denied/i);
    }
  });

  // F072
  it('returns no budget, billing or rate key in the project, phase and task reads', async () => {
    as(tech);
    queries.length = 0;
    const project = asRecord(await getProject(shared.projectId));
    expect(project.project_id).toBe(shared.projectId);
    expectNoClosedKey(project, 'getProject');

    const details = asRecord(await getProjectDetails(shared.projectId));
    expect(failureOf(details)).toBeNull();
    expectNoClosedKey(details.project, 'details.project');
    expect(details.phases).toHaveLength(1);
    for (const phase of details.phases) expectNoClosedKey(phase, 'details.phase');
    expect(details.tasks).toHaveLength(1);
    for (const task of details.tasks) expectNoClosedKey(task, 'details.task');
    // Effort the technician plans and logs is not a budget or a rate.
    expect(details.tasks[0]).toHaveProperty('estimated_hours');

    const metadata = asRecord(await getProjectMetadata(shared.projectId));
    expectNoClosedKey(metadata.project, 'metadata.project');
    for (const phase of metadata.phases) expectNoClosedKey(phase, 'metadata.phase');

    expectNoClosedKey(await getProjectPhase(shared.phaseId), 'getProjectPhase');
    expectNoClosedKey(await getTaskById(shared.taskId), 'getTaskById');
    const withDetails = asRecord(await getTaskWithDetails(shared.taskId));
    expect(failureOf(withDetails)).toBeNull();
    expectNoClosedKey(withDetails, 'getTaskWithDetails');
    const forPhase = asRecord(await getTasksForPhase(shared.phaseId));
    for (const task of forPhase.tasks) expectNoClosedKey(task, 'getTasksForPhase');
    const taskData = asRecord(await getProjectTaskData(shared.projectId));
    for (const task of taskData.tasks) expectNoClosedKey(task, 'getProjectTaskData');
    const listView = asRecord(await getAllProjectTasksForListView(shared.projectId));
    for (const phase of listView.phases) expectNoClosedKey(phase, 'list view phase');
    for (const task of listView.tasks) expectNoClosedKey(task, 'list view task');

    // The metrics carry no hours derived from the budget; the keys are absent, not zero.
    const metrics = asRecord(await calculateProjectCompletion(shared.projectId));
    expect(metrics).toHaveProperty('taskCompletionPercentage');
    for (const key of ['budgetedHours', 'hoursCompletionPercentage', 'remainingHours', 'spentHours']) expect(metrics, key).not.toHaveProperty(key);

    // Nothing a payload carries holds the budget, the billing profile or the service's rate.
    const everything = JSON.stringify([project, details, metadata, withDetails, forPhase, taskData, listView]);
    expect(everything).not.toContain(profileId);
    expect(everything).not.toContain('Premium project hours');
    expect(everything).not.toContain('18500');
    expect(everything).not.toContain(String(BUDGET_MINUTES));
    expect(queries.join('\n')).not.toMatch(/service_catalog/);
  });

  it('still returns every column to MSP staff', async () => {
    as(msp);
    const details = asRecord(await getProjectDetails(shared.projectId));
    expect(details.project).toMatchObject({ budgeted_hours: String(BUDGET_MINUTES), billing_profile_id: profileId, service_id: serviceId });
    expect(details.phases[0]).toMatchObject({ service_id: serviceId });
    expect(details.tasks[0]).toMatchObject({ service_id: serviceId });
    const metrics = asRecord(await calculateProjectCompletion(shared.projectId));
    expect(metrics.budgetedHours).toBe(BUDGET_MINUTES / 60);
    expect(asRecord(await getProjectSurfaceAccess())).toEqual({ closedFields: [], closedOperations: [] });
  });

  it('loads the task form without touching the service catalog', async () => {
    for (const user of [tech, widened]) {
      as(user);
      queries.length = 0;
      // What the task form asks of the server when it opens for a seat technician.
      expect(failureOf(await getTaskWithDetails(shared.taskId))).toBeNull();
      expect(failureOf(await getProjectDetails(shared.projectId))).toBeNull();
      expect(failureOf(await getProjectTaskData(shared.projectId))).toBeNull();
      expect(queries.join('\n')).not.toMatch(/service_catalog/);

      // The lookups the form would have made are closed at the server too, whatever the role holds.
      queries.length = 0;
      expect(await attempt(() => getServices(1, 999))).toMatch(/denied/i);
      expect(await attempt(() => getEffectiveTaskService(shared.taskId))).toMatch(/denied/i);
      expect(await attempt(() => searchServiceCatalogForPicker({} as any))).toMatch(/denied/i);
      expect(await attempt(() => listProjectMaterials(shared.projectId))).toMatch(/denied/i);
      expect(queries.join('\n')).not.toMatch(/service_catalog/);
    }
    // The screen is told what is closed, as data, and nothing for MSP staff.
    as(tech);
    const surface = asRecord(await getProjectSurfaceAccess());
    expect(surface.closedFields).toEqual(['billing_profile_id', 'budgeted_hours', 'service_id']);
    expect(surface.closedOperations).toEqual(['project_billing', 'project_manage', 'project_materials', 'service_catalog']);
  });

  // F073
  it('updates a shared task\'s status and refuses it on an unshared one', async () => {
    for (const user of [tech, widened]) {
      as(user);
      const moved = asRecord(await updateTaskStatus(shared.taskId, shared.done));
      expect(failureOf(moved)).toBeNull();
      expect(moved.project_status_mapping_id).toBe(shared.done);
      expectNoClosedKey(moved, 'updateTaskStatus result');
      expect((await taskRow(shared.taskId)).project_status_mapping_id).toBe(shared.done);
      expect(failureOf(await updateTaskStatus(shared.taskId, shared.todo))).toBeNull();

      expect(await attempt(() => updateTaskStatus(unshared.taskId, unshared.done))).toMatch(/permission denied/i);
      expect(await attempt(() => updateTaskStatus(otherClientProject.taskId, otherClientProject.done))).toMatch(/permission denied/i);
      // A status of a project that is not shared is no target for a task that is.
      expect(await attempt(() => updateTaskStatus(shared.taskId, unshared.done))).not.toBeNull();
    }
    expect((await taskRow(unshared.taskId)).project_status_mapping_id).toBe(unshared.todo);
    expect((await taskRow(otherClientProject.taskId)).project_status_mapping_id).toBe(otherClientProject.todo);
    expect((await taskRow(shared.taskId)).project_status_mapping_id).toBe(shared.todo);
  });

  it('refuses a task edit that is not the status or the assignee, and a closed field', async () => {
    as(tech);
    expect(await attempt(() => updateTaskWithChecklist(shared.taskId, { task_name: 'Renamed by a technician' } as any))).toMatch(/permission denied/i);
    expect(await attempt(() => updateTaskWithChecklist(shared.taskId, { service_id: null } as any))).toMatch(/permission denied/i);
    expect(await attempt(() => updateTaskWithChecklist(shared.taskId, { estimated_hours: 1 } as any))).toMatch(/permission denied/i);
    const row = await taskRow(shared.taskId);
    expect(row.task_name).toBe('Task Shared rollout');
    expect(row.service_id).toBe(serviceId);
  });

  it('assigns a shared task to a technician of their own client, and to no one outside the projection', async () => {
    as(tech);
    const assigned = asRecord(await updateTaskWithChecklist(shared.taskId, { assigned_to: peer.user_id } as any));
    expect(failureOf(assigned)).toBeNull();
    expectNoClosedKey(assigned, 'updateTaskWithChecklist result');
    expect((await taskRow(shared.taskId)).assigned_to).toBe(peer.user_id);
    expect(failureOf(await updateTaskWithChecklist(shared.taskId, { assigned_to: tech.user_id } as any))).toBeNull();

    for (const outsider of [mspStaff, foreignTech, msp]) {
      const failure = await attempt(() => updateTaskWithChecklist(shared.taskId, { assigned_to: outsider.user_id } as any));
      expect(failure, `assignment to ${outsider.user_id === mspStaff.user_id ? 'MSP staff' : 'someone outside'}`).toMatch(/permission denied|not eligible|cannot be assigned|invalid/i);
    }
    expect((await taskRow(shared.taskId)).assigned_to).toBe(tech.user_id);

    // The same assignment on a task of an unshared project, to a technician of their own client, is refused.
    expect(await attempt(() => updateTaskWithChecklist(unshared.taskId, { assigned_to: peer.user_id } as any))).toMatch(/permission denied/i);
    expect((await taskRow(unshared.taskId)).assigned_to).toBeNull();

    // An additional agent follows the same rule.
    expect(failureOf(await addTaskResourcesAction(shared.taskId, [peer.user_id]))).toBeNull();
    expect(await attempt(() => addTaskResourcesAction(shared.taskId, [mspStaff.user_id]))).toMatch(/permission denied/i);
    expect(await attempt(() => addTaskResourcesAction(unshared.taskId, [peer.user_id]))).toMatch(/permission denied/i);
    expect(await db('task_resources').where({ tenant, task_id: unshared.taskId }).count('* as n').first().then((r) => Number(r!.n))).toBe(0);
  });

  it('refuses to give an unshared project\'s task to a technician at all (the assignee guard)', async () => {
    // MSP staff assigning a seat technician to work they have not been given: the human-work guard refuses it.
    as(msp);
    expect(await attempt(() => updateTaskWithChecklist(unshared.taskId, { assigned_to: tech.user_id } as any))).not.toBeNull();
    expect(await attempt(() => updateTaskWithChecklist(shared.taskId, { assigned_to: foreignTech.user_id } as any))).not.toBeNull();
    expect(failureOf(await updateTaskWithChecklist(shared.taskId, { assigned_to: tech.user_id } as any))).toBeNull();
  });

  it('comments with an audience on a shared task, stores it, and refuses an unshared task and a missing audience', async () => {
    as(tech);
    const note = (text: string) => JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text }] }]);

    const sharedItId = await createTaskComment({ taskId: shared.taskId, note: note('Shared IT note'), audience: 'shared_it' } as any);
    expect(typeof sharedItId).toBe('string');
    const requesterId = await createTaskComment({ taskId: shared.taskId, note: note('Requester visible note'), audience: 'requester' } as any);
    expect(typeof requesterId).toBe('string');

    const stored = async (commentId: string) => {
      const row = await db('project_task_comments as c').join('comment_threads as t', function join() {
        this.on('t.tenant', 'c.tenant').andOn('t.thread_id', 'c.thread_id');
      }).where({ 'c.tenant': tenant, 'c.task_comment_id': commentId }).first('t.collaboration_audience', 't.is_internal', 'c.user_id', 'c.thread_id');
      return { ...row, audience: resolveCommentAudience(row) };
    };
    expect(await stored(sharedItId as string)).toMatchObject({ audience: 'shared_it', is_internal: true, user_id: tech.user_id });
    expect(await stored(requesterId as string)).toMatchObject({ audience: 'requester', is_internal: false, user_id: tech.user_id });

    // A reply inherits its thread's audience.
    const replyId = await createTaskComment({ taskId: shared.taskId, note: note('Reply'), parent_comment_id: sharedItId } as any);
    expect(typeof replyId).toBe('string');
    expect((await stored(replyId as string)).audience).toBe('shared_it');

    // Not an audience a technician may write, no audience, and an unshared or other client's task.
    expect(await attempt(() => createTaskComment({ taskId: shared.taskId, note: note('x'), audience: 'organization_private' } as any))).toMatch(/denied/i);
    expect(await attempt(() => createTaskComment({ taskId: shared.taskId, note: note('x') } as any))).toMatch(/denied/i);
    for (const hidden of [unshared, otherClientProject]) {
      expect(await attempt(() => createTaskComment({ taskId: hidden.taskId, note: note('x'), audience: 'shared_it' } as any))).toMatch(/not found|denied/i);
    }
    expect(await db('project_task_comments').where({ tenant, task_id: unshared.taskId }).count('* as n').first().then((r) => Number(r!.n))).toBe(0);

    // The technician reads what they wrote; MSP staff read it too; the technician is never shown a private thread.
    const own = asRecord(await getTaskComments(shared.taskId)) as any[];
    expect(own.map((c) => c.taskCommentId)).toEqual(expect.arrayContaining([sharedItId, requesterId, replyId]));
    expect(await attempt(() => getTaskComments(unshared.taskId))).toMatch(/not found|denied/i);

    as(msp);
    const mspSees = (await getTaskComments(shared.taskId)) as any[];
    expect(mspSees.map((c) => c.taskCommentId)).toEqual(expect.arrayContaining([sharedItId, requesterId, replyId]));

    // MSP-private notes (organization_private) on the task are not visible to the technician.
    const privateThread = randomUUID(); const privateComment = randomUUID();
    await db('comment_threads').insert({
      tenant, thread_id: privateThread, ticket_id: null, project_task_id: shared.taskId, root_comment_id: privateComment,
      is_internal: true, collaboration_audience: 'organization_private', reply_count: 0, created_by: msp.user_id,
    });
    await db('project_task_comments').insert({
      tenant, task_comment_id: privateComment, task_id: shared.taskId, thread_id: privateThread, user_id: msp.user_id,
      author_type: 'internal', note: note('MSP only'), markdown_content: 'MSP only',
    });
    expect(((await getTaskComments(shared.taskId)) as any[]).map((c) => c.taskCommentId)).toContain(privateComment);
    as(tech);
    expect(((await getTaskComments(shared.taskId)) as any[]).map((c) => c.taskCommentId)).not.toContain(privateComment);
  });

  it('logs operational time on a shared task, stored as operational, and refuses an unshared task', async () => {
    as(tech);
    const entry = (taskId: string) => ({
      work_item_id: taskId, work_item_type: 'project_task', notes: 'Rolled out the switch', user_id: tech.user_id,
      start_time: '2026-11-02T14:00:00.000Z', end_time: '2026-11-02T15:30:00.000Z',
      created_at: '2026-11-02T15:30:00.000Z', updated_at: '2026-11-02T15:30:00.000Z',
      billable_duration: 90, approval_status: 'DRAFT',
    }) as any;

    const saved = asRecord(await saveTimeEntry(entry(shared.taskId)));
    expect(failureOf(saved)).toBeNull();
    const row = await db('time_entries').where({ tenant, work_item_id: shared.taskId, user_id: tech.user_id }).first();
    expect(row).toBeTruthy();
    expect(row.billing_mode).toBe('operational');
    expect(row.service_id ?? null).toBeNull();
    expect(row.contract_line_id ?? null).toBeNull();
    expect(Number(row.billable_duration ?? 0)).toBe(0);

    // Editing the entry stays on the shared task and stays operational.
    expect(failureOf(await saveTimeEntry({ ...entry(shared.taskId), entry_id: row.entry_id, notes: 'Edited' }))).toBeNull();

    for (const hidden of [unshared, otherClientProject]) {
      // A new entry on a task of a project that is not shared is refused (by the human-work guard, for the owner named).
      expect(await attempt(() => saveTimeEntry(entry(hidden.taskId)))).toMatch(/permission denied|cannot be assigned/i);
      expect(await db('time_entries').where({ tenant, work_item_id: hidden.taskId }).count('* as n').first().then((r) => Number(r!.n))).toBe(0);
    }
    // A technician cannot ask for billable time: a commercial field is refused, not dropped.
    expect(await attempt(() => saveTimeEntry({ ...entry(shared.taskId), service_id: serviceId }))).not.toBeNull();
    expect(await db('time_entries').where({ tenant, work_item_id: shared.taskId, billing_mode: 'commercial' }).count('* as n').first().then((r) => Number(r!.n))).toBe(0);

    // After unsharing, the entry the technician logged can no longer be edited through the task either.
    await share(shared, false);
    expect(await attempt(() => saveTimeEntry({ ...entry(shared.taskId), entry_id: row.entry_id, notes: 'Edited after unshare' }))).toMatch(/permission denied/i);
    await share(shared, true);
  });

  it('shares and unshares idempotently, and unsharing removes visibility at once', async () => {
    const revision = async () => Number((await db('co_managed_seat_arrangements').where({ tenant, arrangement_id: arrangementId }).first('revision')).revision);
    const grants = async () => Number((await db('co_managed_seat_project_grants').where({ tenant, arrangement_id: arrangementId, project_id: unshared.projectId }).count('* as n').first())!.n);

    as(tech);
    expect(((await getProjects()) as any[]).map((p) => p.project_id)).not.toContain(unshared.projectId);
    const before = await revision();

    expect(await share(unshared, true)).toEqual({ projectId: unshared.projectId, shared: true, changed: true });
    expect(await share(unshared, true)).toEqual({ projectId: unshared.projectId, shared: true, changed: false });
    expect(await grants()).toBe(1);
    expect(await revision()).toBe(before + 1);

    // The very next request sees it, with nothing cached.
    expect(((await getProjects()) as any[]).map((p) => p.project_id)).toEqual(expect.arrayContaining([shared.projectId, unshared.projectId]));
    expect(failureOf(await updateTaskStatus(unshared.taskId, unshared.done))).toBeNull();
    expect(failureOf(await updateTaskStatus(unshared.taskId, unshared.todo))).toBeNull();
    const options = await readCoManagedSeatProjectShares(db, { sponsorTenant: tenant, arrangementId });
    expect(options.map((o) => [o.projectName, o.shared])).toEqual([['Shared rollout', true], ['Unshared rollout', true]]);

    expect(await share(unshared, false)).toEqual({ projectId: unshared.projectId, shared: false, changed: true });
    expect(await share(unshared, false)).toEqual({ projectId: unshared.projectId, shared: false, changed: false });
    expect(await grants()).toBe(0);
    expect(await revision()).toBe(before + 2);

    // Gone from the very next request: lists, direct reads and writes.
    expect(((await getProjects()) as any[]).map((p) => p.project_id)).toEqual([shared.projectId]);
    expect(await getProject(unshared.projectId)).toBeNull();
    expect(await attempt(() => getTaskById(unshared.taskId))).toMatch(/permission denied/i);
    expect(await attempt(() => updateTaskStatus(unshared.taskId, unshared.done))).toMatch(/permission denied/i);
    expect(await attempt(() => saveTimeEntry({
      work_item_id: unshared.taskId, work_item_type: 'project_task', notes: 'n', user_id: tech.user_id,
      start_time: '2026-11-03T14:00:00.000Z', end_time: '2026-11-03T15:00:00.000Z', created_at: '2026-11-03T15:00:00.000Z',
      updated_at: '2026-11-03T15:00:00.000Z', billable_duration: 60, approval_status: 'DRAFT',
    } as any))).toMatch(/permission denied|cannot be assigned/i);
  });

  it('shares only a project of the arrangement\'s client, and refuses an ended or unknown arrangement', async () => {
    await expect(share(otherClientProject, true)).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
    await expect(setCoManagedSeatProjectShared(db, { sponsorTenant: tenant, arrangementId, projectId: randomUUID(), shared: true }))
      .rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
    await expect(setCoManagedSeatProjectShared(db, { sponsorTenant: tenant, arrangementId: randomUUID(), projectId: shared.projectId, shared: true }))
      .rejects.toMatchObject({ code: 'ARRANGEMENT_NOT_FOUND' });
    await expect(setCoManagedSeatProjectShared(db, { sponsorTenant: tenant, arrangementId, projectId: 'not-a-uuid', shared: true }))
      .rejects.toMatchObject({ code: 'INVALID_PROJECT_GRANT' });
    expect(await db('co_managed_seat_project_grants').where({ tenant, project_id: otherClientProject.projectId }).count('* as n').first().then((r) => Number(r!.n))).toBe(0);
    // Unsharing needs no project to exist.
    expect((await setCoManagedSeatProjectShared(db, { sponsorTenant: tenant, arrangementId, projectId: randomUUID(), shared: false })).changed).toBe(false);
  });

  it('keeps the seat\'s authority with the release capability off, and leaves MSP staff untouched', async () => {
    // Revoking the seat grants nothing, whatever the capability says: authority is read from the rows.
    process.env.FORCE_CAPABILITIES = 'co-managed-seat:off';
    as(tech);
    expect(((await getProjects()) as any[]).map((p) => p.project_id)).toEqual([shared.projectId]);
    expectNoClosedKey(await getProject(shared.projectId), 'flag off getProject');
    as(msp);
    expect(((await getProjects()) as any[]).length).toBeGreaterThanOrEqual(3);
    expect(asRecord(await getProject(shared.projectId))).toMatchObject({ budgeted_hours: String(BUDGET_MINUTES) });
  });
});
