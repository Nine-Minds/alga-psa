// Regression guard for the Docker build context:
//
//   - Operator-written secrets and local env files never enter an image build
//     context (top-level secrets/, server/.env, ee/server/.env, ...).
//   - Tracked source directories that happen to be named `secrets`, and the
//     tracked env fixtures, stay in the context.
//
// The matching is done by real `docker buildx build`, not reimplemented here.
// Pure node:test, no npm dependencies.
//
// Run: node --test scripts/tests/docker-build-context.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { before, after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT_DOCKERIGNORE = path.join(REPO_ROOT, '.dockerignore');

// The synthetic context lives under the repo's git-ignored tmp/, not
// os.tmpdir(): snap-packaged Docker cannot read the host /tmp.
const WORK_DIR = path.join(REPO_ROOT, 'tmp', `docker-build-context-test-${process.pid}`);
const CONTEXT_DIR = path.join(WORK_DIR, 'context');
const OUTPUT_TAR = path.join(WORK_DIR, 'out.tar');

const MUST_EXCLUDE = [
  'secrets/postgres_password',
  'secrets/tenants/t1/x',
  '.secrets',
  'secrets-playwright/a',
  'server/secrets-playwright/a',
  '.env',
  'server/.env',
  'server/.env.local',
  'server/.env.production.local',
  'server/.env.local.bak1',
  'server/.env.localtest',
  'ee/server/.env',
  'ee/server/.env.local',
  'ee/temporal-workflows/.env',
  '.env.image',
  'certs/x.pem',
];

// Real source directories that share the name `secrets`.
const SOURCE_SECRETS_DIRS = [
  'packages/core/src/secrets',
  'packages/core/src/lib/secrets',
  'server/src/app/api/secrets',
  'server/src/app/msp/settings/secrets',
  'server/src/components/settings/secrets',
  'shared/workflow/secrets',
];

const MUST_INCLUDE = [
  ...SOURCE_SECRETS_DIRS.map((dir) => `${dir}/index.ts`),
  '.env.example',
  'ee/server/.env.example',
  'server/.env.e2e',
  '.env.localtest',
  'ee/server/.env.test',
  'server/src/index.ts',
];

function dockerBuildxAvailable() {
  const result = spawnSync('docker', ['buildx', 'version'], { encoding: 'utf8' });
  return result.status === 0;
}

const buildxAvailable = dockerBuildxAvailable();
if (!buildxAvailable && process.env.CI) {
  throw new Error('docker buildx is required in CI for docker-build-context.test.mjs');
}
const skipNoBuildx = buildxAvailable ? false : 'docker buildx is not available';

function writeFixture(root, relPath) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, 'fixture\n');
}

// Runs the real BuildKit context transfer (`COPY . /` into an empty image) and
// returns the file paths that reached the build. Exported as a tar because
// `--output type=local` fails with lchown errors on snap-packaged Docker.
function contextFiles(contextDir, tarPath) {
  const build = spawnSync(
    'docker',
    ['buildx', 'build', '-f', '-', '--output', `type=tar,dest=${tarPath}`, contextDir],
    { input: 'FROM scratch\nCOPY . /\n', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
  assert.equal(build.status, 0, `docker buildx build failed:\n${build.stderr}`);
  const list = spawnSync('tar', ['-tf', tarPath], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  assert.equal(list.status, 0, `tar -tf failed:\n${list.stderr}`);
  return list.stdout.split('\n').filter((entry) => entry && !entry.endsWith('/'));
}

function gitLsFiles(...args) {
  const result = spawnSync('git', ['ls-files', ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `git ls-files failed:\n${result.stderr}`);
  return result.stdout.split('\n').filter(Boolean);
}

function dockerignoreRules(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

describe('docker build context (real buildx matching)', { skip: skipNoBuildx }, () => {
  let sent = [];

  before(() => {
    fs.rmSync(WORK_DIR, { recursive: true, force: true });
    fs.mkdirSync(CONTEXT_DIR, { recursive: true });
    fs.copyFileSync(ROOT_DOCKERIGNORE, path.join(CONTEXT_DIR, '.dockerignore'));
    for (const rel of [...MUST_EXCLUDE, ...MUST_INCLUDE]) writeFixture(CONTEXT_DIR, rel);

    sent = contextFiles(CONTEXT_DIR, OUTPUT_TAR);
  });

  after(() => {
    fs.rmSync(WORK_DIR, { recursive: true, force: true });
  });

  test('operator secrets and local env files are excluded', () => {
    const leaked = MUST_EXCLUDE.filter((rel) => sent.includes(rel));
    assert.deepEqual(leaked, [], `these files reached the build context: ${leaked.join(', ')}`);
  });

  test('source directories named secrets and tracked env fixtures are included', () => {
    const missing = MUST_INCLUDE.filter((rel) => !sent.includes(rel));
    assert.deepEqual(missing, [], `these files were dropped from the build context: ${missing.join(', ')}`);
  });
});

describe('docker ignore rules (static)', () => {
  test('no .dockerignore uses a depth-matching secrets rule', () => {
    const files = gitLsFiles('--cached', '--others', '--exclude-standard', '--', '*.dockerignore', '.dockerignore');
    assert.ok(files.length > 0, 'expected at least the root .dockerignore');
    for (const file of files) {
      for (const rule of dockerignoreRules(path.join(REPO_ROOT, file))) {
        assert.ok(
          !/^!?\*\*\/secrets(\/.*)?$/.test(rule) && !/^!?\*\*\/\.?secrets\*?$/.test(rule),
          `${file}: rule "${rule}" would match real source directories named secrets`
        );
      }
    }
  });

  test('root .dockerignore anchors the top-level secrets directory', () => {
    assert.ok(dockerignoreRules(ROOT_DOCKERIGNORE).includes('/secrets'));
  });

  test('no per-Dockerfile .dockerignore overrides the root rule set', () => {
    const siblings = gitLsFiles('--cached', '--others', '--exclude-standard', '--', '*.dockerignore').filter(
      (file) => path.basename(file) !== '.dockerignore'
    );
    assert.deepEqual(siblings, [], '<Dockerfile>.dockerignore would silently replace the root .dockerignore');
  });

  test('no tracked file is matched by the exclude rules', { skip: skipNoBuildx }, () => {
    const tracked = gitLsFiles();
    // docs/ and tests/ are excluded from every build context by older rules,
    // so they are not what this guard is about.
    const candidates = tracked.filter(
      (f) =>
        !/^(docs|tests)\//.test(f) &&
        (/(^|\/)(\.env|\.secrets|secrets)/.test(f) || /\.pem$/.test(f) || /\.bak/.test(f))
    );

    // Hand the candidate paths to real buildx matching in a synthetic context.
    const dir = path.join(REPO_ROOT, 'tmp', `docker-build-context-tracked-${process.pid}`);
    const out = `${dir}.tar`;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(out, { force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(ROOT_DOCKERIGNORE, path.join(dir, '.dockerignore'));
    for (const rel of candidates) writeFixture(dir, rel);

    try {
      const kept = new Set(contextFiles(dir, out));
      const dropped = candidates.filter((rel) => !kept.has(rel));
      assert.deepEqual(dropped, [], `tracked files are excluded from the build context: ${dropped.join(', ')}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(out, { force: true });
    }
  });
});
