/** Fixture for the CM L7b3 portable-domain integration cases: the L3c world plus the home permissions a
 * customer-workspace admin needs to run a portable export. No restore code, no app server. */
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { withCoManagedPortableSnapshot } from '@alga-psa/co-managed/portableSnapshot';
import type { PortableContributor } from '@alga-psa/co-managed/portableContributorRegistry';
import { seedL3cWorld, sessionActor, type L3cWorld } from './coManagedL3cFixture';

export { configureL3cDbEnv, connectL3cDb, cleanupL3cTenants, registerCoManagedCapability } from './coManagedL3cFixture';

const GRANTS: [string, string][] = [['co_management', 'manage'], ['ticket', 'read'], ['project', 'read'], ['ticket_settings', 'read'],
  ['document', 'read'], ['timesheet', 'read'], ['user_schedule', 'read'], ['interaction', 'read'], ['asset', 'read'],
  ['user', 'read'], ['team', 'read'], ['client', 'read'], ['contact', 'read'], ['security_settings', 'read'], ['workflow', 'admin'], ['workflow', 'read']];

export interface PortableWorld extends L3cWorld { actor: ReturnType<typeof sessionActor>; packageId: string }

export async function seedPortableWorld(db: Knex): Promise<PortableWorld> {
  const world = await seedL3cWorld(db);
  const role = await db('roles').where({ tenant: world.customer, role_name: 'Admin', msp: true, client: false }).first();
  for (const [resource, action] of GRANTS) {
    let permission = await db('permissions').where({ tenant: world.customer, resource, action, msp: true }).first();
    if (!permission) {
      permission = { permission_id: uuidv4() };
      await db('permissions').insert({ tenant: world.customer, permission_id: permission.permission_id, resource, action, msp: true, client: false });
    }
    const linked = await db('role_permissions').where({ tenant: world.customer, role_id: role.role_id, permission_id: permission.permission_id }).first();
    if (!linked) await db('role_permissions').insert({ tenant: world.customer, role_id: role.role_id, permission_id: permission.permission_id });
  }
  return { ...world, actor: sessionActor(world.customer, world.customerStaff), packageId: uuidv4() };
}

/** Runs one contributor's export at a real shared MVCC snapshot and always disposes its staged files. */
export async function exportContributor(db: Knex, world: PortableWorld, contributor: PortableContributor) {
  return withCoManagedPortableSnapshot(db, async snapshot => {
    const result = await contributor.export({ db, actor: world.actor, packageId: world.packageId, snapshot });
    const files = result.files?.files.map(file => ({ ...file })) ?? [];
    await result.files?.dispose();
    return { records: result.records, annotations: result.annotations ?? {}, files };
  });
}

/** The retain run of the same contributor in a caller transaction: must equal the export's records. */
export async function retainContributor(db: Knex, world: PortableWorld, contributor: PortableContributor) {
  return db.transaction(trx => contributor.retain({ trx, actor: world.actor, packageId: world.packageId }), { isolationLevel: 'repeatable read' });
}

export const exclusionNames = (annotations: Record<string, unknown>) =>
  ((annotations.exclusions ?? []) as { class: string; name: string; reason: string }[]).map(entry => entry.name);

/** In-memory stand-in for the storage provider (installed by the runner's vi.mock): path -> object bytes. */
export const fakeStorageObjects = new Map<string, Buffer>();
export const fakeStorageProvider = { getReadStream: async (path: string) => {
  const { Readable } = await import('node:stream');
  const bytes = fakeStorageObjects.get(path);
  if (!bytes) throw new Error(`fake storage: no object at ${path}`);
  return Readable.from([bytes]);
} };
