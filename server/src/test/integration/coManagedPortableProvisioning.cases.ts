/** CM L7b3 deploy-fix: a co-managed customer has no timesheet / user_schedule / document permission rows. Every L7b3
 * contributor must degrade (empty owned tables, no check) instead of throwing, and a provisioned-but-not-held grant must
 * still throw. Uses the real contributors, the real engine and a real database. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createCorePortableRegistry } from '@alga-psa/co-managed/portableCoreRegistry';
import { collectPortableWorkspace, assertPortableWorkspaceCurrent } from '@alga-psa/co-managed/portableWorkspaceGraph';
import { buildCoManagedPortableWorkspaceManifest } from '@alga-psa/co-managed/portableWorkspaceManifest';
import { withCoManagedPortableSnapshot } from '@alga-psa/co-managed/portableSnapshot';
import { CoManagedSharedWorkError } from '@alga-psa/co-managed/sharedWorkIdentity';
import type { PortableContributor } from '@alga-psa/co-managed/portableContributorRegistry';
import { portableRemoteMeetingContributor } from '../../../../ee/server/src/lib/co-managed/portableRemoteMeetingExport';
import { cleanupL3cTenants, seedPortableWorld, type PortableWorld } from './helpers/coManagedPortableExportFixture';

const L7B3_IDS = ['operational', 'conversations', 'documents', 'artifacts', 'engagement', 'meetings'];
const UNPROVISIONED = [['timesheet', 'read'], ['user_schedule', 'read'], ['document', 'read']];

/** Removes the permission rows themselves (not just the role link): the tenant does not provision them. */
async function dropPermissions(db: Knex, tenant: string, pairs: string[][]) {
  for (const [resource, action] of pairs) {
    const ids = (await db('permissions').where({ tenant, resource, action, msp: true }).select('permission_id')).map(row => row.permission_id);
    await db('role_permissions').where({ tenant }).whereIn('permission_id', ids).delete();
    await db('permissions').where({ tenant }).whereIn('permission_id', ids).delete();
  }
}
/** Unlinks the grants from every role but keeps the permission rows: provisioned, not held. */
async function revokePermissions(db: Knex, tenant: string, pairs: string[][]) {
  for (const [resource, action] of pairs) {
    const ids = (await db('permissions').where({ tenant, resource, action, msp: true }).select('permission_id')).map(row => row.permission_id);
    await db('role_permissions').where({ tenant }).whereIn('permission_id', ids).delete();
  }
}

