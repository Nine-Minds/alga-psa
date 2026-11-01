/**
 * CM L3c neutrality of native hot paths (A5, PLAN §2-3).
 *  - A PSA tenant's project search, task update and board comment-count batch issue 0 extra statements compared
 *    with the capability forced off (the kill switch never touches the database).
 *  - A participating tenant with the release flag off is still served (serves is sticky, PLAN §2).
 *  - The board comment-count action counts past the old 1000-task cap for a co_managed workspace.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { configureL3cDbEnv, connectL3cDb, seedL3cWorld, seedL3cProject, cleanupL3cTenants, type L3cWorld, type L3cProject } from './helpers/coManagedL3cFixture';

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({ getAppSecret: async () => undefined, getTenantSecret: async () => undefined }),
  getSecret: async (_n: string, e?: string, f = '') => (e ? process.env[e] : undefined) ?? f,
}));

const session = vi.hoisted(() => ({ tenant: '', userId: '', sessionId: '' }));
const knexHolder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@alga-psa/auth', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  withAuth: (action: (...a: any[]) => Promise<unknown>) => (...args: unknown[]) =>
    action({ user_id: session.userId, tenant: session.tenant, user_type: 'internal' }, { tenant: session.tenant }, ...args),
  getSession: async () => ({ session_id: session.sessionId, user: { id: session.userId, tenant: session.tenant, user_type: 'internal' } }),
  getApiKeyUserOverride: () => null,
}));
vi.mock('@alga-psa/auth/rbac', async importOriginal => ({ ...(await importOriginal<Record<string, unknown>>()), hasPermission: async () => true }));
vi.mock('@alga-psa/db', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createTenantKnex: async () => ({ knex: knexHolder.db, tenant: session.tenant }),
}));

import { editCoManagedProjectTaskAction, assignCoManagedProjectTaskAction } from '../../lib/actions/coManagedProjectTaskActions';
import { shareProject } from './helpers/coManagedL3cFixture';
import { getTaskCommentCountsBatch } from '@alga-psa/projects/actions/projectTaskCommentActions';
import { ProjectTaskModel } from '@alga-psa/projects/models';
import { withProjectSearchAccess } from '@alga-psa/search/projectSearchAccess';
import { serves } from '@alga-psa/core/capability';
import { clearCapabilityCache } from '@alga-psa/core/capability/testing';
import { resetCoManagedWorkspaceCache } from '@alga-psa/co-managed/coManagedWorkspace';

const FLAG_ENV = 'FEATURE_FLAG_TENANTS__RELEASE_V2_0_FEATURE';
const originalEnv = { force: process.env.FORCE_CAPABILITIES, flag: process.env[FLAG_ENV] };
let db: Knex;
let world: L3cWorld;
let psaTask: L3cProject;
let big: L3cProject;
const TASKS = 1100;

/** Counts every statement the connection pool issues while `work` runs. */
async function statements(work: () => Promise<unknown>): Promise<number> {
  let n = 0;
  const listener = () => { n++; };
  db.on('query', listener);
  try { await work(); } finally { db.removeListener('query', listener); }
  return n;
}

/** Runs `work` once to warm caches, then returns (normal, killSwitch) statement counts. */
async function compareToKillSwitch(work: () => Promise<unknown>) {
  await work();
  const normal = await statements(work);
  process.env.FORCE_CAPABILITIES = 'co-managed:off';
  try { await work(); var off = await statements(work); } finally { delete process.env.FORCE_CAPABILITIES; }
  return { normal, off };
}

