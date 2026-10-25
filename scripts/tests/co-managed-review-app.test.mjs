import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const launcher = path.join(repoRoot, 'scripts/dev/run-co-managed-review-app.sh');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function makeCandidate(mutation = 'none', prepareOnly = '0') {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'co-managed-review-app-'));
  const root = path.join(tmp, 'repo');
  fs.mkdirSync(path.join(root, 'scripts/dev'), { recursive: true });
  fs.mkdirSync(path.join(root, 'server/src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules/.bin'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'home'), { recursive: true });
  fs.copyFileSync(launcher, path.join(root, 'scripts/dev/run-co-managed-review-app.sh'));
  fs.writeFileSync(path.join(root, 'server/next.config.mjs'), "export default { distDir: process.env.NEXT_DIST_DIR || '.next' };\n");
  fs.writeFileSync(path.join(root, 'server/src/page.ts'), 'original source\n');
  fs.writeFileSync(path.join(root, 'node_modules/.bin/tsc'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(tmp, 'bin/npx'), `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1 $2" == "nx build-deps" ]]; then exit 0; fi
if [[ "$1 $2" == "next build" ]]; then
  mkdir -p "$PWD/$NEXT_DIST_DIR"
  printf 'build-id\\n' > "$PWD/$NEXT_DIST_DIR/BUILD_ID"
  case "$TEST_MUTATION" in
    source)
      printf 'mutated during compiler\\n' > "$TEST_ROOT/server/src/page.ts"
      ;;
    head)
      printf 'new committed file\\n' > "$TEST_ROOT/server/src/during-build.ts"
      git -C "$TEST_ROOT" add server/src/during-build.ts
      git -C "$TEST_ROOT" -c user.name='Regression Test' -c user.email='test@example.invalid' commit -m 'change HEAD during mocked compiler' >/dev/null
      ;;
  esac
  exit 0
fi
if [[ "$1 $2" == "next start" ]]; then
  touch "$TEST_ROOT/served"
  exit 0
fi
echo "unexpected npx invocation: $*" >&2
exit 91
`, { mode: 0o755 });

  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.name', 'Regression Test');
  git(root, 'config', 'user.email', 'test@example.invalid');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'initial isolated review candidate');

  const dist = '.next-review-test';
  const result = spawnSync('bash', [path.join(root, 'scripts/dev/run-co-managed-review-app.sh')], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${path.join(tmp, 'bin')}${path.delimiter}${process.env.PATH}`,
      HOME: path.join(tmp, 'home'),
      TEST_ROOT: root,
      TEST_MUTATION: mutation,
      CO_MANAGED_REVIEW_PREPARE_ONLY: prepareOnly,
      CO_MANAGED_REVIEW_DIST: dist,
      PORT: '24473',
    },
    timeout: 30000,
  });

  return { tmp, root, dist, result };
}

test('refuses to stamp or serve when tracked source changes during production compilation', (t) => {
  const candidate = makeCandidate('source');
  t.after(() => fs.rmSync(candidate.tmp, { recursive: true, force: true }));

  assert.notEqual(candidate.result.status, 0, candidate.result.stdout + candidate.result.stderr);
  assert.match(candidate.result.stderr, /changed during production compilation/);
  assert.match(candidate.result.stderr, /refusing to stamp or serve/);
  assert.equal(fs.existsSync(path.join(candidate.root, 'server', candidate.dist, '.alga-review-revision')), false);
  assert.equal(fs.existsSync(path.join(candidate.root, 'served')), false);
});

test('refuses to stamp or serve when HEAD changes during production compilation', (t) => {
  const candidate = makeCandidate('head');
  t.after(() => fs.rmSync(candidate.tmp, { recursive: true, force: true }));

  assert.notEqual(candidate.result.status, 0, candidate.result.stdout + candidate.result.stderr);
  assert.match(candidate.result.stderr, /changed during production compilation/);
  assert.match(candidate.result.stderr, /refusing to stamp or serve/);
  assert.equal(fs.existsSync(path.join(candidate.root, 'server', candidate.dist, '.alga-review-revision')), false);
  assert.equal(fs.existsSync(path.join(candidate.root, 'served')), false);
});

test('stamps and serves when the captured HEAD and source fingerprint remain stable', (t) => {
  const candidate = makeCandidate();
  t.after(() => fs.rmSync(candidate.tmp, { recursive: true, force: true }));

  assert.equal(candidate.result.status, 0, candidate.result.stdout + candidate.result.stderr);
  const stamp = fs.readFileSync(path.join(candidate.root, 'server', candidate.dist, '.alga-review-revision'), 'utf8').trim();
  const head = git(candidate.root, 'rev-parse', 'HEAD');
  assert.equal(stamp, `${head}+da39a3ee5e6b`);
  assert.equal(fs.existsSync(path.join(candidate.root, 'served')), true);
});

test('prepare-only stamps a stable build without invoking next start', (t) => {
  const candidate = makeCandidate('none', '1');
  t.after(() => fs.rmSync(candidate.tmp, { recursive: true, force: true }));

  assert.equal(candidate.result.status, 0, candidate.result.stdout + candidate.result.stderr);
  const stamp = fs.readFileSync(path.join(candidate.root, 'server', candidate.dist, '.alga-review-revision'), 'utf8').trim();
  const head = git(candidate.root, 'rev-parse', 'HEAD');
  assert.equal(stamp, `${head}+da39a3ee5e6b`);
  assert.match(candidate.result.stdout, /application startup skipped/);
  assert.equal(fs.existsSync(path.join(candidate.root, 'served')), false);
});

test('rejects invalid prepare-only values before typecheck or build', (t) => {
  const candidate = makeCandidate('none', 'true');
  t.after(() => fs.rmSync(candidate.tmp, { recursive: true, force: true }));

  assert.equal(candidate.result.status, 2, candidate.result.stdout + candidate.result.stderr);
  assert.match(candidate.result.stderr, /CO_MANAGED_REVIEW_PREPARE_ONLY must be 0 or 1/);
  assert.equal(fs.existsSync(path.join(candidate.root, 'served')), false);
  assert.equal(fs.existsSync(path.join(candidate.root, 'server', candidate.dist, 'BUILD_ID')), false);
});

test('prepare-only refuses to stamp when source changes during production compilation', (t) => {
  const candidate = makeCandidate('source', '1');
  t.after(() => fs.rmSync(candidate.tmp, { recursive: true, force: true }));

  assert.notEqual(candidate.result.status, 0, candidate.result.stdout + candidate.result.stderr);
  assert.match(candidate.result.stderr, /changed during production compilation/);
  assert.match(candidate.result.stderr, /refusing to stamp or serve/);
  assert.equal(fs.existsSync(path.join(candidate.root, 'server', candidate.dist, '.alga-review-revision')), false);
  assert.equal(fs.existsSync(path.join(candidate.root, 'served')), false);
});

test('prepare-only refuses to stamp when HEAD changes during production compilation', (t) => {
  const candidate = makeCandidate('head', '1');
  t.after(() => fs.rmSync(candidate.tmp, { recursive: true, force: true }));

  assert.notEqual(candidate.result.status, 0, candidate.result.stdout + candidate.result.stderr);
  assert.match(candidate.result.stderr, /changed during production compilation/);
  assert.match(candidate.result.stderr, /refusing to stamp or serve/);
  assert.equal(fs.existsSync(path.join(candidate.root, 'server', candidate.dist, '.alga-review-revision')), false);
  assert.equal(fs.existsSync(path.join(candidate.root, 'served')), false);
});