export function defineProvisioningCases(get: () => { db: Knex }) {
  describe('portable export for a co-managed tenant that does not provision timesheet / user_schedule / document', () => {
    let bare: PortableWorld, denied: PortableWorld;
    const contributors = () => [...createCorePortableRegistry([portableRemoteMeetingContributor]).list()].filter(c => L7B3_IDS.includes(c.id));
    const scopes = (c: PortableContributor) => (c.permissions ?? []).map(p => ({ label: `${p.resource}.${p.action}`, tables: [...(p.tables ?? Object.keys(c.columns))] }));

    beforeAll(async () => {
      const { db } = get();
      bare = await seedPortableWorld(db);
      await dropPermissions(db, bare.customer, UNPROVISIONED);
      denied = await seedPortableWorld(db);
      await revokePermissions(db, denied.customer, [...UNPROVISIONED, ['interaction', 'read'], ['ticket', 'read']]);
    }, 120_000);
    afterAll(async () => { await cleanupL3cTenants([...(bare?.tenants ?? []), ...(denied?.tenants ?? [])]); }, 120_000);

    const run = (world: PortableWorld, c: PortableContributor, notProvisioned?: ReadonlySet<string>) => withCoManagedPortableSnapshot(get().db, async snapshot => {
      const result = await c.export({ db: get().db, actor: world.actor, packageId: world.packageId, snapshot, ...(notProvisioned ? { notProvisioned } : {}) });
      await result.files?.dispose();
      return result.records;
    });
    const retain = (world: PortableWorld, c: PortableContributor, notProvisioned?: ReadonlySet<string>) => get().db.transaction(
      trx => c.retain({ trx, actor: world.actor, packageId: world.packageId, ...(notProvisioned ? { notProvisioned } : {}) }), { isolationLevel: 'repeatable read' }).then(result => result.records);

    it('every L7b3 contributor declares the grants it checks, scoped to the tables that depend on them', () => {
      const declared = Object.fromEntries(contributors().map(c => [c.id, scopes(c)]));
      expect(Object.keys(declared).sort()).toEqual([...L7B3_IDS].sort());
      expect(declared.operational.map(s => s.label)).toEqual(['timesheet.read', 'user_schedule.read']);
      expect(declared.engagement.map(s => s.label)).toEqual(['interaction.read', 'user_schedule.read']);
      expect(declared.meetings.map(s => s.label)).toEqual(['interaction.read', 'user_schedule.read']);
      expect(declared.documents.map(s => s.label)).toEqual(['document.read']);
      expect(declared.artifacts.map(s => s.label)).toEqual(['document.read']);
      expect(declared.conversations.map(s => s.label)).toEqual(['ticket.read']);
      // Scopes name only owned tables, and the two operational scopes do not overlap.
      for (const c of contributors()) for (const scope of scopes(c)) for (const table of scope.tables) expect(Object.keys(c.columns), `${c.id}:${scope.label}`).toContain(table);
      const [time, schedule] = declared.operational.map(s => s.tables);
      expect(time.filter(table => schedule.includes(table))).toEqual([]);
      expect([...time, ...schedule].sort()).toEqual(Object.keys(contributors().find(c => c.id === 'operational')!.columns).sort());
    });

    for (const id of L7B3_IDS) {
      it(`${id}: unprovisioned tables come back empty, the permission check is not called, and retain agrees`, async () => {
        const c = contributors().find(entry => entry.id === id)!;
        const all = new Set(scopes(c).flatMap(scope => scope.tables));
        // Tables outside the set keep their checks: a scope the tenant does not provision, left unsignalled, still throws (it is not held).
        const absent = new Set(UNPROVISIONED.map(([resource, action]) => `${resource}.${action}`));
        for (const scope of scopes(c)) {
          const set = new Set(scope.tables);
          if (scopes(c).some(other => other !== scope && absent.has(other.label) && other.tables.some(table => !set.has(table)))) {
            await expect(run(bare, c, set), `${id}:${scope.label}`).rejects.toBeInstanceOf(CoManagedSharedWorkError);
          }
        }
        // The tenant holds none of timesheet / user_schedule / document: were any of their checks called here, this would throw.
        const records = await run(bare, c, all), retained = await retain(bare, c, all);
        for (const table of all) expect(records[table], `${id}.${table}`).toEqual([]);
        expect(retained).toEqual(records);
      });
    }

    it('still throws CoManagedSharedWorkError for every contributor when the permission row exists but the actor lacks it', async () => {
      for (const c of contributors()) {
        await expect(run(denied, c), c.id).rejects.toBeInstanceOf(CoManagedSharedWorkError);
        await expect(retain(denied, c), `${c.id} retain`).rejects.toBeInstanceOf(CoManagedSharedWorkError);
      }
      const registry = createCorePortableRegistry([portableRemoteMeetingContributor]);
      await expect(withCoManagedPortableSnapshot(get().db, snapshot => collectPortableWorkspace(registry,
        { db: get().db, actor: denied.actor, packageId: denied.packageId, snapshot }))).rejects.toBeInstanceOf(CoManagedSharedWorkError);
    });

    it('the full registry exports with 200-equivalent success, names not_provisioned exclusions, and carries empty tables', async () => {
      const { db } = get();
      const registry = createCorePortableRegistry([portableRemoteMeetingContributor]);
      await withCoManagedPortableSnapshot(db, async snapshot => {
        const collected = await collectPortableWorkspace(registry, { db, actor: bare.actor, packageId: bare.packageId, snapshot });
        try {
          const manifest = buildCoManagedPortableWorkspaceManifest({ context: { packageId: bare.packageId, sourceTenant: bare.customer, capturedAt: snapshot.capturedAt }, collected, registry });
          const missing = manifest.exclusions.filter(e => e.class === 'not_provisioned').map(e => e.name);
          expect(missing).toEqual(expect.arrayContaining(['domain:operational:timesheet', 'domain:operational:user_schedule', 'domain:documents', 'domain:artifacts',
            'domain:engagement:user_schedule', 'domain:meetings:user_schedule']));
          expect(missing).not.toContain('domain:conversations');
          const section = (id: string) => manifest.sections.find(entry => entry.id === id)!;
          const rows = (id: string, tables?: string[]) => Object.entries(section(id).records).filter(([table]) => !tables || tables.includes(table)).flatMap(([, list]) => list);
          expect(rows('operational')).toEqual([]);
          expect(rows('documents')).toEqual([]);
          expect(rows('artifacts')).toEqual([]);
          expect(rows('meetings')).toEqual([]);
          expect(rows('engagement', ['appointment_requests', 'availability_settings', 'availability_exceptions'])).toEqual([]);
          for (const id of L7B3_IDS) expect(manifest.sections.map(s => s.id)).toContain(id);
          // retain agrees with export: the engine's changed-source detection stays quiet.
          await db.transaction(trx => assertPortableWorkspaceCurrent(registry, collected, { trx, actor: bare.actor, packageId: bare.packageId }), { isolationLevel: 'repeatable read' });
        } finally { await collected.dispose(); }
      });
    });

    it('a document row that exists is still not read when the engine declares documents not provisioned', async () => {
      const { db } = get();
      await db('documents').insert({ tenant: bare.customer, document_id: uuidv4(), document_name: 'Library doc', user_id: bare.customerStaff.userId, created_by: bare.customerStaff.userId });
      const records = await run(bare, contributors().find(c => c.id === 'documents')!, new Set(Object.keys(contributors().find(c => c.id === 'documents')!.columns)));
      expect(records.documents).toEqual([]);
    });
  });
}
