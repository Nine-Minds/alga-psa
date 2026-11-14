import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import nextConfig from '../../server/next.config.mjs';

const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack');

for (const dev of [false, true]) {
  test(`${dev ? 'development' : 'production'} compilation ${dev ? 'persists' : 'does not hydrate or persist'} webpack cache packs`, async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'production-webpack-cache-'));
    const cacheDirectory = path.join(directory, 'cache');
    const entry = path.join(directory, 'entry.cjs');
    const dependency = path.join(directory, 'dependency.cjs');
    writeFileSync(entry, "module.exports = require('./dependency.cjs') * 2;");

    async function compile(value, configure) {
      writeFileSync(dependency, `module.exports = ${value};`);
      const base = {
        mode: dev ? 'development' : 'production', target: 'node', context: directory, entry,
        output: { path: directory, filename: `bundle-${value}.cjs`, library: { type: 'commonjs2' } },
        cache: { type: 'filesystem', cacheDirectory, name: 'fixture', version: 'fixture', maxMemoryGenerations: dev ? 0 : Infinity },
        resolve: { alias: {} }, module: { rules: [] }, plugins: [], optimization: { minimize: false },
      };
      const configuration = configure ? nextConfig.webpack(base, { isServer: true, dev }) : base;
      // Isolate cache I/O from the worktree while preserving the actual policy.
      if (configuration.cache && typeof configuration.cache === 'object') configuration.cache.cacheDirectory = cacheDirectory;
      const compiler = webpack(configuration);
      let stats;
      try {
        stats = await new Promise((resolve, reject) => compiler.run((error, result) => error ? reject(error) : resolve(result)));
      } finally {
        await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()));
      }
      assert.equal(stats.hasErrors(), false, stats.toString({ all: false, errors: true }));
      assert.equal(require(path.join(directory, `bundle-${value}.cjs`)), value * 2);
      return stats.toJson({ all: false, modules: true }).modules;
    }

    const packs = () => readdirSync(cacheDirectory, { recursive: true }).filter(file => /\.pack(?:\.gz)?$/.test(file));
    try {
      // Supply a real pack from an earlier build, as CI's registry restore does.
      await compile(1, false);
      const before = new Map(packs().map(file => [file, readFileSync(path.join(cacheDirectory, file))]));
      assert.ok(before.size > 0, 'the fixture must start with a persisted webpack cache');

      const modules = await compile(2, true);
      await compile(3, true);
      if (dev) {
        assert.ok(packs().some(file => !before.has(file) || !before.get(file).equals(readFileSync(path.join(cacheDirectory, file)))), 'development must still update its filesystem cache');
      } else {
        assert.ok(modules.filter(module => module.name).every(module => module.built && !module.cached), 'production must build modules without hydrating the old pack');
        assert.deepEqual(new Map(packs().map(file => [file, readFileSync(path.join(cacheDirectory, file))])), before, 'production must leave restored packs untouched');
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
