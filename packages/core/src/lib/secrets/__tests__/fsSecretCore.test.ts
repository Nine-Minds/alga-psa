import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile, rename as realRename } from 'node:fs/promises';
import * as fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  ensurePrivateDirectory,
  ensureWriteBasePath,
  InvalidSecretPathError,
  readFileContentSafe,
  repairSecretStoreModes,
  scanSecretStoreModes,
  SECRET_DIR_MODE,
  SECRET_FILE_MODE,
  tenantDir,
  tenantSecretPath,
  tenantsDir,
  unlinkTenantSecret,
  UnsafeSecretLocationError,
  validateSecretComponent,
  writeTenantSecretAtomic,
} from '../fsSecretCore';

/**
 * Failures during the rename that finishes an atomic write must never corrupt
 * the previous value. The lazy builtin loader resolves `node:fs/promises`
 * through `lazyBuiltin.ts`; this mock wraps that one module so `rename` is a
 * controllable call-through mock that tests can arm with `mockRejectedValueOnce`.
 */
const renameMock = vi.hoisted(() => vi.fn());

vi.mock('../lazyBuiltin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lazyBuiltin')>();
  return {
    ...actual,
    loadBuiltin: async (specifier: string) => {
      const mod = await actual.loadBuiltin(specifier);
      if (specifier === 'node:fs/promises') {
        return { ...(mod as typeof import('node:fs/promises')), rename: renameMock };
      }
      return mod;
    },
  };
});

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../../../..');
const TSSX_BIN = path.join(REPO_ROOT, 'node_modules/.bin/tsx');
const PROVIDER_FILE = path.join(import.meta.dirname, '../LazyFileSystemSecretProvider.ts');
const REPAIR_SCRIPT = path.join(REPO_ROOT, 'scripts/repair-secret-permissions.sh');
const DIST_PROVIDER = path.join(REPO_ROOT, 'packages/core/dist/lib/secrets/LazyFileSystemSecretProvider.js');

const SECRET_VALUE = 'super-secret-value-that-must-never-be-logged';

/**
 * The repair script's chown branches only run as root with --uid. A user
 * namespace (`unshare -r --map-auto`) provides an unprivileged fake root with
 * a mapped uid range, letting those branches execute for real. Skipped where
 * user namespaces are unavailable.
 */
