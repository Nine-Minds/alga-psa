/**
 * Shared fixture for the CM L3c (shared projects & tasks) DB-backed integration tests.
 *
 * One world per test file: a PSA sponsor (the MSP), a co_managed customer workspace, an active
 * relationship with a live entitlement + allocation, MSP staff assignments, and customer projects
 * in different sharing states. Tenants are provisioned through the real onboarding seeds.
 */
import type { Knex } from 'knex';
import { knex as createKnex } from 'knex';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { registerCoManagedCapability } from '@alga-psa/co-managed/capability';

// The server entry registers the co-managed capability resolvers on import; tests do the same.
registerCoManagedCapability();
export { registerCoManagedCapability };

const require = createRequire(import.meta.url);
const seedsRoot = '../../../../../ee/server/seeds/onboarding';
const secretsDir = path.resolve(__dirname, '../../../../../secrets');

/** Points every connection layer at the throwaway test Postgres. `L3C_DB_PORT` overrides the port. */
export function configureL3cDbEnv(): void {
  const readSecret = (name: string) => {
    try { return fs.readFileSync(path.join(secretsDir, name), 'utf8').trim(); } catch { return undefined; }
  };
  process.env.DB_HOST = process.env.L3C_DB_HOST || process.env.DB_HOST || '127.0.0.1';
  process.env.DB_PORT = process.env.L3C_DB_PORT || process.env.DB_PORT || '5432';
  process.env.DB_USER_ADMIN = 'postgres';
  process.env.DB_USER_SERVER = 'app_user';
  process.env.DB_NAME_SERVER = process.env.TEST_DB_NAME || 'test_database';
  process.env.DB_PASSWORD_ADMIN = readSecret('postgres_password') || 'postpass123';
  process.env.DB_PASSWORD_SERVER = readSecret('db_password_server') || 'postpass123';
  (process.env as Record<string, string>).NODE_ENV = 'test';
}

/** Connect without the destructive per-file recreate: the database is already migrated. */
export async function connectL3cDb(): Promise<Knex> {
  configureL3cDbEnv();
  return createTestDbConnection({ recreate: false });
}

function adminKnex(): Knex {
  return createKnex({
    client: 'pg',
    connection: {
      host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: 'postgres',
      password: process.env.DB_PASSWORD_ADMIN, database: process.env.DB_NAME_SERVER,
    },
    pool: { min: 0, max: 2 },
  });
}

const seed = (product: 'psa' | 'co_managed', file: string, db: Knex, tenant: string) =>
  require(`${seedsRoot}/${product}/${file}`).seed(db, tenant);

export interface L3cUser { userId: string; sessionId: string }
export interface L3cProject { projectId: string; phaseId: string; taskIds: string[] }

export interface L3cWorld {
  sponsor: string;
  customer: string;
  relationshipId: string;
  sponsorClientId: string;
  customerClientId: string;
  /** MSP "Project Manager": home project read+update, staff role technician. */
  technician: L3cUser;
  /** MSP "Project Manager": home project read+update, but only a staff `viewer` assignment. */
  viewer: L3cUser;
  /** Customer workspace user with local project:read (acts on its own tenant). */
  customerStaff: L3cUser;
  statusId: string;
  tenants: string[];
}

export const sessionActor = (tenant: string, user: L3cUser) =>
  ({ kind: 'session' as const, tenant, userId: user.userId, sessionId: user.sessionId });

async function provisionTenant(db: Knex, product: 'psa' | 'co_managed') {
  const tenant = uuidv4();
  await db('tenants').insert({
    tenant, client_name: `${product} ${tenant.slice(0, 6)}`, email: `${tenant.slice(0, 6)}@example.com`,
    product_code: product, billing_source: 'internal',
  });
  for (const file of ['01_roles.cjs', '02_permissions.cjs', '03_role_permissions.cjs']) await seed(product, file, db, tenant);
  return tenant;
}

async function addUser(db: Knex, tenant: string, roleName: string): Promise<L3cUser> {
  const userId = uuidv4();
  await db('users').insert({
    tenant, user_id: userId, username: `${roleName}-${userId.slice(0, 8)}`.toLowerCase().replace(/\s+/g, '-'),
    email: `${userId.slice(0, 8)}@example.com`, first_name: 'Test', last_name: roleName, hashed_password: 'x', user_type: 'internal',
  });
  const role = await db('roles').where({ tenant, role_name: roleName, msp: true, client: false }).first();
  if (!role) throw new Error(`Role ${roleName} missing for ${tenant}`);
  await db('user_roles').insert({ tenant, user_id: userId, role_id: role.role_id });
  const sessionId = uuidv4();
  await db('sessions').insert({
    tenant, session_id: sessionId, user_id: userId, created_at: db.fn.now(),
    expires_at: db.raw("now() + interval '1 day'"),
  });
  return { userId, sessionId };
}

