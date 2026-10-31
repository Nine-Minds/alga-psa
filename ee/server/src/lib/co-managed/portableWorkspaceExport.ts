import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { withPortableTransfer, assertPortableTransferActive, portableTransferSignal, type PortableTransferOptions } from '@alga-psa/co-managed/portableTransfer';
import { withCoManagedPortableSnapshot } from '@alga-psa/co-managed/portableSnapshot';
import { withCoManagedExportAdmin } from '@alga-psa/co-managed/portableExport';
import { snapshotCoManagedSessionActor, assertCoManagedSessionUnexpired, CoManagedSharedWorkError,
  type CoManagedSessionActor } from '@alga-psa/co-managed/sharedWorkIdentity';
import { sealPortableArchive } from '@alga-psa/co-managed/portableArchive';
import { buildCoManagedPortableWorkspaceManifest } from '@alga-psa/co-managed/portableWorkspaceManifest';
import { collectPortableWorkspace, assertPortableWorkspaceCurrent } from '@alga-psa/co-managed/portableWorkspaceGraph';
import { createCorePortableRegistry } from '@alga-psa/co-managed/portableCoreRegistry';
import type { PortableContributorRegistry } from '@alga-psa/co-managed/portableContributorRegistry';
import { acquirePortableDownload } from '@alga-psa/co-managed/portableDownload';
import { exportCoManagedPortableVault } from './portableVaultExport';

export interface CoManagedPortableWorkspaceArtifact {
  packageId: string; sourceTenant: string; capturedAt: string; path: string; size: number; sha256: string;
}

type VaultResult = Awaited<ReturnType<typeof exportCoManagedPortableVault>>;
export interface PortableExportDependencies {
  registry?: PortableContributorRegistry;
  /** Optional credential vault. Absent or failing never fails the export; the manifest records the exclusion. */
  vault?: (db: Knex, actor: CoManagedSessionActor, packageId: string, passphrase: string, snapshot: { capturedAt: string }) => Promise<VaultResult>;
}

async function disposeAll(leases: readonly { dispose(): Promise<void> }[]) {
  const results = await Promise.allSettled(leases.map(lease => lease.dispose()));
  if (results.some(result => result.status === 'rejected')) throw new Error('Portable export staging cleanup failed');
}

/** Internal, single-use export preparation. Every contributor shares one MVCC
 * cutoff. Source storage and credential providers run outside admission
 * transactions. All staged plaintext is discarded after archive encryption.
 *
 * consume() re-enters ONE fresh transaction and asks every contributor to
 * `retain` (re-read under final locks); a changed source fails the export. Its
 * callback must finish local-file consumption before resolving. No passphrase is
 * retained by the returned handle or sent to a job. Always dispose unused handles. */
export async function prepareCoManagedPortableWorkspaceExport(db: Knex, inputActor: CoManagedSessionActor, passphrase: string,
  options: PortableTransferOptions = {}, dependencies: PortableExportDependencies = {}) {
  let prepared: Awaited<ReturnType<typeof prepareWorkspace>> | undefined;
  try { return await withPortableTransfer(options, async () => { prepared = await prepareWorkspace(db, inputActor, passphrase, dependencies); return prepared; }); }
  catch (error) { await prepared?.dispose(); throw error; }
  finally { passphrase = ''; }
}

async function prepareWorkspace(db: Knex, inputActor: CoManagedSessionActor, passphrase: string, dependencies: PortableExportDependencies) {
  if (db.isTransaction) throw new Error('Portable export requires a root database connection');
  const registry = dependencies.registry ?? createCorePortableRegistry();
  const vaultExport = dependencies.vault ?? exportCoManagedPortableVault;
  const actor = snapshotCoManagedSessionActor(inputActor), packageId = randomUUID();
  let collected: Awaited<ReturnType<typeof collectPortableWorkspace>> | undefined;
  let archive: Awaited<ReturnType<typeof sealPortableArchive>> | undefined;
  try {
    const capture = await withCoManagedPortableSnapshot(db, async snapshot => {
      const context = { packageId, sourceTenant: actor.tenant, capturedAt: snapshot.capturedAt };
      collected = await collectPortableWorkspace(registry, { db, actor, packageId, snapshot });
      let vault: VaultResult | undefined, vaultExclusion: string | undefined;
      try { vault = await vaultExport(db, actor, packageId, passphrase, snapshot); }
      catch (error) {
        // A cancelled or timed-out transfer is never reinterpreted as "no vault".
        assertPortableTransferActive();
        if (portableTransferSignal()?.aborted) throw error;
        vaultExclusion = error instanceof CoManagedSharedWorkError
          ? 'The exporting user cannot read every credential, so no vault was produced' : 'The credential vault could not be produced';
      }
      const { assertCurrent, ...vaultSource } = vault ?? {} as Partial<VaultResult>;
      const manifest = buildCoManagedPortableWorkspaceManifest({ context, collected, registry,
        credentialVault: vault ? JSON.parse(JSON.stringify(vaultSource)) : null, vaultExclusion });
      return { context, manifest, files: collected.files, assertVaultCurrent: assertCurrent };
    });
    assertPortableTransferActive();
    archive = await sealPortableArchive({ context: { packageId, sourceTenant: actor.tenant }, manifest: { ...capture.manifest }, files: capture.files }, passphrase);
    const sealedCollection = collected!; collected = undefined;
    await sealedCollection.dispose();
    const sealed = archive, current = { context: capture.context, sections: sealedCollection.sections, assertVaultCurrent: capture.assertVaultCurrent };
    let state: 'ready' | 'consuming' | 'disposed' = 'ready';
    let pending: Promise<unknown> | undefined;
    const dispose = async () => {
      if (state === 'consuming') { await pending?.catch(() => {}); return; }
      state = 'disposed'; await sealed.dispose();
    };
    const consume = async <T>(callback: (artifact: CoManagedPortableWorkspaceArtifact) => Promise<T>): Promise<T> => {
      if (state !== 'ready' || typeof callback !== 'function') throw new CoManagedSharedWorkError();
      state = 'consuming';
      const operation = (async () => {
        try {
          sealed.assertActive();
          return await db.transaction(trx => withCoManagedExportAdmin(trx, actor, async (retained, verified) => {
            await assertPortableWorkspaceCurrent(registry, current, { trx: retained, actor: verified, packageId });
            await current.assertVaultCurrent?.(retained);
            await assertCoManagedSessionUnexpired(retained, verified);
            sealed.assertActive();
            const value = await callback({ ...current.context, path: sealed.path, size: sealed.size, sha256: sealed.sha256 });
            sealed.assertActive();
            await assertCoManagedSessionUnexpired(retained, verified);
            return value;
          }), { isolationLevel: 'repeatable read' });
        } finally { state = 'disposed'; await sealed.dispose(); }
      })();
      pending = operation;
      return operation;
    };
    return { packageId, capturedAt: capture.context.capturedAt, size: sealed.size, sha256: sealed.sha256, consume,
      acquireDownload: (signal?: AbortSignal) => acquirePortableDownload(consume, signal), dispose };
  } catch (error) { await disposeAll([...(collected ? [collected] : []), ...(archive ? [archive] : [])]); throw error; }
  finally { passphrase = ''; }
}
