import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { discoverEnvironment, selectDiscoveredSite } from '../lib/environment.mjs';
import { resolveConfigBase, resolveRuntimePaths } from '../lib/runtime-paths.mjs';

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

test('resolveConfigBase defaults to a product-owned appliance config home', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'appliance-operator-home-'));
  assert.equal(resolveConfigBase(home), path.join(home, '.alga-psa-appliance'));
});

test('environment discovery defers site selection in TUI mode when multiple sites exist', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'appliance-operator-home-'));
  for (const siteId of ['site-a', 'site-b']) {
    const siteDir = path.join(home, '.alga-psa-appliance', siteId);
    fs.mkdirSync(siteDir, { recursive: true });
    fs.writeFileSync(path.join(siteDir, 'kubeconfig'), 'fake');
    fs.writeFileSync(path.join(siteDir, 'talosconfig'), 'fake');
  }

  const env = discoverEnvironment({
    homeDir: home,
    cwd: path.resolve(__dirname, 'fixtures/runtime-repo'),
    allowAmbiguousSiteSelection: true,
  });

  assert.equal(env.siteSelectionRequired, true);
  assert.equal(env.site, null);

  const selected = selectDiscoveredSite(env, 'site-b');
  assert.equal(selected.site.siteId, 'site-b');
  assert.equal(selected.paths.kubeconfig, path.join(home, '.alga-psa-appliance', 'site-b', 'kubeconfig'));
});