describe('CM L3c native-path neutrality and board comment counts', () => {
  beforeAll(async () => {
    configureL3cDbEnv();
    delete process.env.FORCE_CAPABILITIES;
    db = await connectL3cDb();
    knexHolder.db = db;
    world = await seedL3cWorld(db);
    // A native PSA project/task in the sponsor tenant.
    const sponsorStatusId = uuidv4();
    await db('statuses').insert({ tenant: world.sponsor, status_id: sponsorStatusId, name: 'Open', status_type: 'project', item_type: 'project', order_number: 1 });
    psaTask = await seedL3cProject(db, { ...world, customer: world.sponsor, customerClientId: world.sponsorClientId, statusId: sponsorStatusId } as L3cWorld, 'Native PSA project', ['native']);

    big = await seedL3cProject(db, world, 'Big board', []);
    const { rows } = await db.raw(
      `INSERT INTO project_tasks (tenant, phase_id, task_name, wbs_code)
       SELECT ?::uuid, ?::uuid, 'Bulk ' || g, '900.1.' || g FROM generate_series(1, ?) g RETURNING task_id`,
      [world.customer, big.phaseId, TASKS]);
    big.taskIds = rows.map((r: { task_id: string }) => r.task_id);
    for (let i = 0; i < big.taskIds.length; i += 400) {
      const chunk = big.taskIds.slice(i, i + 400).map(taskId => ({ taskId, commentId: uuidv4(), threadId: uuidv4() }));
      await db('comment_threads').insert(chunk.map(c => ({ tenant: world.customer, thread_id: c.threadId, project_task_id: c.taskId, root_comment_id: c.commentId })));
      await db('project_task_comments').insert(chunk.map(c => ({ tenant: world.customer, task_comment_id: c.commentId, task_id: c.taskId,
        user_id: world.customerStaff.userId, note: 'hi', thread_id: c.threadId })));
    }
  }, 300_000);

  afterEach(() => {
    for (const [key, value] of [['FORCE_CAPABILITIES', originalEnv.force], [FLAG_ENV, originalEnv.flag]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    clearCapabilityCache();
    resetCoManagedWorkspaceCache();
  });

  afterAll(async () => {
    await cleanupL3cTenants(world?.tenants ?? []);
    await db?.destroy().catch(() => undefined);
  });

  it('board comment counts for a co_managed workspace cover tasks past index 1000', async () => {
    Object.assign(session, { tenant: world.customer, userId: world.customerStaff.userId, sessionId: world.customerStaff.sessionId });
    const counts = await getTaskCommentCountsBatch(big.taskIds) as Record<string, number>;
    expect(Object.keys(counts).length).toBe(TASKS);
    for (const index of [0, 999, 1000, 1050, TASKS - 1]) expect(counts[big.taskIds[index]]).toBe(1);
  });

  it('PSA tenant: board comment-count batch issues 0 extra statements', async () => {
    Object.assign(session, { tenant: world.sponsor, userId: world.technician.userId, sessionId: world.technician.sessionId });
    const { normal, off } = await compareToKillSwitch(() => getTaskCommentCountsBatch([psaTask.taskIds[0]]));
    expect(normal).toBe(off);
    expect(normal).toBeGreaterThan(0);
  });

  it('PSA tenant: project search issues 0 extra statements', async () => {
    const user = { user_id: world.technician.userId, tenant: world.sponsor, user_type: 'internal' } as never;
    const work = () => withProjectSearchAccess(db, world.sponsor, user, async () => undefined,
      async knex => knex('project_tasks').where({ tenant: world.sponsor }).count({ n: '*' }));
    const { normal, off } = await compareToKillSwitch(work);
    expect(normal).toBe(off);
  });

  it('PSA tenant: native task update issues 0 extra statements', async () => {
    const work = () => ProjectTaskModel.updateTask(db, world.sponsor, psaTask.taskIds[0], { task_name: 'native rename' });
    const { normal, off } = await compareToKillSwitch(work);
    expect(normal).toBe(off);
    expect((await db('project_tasks').where({ tenant: world.sponsor, task_id: psaTask.taskIds[0] }).first()).task_name).toBe('native rename');
  });

  it('participating tenant with release-v2-0-feature off is still served (PLAN §2: serves is sticky)', async () => {
    // Authoritative flag targeting naming some other tenant: the flag is OFF for everyone else.
    process.env[FLAG_ENV] = uuidv4();
    clearCapabilityCache();
    expect((await serves('co-managed', world.sponsor)).served).toBe(true);
    expect((await serves('co-managed', world.customer)).served).toBe(true);
    // ...and the kill switch still wins.
    process.env.FORCE_CAPABILITIES = 'co-managed:off';
    clearCapabilityCache();
    expect((await serves('co-managed', world.sponsor)).served).toBe(false);
  });

  it('edit action maps a stale write to a structured CONFLICT with a snapshot, and denials to opaque errors', async () => {
    Object.assign(session, { tenant: world.sponsor, userId: world.technician.userId, sessionId: world.technician.sessionId });
    const project = await seedL3cProject(db, world, 'Action project', ['a']);
    await shareProject(db, world, project.projectId, true);
    const id = project.taskIds[0];
    const assigned = await assignCoManagedProjectTaskAction(world.customer, world.relationshipId, id,
      { operationId: uuidv4(), expectedRevision: null, assignee: { kind: 'user', id: world.technician.userId } });
    expect(assigned).toMatchObject({ success: true });
    const stale = await editCoManagedProjectTaskAction(world.customer, world.relationshipId, id,
      { operationId: uuidv4(), expectedRevision: 99, expectedTaskUpdatedAt: new Date().toISOString(), patch: { task_name: 'x' } });
    expect(stale).toMatchObject({ success: false, error: 'CONFLICT', reason: 'revision' });
    expect((stale as { snapshot?: { revision: number } }).snapshot?.revision).toBe(1);
    const invalid = await editCoManagedProjectTaskAction(world.customer, world.relationshipId, id,
      { operationId: uuidv4(), expectedRevision: 1, expectedTaskUpdatedAt: new Date().toISOString(), patch: { bogus: 1 } as never });
    expect(invalid).toEqual({ success: false, error: 'INVALID' });
    const hidden = await editCoManagedProjectTaskAction(world.customer, world.relationshipId, uuidv4(),
      { operationId: uuidv4(), expectedRevision: 1, expectedTaskUpdatedAt: new Date().toISOString(), patch: { task_name: 'x' } });
    expect(hidden).toEqual({ success: false, error: 'NOT_FOUND' });
  });
});
