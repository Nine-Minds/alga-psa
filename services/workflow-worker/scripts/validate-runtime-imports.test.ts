import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

async function createDistFixture(files: Record<string, string>): Promise<string> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-worker-validate-'));
  await Promise.all(
    Object.entries(files).map(async ([relPath, source]) => {
      const absPath = path.join(tempRoot, relPath);
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, source, 'utf8');
    }),
  );
  return tempRoot;
}

async function removeDirIfExists(dirPath: string): Promise<void> {
  await fs.rm(dirPath, { recursive: true, force: true });
}

describe('validate-runtime-imports', () => {
  const tempDirs: string[] = [];
  const scriptPath = path.resolve(process.cwd(), 'scripts/validate-runtime-imports.mjs');

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dirPath = tempDirs.pop();
      if (dirPath) {
        await removeDirIfExists(dirPath);
      }
    }
  });

  it('passes when startup graph uses resolvable worker-safe imports only', async () => {
    const distRoot = await createDistFixture({
      'dist/src/index.js': "import './ok.js';\n",
      'dist/src/ok.js': 'export const ok = true;\n',
    });
    tempDirs.push(distRoot);

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        WORKFLOW_WORKER_VALIDATE_DIST_ROOT: path.join(distRoot, 'dist'),
      },
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('validation passed');
  });

  it('fails when unresolved @shared alias appears in runtime startup graph', async () => {
    const distRoot = await createDistFixture({
      'dist/src/index.js': "import '@shared/task-inbox';\n",
    });
    tempDirs.push(distRoot);

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        WORKFLOW_WORKER_VALIDATE_DIST_ROOT: path.join(distRoot, 'dist'),
      },
      encoding: 'utf8',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('unresolved @shared alias is not allowed');
  });

  it('fails when runtime startup graph contains repo-layout-relative source hops', async () => {
    const distRoot = await createDistFixture({
      'dist/src/index.js': "import '../../../../../../shared/workflow/runtime/init.js';\n",
    });
    tempDirs.push(distRoot);

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        WORKFLOW_WORKER_VALIDATE_DIST_ROOT: path.join(distRoot, 'dist'),
      },
      encoding: 'utf8',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('relative import does not resolve in dist output');
  });

  it('allows AI runtime wiring only through the dedicated runtime/worker entrypoint', async () => {
    const distRoot = await createDistFixture({
      'dist/src/index.js': "import '../../ee/packages/workflows/src/runtime/worker.js';\n",
      'dist/ee/packages/workflows/src/runtime/worker.js': [
        "import '../../../../../shared/workflow/runtime/actions/registerAiActions.js';",
        "import '../../../../../packages/ee/src/services/workflowInferenceService.js';",
        'export const ok = true;',
        '',
      ].join('\n'),
    });
    tempDirs.push(distRoot);

    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        WORKFLOW_WORKER_VALIDATE_DIST_ROOT: path.join(distRoot, 'dist'),
      },
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('validation passed');
  });
});
