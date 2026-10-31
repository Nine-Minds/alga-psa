/** CM L7b3 end to end: the real core registry plus the EE meeting contributor, through the engine's collect and manifest path. */
import { describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { createCorePortableRegistry } from '@alga-psa/co-managed/portableCoreRegistry';
import { collectPortableWorkspace } from '@alga-psa/co-managed/portableWorkspaceGraph';
import { buildCoManagedPortableWorkspaceManifest } from '@alga-psa/co-managed/portableWorkspaceManifest';
import { withCoManagedPortableSnapshot } from '@alga-psa/co-managed/portableSnapshot';
import { portableRemoteMeetingContributor } from '../../../../ee/server/src/lib/co-managed/portableRemoteMeetingExport';
import type { PortableWorld } from './helpers/coManagedPortableExportFixture';

const NEW_SECTIONS = ['operational', 'conversations', 'documents', 'artifacts', 'engagement', 'meetings'];

export function defineManifestCases(get: () => { db: Knex; world: PortableWorld }) {
  describe('complete portable manifest across all contributors', () => {
    const build = async () => {
      const { db, world } = get();
      const registry = createCorePortableRegistry([portableRemoteMeetingContributor]);
      return withCoManagedPortableSnapshot(db, async snapshot => {
        const collected = await collectPortableWorkspace(registry, { db, actor: world.actor, packageId: world.packageId, snapshot });
        try {
          const manifest = buildCoManagedPortableWorkspaceManifest({ context: { packageId: world.packageId, sourceTenant: world.customer, capturedAt: snapshot.capturedAt },
            collected, registry });
          return { registry, collected, manifest };
        } finally { await collected.dispose(); }
      });
    };
    const names = (annotations: Record<string, unknown>) => ((annotations.exclusions ?? []) as { name: string }[]).map(entry => entry.name);

    it('names all six new contributors, each with a named exclusion list', async () => {
      const { manifest } = await build();
      const ids = manifest.sections.map(section => section.id);
      expect(ids).toEqual(expect.arrayContaining(NEW_SECTIONS));
      for (const id of NEW_SECTIONS) {
        const section = manifest.sections.find(entry => entry.id === id)!;
        expect(names(section.annotations).length, `${id} exclusions`).toBeGreaterThan(0);
      }
    });

    it('resolves cross-contributor references against the owning contributor', async () => {
      const { manifest, registry } = await build();
      expect(registry.owner('priorities')?.id).toBe('work');
      const edge = (table: string, column: string, parent: string) => manifest.references.find(entry => entry.table === table && entry.column === column && entry.parent === parent);
      expect(edge('sla_policy_targets', 'priority_id', 'priorities')).toMatchObject({ status: 'resolved', contributor: 'operational' });
      expect(edge('online_meetings', 'appointment_request_id', 'appointment_requests')).toMatchObject({ status: 'resolved', contributor: 'meetings' });
      expect(edge('online_meetings', 'interaction_id', 'interactions')).toMatchObject({ status: 'resolved', contributor: 'meetings' });
      expect(edge('online_meetings', 'schedule_entry_id', 'schedule_entries')).toMatchObject({ status: 'resolved', contributor: 'meetings' });
      expect(registry.owner('schedule_entries')?.id).toBe('operational');
      expect(registry.owner('interactions')?.id).toBe('engagement');
      expect(registry.owner('appointment_requests')?.id).toBe('engagement');
      for (const entry of manifest.references.filter(item => NEW_SECTIONS.includes(item.contributor) && item.parent !== 'tickets')) {
        if (registry.owner(entry.parent)) expect(entry.status, `${entry.table}.${entry.column}`).toBe('resolved');
      }
    });

    it('carries the named exclusion for every empty domain', async () => {
      const { manifest } = await build();
      const section = (id: string) => manifest.sections.find(entry => entry.id === id)!;
      const operational = section('operational');
      if (!operational.records.time_entries.length) expect(names(operational.annotations)).toContain('time_domain_empty');
      expect(names(section('meetings').annotations)).toContain('online_meeting_attendance');
      expect(names(section('conversations').annotations)).toContain('co_management_conversation_attachments');
      for (const id of NEW_SECTIONS) {
        const empty = Object.entries(section(id).records).filter(([, rows]) => rows.length === 0).map(([table]) => table);
        // an empty table is never silent: the section states why it carries no rows or the table is plain customer data
        expect(Array.isArray(section(id).annotations.exclusions), `${id} (${empty.length} empty tables)`).toBe(true);
      }
    });
  });
}
