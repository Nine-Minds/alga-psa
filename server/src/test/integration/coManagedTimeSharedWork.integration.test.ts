/**
 * L6a2: shared-work stopwatch and time billing profile, against real rows in a migrated Postgres
 * (connectL3cDb: set TEST_DB_NAME and L3C_DB_PORT to point at an already migrated database).
 * The fixture is an accepted relationship from the L3c onboarding seeds plus a customer ticket escalated
 * through the real handoff. Authentication is the only substitution: the acting user/session is switched per call.
 */
import { afterAll, afterEach, beforeAll, describe, vi } from 'vitest';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { tenantDb } from '@alga-psa/db';

const actor = vi.hoisted(() => ({ user: null as any, session: null as any }));
const dbRef = vi.hoisted(() => ({ db: null as any }));
vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({ getAppSecret: async () => undefined, getTenantSecret: async () => undefined }),
  getSecret: async (_n: string, e?: string, f = '') => (e ? process.env[e] : undefined) ?? f,
}));
vi.mock('@alga-psa/db', async importOriginal => {
  const real = await importOriginal<typeof import('@alga-psa/db')>();
  return { ...real, getConnection: async () => dbRef.db, getAdminConnection: async () => dbRef.db,
    createTenantKnex: async (tenant?: string) => ({ knex: dbRef.db, tenant: tenant ?? actor.user?.tenant }) };
});
vi.mock('@alga-psa/auth', async importOriginal => {
  const real = await importOriginal<typeof import('@alga-psa/auth')>();
  return { ...real, withAuth: (handler: any) => (...args: any[]) => handler(actor.user, { tenant: actor.user.tenant }, ...args),
    getSession: async () => actor.session, getApiKeyUserOverride: () => null };
});

import { configureL3cDbEnv, connectL3cDb, seedL3cWorld, seedL3cProject, shareProject, cleanupL3cTenants, type L3cWorld } from './helpers/coManagedL3cFixture';
import { buildTimeFixture, type Session } from './helpers/coManagedTimeFixture';
import { registerCoManagedSharedStopwatchTests } from './helpers/coManagedSharedStopwatchCases';
import { registerCoManagedTimeBillingProfileTests } from './helpers/coManagedTimeBillingProfileCases';
import { registerCoManagedTimeSource } from '../../lib/co-managed/timeSource';
import { registerCoManagedTimeEntryWorkContributor } from '../../lib/co-managed/timeWorkContext';
import { registerFeatureFlagChecker } from '../../../../packages/core/src/lib/features';
import { clearCapabilityCache } from '../../../../packages/core/src/capability/testing';
import { assignCoManagedProjectTask } from '../../../../packages/co-managed/src/projectTaskAssignments';

let db: Knex;
const tenants: string[] = [];

beforeAll(async () => {
  configureL3cDbEnv();
  process.env.CAPABILITY_CACHE_TTL_MS = '0';
  db = await connectL3cDb();
  dbRef.db = db;
  registerFeatureFlagChecker(async () => true);
  // What server instrumentation registers at boot.
  registerCoManagedTimeSource();
  registerCoManagedTimeEntryWorkContributor();
}, 180_000);

afterEach(() => { clearCapabilityCache(); });
afterAll(async () => { await cleanupL3cTenants(tenants); await db?.destroy().catch(() => undefined); });

const hooks = {
  actAs: (user: any, session: Session) => {
    actor.user = user;
    actor.session = { session_id: session.sessionId, user: { id: user.user_id, tenant: user.tenant, user_type: user.user_type } };
  },
  loadUser: async (session: Session) => tenantDb(db, session.tenant).table('users').where('user_id', session.userId).first(),
};

async function world(): Promise<{ world: L3cWorld; base: Parameters<typeof buildTimeFixture>[1] }> {
  const w = await seedL3cWorld(db);
  tenants.push(...w.tenants);
  const escalationBoardId = randomUUID();
  await tenantDb(db, w.sponsor).table('boards').insert({ tenant: w.sponsor, board_id: escalationBoardId, board_name: 'Escalations', is_inactive: false });
  await tenantDb(db, w.customer).table('co_management_relationships').where('relationship_id', w.relationshipId).update({ escalation_board_id: escalationBoardId });
  const customerAdmin: Session = { kind: 'session', tenant: w.customer, userId: w.customerStaff.userId, sessionId: w.customerStaff.sessionId };
  return { world: w, base: { sponsorTenant: w.sponsor, customerTenant: w.customer, relationshipId: w.relationshipId,
    sponsorClientId: w.sponsorClientId, escalationBoardId, customerAdmin } };
}

async function withTime(work: (f: any) => Promise<void>) {
  const { base } = await world();
  const f = await buildTimeFixture(db, base, hooks);
  await work(f);
}

async function withTask(work: (f: any) => Promise<void>) {
  const { world: w, base } = await world();
  const f: any = await buildTimeFixture(db, base, hooks);
  const project = await seedL3cProject(db, w, 'Billable project', ['shared task']);
  await shareProject(db, w, project.projectId, true);
  const taskId = project.taskIds[0];
  const resource = { kind: 'project_task' as const, tenant: w.customer, relationshipId: w.relationshipId, id: taskId };
  // The MSP-local task routing row is written when the technician takes the task.
  await assignCoManagedProjectTask(db, f.principal as any,
    resource, { assignee: { kind: 'user', id: f.principal.userId }, expectedRevision: null });
  // The task routing row is bound to the client of the MSP workspace; give the technician the staff assignment the fixture user already has.
  f.resource = resource;
  await work(f);
}

describe.sequential('L6a2 shared-work stopwatch', () => {
  registerCoManagedSharedStopwatchTests(() => db, withTime);
});

describe.sequential('L6a2 shared-work time billing profile', () => {
  registerCoManagedTimeBillingProfileTests(() => db, withTime, withTask);
});
