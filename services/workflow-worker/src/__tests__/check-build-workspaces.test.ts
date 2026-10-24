import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workerRoot = fileURLToPath(new URL('../../', import.meta.url));
const dockerfile = path.join(workerRoot, 'Dockerfile');

function checkBuildWorkspaces(input: string) {
  return spawnSync(process.execPath, [path.join(workerRoot, 'scripts/check-build-workspaces.mjs'), input], {
    encoding: 'utf8',
    timeout: 30_000,
  });
}

describe('workflow-worker dependency install inputs', () => {
  it('resolves the full local dependency closure and workspace selectors from the Dockerfile', () => {
    const result = checkBuildWorkspaces(dockerfile);

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Build workspace check passed:');
  });

  it('rejects a chat manifest copied only after dependency installation', () => {
    const temporary = mkdtempSync(path.join(tmpdir(), 'workflow-build-inputs-test-'));
    try {
      // Reproduce the missing transitive dependency even though the later
      // source COPY would eventually make this package available in the image.
      const input = readFileSync(dockerfile, 'utf8');
      const manifestCopy = 'COPY packages/product-chat/package.json ./packages/product-chat/';
      const fixture = path.join(temporary, 'Dockerfile');
      writeFileSync(fixture, input.replace(`${manifestCopy}\n`, '') + `\n${manifestCopy}\n`);

      const result = checkBuildWorkspaces(fixture);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Missing transitive workspace manifests: @product/chat');
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});
