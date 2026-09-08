import { createHash } from 'node:crypto';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { StorageProviderFactory } from '@alga-psa/storage/StorageProviderFactory';
import { isCoManagedUuid } from './sharedWorkIdentity';
import { assertPortableTransferActive, awaitPortableTransfer, createPortableWriteStream, portableTransferSignal } from './portableTransfer';

export interface PortableSourceBlob { id: string; path: string; size: number; sha256?: string }
export interface PortableStagedBlob { id: string; path: string; size: number; sha256: string }

/** Internal transport only: callers must admit each source and validate its
 * owner-specific storage path first, then recheck authority before delivery.
 * A successful lease is disposed by its caller; every failure disposes itself. */
export async function stageCoManagedPortableBlobs(input: readonly PortableSourceBlob[]) {
  assertPortableTransferActive();
  const blobs = input.map(blob => ({ id: blob.id, path: blob.path, size: blob.size, sha256: blob.sha256 }));
  const ids = new Set<string>();
  for (const blob of blobs) {
    const [kind, id, extra] = blob.id.split(':');
    if (!/^[a-z][a-z_]{0,31}$/.test(kind) || !isCoManagedUuid(id) || extra !== undefined || ids.has(blob.id) ||
        !Number.isSafeInteger(blob.size) || blob.size < 0 || typeof blob.path !== 'string' ||
        (blob.sha256 !== undefined && !/^[0-9a-f]{64}$/.test(blob.sha256))) throw new Error('Invalid portable source blob');
    ids.add(blob.id);
  }
  const directory = await mkdtemp(join(tmpdir(), 'alga-portable-blobs-'));
  const dispose = () => rm(directory, { recursive: true, force: true });
  try {
    await chmod(directory, 0o700);
    const files: PortableStagedBlob[] = [];
    if (blobs.length) {
      const provider = await awaitPortableTransfer(() => StorageProviderFactory.createProvider());
      for (const blob of blobs) {
        let size = 0;
        const hash = createHash('sha256'), path = join(directory, blob.id.replace(':', '-'));
        try {
          const source = await awaitPortableTransfer(() => provider.getReadStream(blob.path), stream => { stream.destroy(); });
          await pipeline(source, new Transform({ transform(chunk, _encoding, callback) {
            size += chunk.length;
            if (size > blob.size) return callback(new Error('Portable file size changed'));
            hash.update(chunk); callback(null, chunk);
          } }), createPortableWriteStream(path), { signal: portableTransferSignal() });
          if (size !== blob.size) throw new Error('Portable file size changed');
          const sha256 = hash.digest('hex');
          if (blob.sha256 !== undefined && sha256 !== blob.sha256) throw new Error('Portable file checksum changed');
          files.push({ id: blob.id, path, size, sha256 });
        } catch { throw new Error('Portable export file could not be staged'); }
      }
    }
    return { files, dispose };
  } catch (error) { await dispose(); throw error; }
}
