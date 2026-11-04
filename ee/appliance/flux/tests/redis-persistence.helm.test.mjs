import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parseAllDocuments } from 'yaml';

const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..', '..', '..'));
const chartPath = path.join(repoRoot, 'helm');
const applianceValues = path.join(
  repoRoot, 'ee', 'appliance', 'flux', 'profiles', 'single-node', 'values', 'alga-core.single-node.yaml',
);

// Raw `command:` line as rendered by main before AOF support. Hosted Redis renders with chart
// defaults; any change to this string rolls hosted redis-0 and wipes its (non-persistent) data.
const BASELINE_COMMAND_LINE =
  `        command: ["sh", "-c", "mkdir -p /etc/redis && printf \\"requirepass \${REDIS_PASSWORD}\\nsave ''\\n\\" > /etc/redis/redis.conf && redis-server /etc/redis/redis.conf"]`;

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
  return { sts, raw: result.stdout };
}

test('appliance profile enables AOF on the /data volume', () => {
  const { sts } = redisStatefulSet(['-f', applianceValues]);
  const container = sts.spec.template.spec.containers.find((c) => c.name === 'redis');
  const script = container.command.join('\n');

  for (const line of ['requirepass ${REDIS_PASSWORD}', "save ''", 'dir /data', 'appendonly yes', 'appendfsync everysec', 'maxmemory-policy noeviction']) {
    assert.ok(script.includes(line), `command contains ${line}`);
  }
  assert.deepEqual(container.volumeMounts.find((m) => m.name === 'redis-data'), { name: 'redis-data', mountPath: '/data' });
  const volume = sts.spec.template.spec.volumes.find((v) => v.name === 'redis-data');
  assert.equal(volume.persistentVolumeClaim.claimName, 'test-release-sebastian-redis-data');
});

test('chart defaults render the Redis command byte-identical to before AOF support', () => {
  const { sts, raw } = redisStatefulSet();
  assert.ok(raw.split('\n').includes(BASELINE_COMMAND_LINE), 'raw command line unchanged');
  const container = sts.spec.template.spec.containers.find((c) => c.name === 'redis');
  assert.deepEqual(container.command, [
    'sh', '-c',
    'mkdir -p /etc/redis && printf "requirepass ${REDIS_PASSWORD}\nsave \'\'\n" > /etc/redis/redis.conf && redis-server /etc/redis/redis.conf',
  ]);
  assert.ok(!/appendonly/.test(raw));
});

test('aof.enabled without persistence.enabled fails the render', () => {
  const result = helmTemplate(['--set', 'redis.persistence.enabled=false', '--set', 'redis.persistence.aof.enabled=true']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /redis\.persistence\.aof\.enabled requires redis\.persistence\.enabled/);
});
