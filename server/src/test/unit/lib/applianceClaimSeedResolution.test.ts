import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveOnboardingSeedPath } from '../../../../../packages/auth/src/lib/applianceClaim';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appliance-claim-seeds-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('resolveOnboardingSeedPath', () => {
  it('resolves EE onboarding seeds from the repository root', () => {
    const testFile = fileURLToPath(import.meta.url);
    const repoRoot = path.resolve(path.dirname(testFile), '../../../../../');

    const seedPath = resolveOnboardingSeedPath('01_roles.cjs', { cwd: repoRoot });

    expect(seedPath).toBe(path.join(repoRoot, 'ee/server/seeds/onboarding/01_roles.cjs'));
  });

  it('resolves onboarding seeds from /server/seeds/onboarding when running from the server cwd', () => {
    const runtimeRoot = makeTempDir();
    const serverCwd = path.join(runtimeRoot, 'server');
    const moduleDirectory = path.join(runtimeRoot, 'packages/auth/src/lib');
    const seedPath = path.join(serverCwd, 'seeds/onboarding/01_roles.cjs');

    fs.mkdirSync(path.dirname(seedPath), { recursive: true });
    fs.mkdirSync(moduleDirectory, { recursive: true });
    fs.writeFileSync(seedPath, 'exports.seed = async function seed() {};\n', 'utf8');

    const resolvedPath = resolveOnboardingSeedPath('01_roles.cjs', {
      cwd: serverCwd,
      moduleDirectory,
    });

    expect(resolvedPath).toBe(seedPath);
  });
});
