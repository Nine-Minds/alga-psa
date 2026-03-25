import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { resolveRuntimePaths } from '../lib/runtime-paths.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('T006: resolves repo runtime paths from repository layout', () => {
  const fixtureRoot = path.resolve(__dirname, 'fixtures/runtime-repo');
  const nestedCwd = path.join(fixtureRoot, 'ee/appliance/releases');
  const runtime = resolveRuntimePaths({ cwd: nestedCwd });

  assert.equal(runtime.runtimeMode, 'repo');
  assert.equal(runtime.repoRoot, fixtureRoot);
  assert.equal(runtime.bootstrapScript, path.join(fixtureRoot, 'ee/appliance/scripts/bootstrap-appliance.sh'));
  assert.equal(runtime.releasesDir, path.join(fixtureRoot, 'ee/appliance/releases'));
});

test('T006: resolves standalone asset-root runtime paths', () => {
  const fixtureRoot = path.resolve(__dirname, 'fixtures/runtime-bundle');
  const runtime = resolveRuntimePaths({ assetRoot: fixtureRoot });

  assert.equal(runtime.runtimeMode, 'asset-root');
  assert.equal(runtime.assetRoot, fixtureRoot);
  assert.equal(runtime.bootstrapScript, path.join(fixtureRoot, 'scripts/bootstrap-appliance.sh'));
  assert.equal(runtime.releasesDir, path.join(fixtureRoot, 'releases'));
});
