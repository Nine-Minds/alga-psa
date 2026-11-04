import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const scriptPath = fileURLToPath(new URL('../../scripts/check-build-workspaces.mjs', import.meta.url));
const dockerfilePath = fileURLToPath(new URL('../../Dockerfile', import.meta.url));

function runCheck(dockerfile: string) {
  return spawnSync(process.execPath, [scriptPath, dockerfile], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
}

describe('check-build-workspaces', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
  });

  it('accepts the worker Dockerfile: every transitive workspace manifest is staged before npm install', () => {
    const result = runCheck(dockerfilePath);

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Build workspace check passed');
  }, 60_000);

  it('rejects a Dockerfile that omits the @alga-psa/co-managed manifest required by temporal-workflows', async () => {
    const source = await fs.readFile(dockerfilePath, 'utf8');
    const copyLine = 'COPY packages/co-managed/package.json ./packages/co-managed/\n';
    expect(source).toContain(copyLine);

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-worker-build-workspaces-'));
    tempDirs.push(tempDir);
    const mutated = path.join(tempDir, 'Dockerfile');
    await fs.writeFile(mutated, source.replace(copyLine, ''), 'utf8');

    const result = runCheck(mutated);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Missing transitive workspace manifests: @alga-psa/co-managed');
  }, 60_000);
});
