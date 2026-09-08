import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, stat, readdir, rm, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { APP_SECRET_FILES, initializeWorkerTestState } from '../../e2e-tests/harness/init-worker-test-state.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'worker-test-state-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const options = { sourceDirectory: path.join(root, 'source'), secretsDirectory: path.join(root, 'secrets'), filesDirectory: path.join(root, 'files'), uid: process.getuid(), gid: process.getgid() };
  for (const directory of [options.sourceDirectory, options.secretsDirectory, options.filesDirectory]) await mkdir(directory);
  for (const name of APP_SECRET_FILES) await writeFile(path.join(options.sourceDirectory, name), `synthetic-${name}`);
  return options;
}

test('initializes exact app secret copies, admin alias and owner-only writable directories', async t => {
  const options = await fixture(t);
  await writeFile(path.join(options.sourceDirectory, 'not-allowlisted'), 'do-not-copy');
  const result = await initializeWorkerTestState(options);
  assert.equal(result.appSecretFiles, APP_SECRET_FILES.length + 1);
  assert.deepEqual((await readdir(options.secretsDirectory)).sort(), [...APP_SECRET_FILES, 'DB_PASSWORD_ADMIN', 'tenants'].sort());
  for (const name of [...APP_SECRET_FILES, 'DB_PASSWORD_ADMIN']) {
    const target = path.join(options.secretsDirectory, name);
    assert.equal(await readFile(target, 'utf8'), `synthetic-${name === 'DB_PASSWORD_ADMIN' ? 'postgres_password' : name}`);
    const info = await stat(target);
    assert.equal(info.mode & 0o777, 0o600); assert.equal(info.uid, options.uid); assert.equal(info.gid, options.gid);
  }
  for (const directory of [options.secretsDirectory, options.filesDirectory, path.join(options.secretsDirectory, 'tenants')]) {
    const info = await stat(directory);
    assert.equal(info.mode & 0o777, 0o700); assert.equal(info.uid, options.uid); assert.equal(info.gid, options.gid);
  }
});

for (const target of ['secretsDirectory', 'filesDirectory']) test(`refuses nonempty ${target} without modifying either destination`, async t => {
  const options = await fixture(t);
  await writeFile(path.join(options[target], 'existing'), 'preserve');
  await assert.rejects(initializeWorkerTestState(options), /empty real directory/);
  assert.equal(await readFile(path.join(options[target], 'existing'), 'utf8'), 'preserve');
  const other = target === 'filesDirectory' ? 'secretsDirectory' : 'filesDirectory';
  assert.deepEqual(await readdir(options[other]), []);
});

test('missing source fails before writing destination state', async t => {
  const options = await fixture(t);
  await unlink(path.join(options.sourceDirectory, APP_SECRET_FILES.at(-1)));
  await assert.rejects(initializeWorkerTestState(options));
  assert.deepEqual(await readdir(options.secretsDirectory), []);
  assert.deepEqual(await readdir(options.filesDirectory), []);
});

test('rejects a source symlink instead of following it', async t => {
  const options = await fixture(t);
  const target = path.join(options.sourceDirectory, APP_SECRET_FILES[0]);
  await unlink(target);
  await symlink(path.join(options.sourceDirectory, APP_SECRET_FILES[1]), target);
  await assert.rejects(initializeWorkerTestState(options));
  assert.deepEqual(await readdir(options.secretsDirectory), []);
});

test('refuses reinitialization and preserves initialized files', async t => {
  const options = await fixture(t);
  await initializeWorkerTestState(options);
  const file = path.join(options.secretsDirectory, 'nextauth_secret');
  await writeFile(file, 'preserved-state');
  await assert.rejects(initializeWorkerTestState(options), /empty real directory/);
  assert.equal(await readFile(file, 'utf8'), 'preserved-state');
});

test('rejects a symlinked target without populating its referent', async t => {
  const options = await fixture(t);
  const referent = path.join(options.sourceDirectory, 'empty-target');
  await mkdir(referent);
  await rm(options.filesDirectory, { recursive: true });
  await symlink(referent, options.filesDirectory);
  await assert.rejects(initializeWorkerTestState(options), /empty real directory/);
  assert.deepEqual(await readdir(referent), []);
  assert.deepEqual(await readdir(options.secretsDirectory), []);
});

test('rejects invalid ownership and overlapping targets before modifying state', async t => {
  const options = await fixture(t);
  await assert.rejects(initializeWorkerTestState({ ...options, uid: -1 }), /numeric IDs/);
  await assert.rejects(initializeWorkerTestState({ ...options, filesDirectory: options.secretsDirectory }), /separate/);
  assert.deepEqual(await readdir(options.secretsDirectory), []);
});
