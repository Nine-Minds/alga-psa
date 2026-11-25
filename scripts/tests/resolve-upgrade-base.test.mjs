import test from 'node:test';
import assert from 'node:assert/strict';
import { selectVerifiedBaseline } from '../ci/resolve-upgrade-base.mjs';

const repository = 'Nine-Minds/alga-psa';
const run = (sha, overrides = {}) => ({ head_sha: sha, event: 'push', head_branch: 'main',
  conclusion: 'success', status: 'completed', head_repository: { full_name: repository },
  path: '.github/workflows/ci-safety-gates.yml', ...overrides });

test('broken main uses its closest verified ancestor, never candidate or a newer unrelated main tip', () => {
  const result = selectVerifiedBaseline([run('future'), run('candidate'), run('old'), run('good')],
    ['broken', 'good', 'old'], repository);
  assert.equal(result.head_sha, 'good');
});
test('a verified current base is retained; rerunning an older commit does not move baseline backward', () => {
  assert.equal(selectVerifiedBaseline([run('old'), run('tip')], ['tip', 'old'], repository).head_sha, 'tip');
});
for (const override of [
  { event: 'pull_request' }, { head_branch: 'feature' }, { conclusion: 'failure' },
  { conclusion: 'cancelled' }, { status: 'in_progress' },
  { head_repository: { full_name: 'fork/alga-psa' } }, { path: '.github/workflows/other.yml' },
]) test(`rejects unverified history ${JSON.stringify(override)}`, () => {
  assert.throws(() => selectVerifiedBaseline([run('tip', override)], ['tip'], repository), /No verified main ancestor/);
});
test('missing history fails closed instead of falling back to an arbitrary SHA', () => {
  assert.throws(() => selectVerifiedBaseline([], ['tip'], repository), /refusing to guess/);
});
