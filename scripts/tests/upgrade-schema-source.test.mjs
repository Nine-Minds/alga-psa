import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { prepareUpgradeSchema } from '../lib/upgrade-schema-source.mjs';
const require = createRequire(import.meta.url);

test('pinned baseline executes old helpers and EE overlay despite candidate edits', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'upgrade-source-'));
  const repository = path.join(root, 'repo');
  mkdirSync(repository);
  const git = (...args) => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
  try {
    git('init', '-q');
    for (const edition of ['server', 'ee/server']) mkdirSync(path.join(repository, edition, 'migrations/utils'), { recursive: true });
    writeFileSync(path.join(repository, 'server/migrations/001.cjs'), "module.exports = () => require('./utils/value.cjs') + ':ce';");
    writeFileSync(path.join(repository, 'server/migrations/utils/value.cjs'), "module.exports = 'old';");
    writeFileSync(path.join(repository, 'ee/server/migrations/001.cjs'), "module.exports = () => require('./utils/value.cjs') + ':ee';");
    mkdirSync(path.join(repository, 'server/templates'));
    writeFileSync(path.join(repository, 'server/templates/value.txt'), 'old-template');
    writeFileSync(path.join(repository, 'server/migrations/002.cjs'), "module.exports = () => require('node:fs').readFileSync(require('node:path').join(__dirname, '../templates/value.txt'), 'utf8');");
    git('add', '.');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'baseline');
    const commit = git('rev-parse', 'HEAD');
    writeFileSync(path.join(repository, 'server/migrations/utils/value.cjs'), "module.exports = 'candidate';");
    for (const edition of ['ce', 'ee']) {
      const destination = path.join(root, edition);
      const result = prepareUpgradeSchema({ repository, commit, destination, edition });
      assert.equal(require(path.join(result.directory, '001.cjs'))(), `old:${edition}`);
      assert.deepEqual(result.manifest.migrations, ['001.cjs', '002.cjs']);
      assert.equal(require(path.join(result.directory, '002.cjs'))(), 'old-template');
      assert.throws(() => prepareUpgradeSchema({ repository, commit, destination, edition }), /EEXIST/);
    }
    assert.throws(() => prepareUpgradeSchema({ repository, commit: 'v1.5.0', destination: path.join(root, 'bad') }), /full commit SHA/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
