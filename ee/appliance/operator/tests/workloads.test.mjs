import assert from 'node:assert/strict';
import test from 'node:test';
import { listAppliancePods, readPodLogsSince, readPodLogsTail } from '../lib/workloads.mjs';

class FakeRunner {
  constructor(handlers = []) {
    this.handlers = handlers;
    this.calls = [];
  }

  async runCapture(command, args) {
    this.calls.push([command, ...args]);
    const handler = this.handlers.shift();
    if (!handler) {
      return { ok: false, code: 1, output: 'unexpected command' };
    }
    return handler(command, args);
  }
}

function makeEnv() {
  return {
    runtime: { assetRoot: '/tmp' },
    paths: { kubeconfig: '/tmp/kubeconfig' },
  };
}

test('listAppliancePods returns appliance namespace pods with status columns', async () => {
  const runner = new FakeRunner([
    async () => ({
      ok: true,
      code: 0,
      output: JSON.stringify({
        items: [
          {
            metadata: {
              namespace: 'msp',
              name: 'alga-core-0',
              creationTimestamp: '2026-03-25T11:59:00Z',
            },
            spec: {
              containers: [{ name: 'app' }, { name: 'sidecar' }],
            },
            status: {
              phase: 'Running',
              startTime: '2026-03-25T12:00:00Z',
              containerStatuses: [
                { ready: true, restartCount: 1, state: { running: {} } },
                { ready: false, restartCount: 2, state: { waiting: { reason: 'CrashLoopBackOff' } } },
              ],
            },
          },
        ],
      }),
    }),
    async () => ({ ok: true, code: 0, output: JSON.stringify({ items: [] }) }),
    async () => ({ ok: false, code: 1, output: 'forbidden' }),
  ]);

  const result = await listAppliancePods(makeEnv(), {
    runner,
    nowMs: Date.parse('2026-03-25T13:00:00Z'),
  });

  assert.deepEqual(result.namespaces, ['msp', 'alga-system', 'flux-system']);
  assert.equal(result.pods.length, 1);
  assert.equal(result.pods[0].key, 'msp/alga-core-0');
  assert.equal(result.pods[0].ready, '1/2');
  assert.equal(result.pods[0].restarts, 3);
  assert.equal(result.pods[0].status, 'CrashLoopBackOff');
  assert.equal(result.pods[0].age, '1h');
  assert.match(result.errors[0], /flux-system/);
});

test('readPodLogsTail and readPodLogsSince parse timestamped lines', async () => {
  const runner = new FakeRunner([
    async () => ({
      ok: true,
      code: 0,
      output: [
        '2026-03-25T12:00:00Z ready',
        '2026-03-25T12:00:01Z reconciling',
      ].join('\n'),
    }),
    async () => ({
      ok: true,
      code: 0,
      output: '2026-03-25T12:00:02Z done\n',
    }),
  ]);

  const pod = { namespace: 'msp', name: 'alga-core-0' };
  const tail = await readPodLogsTail(makeEnv(), pod, { runner, tailLines: 50 });
  assert.equal(tail.ok, true);
  assert.equal(tail.lines.length, 2);
  assert.equal(tail.lines[0].timestamp, '2026-03-25T12:00:00Z');
  assert.equal(tail.lines[0].message, 'ready');

  const since = await readPodLogsSince(makeEnv(), pod, {
    runner,
    sinceTime: '2026-03-25T12:00:01Z',
  });
  assert.equal(since.ok, true);
  assert.equal(since.lines.length, 1);
  assert.equal(since.lines[0].message, 'done');
});
