import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

async function createDistFixture(files: Record<string, string>): Promise<string> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-worker-storage-validate-'));
  await Promise.all(
    Object.entries(files).map(async ([relPath, source]) => {
      const absPath = path.join(tempRoot, relPath);
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, source, 'utf8');
    }),
  );
  return tempRoot;
}

describe('validate-native-storage-imports', () => {
  const tempDirs: string[] = [];
  const scriptPath = fileURLToPath(new URL('../../scripts/validate-native-storage-imports.mjs', import.meta.url));

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dirPath = tempDirs.pop();
      if (dirPath) {
        await fs.rm(dirPath, { recursive: true, force: true });
      }
    }
  });

  function run(distRoot: string, extraEnv: Record<string, string> = {}) {
    return spawnSync(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        WORKFLOW_WORKER_STORAGE_DIST_ROOT: path.join(distRoot, 'dist'),
        ...extraEnv,
      },
      encoding: 'utf8',
    });
  }

  it('passes when the built graph uses narrow storage subpaths only', async () => {
    const distRoot = await createDistFixture({
      'dist/shared/helper.js': [
        "await import('@alga-psa/storage/config/storage');",
        "await import('@alga-psa/storage/StorageProviderFactory');",
      ].join('\n'),
    });
    tempDirs.push(distRoot);

    const result = run(distRoot);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('validation passed');
  });

  it('fails when the built graph imports the @alga-psa/storage barrel', async () => {
    const distRoot = await createDistFixture({
      'dist/shared/helper.js': "await import('@alga-psa/storage');\n",
    });
    tempDirs.push(distRoot);

    const result = run(distRoot);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('must not import the @alga-psa/storage barrel');
  });

  it('fails when a referenced storage subpath does not resolve under plain node', async () => {
    const distRoot = await createDistFixture({
      'dist/shared/helper.js': "await import('@alga-psa/storage/does-not-exist');\n",
    });
    tempDirs.push(distRoot);

    const result = run(distRoot);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('failed to resolve under plain node');
  });

  it('fails when the storage dist is stale (only tsconfig.tsbuildinfo, no entry outputs)', async () => {
    const distRoot = await createDistFixture({
      'dist/shared/helper.js': "await import('@alga-psa/storage/config/storage');\n",
    });
    tempDirs.push(distRoot);
    const staleStorageDist = path.join(distRoot, 'storage-dist');
    await fs.mkdir(staleStorageDist, { recursive: true });
    await fs.writeFile(path.join(staleStorageDist, 'tsconfig.tsbuildinfo'), '{}', 'utf8');

    // A no-op build cannot repair the stale dist, so the guard must fail loudly
    // instead of importing a missing entry module later.
    const result = run(distRoot, {
      WORKFLOW_WORKER_STORAGE_DIST: staleStorageDist,
      WORKFLOW_WORKER_STORAGE_BUILD_CMD: 'true',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('is incomplete after build');
    expect(result.stderr).toContain('config/storage.mjs');
  });

  it('rebuilds when required storage entry outputs are missing', async () => {
    const distRoot = await createDistFixture({
      'dist/shared/helper.js': "await import('@alga-psa/storage/StorageProviderFactory');\n",
    });
    tempDirs.push(distRoot);
    const staleStorageDist = path.join(distRoot, 'storage-dist');
    await fs.mkdir(staleStorageDist, { recursive: true });
    await fs.writeFile(path.join(staleStorageDist, 'tsconfig.tsbuildinfo'), '{}', 'utf8');

    // Inject a fake build that writes the exact entry outputs the guard checks
    // for, proving the guard rebuilds when they are absent.
    const buildCommand =
      'node -e "const fs=require(\'fs\'),path=require(\'path\');' +
      'const d=process.env.WORKFLOW_WORKER_STORAGE_DIST;' +
      'fs.mkdirSync(path.join(d,\'config\'),{recursive:true});' +
      '[\'index.mjs\',\'config/storage.mjs\',\'StorageProviderFactory.mjs\'].forEach(f=>fs.writeFileSync(path.join(d,f),\'export {};\'));"';

    const result = run(distRoot, {
      WORKFLOW_WORKER_STORAGE_DIST: staleStorageDist,
      WORKFLOW_WORKER_STORAGE_BUILD_CMD: buildCommand,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('validation passed');
    for (const rel of ['index.mjs', 'config/storage.mjs', 'StorageProviderFactory.mjs']) {
      await expect(fs.stat(path.join(staleStorageDist, rel))).resolves.toBeTruthy();
    }
  });
});