/** Builds a sponsor + customer + active, allocated relationship. No project is shared yet. */
export async function seedL3cWorld(db: Knex): Promise<L3cWorld> {
  const sponsor = await provisionTenant(db, 'psa');
  const customer = await provisionTenant(db, 'co_managed');

  const sponsorClientId = uuidv4(), customerClientId = uuidv4();
  await db('clients').insert({ tenant: sponsor, client_id: sponsorClientId, client_name: 'Customer Co (MSP view)' });
  await db('clients').insert({ tenant: customer, client_id: customerClientId, client_name: 'Customer Co' });

  const technician = await addUser(db, sponsor, 'Project Manager');
  const viewer = await addUser(db, sponsor, 'Project Manager');
  const customerStaff = await addUser(db, customer, 'Admin');
  // The co_managed catalog does not grant project:read to customer roles by default; the customer's own
  // workspace staff need it for the native comment entry points under test.
  const permissionId = uuidv4();
  await db('permissions').insert({ tenant: customer, permission_id: permissionId, resource: 'project', action: 'read', msp: true, client: false });
  const adminRole = await db('roles').where({ tenant: customer, role_name: 'Admin', msp: true, client: false }).first();
  await db('role_permissions').insert({ tenant: customer, role_id: adminRole.role_id, permission_id: permissionId });

  // Live licensing: entitlement for the sponsor, active allocation for this customer.
  await db('co_managed_entitlements').insert({
    tenant: sponsor, source: 'admin_grant', source_reference: `l3c-${sponsor.slice(0, 8)}`, capacity: 5,
    verified_at: db.fn.now(), valid_until: db.raw("now() + interval '1 year'"),
  });
  const relationshipId = uuidv4();
  await db('co_management_relationships').insert({
    tenant: customer, relationship_id: relationshipId, sponsor_tenant: sponsor, sponsor_client_id: sponsorClientId,
    state: 'active', visibility_mode: 'board_scope', accepted_by: customerStaff.userId, accepted_at: db.fn.now(),
  });
  await db('co_managed_allocations').insert({
    tenant: sponsor, allocation_id: uuidv4(), operation_id: uuidv4(), request_fingerprint: 'a'.repeat(64),
    customer_tenant: customer, relationship_id: relationshipId, seats: 1, state: 'active',
  });
  for (const [user, role] of [[technician, 'technician'], [viewer, 'viewer']] as const) {
    await db('co_management_staff_assignments').insert({
      tenant: sponsor, customer_tenant: customer, relationship_id: relationshipId,
      principal_type: 'user', principal_id: user.userId, relationship_role: role,
    });
  }

  const statusId = uuidv4();
  await db('statuses').insert({ tenant: customer, status_id: statusId, name: 'Open', status_type: 'project', item_type: 'project', order_number: 1 });

  return { sponsor, customer, relationshipId, sponsorClientId, customerClientId, technician, viewer, customerStaff, statusId, tenants: [sponsor, customer] };
}

let projectSerial = 0;

/** A customer project with one phase and named tasks (inserted in the given order). */
export async function seedL3cProject(db: Knex, world: L3cWorld, name: string, taskNames: string[]): Promise<L3cProject> {
  const { customer: tenant } = world;
  const serial = ++projectSerial;
  const projectId = uuidv4(), phaseId = uuidv4();
  await db('projects').insert({
    tenant, project_id: projectId, project_name: name, status: world.statusId, wbs_code: String(serial),
    client_id: world.customerClientId, project_number: `L3C-${projectId.slice(0, 8)}`,
  });
  await db('project_phases').insert({
    tenant, phase_id: phaseId, project_id: projectId, phase_name: `${name} phase`, status: 'open', order_number: 1, wbs_code: `${serial}.1`,
  });
  const taskIds: string[] = [];
  let n = 0;
  for (const taskName of taskNames) {
    const taskId = uuidv4();
    await db('project_tasks').insert({
      tenant, task_id: taskId, phase_id: phaseId, task_name: taskName, wbs_code: `${serial}.1.${++n}`,
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
    });
    taskIds.push(taskId);
  }
  return { projectId, phaseId, taskIds };
}

export async function shareProject(db: Knex, world: L3cWorld, projectId: string, canCollaborate: boolean): Promise<void> {
  await db('co_management_project_scopes')
    .insert({ tenant: world.customer, relationship_id: world.relationshipId, project_id: projectId, can_collaborate: canCollaborate })
    .onConflict(['tenant', 'relationship_id', 'project_id']).merge({ can_collaborate: canCollaborate });
}

export async function indexProjectRows(db: Knex, tenant: string, name: string, project: L3cProject, taskNames: string[]): Promise<void> {
  const row = (object_type: string, object_id: string, title: string) => ({
    tenant, object_type, object_id, title, url: `/x/${object_id}`,
    search_vector: db.raw("to_tsvector('english', ?)", [title]), source_updated_at: new Date('2026-01-01T00:00:00.000Z'),
  });
  await db('app_search_index').insert([
    row('project', project.projectId, name),
    row('project_phase', project.phaseId, `${name} phase`),
    ...project.taskIds.map((id, i) => row('project_task', id, taskNames[i])),
  ]);
}

/** Removes every row of the given tenants, in all tables, regardless of FK order (admin, replica mode). */
export async function cleanupL3cTenants(tenants: string[]): Promise<void> {
  if (!tenants.length) return;
  const admin = adminKnex();
  try {
    await admin.transaction(async trx => {
      await trx.raw("SET LOCAL session_replication_role = 'replica'");
      const { rows } = await trx.raw(
        `SELECT c.table_name FROM information_schema.columns c
           JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
          WHERE c.table_schema = 'public' AND c.column_name = 'tenant'`);
      for (const { table_name } of rows) await trx(table_name).whereIn('tenant', tenants).delete();
    });
  } finally {
    await admin.destroy().catch(() => undefined);
  }
}
