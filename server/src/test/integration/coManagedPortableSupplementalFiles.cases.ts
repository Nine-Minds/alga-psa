/** CM L7b3 supplemental (meeting artifact) files: per-file size cap and tenant path scope. No real blob is
 * staged: capped files never reach storage, and an out-of-scope path is refused before staging. */
import { describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { portableSupplementalFileContributor } from '@alga-psa/co-managed/portableSupplementalFileExport';
import { CO_MANAGED_PORTABLE_FILE_CAPS } from '@alga-psa/co-managed/portableDocumentExport';
import { exclusionNames, exportContributor, type PortableWorld } from './helpers/coManagedPortableExportFixture';

export function defineSupplementalFileCases(get: () => { db: Knex; world: PortableWorld }) {
  describe('portable supplemental file export (size cap, path scope)', () => {
    const seed = async (path: (tenant: string, id: string) => string, size: number) => {
      const { db, world } = get();
      const fileId = uuidv4(), meetingId = uuidv4(), artifactId = uuidv4();
      await db('external_files').insert({ tenant: world.customer, file_id: fileId, file_name: 'a.mp4', original_name: 'a.mp4', mime_type: 'video/mp4',
        file_size: size, storage_path: path(world.customer, fileId), uploaded_by_id: world.customerStaff.userId });
      await db('online_meeting_artifacts').insert({ tenant: world.customer, artifact_id: artifactId, meeting_id: meetingId, artifact_type: 'recording',
        provider_artifact_id: `p-${artifactId}`, file_id: fileId });
      return { fileId, artifactId };
    };
    const cleanup = async (artifactId: string, fileId: string) => {
      const { db, world } = get();
      await db('online_meeting_artifacts').where({ tenant: world.customer, artifact_id: artifactId }).delete();
      await db('external_files').where({ tenant: world.customer, file_id: fileId }).delete();
    };

    it('a file over the per-file cap is never staged and is named in the exclusions', async () => {
      const { db, world } = get();
      const { fileId, artifactId } = await seed((tenant, id) => `${tenant}/artifacts/${id}`, CO_MANAGED_PORTABLE_FILE_CAPS.perFileBytes + 1);
      try {
        const { records, files, annotations } = await exportContributor(db, world, portableSupplementalFileContributor);
        expect(files.map(file => file.id)).not.toContain(`file:${fileId}`);
        expect(records.online_meeting_artifacts.map(row => row.artifact_id)).toContain(artifactId);
        expect(exclusionNames(annotations)).toContain(`file:${fileId}`);
      } finally { await cleanup(artifactId, fileId); }
    });
    it('a storage path outside the tenant scope fails the export closed', async () => {
      const { db, world } = get();
      const { fileId, artifactId } = await seed((_tenant, id) => `${uuidv4()}/artifacts/${id}`, 10);
      try {
        await expect(exportContributor(db, world, portableSupplementalFileContributor)).rejects.toThrow();
      } finally { await cleanup(artifactId, fileId); }
    });
  });
}
