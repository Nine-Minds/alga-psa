/**
 * Search matching runs against PostgreSQL's text search operators and a real app_search_index.
 * Run from the repository root: node scripts/run-workspace-db-tests.mjs ../packages/projects/src/actions/projectActions.searchRedaction.db.test.ts
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import knexLib, { type Knex } from 'knex';

const testState = vi.hoisted(() => ({
  trx: null as any,
  tenant: '',
  user: { user_id: '', user_type: 'internal', roles: [] as unknown[] } as Record<string, unknown>,
  decisions: new Map<string, { allowed: boolean; redactedFields: string[] }>(),
}));

vi.mock('@alga-psa/db', async () => ({
  ...(await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db')),
  createTenantKnex: vi.fn(async () => ({ knex: testState.trx })),
  withTransaction: vi.fn(async (_db: unknown, callback: (trx: Knex.Transaction) => Promise<unknown>) => testState.trx.transaction(callback)),
}));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: unknown[]) => fn(testState.user, { tenant: testState.tenant }, ...args),
  withOptionalAuth: (fn: any) => (...args: unknown[]) => fn(testState.user, { tenant: testState.tenant }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('../lib/projectReadAuthorization', () => ({
  createProjectReadAuthorizer: async () => async (project: { project_id?: string }) => testState.decisions.get(project.project_id ?? '') ?? { allowed: true, redactedFields: [] },
}));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: vi.fn(), publishWorkflowEvent: vi.fn(async () => undefined) }));

import { searchProjectListIds } from './projectActions';
import { createInventoryTestTenant, getInventoryTestDatabaseConnection } from '../../../inventory/src/test-utils/inventoryTestDatabase';

const databaseConnection = getInventoryTestDatabaseConnection();
let knex: Knex;
let tenant: string;
let userId: string;
let clientId: string;
let statusId: string;

beforeAll(async () => {
  knex = knexLib({ client: 'pg', connection: databaseConnection, pool: { min: 1, max: 4 } });
  tenant = await createInventoryTestTenant(knex);
  testState.tenant = tenant;
  userId = (await knex('users').where({ tenant }).first()).user_id;
  clientId = (await knex('clients').where({ tenant }).first()).client_id;
  statusId = (await knex('statuses').where({ tenant }).first()).status_id;
});

afterAll(async () => { await knex?.destroy(); });

beforeEach(async () => {
  testState.trx = await knex.transaction();
  testState.user = { user_id: userId, user_type: 'internal', roles: [] };
  testState.decisions.clear();
});

afterEach(async () => {
  if (testState.trx) await testState.trx.rollback();
  testState.trx = null;
});

const makeProject = async (name: string, number: string) => {
  const projectId = randomUUID();
  await testState.trx('projects').insert({
    tenant, project_id: projectId, project_name: name, client_id: clientId, status: statusId,
    wbs_code: projectId.slice(0, 8), project_number: number,
  });
  return projectId;
};

const addIndexEntry = async (entry: {
  type: string; id: string; parentId: string | null; title: string; subtitle?: string | null; body?: string | null; metadata?: object;
}) => {
  const text = [entry.title, entry.subtitle, entry.body].filter(Boolean).join(' ');
  await testState.trx('app_search_index').insert({
    tenant, object_type: entry.type, object_id: entry.id, parent_type: entry.type === 'project' ? null : 'project',
    parent_id: entry.parentId, title: entry.title, subtitle: entry.subtitle ?? null, body: entry.body ?? null,
    url: '/msp/projects/' + (entry.parentId ?? entry.id), metadata: entry.metadata ?? {},
    visible_to_user_ids: [], visible_to_roles: [], is_internal_only: false, is_private: false,
    client_scope_id: clientId, required_permission: 'project:read', search_vector: knex.raw("to_tsvector('english', ?)", [text]),
    source_updated_at: new Date(),
  });
};

describe('project list search respects effective redacted fields', () => {
  it('does not return a project for its hidden name or fragment copied into project, phase, task, or comment entries', async () => {
    const name = 'Project Nacre-9162 Lantern';
    const projectId = await makeProject(name, 'PRJ-9162');
    const phaseId = randomUUID();
    const taskId = randomUUID();
    await testState.trx('project_phases').insert({
      tenant, phase_id: phaseId, project_id: projectId, phase_name: 'Planning milestone', status: 'open',
      order_number: 1, wbs_code: 'phase-1',
    });
    await testState.trx('project_tasks').insert({ tenant, task_id: taskId, phase_id: phaseId, task_name: 'Review shipment', description: 'Needlewood visible task notes', wbs_code: 'task-1' });
    await addIndexEntry({ type: 'project', id: projectId, parentId: null, title: name, body: `Notes for ${name}`, metadata: { identifier: 'Nacre-9162' } });
    await addIndexEntry({ type: 'project_phase', id: phaseId, parentId: projectId, title: `Planning for ${name}`, subtitle: name });
    await addIndexEntry({ type: 'project_task', id: taskId, parentId: projectId, title: `Review ${name}`, subtitle: name });
    await addIndexEntry({ type: 'project_task_comment', id: randomUUID(), parentId: taskId, title: `Review ${name}`, subtitle: name, body: `Comment copied ${name}` });
    testState.decisions.set(projectId, { allowed: true, redactedFields: ['projects.project_name'] });

    expect(await searchProjectListIds(name)).not.toContain(projectId);
    expect(await searchProjectListIds('Nacre-9162')).not.toContain(projectId);
    expect(await searchProjectListIds('PRJ-9162')).toContain(projectId);
    expect(await searchProjectListIds('Needlewood')).toContain(projectId);
  });

  it('does not match stale indexed names after a rename, redacted descriptions, or comments denied by any parent redaction', async () => {
    const renamedId = await makeProject('Current Alder Portfolio', 'PRJ-9170');
    const descriptionHiddenId = await makeProject('Visible description project', 'PRJ-9171');
    await testState.trx('projects').where({ tenant, project_id: descriptionHiddenId }).update({ description: 'HarborVault description source' });
    const taskId = randomUUID();
    const phaseId = randomUUID();
    await testState.trx('project_phases').insert({ tenant, phase_id: phaseId, project_id: renamedId, phase_name: 'Current phase', status: 'open', order_number: 1, wbs_code: 'phase-2' });
    await testState.trx('project_tasks').insert({ tenant, task_id: taskId, phase_id: phaseId, task_name: 'Current task', wbs_code: 'task-2' });
    await addIndexEntry({ type: 'project', id: renamedId, parentId: null, title: 'Project Nacre-9162 Lantern', body: 'Old Nacre-9162 notes' });
    await addIndexEntry({ type: 'project_phase', id: phaseId, parentId: renamedId, title: 'Old phase Project Nacre-9162 Lantern', subtitle: 'Project Nacre-9162 Lantern' });
    await addIndexEntry({ type: 'project_task', id: taskId, parentId: renamedId, title: 'Old task Project Nacre-9162 Lantern', subtitle: 'Project Nacre-9162 Lantern' });
    await addIndexEntry({ type: 'project', id: descriptionHiddenId, parentId: null, title: 'Visible description project', body: 'HarborVault description source' });
    await addIndexEntry({ type: 'project_task_comment', id: randomUUID(), parentId: taskId, title: 'Current task', body: 'CommentVault inaccessible comment text' });
    testState.decisions.set(renamedId, { allowed: true, redactedFields: ['project_name'] });
    testState.decisions.set(descriptionHiddenId, { allowed: true, redactedFields: ['projects.description'] });

    expect(await searchProjectListIds('Project Nacre-9162 Lantern')).not.toContain(renamedId);
    expect(await searchProjectListIds('Nacre-9162')).not.toContain(renamedId);
    expect(await searchProjectListIds('HarborVault')).not.toContain(descriptionHiddenId);
    expect(await searchProjectListIds('CommentVault')).not.toContain(renamedId);
    expect(await searchProjectListIds('Alder')).not.toContain(renamedId);
  });

  it('keeps visible project numbers and child text searchable, while excluding denied and wholly redacted projects', async () => {
    const visibleId = await makeProject('Visible rollout', 'PRJ-9163');
    const deniedId = await makeProject('Denied rollout', 'PRJ-9164');
    const wholeRedactedId = await makeProject('Whole hidden rollout', 'PRJ-9165');
    const visiblePhaseId = randomUUID();
    await testState.trx('project_phases').insert({
      tenant, phase_id: visiblePhaseId, project_id: visibleId, phase_name: 'Operations milestone',
      description: 'Needlewood commissioning notes', status: 'open', order_number: 1, wbs_code: 'phase-visible',
    });
    await addIndexEntry({ type: 'project', id: visibleId, parentId: null, title: 'Visible rollout' });
    await addIndexEntry({ type: 'project_phase', id: visiblePhaseId, parentId: visibleId, title: 'Operations milestone', body: 'Needlewood commissioning notes' });
    await addIndexEntry({ type: 'project', id: deniedId, parentId: null, title: 'Denied rollout' });
    await addIndexEntry({ type: 'project', id: wholeRedactedId, parentId: null, title: 'Whole hidden rollout' });
    testState.decisions.set(deniedId, { allowed: false, redactedFields: [] });
    testState.decisions.set(wholeRedactedId, { allowed: true, redactedFields: ['*'] });

    expect(await searchProjectListIds('PRJ-9163')).toContain(visibleId);
    expect(await searchProjectListIds('Needlewood')).toContain(visibleId);
    expect(await searchProjectListIds('PRJ-9164')).not.toContain(deniedId);
    expect(await searchProjectListIds('PRJ-9165')).not.toContain(wholeRedactedId);
  });
});
