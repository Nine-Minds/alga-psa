import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { resolveBase } from '../ci/resolve-base.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const RESOLVE = path.resolve(here, '../ci/resolve-base.mjs');
const LINT = path.resolve(here, '../ci/migration-lint.mjs');

function scratchRepo(t) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-base-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'ci@example.com');
  git('config', 'user.name', 'ci');
  git('config', 'commit.gpgsign', 'false');
  const migration = (name) => {
    fs.mkdirSync(path.join(repo, 'server/migrations'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'server/migrations', name), 'exports.up = async () => {};\n');
  };
  const commit = (msg) => { git('add', '-A'); git('commit', '-q', '-m', msg); return git('rev-parse', 'HEAD'); };
  return { repo, git, migration, commit };
}

// The shape that failed PR #3827: the PR was pushed while main was at `staleBase`; main
// then gained a migration whose timestamp is older than main's newest (merged from a
// long-lived branch); GitHub rebuilt refs/pull/N/merge on top of the new main tip, but
// pull_request.base.sha still named `staleBase`.
function prMergeRefAfterBaseAdvanced(t) {
  const r = scratchRepo(t);
  r.migration('20240300000000_newest_on_main.cjs');
  const staleBase = r.commit('main at PR push');
  r.git('switch', '-q', '-c', 'pr');
  fs.writeFileSync(path.join(r.repo, 'feature.txt'), 'pr work\n');
  const prHead = r.commit('PR change, no migrations');
  r.git('switch', '-q', 'main');
  r.migration('20240200000000_old_branch_landed_later.cjs');
  const mainTip = r.commit('another PR lands on main');
  r.git('merge', '-q', '--no-ff', '--no-edit', prHead);
  return { ...r, staleBase, prHead, mainTip };
}

test('pull_request on the merge ref: baseline is the merge commit first parent, not the stale base.sha', (t) => {
  const r = prMergeRefAfterBaseAdvanced(t);
  const base = resolveBase({ eventName: 'pull_request', prBaseSha: r.staleBase, prHeadSha: r.prHead }, r.repo);
  assert.equal(base, r.mainTip);
});

test('migration-lint on the merge ref does not blame the PR for migrations main gained after the PR push', (t) => {
  const r = prMergeRefAfterBaseAdvanced(t);
  const lint = (base) => spawnSync('node', [LINT, '--repo', r.repo, '--base', base, '--json'], { encoding: 'utf8' });

  const stale = lint(r.staleBase);
  assert.equal(stale.status, 1, 'the stale base.sha reproduces the false R6');
  assert.deepEqual(JSON.parse(stale.stdout).violations.map(({ file, rule }) => ({ file, rule })),
    [{ file: 'server/migrations/20240200000000_old_branch_landed_later.cjs', rule: 6 }]);

  const resolved = spawnSync('node', [RESOLVE, '--repo', r.repo], {
    encoding: 'utf8',
    env: { ...process.env, EVENT_NAME: 'pull_request', PR_BASE_SHA: r.staleBase, PR_HEAD_SHA: r.prHead, PUSH_BEFORE_SHA: '' },
  });
  assert.equal(resolved.status, 0, resolved.stderr);
  const clean = lint(resolved.stdout.trim());
  assert.equal(clean.status, 0, clean.stdout);
  assert.equal(JSON.parse(clean.stdout).filesScanned, 0);
});

test('migration-lint on the merge ref still catches a stale timestamp the PR itself adds', (t) => {
  const r = scratchRepo(t);
  r.migration('20240300000000_newest_on_main.cjs');
  const staleBase = r.commit('main at PR push');
  r.git('switch', '-q', '-c', 'pr');
  r.migration('20240250000000_pr_migration.cjs');
  const prHead = r.commit('PR adds a migration');
  r.git('switch', '-q', 'main');
  r.migration('20240400000000_main_moves_on.cjs');
  r.commit('main advances');
  r.git('merge', '-q', '--no-ff', '--no-edit', prHead);

  const base = resolveBase({ eventName: 'pull_request', prBaseSha: staleBase, prHeadSha: prHead }, r.repo);
  const out = spawnSync('node', [LINT, '--repo', r.repo, '--base', base, '--json'], { encoding: 'utf8' });
  assert.equal(out.status, 1, out.stdout);
  assert.deepEqual(JSON.parse(out.stdout).violations.map(({ file, rule }) => ({ file, rule })),
    [{ file: 'server/migrations/20240250000000_pr_migration.cjs', rule: 6 }]);
});

test('pull_request checked out at the PR head (not a merge ref): falls back to base.sha', (t) => {
  const r = scratchRepo(t);
  r.migration('20240300000000_a.cjs');
  const base = r.commit('base');
  r.git('switch', '-q', '-c', 'pr');
  fs.writeFileSync(path.join(r.repo, 'x.txt'), 'x\n');
  const otherHead = r.commit('pr');
  r.git('switch', '-q', '--detach', otherHead);
  assert.equal(resolveBase({ eventName: 'pull_request', prBaseSha: base, prHeadSha: 'deadbeef' }, r.repo), base);
});

test('push: baseline is event.before; a new-branch push (zero SHA) has none', (t) => {
  const r = scratchRepo(t);
  r.migration('20240300000000_a.cjs');
  const before = r.commit('one');
  assert.equal(resolveBase({ eventName: 'push', pushBeforeSha: before }, r.repo), before);
  assert.equal(resolveBase({ eventName: 'push', pushBeforeSha: '0000000000000000000000000000000000000000' }, r.repo), '');
});
