/**
 * Resumable multipart write sessions: the shared contract (src/testing/writeSessionContract.ts)
 * against the local provider, plus local-only handle path safety.
 *
 * The same contract runs against S3 in
 * ee/server/src/lib/storage/providers/__tests__/s3WriteSession.integration.test.ts, which needs the
 * real MinIO service of the workspace-runtime lane and therefore lives in that lane, not here.
 */
import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { LocalStorageProvider } from '../src/providers/LocalStorageProvider';
import { StorageError } from '../src/providers/StorageProvider';
import { defineWriteSessionContract, localWriteSessionHarness } from '../src/testing/writeSessionContract';

defineWriteSessionContract(localWriteSessionHarness());

describe('local write session path safety', () => {
  it('rejects handles whose paths escape basePath or point at foreign files', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'write-session-esc-'));
    try {
      const p = new LocalStorageProvider({ type: 'local', basePath: dir } as any);
      await expect(p.beginWrite('../evil', {})).rejects.toMatchObject({ code: 'PATH_TRAVERSAL' });
      const body = Readable.from([Buffer.from('x')]);
      for (const handle of [
        { provider: 'local', path: '../x', partialPath: '../x.a.partial' },
        { provider: 'local', path: 'a/b', partialPath: '../../etc/passwd' },
        { provider: 'local', path: 'a/b', partialPath: 'a/other.file' },
        { provider: 'local', path: '/abs', partialPath: '/abs.a.partial' },
      ]) {
        await expect(p.abortWrite(handle as any)).rejects.toMatchObject({ code: expect.stringMatching(/PATH_TRAVERSAL|INVALID_WRITE_HANDLE/) });
        await expect(p.writePart(handle as any, 1, body, 1, { final: true })).rejects.toBeInstanceOf(StorageError);
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
