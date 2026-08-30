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

let rootDir: string;
let previousUmask: number;

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

  function providerProgram(script: string): string {
    return [
      `import { FileSystemSecretProvider } from ${JSON.stringify(PROVIDER_FILE)};`,
      `import { writeFileSync } from 'node:fs';`,
      `process.env.SECRET_FS_BASE_PATH = ${JSON.stringify(rootDir)};`,
      script,
    ].join('\n');
  }

  it('round-trips a tenant secret through the provider API without logging its value', async () => {
    const resultPath = path.join(rootDir, 'provider-result');
    const program = providerProgram([
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

  it('continues reading from a legacy-moded store while refusing writes with the operator message', async () => {
    const resultPath = path.join(rootDir, 'provider-result');
    const tenant = 'tenant-read-legacy';
    const name = 'token';
    await seedTenantSecret(tenant, name, SECRET_VALUE);
    await fsPromises.chmod(rootDir, 0o755);

    const program = providerProgram([
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

  it('dry-run reports mode issues without mutating the store', async () => {
    const store = await createMisModesStore();
    const secretFile = path.join(store, 'tenants', 't1', 'token');

    const output = execFileSync('bash', [REPAIR_SCRIPT, '--path', store], { encoding: 'utf8' });

    expect(output).toContain('Dry run');
    expect(output).toContain('mode 755 (expected 700)');
    expect(output).toContain('mode 644 (expected 600)');
    expect((await fsPromises.lstat(store)).mode & 0o777).toBe(0o755);
    expect((await fsPromises.lstat(secretFile)).mode & 0o777).toBe(0o644);
    expect(await readFile(secretFile, 'utf-8')).toBe(SECRET_VALUE);
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

    let result = '';
    try {
      result = execFileSync('bash', [REPAIR_SCRIPT, '--apply', '--path', store], { encoding: 'utf8' });
    } catch (error) {
      // Symlink issues remain after --apply, so the script exits non-zero.
      const err = error as { stdout?: string; message: string };
      result = err.stdout ?? err.message;
    }
    expect(result).toContain('Symlink');

    expect((await fsPromises.lstat(linkPath)).isSymbolicLink()).toBe(true);
    expect(await readFile(linkTarget, 'utf-8')).toBe(SECRET_VALUE);
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