const HAS_USERNS = (() => {
  try {
    execFileSync('unshare', ['-r', '--map-auto', 'true'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

let rootDir: string;
let previousUmask: number;

async function runProviderProgram(program: string, args: string[] = []): Promise<{ stdout: string; stderr: string }> {
  try {
    const stdout = execFileSync(TSSX_BIN, ['-e', program, ...args], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '' };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message: string };
    return { stdout: err.stdout ?? '', stderr: err.stderr ?? `${err.message}\n` };
  }
}

function providerProgram(basePath: string, script: string): string {
  return [
    `import { FileSystemSecretProvider } from ${JSON.stringify(PROVIDER_FILE)};`,
    `import { writeFileSync } from 'node:fs';`,
    `process.env.SECRET_FS_BASE_PATH = ${JSON.stringify(basePath)};`,
    script,
  ].join('\n');
}

async function tenantSecret(tenantId: string, name: string): Promise<string> {
  return tenantSecretPath(rootDir, tenantId, name);
}

async function seedTenantSecret(tenantId: string, name: string, value: string): Promise<string> {
  const filePath = await tenantSecret(tenantId, name);
  await ensurePrivateDirectory(await tenantDir(rootDir, tenantId));
  await writeTenantSecretAtomic(filePath, value);
  return filePath;
}

beforeEach(async () => {
  rootDir = await mkdtemp(path.join(os.tmpdir(), 'alga-fs-secret-'));
  previousUmask = process.umask(0o000);
  renameMock.mockClear();
  renameMock.mockImplementation(realRename);
});

afterEach(async () => {
  process.umask(previousUmask);
  await rm(rootDir, { recursive: true, force: true });
});

describe('fsSecretCore mode handling', () => {
  it('creates directories with exactly 0700 and files with exactly 0600 under a permissive umask', async () => {
    const filePath = await seedTenantSecret('tenant-mode', 'token', SECRET_VALUE);

    expect((await fsPromises.lstat(await tenantDir(rootDir, 'tenant-mode'))).mode & 0o777).toBe(SECRET_DIR_MODE);
    expect((await fsPromises.lstat(path.dirname(await tenantDir(rootDir, 'tenant-mode')))).mode & 0o777).toBe(SECRET_DIR_MODE);
    expect((await fsPromises.lstat(filePath)).mode & 0o777).toBe(SECRET_FILE_MODE);
  });

  it('corrects a pre-existing tenant directory to 0700 instead of trusting its current mode', async () => {
    const dirPath = await tenantDir(rootDir, 'tenant-pre-existing');
    await mkdir(dirPath, { recursive: true });
    await fsPromises.chmod(dirPath, 0o755);

    await ensurePrivateDirectory(dirPath);

    expect((await fsPromises.lstat(dirPath)).mode & 0o777).toBe(SECRET_DIR_MODE);
  });

  it('rewrites an existing secret atomically and keeps 0600 even when the previous file had looser modes', async () => {
    const filePath = await seedTenantSecret('tenant-rewrite', 'token', 'first-value');
    await fsPromises.chmod(filePath, 0o644);

    await writeTenantSecretAtomic(filePath, 'second-value');

    expect((await fsPromises.lstat(filePath)).mode & 0o777).toBe(SECRET_FILE_MODE);
    expect(await readFileContentSafe(filePath)).toBe('second-value');
  });
});

describe('fsSecretCore atomic writes', () => {
  it('leaves the previous secret intact and no partial file at the final path when the rename fails', async () => {
    const filePath = await seedTenantSecret('tenant-atomic', 'token', JSON.stringify({ v: 'before' }));
    const injected = new Error('injected rename failure');
    renameMock.mockRejectedValueOnce(injected);

    await expect(writeTenantSecretAtomic(filePath, JSON.stringify({ v: 'after' }))).rejects.toThrow('injected rename failure');

    const content = await readFile(filePath, 'utf-8');
    expect(content).toBe(JSON.stringify({ v: 'before' }));
    expect(content).not.toContain('after');

    const entries = await readdir(path.dirname(filePath));
    expect(entries.filter((entry) => entry.includes('.tmp-'))).toEqual([]);
  });

  it('never prints the secret value in error output when a write fails', async () => {
    const filePath = await seedTenantSecret('tenant-no-leak', 'token', 'before');
    renameMock.mockRejectedValueOnce(new Error('injected'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(writeTenantSecretAtomic(filePath, SECRET_VALUE)).rejects.toThrow();
      expect(errorSpy.mock.calls.flat().join(' ')).not.toContain(SECRET_VALUE);
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe('fsSecretCore path validation', () => {
  it('rejects traversal, separators, empty and dot components in tenant ids and secret names', async () => {
    for (const bad of ['../x', 'a/b', 'a\\b', '..', '.', '', '/absolute', 'x\0']) {
      expect(() => validateSecretComponent(bad, 'tenantId')).toThrow(InvalidSecretPathError);
      expect(() => validateSecretComponent(bad, 'secret name')).toThrow(InvalidSecretPathError);
      await expect(tenantSecretPath(rootDir, bad, 'name')).rejects.toThrow(InvalidSecretPathError);
      await expect(tenantSecretPath(rootDir, 'tenant', bad)).rejects.toThrow(InvalidSecretPathError);
    }
  });

  it('rejects a symlinked secret root for writes', async () => {
    const elsewhere = await mkdtemp(path.join(os.tmpdir(), 'alga-fs-elsewhere-'));
    try {
      const symlinkRoot = path.join(os.tmpdir(), `alga-fs-root-link-${Date.now()}`);
      await symlink(elsewhere, symlinkRoot);
      try {
        await expect(ensureWriteBasePath(symlinkRoot)).rejects.toBeInstanceOf(UnsafeSecretLocationError);
      } finally {
        await rm(symlinkRoot, { force: true });
      }
    } finally {
      await rm(elsewhere, { recursive: true, force: true });
    }
  });

  it('rejects a symlinked tenant directory without writing outside the store', async () => {
    const elsewhere = await mkdtemp(path.join(os.tmpdir(), 'alga-fs-tenant-link-'));
    try {
      const linkPath = await tenantDir(rootDir, 'evil-tenant');
      await mkdir(path.dirname(linkPath), { recursive: true });
      await symlink(elsewhere, linkPath);

      await expect(ensurePrivateDirectory(linkPath)).rejects.toBeInstanceOf(UnsafeSecretLocationError);

      expect(await readdir(elsewhere)).toEqual([]);
    } finally {
      await rm(elsewhere, { recursive: true, force: true });
    }
  });

  it('rejects a symlinked secret file and a non-regular-file target instead of replacing them', async () => {
    const filePath = await tenantSecret('tenant-file', 'token');
    await ensurePrivateDirectory(await tenantDir(rootDir, 'tenant-file'));

    const elsewhere = await mkdtemp(path.join(os.tmpdir(), 'alga-fs-file-link-'));
    try {
      await symlink(elsewhere, filePath);
      await expect(writeTenantSecretAtomic(filePath, SECRET_VALUE)).rejects.toThrow(InvalidSecretPathError);
      expect(await readdir(elsewhere)).toEqual([]);
    } finally {
      await rm(elsewhere, { recursive: true, force: true });
    }

    await fsPromises.unlink(filePath);
    await mkdir(filePath);
    await expect(writeTenantSecretAtomic(filePath, SECRET_VALUE)).rejects.toThrow(InvalidSecretPathError);
  });
});

describe('fsSecretCore deletion path validation', () => {
  const DECOY_VALUE = 'decoy-file-that-deletion-must-never-touch';

  it('deletes a secret through the validated chain and is idempotent', async () => {
    const filePath = await seedTenantSecret('tenant-delete', 'token', SECRET_VALUE);
    expect(await readFileContentSafe(filePath)).toBe(SECRET_VALUE);

    await unlinkTenantSecret(rootDir, 'tenant-delete', 'token');
    expect(await readFileContentSafe(filePath)).toBeUndefined();

    // Absent file and absent tenant directory both resolve without error.
    await unlinkTenantSecret(rootDir, 'tenant-delete', 'token');
    await unlinkTenantSecret(rootDir, 'tenant-never-existed', 'token');
  });

  it('refuses to delete through a symlinked per-tenant directory and leaves the target intact', async () => {
    const elsewhere = await mkdtemp(path.join(os.tmpdir(), 'alga-fs-del-tenant-'));
    try {
      const decoy = path.join(elsewhere, 'token');
      await writeFile(decoy, DECOY_VALUE);

      await ensurePrivateDirectory(await tenantsDir(rootDir));
      await symlink(elsewhere, await tenantDir(rootDir, 'evil-tenant'));

      await expect(unlinkTenantSecret(rootDir, 'evil-tenant', 'token')).rejects.toThrow(InvalidSecretPathError);

      expect(await readFile(decoy, 'utf-8')).toBe(DECOY_VALUE);
    } finally {
      await rm(elsewhere, { recursive: true, force: true });
    }
  });

  it('refuses to delete through a symlinked tenants/ directory and leaves the target intact', async () => {
    const elsewhere = await mkdtemp(path.join(os.tmpdir(), 'alga-fs-del-tenants-'));
    try {
      const decoy = path.join(elsewhere, 't1', 'token');
      await mkdir(path.dirname(decoy), { recursive: true });
      await writeFile(decoy, DECOY_VALUE);

      const base = path.join(rootDir, 'store-linked-tenants');
      await mkdir(base, { recursive: true });
      await symlink(elsewhere, path.join(base, 'tenants'));

      await expect(unlinkTenantSecret(base, 't1', 'token')).rejects.toThrow(InvalidSecretPathError);

      expect(await readFile(decoy, 'utf-8')).toBe(DECOY_VALUE);
    } finally {
      await rm(elsewhere, { recursive: true, force: true });
    }
  });

  it('refuses to delete through a symlinked root and leaves the target intact', async () => {
    const elsewhere = await mkdtemp(path.join(os.tmpdir(), 'alga-fs-del-root-'));
    try {
      const decoy = path.join(elsewhere, 'tenants', 't1', 'token');
      await mkdir(path.dirname(decoy), { recursive: true });
      await writeFile(decoy, DECOY_VALUE);

      const linkRoot = path.join(rootDir, 'root-link');
      await symlink(elsewhere, linkRoot);

      await expect(unlinkTenantSecret(linkRoot, 't1', 'token')).rejects.toThrow(InvalidSecretPathError);

      expect(await readFile(decoy, 'utf-8')).toBe(DECOY_VALUE);
    } finally {
      await rm(elsewhere, { recursive: true, force: true });
    }
  });

  it('refuses to delete a symlinked secret file and leaves the target intact', async () => {
    const elsewhere = await mkdtemp(path.join(os.tmpdir(), 'alga-fs-del-file-'));
    try {
      const decoy = path.join(elsewhere, 'real-secret');
      await writeFile(decoy, DECOY_VALUE);

      await ensurePrivateDirectory(await tenantDir(rootDir, 'tenant-file-link'));
      await symlink(decoy, await tenantSecret('tenant-file-link', 'token'));

      await expect(unlinkTenantSecret(rootDir, 'tenant-file-link', 'token')).rejects.toThrow(InvalidSecretPathError);

      expect(await readFile(decoy, 'utf-8')).toBe(DECOY_VALUE);
    } finally {
      await rm(elsewhere, { recursive: true, force: true });
    }
  });
});

describe('fsSecretCore root validation', () => {
  it('passes a safe root (0700, owned by the running user)', async () => {
    const resolved = await ensureWriteBasePath(rootDir);
    expect(resolved).toBe(rootDir);
    expect((await fsPromises.lstat(rootDir)).mode & 0o777).toBe(SECRET_DIR_MODE);
  });

  it('creates a missing root with 0700', async () => {
    const missing = path.join(rootDir, 'nested', 'store');
    const resolved = await ensureWriteBasePath(missing);
    expect(resolved).toBe(missing);
    expect((await fsPromises.lstat(missing)).mode & 0o777).toBe(SECRET_DIR_MODE);
  });

  it('refuses writes with an actionable operator message when the root mode is unsafe', async () => {
    await fsPromises.chmod(rootDir, 0o755);

    await expect(ensureWriteBasePath(rootDir)).rejects.toSatisfy((error: unknown) => {
      if (!(error instanceof UnsafeSecretLocationError)) return false;
      expect(error.message).toContain(rootDir);
      expect(error.message).toContain('0700');
      expect(error.message).toContain('chmod 700');
      return true;
    });
  });

  it('continues to allow reads of a legacy-moded store while refusing writes', async () => {
    const filePath = await seedTenantSecret('tenant-legacy', 'token', SECRET_VALUE);
    await fsPromises.chmod(rootDir, 0o755);
    await fsPromises.chmod(await tenantDir(rootDir, 'tenant-legacy'), 0o755);

    expect(await readFileContentSafe(filePath)).toBe(SECRET_VALUE);
    await expect(ensureWriteBasePath(rootDir)).rejects.toBeInstanceOf(UnsafeSecretLocationError);
  });
});

describe('FileSystemSecretProvider provider round trip', () => {
  it('round-trips a tenant secret through the provider API without logging its value', async () => {
    const resultPath = path.join(rootDir, 'provider-result');
    const program = providerProgram(rootDir, [
      'console.debug = console.error;',
      '(async () => {',
      '  const p = new FileSystemSecretProvider();',
      `  await p.setTenantSecret('tenant-roundtrip', 'qbo_token', ${JSON.stringify(SECRET_VALUE)});`,
      '  const v = await p.getTenantSecret(process.argv[1], process.argv[2]);',
      `  writeFileSync(${JSON.stringify(resultPath)}, v || 'NULL');`,
      '})().catch((e) => { console.error(e); process.exit(1); });',
    ].join('\n'));

    const { stdout, stderr } = await runProviderProgram(program, ['tenant-roundtrip', 'qbo_token']);

    expect(await readFile(resultPath, 'utf-8')).toBe(SECRET_VALUE);
    const allOutput = `${stdout}\n${stderr}`;
    expect(allOutput).not.toContain(SECRET_VALUE);
  });

  it('deletes a tenant secret through the provider API (write, delete, read returns undefined)', async () => {
    const resultPath = path.join(rootDir, 'provider-result');
    const program = providerProgram(rootDir, [
      '(async () => {',
      '  const p = new FileSystemSecretProvider();',
      `  await p.setTenantSecret(process.argv[1], process.argv[2], ${JSON.stringify(SECRET_VALUE)});`,
      '  await p.deleteTenantSecret(process.argv[1], process.argv[2]);',
      '  const v = await p.getTenantSecret(process.argv[1], process.argv[2]);',
      `  writeFileSync(${JSON.stringify(resultPath)}, v === undefined ? 'DELETED' : 'STILL_PRESENT');`,
      '})().catch((e) => { console.error(e); process.exit(1); });',
    ].join('\n'));

    const { stdout, stderr } = await runProviderProgram(program, ['tenant-del-rt', 'xero_token']);

    expect(await readFile(resultPath, 'utf-8')).toBe('DELETED');
    expect(`${stdout}\n${stderr}`).not.toContain(SECRET_VALUE);
  });

  it('rejects deletion through a symlinked tenant directory instead of treating it as already deleted', async () => {
    const decoyDir = await mkdtemp(path.join(os.tmpdir(), 'alga-fs-provider-del-'));
    try {
      const decoy = path.join(decoyDir, 'qbo_token');
      await writeFile(decoy, 'decoy-outside-the-store');

      await ensurePrivateDirectory(await tenantsDir(rootDir));
      await symlink(decoyDir, await tenantDir(rootDir, 'evil-tenant'));

      const resultPath = path.join(rootDir, 'provider-result');
      const program = providerProgram(rootDir, [
        '(async () => {',
        '  const p = new FileSystemSecretProvider();',
        '  try {',
        '    await p.deleteTenantSecret(process.argv[1], process.argv[2]);',
        `    writeFileSync(${JSON.stringify(resultPath)}, 'UNEXPECTED_DELETE_OK');`,
        '  } catch (e) {',
        `    writeFileSync(${JSON.stringify(resultPath)}, 'REJECTED: ' + (e instanceof Error ? e.message : String(e)));`,
        '  }',
        '})().catch((e) => { console.error(e); process.exit(1); });',
      ].join('\n'));

      await runProviderProgram(program, ['evil-tenant', 'qbo_token']);

      const result = await readFile(resultPath, 'utf-8');
      expect(result).toContain('REJECTED');
      expect(result).toContain('symlink');
      expect(await readFile(decoy, 'utf-8')).toBe('decoy-outside-the-store');
    } finally {
      await rm(decoyDir, { recursive: true, force: true });
    }
  });

  it('continues reading from a legacy-moded store while refusing writes with the operator message', async () => {
    const resultPath = path.join(rootDir, 'provider-result');
    const tenant = 'tenant-read-legacy';
    const name = 'token';
    await seedTenantSecret(tenant, name, SECRET_VALUE);
    await fsPromises.chmod(rootDir, 0o755);

    const program = providerProgram(rootDir, [
      '(async () => {',
      '  const p = new FileSystemSecretProvider();',
      '  const v = await p.getTenantSecret(process.argv[1], process.argv[2]);',
      `  writeFileSync(${JSON.stringify(resultPath)}, v || 'NULL');`,
      '  try {',
      '    await p.setTenantSecret(process.argv[1], "other", "WRITE_SHOULD_FAIL_VALUE_12345");',
      `    writeFileSync(${JSON.stringify(`${resultPath}-write`)}, 'UNEXPECTED_WRITE_OK');`,
      '  } catch (e) {',
      `    writeFileSync(${JSON.stringify(`${resultPath}-write`)}, String(e instanceof Error ? e.message : e));`,
      '  }',
      '})().catch((e) => { console.error(e); process.exit(1); });',
    ].join('\n'));

    const { stdout, stderr } = await runProviderProgram(program, [tenant, name]);

    expect(await readFile(resultPath, 'utf-8')).toBe(SECRET_VALUE);
    const writeMessage = await readFile(`${resultPath}-write`, 'utf-8');
    expect(writeMessage).toContain('not safe for secret writes');
    expect(writeMessage).toContain('chmod 700');
    expect(writeMessage).not.toContain('WRITE_SHOULD_FAIL_VALUE_12345');
    const allOutput = `${stdout}\n${stderr}`;
    expect(allOutput).not.toContain(SECRET_VALUE);
  });

  it('loads from the compiled dist in plain node outside the package and round-trips a secret', async () => {
    // The tsx subprocess tests above resolve TypeScript source and cannot see
    // the runtime-loadability regression: a relative dynamic import hidden in
    // `new Function` cannot resolve in dist ESM, and in webpack source mode it
    // is never emitted. This probe runs plain `node` against the built dist
    // from a cwd outside the package, exercising the exact path real
    // deployments use. It skips when the dist has not been built.
    if (!existsSync(DIST_PROVIDER)) {
      return;
    }
    const probeDir = await mkdtemp(path.join(os.tmpdir(), 'alga-fs-dist-probe-'));
    try {
      const resultPath = path.join(probeDir, 'result');
      const program = [
        `import { FileSystemSecretProvider } from ${JSON.stringify(DIST_PROVIDER)};`,
        `import { writeFileSync } from 'node:fs';`,
        `process.env.SECRET_FS_BASE_PATH = ${JSON.stringify(probeDir)};`,
        '(async () => {',
        '  const p = new FileSystemSecretProvider();',
        '  await p.setTenantSecret(process.argv[1], process.argv[2], process.argv[3]);',
        '  const v = await p.getTenantSecret(process.argv[1], process.argv[2]);',
        `  writeFileSync(${JSON.stringify(resultPath)}, v || 'NULL');`,
        '})().catch((e) => { console.error(e); process.exit(1); });',
      ].join('\n');

      execFileSync('node', ['--input-type=module', '-e', program, 'dist-tenant', 'token', SECRET_VALUE], {
        cwd: probeDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      expect(await readFile(resultPath, 'utf-8')).toBe(SECRET_VALUE);
      expect((await fsPromises.lstat(path.join(probeDir, 'tenants', 'dist-tenant', 'token'))).mode & 0o777).toBe(SECRET_FILE_MODE);
    } finally {
      await rm(probeDir, { recursive: true, force: true });
    }
  });
});

describe('repair script', () => {
  async function createMisModesStore(): Promise<string> {
    const store = path.join(rootDir, 'repair-store');
    const secretFile = path.join(store, 'tenants', 't1', 'token');
    await mkdir(path.dirname(secretFile), { recursive: true });
    await writeFile(secretFile, SECRET_VALUE);
    await fsPromises.chmod(store, 0o755);
    await fsPromises.chmod(path.join(store, 'tenants'), 0o700);
    await fsPromises.chmod(path.join(store, 'tenants', 't1'), 0o755);
    await fsPromises.chmod(secretFile, 0o644);
    return store;
  }

  function runRepairScript(args: string[]): { status: number; output: string } {
    try {
      const output = execFileSync('bash', [REPAIR_SCRIPT, ...args], { encoding: 'utf8' });
      return { status: 0, output };
    } catch (error) {
      const err = error as { status?: number; stdout?: string; stderr?: string; message: string };
      return { status: err.status ?? 1, output: `${err.stdout ?? ''}${err.stderr ?? ''}` || err.message };
    }
  }

  it('dry-run reports mode issues, exits non-zero, and does not mutate the store', async () => {
    const store = await createMisModesStore();
    const secretFile = path.join(store, 'tenants', 't1', 'token');

    const { status, output } = runRepairScript(['--path', store]);

    expect(status).not.toBe(0);
    expect(output).toContain('Dry run');
    expect(output).toContain('mode 755 (expected 700)');
    expect(output).toContain('mode 644 (expected 600)');
    expect((await fsPromises.lstat(store)).mode & 0o777).toBe(0o755);
    expect((await fsPromises.lstat(secretFile)).mode & 0o777).toBe(0o644);
    expect(await readFile(secretFile, 'utf-8')).toBe(SECRET_VALUE);
  });

  it('dry-run exits zero on an already-safe store', async () => {
    const store = path.join(rootDir, 'clean-store');
    await mkdir(path.join(store, 'tenants', 't1'), { recursive: true });
    await writeFile(path.join(store, 'tenants', 't1', 'token'), SECRET_VALUE);
    await fsPromises.chmod(path.join(store, 'tenants', 't1', 'token'), 0o600);
    for (const dir of [store, path.join(store, 'tenants'), path.join(store, 'tenants', 't1')]) {
      await fsPromises.chmod(dir, 0o700);
    }

    const { status, output } = runRepairScript(['--path', store]);

    expect(status).toBe(0);
    expect(output).toContain('Store is clean');
  });

  it('--apply fixes modes without touching file contents', async () => {
    const store = await createMisModesStore();
    const secretFile = path.join(store, 'tenants', 't1', 'token');

    execFileSync('bash', [REPAIR_SCRIPT, '--apply', '--path', store], { encoding: 'utf8' });

    expect((await fsPromises.lstat(store)).mode & 0o777).toBe(SECRET_DIR_MODE);
    expect((await fsPromises.lstat(path.join(store, 'tenants', 't1'))).mode & 0o777).toBe(SECRET_DIR_MODE);
    expect((await fsPromises.lstat(secretFile)).mode & 0o777).toBe(SECRET_FILE_MODE);
    expect(await readFile(secretFile, 'utf-8')).toBe(SECRET_VALUE);
  });

  it('reports symlinks for manual intervention and never follows them', async () => {
    const store = await createMisModesStore();
    const linkTarget = path.join(rootDir, 'link-target');
    await writeFile(linkTarget, SECRET_VALUE);
    const linkPath = path.join(store, 'tenants', 't1', 'link');
    await symlink(linkTarget, linkPath);

    const { status, output } = runRepairScript(['--apply', '--path', store]);

    // Symlink issues remain after --apply, so the script must not claim success.
    expect(status).not.toBe(0);
    expect(output).toContain('Symlink');

    expect((await fsPromises.lstat(linkPath)).isSymbolicLink()).toBe(true);
    expect(await readFile(linkTarget, 'utf-8')).toBe(SECRET_VALUE);
  });

  it('documented procedure (dry-run, --apply, verify) yields a store the provider can write to', async () => {
    // A store with wrong modes everywhere, including a tenant directory that
    // cannot even be traversed (0000) until its own mode is repaired — the
    // repair must descend into it on a later pass and fix its contents too.
    const store = path.join(rootDir, 'procedure-store');
    const lockedDir = path.join(store, 'tenants', 't2');
    const lockedFile = path.join(lockedDir, 'token');
    const secretFile = path.join(store, 'tenants', 't1', 'token');
    await mkdir(path.dirname(secretFile), { recursive: true });
    await mkdir(lockedDir, { recursive: true });
    await writeFile(secretFile, SECRET_VALUE);
    await writeFile(lockedFile, SECRET_VALUE);
    await fsPromises.chmod(secretFile, 0o644);
    await fsPromises.chmod(lockedFile, 0o644);
    await fsPromises.chmod(path.join(store, 'tenants', 't1'), 0o755);
    await fsPromises.chmod(store, 0o755);
    await fsPromises.chmod(lockedDir, 0o000);

    try {
      // Step 1 (documented): dry run reports and exits non-zero, mutating nothing.
      const dryRun = runRepairScript(['--path', store]);
      expect(dryRun.status).not.toBe(0);
      expect(dryRun.output).toContain('Dry run');
      expect((await fsPromises.lstat(store)).mode & 0o777).toBe(0o755);

      // Step 2 (documented): --apply fixes everything fixable and exits zero.
      const apply = runRepairScript(['--apply', '--path', store]);
      expect(apply.status).toBe(0);
      expect(apply.output).toContain('Store is safe');

      expect((await fsPromises.lstat(store)).mode & 0o777).toBe(SECRET_DIR_MODE);
      expect((await fsPromises.lstat(lockedDir)).mode & 0o777).toBe(SECRET_DIR_MODE);
      expect((await fsPromises.lstat(lockedFile)).mode & 0o777).toBe(SECRET_FILE_MODE);
      expect((await fsPromises.lstat(secretFile)).mode & 0o777).toBe(SECRET_FILE_MODE);
      expect(await readFile(secretFile, 'utf-8')).toBe(SECRET_VALUE);
      expect(await readFile(lockedFile, 'utf-8')).toBe(SECRET_VALUE);

      // Step 3 (documented): the verification dry run now reports clean.
      const verify = runRepairScript(['--path', store]);
      expect(verify.status).toBe(0);
      expect(verify.output).toContain('Store is clean');

      // The point of the procedure: the provider can actually write secrets
      // to the repaired store, and read back both old and new values.
      const resultPath = path.join(rootDir, 'procedure-result');
      const program = providerProgram(store, [
        '(async () => {',
        '  const p = new FileSystemSecretProvider();',
        `  await p.setTenantSecret('t3', 'new_token', ${JSON.stringify(SECRET_VALUE)});`,
        "  const oldValue = await p.getTenantSecret('t1', 'token');",
        "  const newValue = await p.getTenantSecret('t3', 'new_token');",
        `  writeFileSync(${JSON.stringify(resultPath)}, oldValue === newValue && newValue !== undefined ? 'WRITABLE' : 'MISMATCH');`,
        '})().catch((e) => { console.error(e); process.exit(1); });',
      ].join('\n'));
      const { stdout, stderr } = await runProviderProgram(program);

      expect(await readFile(resultPath, 'utf-8')).toBe('WRITABLE');
      expect(`${stdout}\n${stderr}`).not.toContain(SECRET_VALUE);
    } finally {
      // Restore traversability so afterEach can remove rootDir even when an
      // assertion fails before the repair runs.
      await fsPromises.chmod(lockedDir, 0o700).catch(() => undefined);
    }
  });

  it.runIf(HAS_USERNS)('--apply --uid as root fixes mode and ownership together, including the root itself', async () => {
    const store = path.join(rootDir, 'chown-store');
    const secretFile = path.join(store, 'tenants', 't1', 'token');
    await mkdir(path.dirname(secretFile), { recursive: true });
    await writeFile(secretFile, SECRET_VALUE);
    await fsPromises.chmod(secretFile, 0o644);
    await fsPromises.chmod(path.join(store, 'tenants', 't1'), 0o755);
    await fsPromises.chmod(path.join(store, 'tenants'), 0o700);
    await fsPromises.chmod(store, 0o755);

    // Inside `unshare -r --map-auto` the test uid maps to root (0) and a
    // subordinate range is available, so chown to uid 1 really executes. All
    // entries are owned by ns-uid 0 while the target is uid 1: every entry
    // needs a chown, and the wrong-moded ones (including the root) need a
    // chmod in the same pass. Ownership is restored to ns-uid 0 (the real
    // test uid outside) before leaving the namespace so cleanup works.
    const script = [
      'set -e',
      'REPAIR="$0"; STORE="$1"',
      'bash "$REPAIR" --apply --path "$STORE" --uid 1',
      'stat -c "%u %a" "$STORE" "$STORE/tenants" "$STORE/tenants/t1" "$STORE/tenants/t1/token"',
      'chown -R 0 "$STORE"',
    ].join('\n');
    const output = execFileSync('unshare', ['-r', '--map-auto', 'bash', '-c', script, REPAIR_SCRIPT, store], {
      encoding: 'utf8',
    });

    // The root had both a wrong mode and (relative to --uid 1) a wrong owner:
    // both must be fixed, not just one.
    expect(output).toContain(`Fixed dir mode to 700: ${store}`);
    expect(output).toContain(`Fixed owner to uid 1: ${store}`);
    expect(output).toContain('Store is safe');
    const stats = output.trim().split('\n').filter((line) => /^\d+ \d+$/.test(line.trim()));
    expect(stats).toEqual(['1 700', '1 700', '1 700', '1 600']);

    expect((await fsPromises.lstat(store)).mode & 0o777).toBe(SECRET_DIR_MODE);
    expect((await fsPromises.lstat(secretFile)).mode & 0o777).toBe(SECRET_FILE_MODE);
    expect(await readFile(secretFile, 'utf-8')).toBe(SECRET_VALUE);
  });

  it.runIf(HAS_USERNS)('--apply without --uid exits non-zero when ownership is mixed', async () => {
    const store = path.join(rootDir, 'mixed-owner-store');
    const secretFile = path.join(store, 'tenants', 't1', 'token');
    await mkdir(path.dirname(secretFile), { recursive: true });
    await writeFile(secretFile, SECRET_VALUE);
    await fsPromises.chmod(secretFile, 0o600);
    for (const dir of [store, path.join(store, 'tenants'), path.join(store, 'tenants', 't1')]) {
      await fsPromises.chmod(dir, 0o700);
    }

    // Modes are already correct; only one file's owner differs from the store
    // root's owner. Without --uid the script cannot fix it — it must report
    // the mismatch and refuse to claim success.
    const script = [
      'REPAIR="$0"; STORE="$1"',
      'chown 1 "$STORE/tenants/t1/token"',
      'if bash "$REPAIR" --apply --path "$STORE"; then echo "EXIT_ZERO"; else echo "EXIT_NONZERO"; fi',
      'chown -R 0 "$STORE"',
    ].join('\n');
    const output = execFileSync('unshare', ['-r', '--map-auto', 'bash', '-c', script, REPAIR_SCRIPT, store], {
      encoding: 'utf8',
    });

    expect(output).toContain('Owner mismatch');
    expect(output).toContain('EXIT_NONZERO');
    expect(await readFile(secretFile, 'utf-8')).toBe(SECRET_VALUE);
  });
});

describe('fsSecretCore store scan and repair functions', () => {
  it('scanSecretStoreModes reports unsafe modes and repairSecretStoreModes applies only mode fixes', async () => {
    const store = path.join(rootDir, 'scan-store');
    const filePath = path.join(store, 'tenants', 't1', 'token');
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, SECRET_VALUE);
    await fsPromises.chmod(store, 0o755);
    await fsPromises.chmod(filePath, 0o644);

    const issues = await scanSecretStoreModes(store);
    expect(issues.some((issue) => issue.path === store && issue.current === '755')).toBe(true);
    expect(issues.some((issue) => issue.path === filePath && issue.current === '644')).toBe(true);

    const fixed = await repairSecretStoreModes(store);
    expect(fixed.some((issue) => issue.path === store)).toBe(true);
    expect(fixed.some((issue) => issue.path === filePath)).toBe(true);
    expect((await fsPromises.lstat(store)).mode & 0o777).toBe(SECRET_DIR_MODE);
    expect((await fsPromises.lstat(filePath)).mode & 0o777).toBe(SECRET_FILE_MODE);
    expect(await readFile(filePath, 'utf-8')).toBe(SECRET_VALUE);
  });
});
