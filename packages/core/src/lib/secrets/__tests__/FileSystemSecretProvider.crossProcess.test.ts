import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileSystemSecretProvider } from '../index';

const run = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, '../../../../../..');

it('shares and rotates private tenant secrets across processes running as the same owner', async () => {
  const previous = process.env.SECRET_FS_BASE_PATH;
  const root = await mkdtemp(path.join(await realpath(tmpdir()), 'alga-secret-process-'));
  try {
    await chmod(root, 0o700);
    process.env.SECRET_FS_BASE_PATH = root;
    const parent = new FileSystemSecretProvider();
    const tenant = 'shared-process-tenant';
    const name = 'provider-refresh-token';
    await parent.setTenantSecret(tenant, name, 'initial-fixture-token');
    const secretPath = path.join(root, 'tenants', tenant, name);
    const assertPrivateModes = async () => {
      for (const directory of [root, path.join(root, 'tenants'), path.dirname(secretPath)]) {
        const metadata = await stat(directory);
        expect(metadata.mode & 0o777).toBe(0o700);
        expect(metadata.uid).toBe(process.getuid!());
      }
      const metadata = await stat(secretPath);
      expect(metadata.mode & 0o777).toBe(0o600);
      expect(metadata.uid).toBe(process.getuid!());
    };
    await assertPrivateModes();

    // Load the same public source export in an independent process. No dist,
    // provider mock, or relaxed permission/ownership configuration is involved.
    const program = `
      import assert from 'node:assert/strict';
      import { FileSystemSecretProvider } from ${JSON.stringify(path.join(repoRoot, 'packages/core/src/lib/secrets/index.ts'))};
      (async () => {
        assert.equal(process.getuid(), Number(process.env.ALGA_TEST_PARENT_UID));
        const provider = new FileSystemSecretProvider();
        assert.equal(await provider.getTenantSecret('shared-process-tenant', 'provider-refresh-token'), 'initial-fixture-token');
        await provider.setTenantSecret('shared-process-tenant', 'provider-refresh-token', 'rotated-fixture-token');
        assert.equal(await provider.getTenantSecret('shared-process-tenant', 'provider-refresh-token'), 'rotated-fixture-token');
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `;
    await run(process.execPath, [path.join(repoRoot, 'node_modules/tsx/dist/cli.mjs'), '-e', program], {
      cwd: repoRoot,
      env: { ...process.env, SECRET_FS_BASE_PATH: root, ALGA_TEST_PARENT_UID: String(process.getuid!()) },
      timeout: 10_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
    });
    expect(await parent.getTenantSecret(tenant, name)).toBe('rotated-fixture-token');
    await assertPrivateModes();
    await parent.deleteTenantSecret(tenant, name);
    expect(await parent.getTenantSecret(tenant, name)).toBeUndefined();
  } finally {
    if (previous === undefined) delete process.env.SECRET_FS_BASE_PATH;
    else process.env.SECRET_FS_BASE_PATH = previous;
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);
