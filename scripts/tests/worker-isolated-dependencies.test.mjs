import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '../..');

for (const target of ['packages/integrations', 'ee/temporal-workflows']) {
  test(`${target} installs internal dependencies outside the root workspace`, t => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'worker-isolated-deps-')));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const manifest = JSON.parse(readFileSync(path.join(repoRoot, target, 'package.json'), 'utf8'));
    const dependencies = Object.fromEntries(Object.entries(manifest.dependencies)
      .filter(([name]) => name.startsWith('@alga-psa/')));
    const packageDir = path.join(root, target);
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({
      name: manifest.name, version: manifest.version, private: true, dependencies,
    }));

    // Keep the image's directory layout, but replace dependency implementations
    // with leaves. This exercises npm's actual resolution of the production
    // specifiers without downloading third-party packages or building the app.
    const expectedPaths = new Map();
    for (const name of Object.keys(dependencies)) {
      const relative = name === '@alga-psa/shared' ? 'shared'
        : name === '@alga-psa/workflows' ? 'ee/packages/workflows'
          : `packages/${name.slice('@alga-psa/'.length)}`;
      const source = JSON.parse(readFileSync(path.join(repoRoot, relative, 'package.json'), 'utf8'));
      const directory = path.join(root, relative);
      mkdirSync(directory, { recursive: true });
      writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: source.name, version: source.version }));
      expectedPaths.set(name, directory);
    }

    const result = spawnSync('npm', [
      'install', '--ignore-scripts', '--legacy-peer-deps', '--offline',
      '--no-audit', '--no-fund', '--cache', path.join(root, 'npm-cache'),
    ], { cwd: packageDir, encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);

    const require = createRequire(path.join(packageDir, 'package.json'));
    for (const [name, directory] of expectedPaths) {
      assert.equal(realpathSync(require.resolve(`${name}/package.json`)),
        path.join(directory, 'package.json'), `${name} must resolve to its local package`);
    }
  });
}
