import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { parseAllDocuments } from 'yaml';

const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..', '..', '..'));
const chartPath = path.join(repoRoot, 'helm');
const applianceValues = path.join(
  repoRoot, 'ee', 'appliance', 'flux', 'profiles', 'single-node', 'values', 'alga-core.single-node.yaml',
);

function helmTemplate(extraArgs = []) {
  return spawnSync('helm', [
    'template', 'test-release', chartPath, '--namespace', 'msp',
    '--show-only', 'templates/redis/statefulSet.yaml', ...extraArgs,
  ], { cwd: repoRoot, encoding: 'utf8' });
}

function redisStatefulSet(extraArgs = []) {
  const result = helmTemplate(extraArgs);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const sts = parseAllDocuments(result.stdout).map((d) => d.toJSON()).find((d) => d?.kind === 'StatefulSet');
  assert.ok(sts, 'redis StatefulSet rendered');
  return { sts };
}

function generatedConfig(container) {
  const sandbox = mkdtempSync(path.join(tmpdir(), 'redis-helm-'));
  try {
    const configDir = path.join(sandbox, 'config');
    const binDir = path.join(sandbox, 'bin');
    mkdirSync(binDir);
    // Capture the server invocation after running the rendered shell command.
    // Redirect only the container's config directory into this test's sandbox.
    writeFileSync(path.join(binDir, 'redis-server'), '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
    const [command, ...args] = container.command;
    const result = spawnSync(command, args.map((arg) => arg.replaceAll('/etc/redis', configDir)), {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, REDIS_PASSWORD: 'test-password' },
    });
    assert.equal(result.status, 0, result.stderr);
    const configPath = path.join(configDir, 'redis.conf');
    assert.equal(result.stdout.trim(), configPath, 'starts Redis with the generated config');
    assert.equal(statSync(configPath).mode & 0o777, 0o600, 'password config is owner-only');
    return readFileSync(configPath, 'utf8');
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

test('appliance profile enables AOF on the /data volume', () => {
  const { sts } = redisStatefulSet(['-f', applianceValues]);
  const container = sts.spec.template.spec.containers.find((c) => c.name === 'redis');
  assert.equal(generatedConfig(container),
    "requirepass test-password\nsave ''\ndir /data\nappendonly yes\nappendfsync everysec\nmaxmemory-policy noeviction\n");
  assert.deepEqual(container.volumeMounts.find((m) => m.name === 'redis-data'), { name: 'redis-data', mountPath: '/data' });
  const volume = sts.spec.template.spec.volumes.find((v) => v.name === 'redis-data');
  assert.equal(volume.persistentVolumeClaim.claimName, 'test-release-sebastian-redis-data');
});

test('chart defaults disable AOF and snapshots and keep the password config private', () => {
  const { sts } = redisStatefulSet();
  const container = sts.spec.template.spec.containers.find((c) => c.name === 'redis');
  assert.equal(generatedConfig(container), "requirepass test-password\nsave ''\n");
  assert.deepEqual(container.volumeMounts.find((mount) => mount.name === 'redis-config'),
    { name: 'redis-config', mountPath: '/etc/redis' });
  assert.deepEqual(sts.spec.template.spec.volumes.find((volume) => volume.name === 'redis-config'),
    { name: 'redis-config', emptyDir: {} });
  assert.equal(container.securityContext.runAsNonRoot, true);
  assert.equal(container.securityContext.allowPrivilegeEscalation, false);
});

test('aof.enabled without persistence.enabled fails the render', () => {
  const result = helmTemplate(['--set', 'redis.persistence.enabled=false', '--set', 'redis.persistence.aof.enabled=true']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /redis\.persistence\.aof\.enabled requires redis\.persistence\.enabled/);
});
