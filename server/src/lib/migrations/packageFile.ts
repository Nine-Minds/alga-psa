import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageService } from '@alga-psa/storage/StorageService';

/**
 * Materialize an uploaded package from tenant storage into a sandboxed
 * temporary file so node:sqlite can open it read-only, and clean up
 * afterwards. The stored file is never modified.
 */
export async function withPackageFile<T>(
  sourceFileId: string,
  work: (packagePath: string) => Promise<T>
): Promise<T> {
  const download = await StorageService.downloadFile(sourceFileId);
  if (!download) {
    throw new Error(`Stored migration package ${sourceFileId} could not be downloaded`);
  }
  const directory = await mkdtemp(join(tmpdir(), 'amp-package-'));
  const packagePath = join(directory, 'package.amp');
  try {
    await writeFile(packagePath, download.buffer, { mode: 0o600 });
    return await work(packagePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
