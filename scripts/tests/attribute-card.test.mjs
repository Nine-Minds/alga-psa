import assert from 'node:assert/strict';
import test from 'node:test';

import { attribute, globToRegExp, owners, readCharters } from '../ci/attribute-card.mjs';

test('glob: ** crosses directories, * does not, dots are literal', () => {
  assert.ok(globToRegExp('scripts/tests/fixtures/migration-lint/**').test('scripts/tests/fixtures/migration-lint/rule-1/fail/a.cjs'));
  assert.ok(globToRegExp('scripts/tests/migration-lint*.test.mjs').test('scripts/tests/migration-lint.test.mjs'));
  assert.ok(!globToRegExp('scripts/ci/*.mjs').test('scripts/ci/sub/x.mjs'));
  assert.ok(!globToRegExp('a.b').test('aXb'));
});

test('the L0g charter owns its gate files and nothing else owns them', () => {
  const charters = readCharters();
  assert.ok(charters.some((c) => c.card === 'L0g' && c.globs.length > 10));
  for (const f of ['scripts/ci/migration-lint.mjs', 'scripts/ci/upgrade-order.mjs', 'server/src/test/contract/hotPathQueryBudget.json', '.github/workflows/ci-safety-gates.yml']) {
    assert.deepEqual(owners(f, charters), ['L0g'], f);
  }
});

test('an unowned path says so', () => {
  assert.match(attribute(['server/migrations/20990101000000_x.cjs'])[0], /owned by no card - check the manifest/);
});
