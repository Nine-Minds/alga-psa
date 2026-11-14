import { describe, expect, it } from 'vitest';
import { portableRestoreGlobalCatalogs, CORE_PORTABLE_RESTORE_PROFILES, prepareCoManagedPortableWorkspaceRecords } from '../../../../../packages/co-managed/src/portableWorkspaceRestoreRecords';
import { fixtureManifest, prepare, id, SOURCE, TARGET } from './portableRestoreFixtures';

describe('portable restore records (manifest v2, profile-driven)', () => {
  it('rewrites every row to the target tenant and accounts for every archive table', async () => {
    const { manifest } = await fixtureManifest();
    const archiveTables = manifest.sections.flatMap(section => Object.keys(section.columns)).sort();
    const prepared = prepare(manifest);
    // The set under test is derived from the archive manifest, never from a hand-written list.
    expect([...prepared.tables].sort()).toEqual(archiveTables);
    expect(Object.keys(prepared.records).sort()).toEqual(archiveTables);
    for (const table of archiveTables) for (const row of prepared.records[table]) if ('tenant' in row) expect(row.tenant).toBe(TARGET);
    expect(JSON.stringify(prepared.records)).not.toContain(SOURCE);
  });
  it('allocates fresh destination identities and keeps relationships consistent', async () => {
    const { manifest } = await fixtureManifest();
    const { records } = prepare(manifest);
    expect(records.tickets[0].ticket_id).not.toBe(id(32));
    expect(records.tickets[0].client_id).toBe(records.clients[0].client_id);
    expect(records.tickets[0].status_id).toBe(records.statuses[0].status_id);
    expect(records.comment_threads[0].root_comment_id).toBe(records.comments[0].comment_id);
    expect(records.users[0].is_inactive).toBe(true);
  });
  it('fails closed when a contributor has no restore profile', async () => {
    const { manifest } = await fixtureManifest();
    const profiles = CORE_PORTABLE_RESTORE_PROFILES.filter((_, i) => i !== 1);
    expect(() => prepareCoManagedPortableWorkspaceRecords({ manifest, destinationTenant: TARGET, destinationCatalogMappings: { standard_statuses: {} }, profiles }, { allocateUuid: () => id(1) })).toThrow();
  });
  it('rejects a destination equal to the source', async () => {
    const { manifest } = await fixtureManifest();
    expect(() => prepareCoManagedPortableWorkspaceRecords({ manifest, destinationTenant: SOURCE, destinationCatalogMappings: { standard_statuses: {} } })).toThrow();
  });
  it('declares global catalogs from the archive, not from a fixed table list', async () => {
    const { manifest } = await fixtureManifest();
    expect(Object.keys(portableRestoreGlobalCatalogs(manifest, CORE_PORTABLE_RESTORE_PROFILES))).toContain('standard_statuses');
  });
  it('remaps an undeclared FK discovered in the destination metadata, and lets declared edges and qualified actors win', async () => {
    const { manifest } = await fixtureManifest(add => { add('collaboration_actor_references', { actor_reference_id: id(60), actor_tenant: SOURCE, actor_user_id: id(10), display_name: 'A', organization_name: 'B' }); });
    // Without the metadata edge the contributors' declarations leave comments.user_id as the SOURCE user id.
    expect(prepare(manifest).records.comments[0].user_id).toBe(id(10));
    let n = 1000;
    const destinationReferences = [
      ['comments', 'user_id', 'users', 'user_id'],                              // undeclared: remapped from metadata
      ['tickets', 'client_id', 'clients', 'client_id'],                         // duplicate of a declared edge: ignored
      ['collaboration_actor_references', 'actor_user_id', 'users', 'user_id'],  // qualified actor column: the profile path wins
      ['comments', 'ticket_id', 'users', 'nonexistent'],                        // not an identity of the parent: ignored
    ] as const;
    const prepared = prepareCoManagedPortableWorkspaceRecords({ manifest, destinationTenant: TARGET, destinationCatalogMappings: { standard_statuses: { [id(40)]: id(900) } }, destinationReferences },
      { allocateUuid: () => id(n++) });
    const user = prepared.records.users[0].user_id;
    expect(user).not.toBe(id(10));
    expect(prepared.records.comments[0].user_id).toBe(user);
    expect(prepared.records.tickets[0].client_id).toBe(prepared.records.clients[0].client_id);
    expect(prepared.records.collaboration_actor_references[0]).toMatchObject({ actor_tenant: TARGET, actor_user_id: user });
    expect(JSON.stringify(prepared.records)).not.toContain(SOURCE);
  });
});
