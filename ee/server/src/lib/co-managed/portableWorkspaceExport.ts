import { withPortableTransfer, assertPortableTransferActive, type PortableTransferOptions } from '../../../../../packages/co-managed/src/portableTransfer';
import { createHash, randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { withCoManagedPortableSnapshot } from '../../../../../packages/co-managed/src/portableSnapshot';
import { withCoManagedExportAdmin } from '../../../../../packages/co-managed/src/portableExport';
import { snapshotCoManagedSessionActor, assertCoManagedSessionUnexpired, CoManagedSharedWorkError,
  type CoManagedSessionActor } from '../../../../../packages/co-managed/src/sharedWorkIdentity';
import { exportCoManagedPortableCore, retainCoManagedPortableCore } from '../../../../../packages/co-managed/src/portableCoreExport';
import { exportCoManagedPortableWork, retainCoManagedPortableWork } from '../../../../../packages/co-managed/src/portableWorkExport';
import { exportCoManagedPortableAssets, retainCoManagedPortableAssets } from '../../../../../packages/co-managed/src/portableAssetExport';
import { exportCoManagedPortableOperational, retainCoManagedPortableOperational } from '../../../../../packages/co-managed/src/portableOperationalExport';
import { exportCoManagedPortableEngagement, retainCoManagedPortableEngagement } from '../../../../../packages/co-managed/src/portableEngagementExport';
import { exportCoManagedPortableWorkflows, retainCoManagedPortableWorkflows } from '../../../../../packages/co-managed/src/portableWorkflowExport';
import { exportCoManagedPortableDocuments } from '../../../../../packages/co-managed/src/portableDocumentExport';
import { exportCoManagedPortableConversationFiles } from '../../../../../packages/co-managed/src/portableConversationExport';
import { exportCoManagedPortableSupplementalFiles } from '../../../../../packages/co-managed/src/portableSupplementalFileExport';
import { sealPortableArchive } from '../../../../../packages/co-managed/src/portableArchive';
import { buildCoManagedPortableWorkspaceManifest } from '../../../../../packages/co-managed/src/portableWorkspaceManifest';
import type { PortableStagedBlob } from '../../../../../packages/co-managed/src/portableBlobStaging';
import { exportCoManagedPortableVault } from './portableVaultExport';
import { exportCoManagedPortableRemoteMeetingFiles } from './portableRemoteMeetingExport';
import { acquirePortableDownload } from '../../../../../packages/co-managed/src/portableDownload';

interface SourceLease { files: PortableStagedBlob[]; dispose(): Promise<void>; assertCurrent(trx: Knex.Transaction): Promise<void> }
const recordCollectors = {
  core: [exportCoManagedPortableCore, retainCoManagedPortableCore], work: [exportCoManagedPortableWork, retainCoManagedPortableWork],
  assets: [exportCoManagedPortableAssets, retainCoManagedPortableAssets], operational: [exportCoManagedPortableOperational, retainCoManagedPortableOperational],
  engagement: [exportCoManagedPortableEngagement, retainCoManagedPortableEngagement], workflows: [exportCoManagedPortableWorkflows, retainCoManagedPortableWorkflows],
} as const;
type RecordSection = keyof typeof recordCollectors;
function sourceFingerprint(component: Record<string, unknown>) {
  const { capturedAt: _capturedAt, sha256: _sha256, ...source } = component;
  return createHash('sha256').update(JSON.stringify(source)).digest('hex');
}
async function disposeAll(leases: readonly { dispose(): Promise<void> }[]) {
  const results = await Promise.allSettled(leases.map(lease => lease.dispose()));
  if (results.some(result => result.status === 'rejected')) throw new Error('Portable export staging cleanup failed');
}
function combinedFiles(leases: readonly SourceLease[]) {
  const files = new Map<string, PortableStagedBlob>();
  for (const lease of leases) for (const file of lease.files) {
    const key = file.id.toLowerCase(), previous = files.get(key);
    if (previous && (previous.id !== file.id || previous.size !== file.size || previous.sha256 !== file.sha256)) throw new Error('Portable export file identity conflicts');
    if (!previous) files.set(key, { ...file });
  }
  return [...files.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export interface CoManagedPortableWorkspaceArtifact {
  packageId: string; sourceTenant: string; capturedAt: string; path: string; size: number; sha256: string;
}

/** Internal, single-use export preparation. Every component shares one MVCC
 * cutoff. Source storage and credential providers run outside admission
 * transactions. All staged plaintext is discarded after archive encryption.
 *
 * consume() re-enters ONE fresh transaction and retains all current source and
 * native authorization locks before exposing the encrypted local file. Its
 * trusted callback must finish local-file consumption before resolving; it must
 * not perform provider I/O or return a lazy path-based stream. acquireDownload
 * is the dedicated descriptor-transfer boundary: it opens the encrypted file
 * under admission, then streams only after transaction commit without retaining
 * database locks. The descriptor closes on EOF/cancel/error. Always dispose unused
 * handles. No passphrase is retained by the returned handle or sent to a job. */
export async function prepareCoManagedPortableWorkspaceExport(db: Knex, inputActor: CoManagedSessionActor, passphrase: string, options: PortableTransferOptions = {}) {
  let prepared: Awaited<ReturnType<typeof prepareWorkspace>> | undefined;
  try { return await withPortableTransfer(options, async () => { prepared = await prepareWorkspace(db, inputActor, passphrase); return prepared; }); }
  catch (error) { await prepared?.dispose(); throw error; }
  finally { passphrase = ''; }
}

async function prepareWorkspace(db: Knex, inputActor: CoManagedSessionActor, passphrase: string) {
  if (db.isTransaction) throw new Error('Portable export requires a root database connection');
  const actor = snapshotCoManagedSessionActor(inputActor), packageId = randomUUID();
  const leases: SourceLease[] = [];
  let archive: Awaited<ReturnType<typeof sealPortableArchive>> | undefined;
  try {
    const capture = await withCoManagedPortableSnapshot(db, async snapshot => {
      const context = { packageId, sourceTenant: actor.tenant, capturedAt: snapshot.capturedAt };
      const sections = {} as Record<RecordSection, Record<string, unknown>>;
      const fingerprints = {} as Record<RecordSection, string>;
      for (const name of Object.keys(recordCollectors) as RecordSection[]) {
        assertPortableTransferActive();
        sections[name] = await recordCollectors[name][0](db, actor, packageId, snapshot);
        fingerprints[name] = sourceFingerprint(sections[name]);
      }
      const documents = await exportCoManagedPortableDocuments(db, actor, packageId, snapshot); leases.push(documents);
      const conversationFiles = await exportCoManagedPortableConversationFiles(db, actor, packageId, snapshot); leases.push(conversationFiles);
      const supplementalFiles = await exportCoManagedPortableSupplementalFiles(db, actor, packageId, snapshot); leases.push(supplementalFiles);
      const remoteMeetingFiles = await exportCoManagedPortableRemoteMeetingFiles(db, actor, packageId, snapshot); leases.push(remoteMeetingFiles);
      const { assertCurrent: assertVaultCurrent, ...vaultSource } = await exportCoManagedPortableVault(db, actor, packageId, passphrase, snapshot);
      const credentialVault = JSON.parse(JSON.stringify(vaultSource));
      const files = combinedFiles(leases);
      const manifest = buildCoManagedPortableWorkspaceManifest({ context, sections: { ...sections, documents: documents.component },
        conversationFiles: conversationFiles.component, supplementalFiles: supplementalFiles.component,
        remoteMeetingFiles: remoteMeetingFiles.component, credentialVault, files });
      return { context, manifest, files, fingerprints, checks: [...leases.map(lease => lease.assertCurrent), assertVaultCurrent] };
    });
    assertPortableTransferActive();
    archive = await sealPortableArchive({ context: { packageId, sourceTenant: actor.tenant }, manifest: { ...capture.manifest }, files: capture.files }, passphrase);
    await disposeAll(leases); leases.length = 0;
    const sealed = archive, currentCapture = { context: capture.context, fingerprints: capture.fingerprints, checks: capture.checks };
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
          return await db.transaction(trx => withCoManagedExportAdmin(trx, actor, async (current, verified) => {
            for (const name of Object.keys(recordCollectors) as RecordSection[]) {
              const source = await recordCollectors[name][1](current, verified, packageId);
              if (sourceFingerprint(source) !== currentCapture.fingerprints[name]) throw new CoManagedSharedWorkError();
            }
            for (const check of currentCapture.checks) await check(current);
            await assertCoManagedSessionUnexpired(current, verified);
            const value = await callback({ ...currentCapture.context, path: sealed.path, size: sealed.size, sha256: sealed.sha256 });
            await assertCoManagedSessionUnexpired(current, verified);
            return value;
          }), { isolationLevel: 'repeatable read' });
        } finally { state = 'disposed'; await sealed.dispose(); }
      })();
      pending = operation;
      return operation;
    };
    return { packageId, capturedAt: capture.context.capturedAt, size: sealed.size, sha256: sealed.sha256, consume,
      acquireDownload: (signal?: AbortSignal) => acquirePortableDownload(consume, signal), dispose };
  } catch (error) { await disposeAll([...leases, ...(archive ? [archive] : [])]); throw error; }
  finally { passphrase = ''; }
}
