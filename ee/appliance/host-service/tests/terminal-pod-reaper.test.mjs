import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTerminalPodLines, planTerminalPodReap, reapTerminalPods } from '../terminal-pod-reaper.mjs';

function pod(namespace, name, phase, createdAt) {
  return { namespace, name, phase, createdAt };
}

function fakeKube(responses) {
  const calls = [];
  return {
    calls,
    quote: (value) => `'${String(value).replaceAll("'", "'\\''")}'`,
    run: async (args) => {
      calls.push(args);
      for (const [match, result] of responses) {
        if (args.includes(match)) return result;
      }
      return { ok: true, stdout: '', stderr: '' };
    }
  };
}

test('parseTerminalPodLines reads the custom-columns listing', () => {
  const pods = parseTerminalPodLines([
    'msp   email-service-abc   Failed   2026-07-21T10:00:00Z',
    'msp   <none>              Failed   2026-07-21T10:00:00Z'
  ]);
  assert.equal(pods.length, 1);
  assert.deepEqual(pods[0], {
    namespace: 'msp',
    name: 'email-service-abc',
    phase: 'Failed',
    createdAt: '2026-07-21T10:00:00Z'
  });
});

test('planTerminalPodReap keeps the newest corpses per namespace', () => {
  const pods = [
    pod('msp', 'old-1', 'Failed', '2026-07-20T10:00:00Z'),
    pod('msp', 'old-2', 'Failed', '2026-07-20T11:00:00Z'),
    pod('msp', 'new-1', 'Failed', '2026-07-24T10:00:00Z'),
    pod('kube-system', 'ks-old', 'Failed', '2026-07-19T10:00:00Z'),
    pod('kube-system', 'ks-new', 'Failed', '2026-07-24T09:00:00Z')
  ];

  const doomed = planTerminalPodReap(pods, { retainPerNamespace: 1 });
  const names = doomed.map((p) => p.name).sort();

  // Newest in each namespace survives; retention is per-namespace, not global,
  // so kube-system keeps its own sample even though msp has fresher failures.
  assert.deepEqual(names, ['ks-old', 'old-1', 'old-2']);
});

test('planTerminalPodReap never touches live pods', () => {
  const pods = [
    pod('msp', 'running', 'Running', '2026-07-01T10:00:00Z'),
    pod('msp', 'pending', 'Pending', '2026-07-01T10:00:00Z'),
    pod('msp', 'succeeded', 'Succeeded', '2026-07-01T10:00:00Z'),
    pod('msp', 'failed', 'Failed', '2026-07-01T10:00:00Z')
  ];

  const doomed = planTerminalPodReap(pods, { retainPerNamespace: 0 });
  assert.deepEqual(doomed.map((p) => p.name), ['failed']);
});

test('planTerminalPodReap is a no-op below the retention count', () => {
  const pods = [pod('msp', 'a', 'Failed', '2026-07-01T10:00:00Z')];
  assert.deepEqual(planTerminalPodReap(pods, { retainPerNamespace: 5 }), []);
});

test('reapTerminalPods deletes doomed pods grouped by namespace', async () => {
  const listing = [
    'msp a Failed 2026-07-20T10:00:00Z',
    'msp b Failed 2026-07-20T11:00:00Z',
    'msp c Failed 2026-07-24T10:00:00Z',
    'alga-system d Failed 2026-07-18T10:00:00Z'
  ].join('\n');

  const kube = fakeKube([
    ['status.phase==Failed', { ok: true, stdout: listing, stderr: '' }],
    ['delete pod', { ok: true, stdout: '', stderr: '' }]
  ]);

  const result = await reapTerminalPods({ kube, retainPerNamespace: 1 });
  assert.equal(result.ok, true);
  assert.equal(result.deleted, 2);

  const deletes = kube.calls.filter((call) => call.includes('delete pod'));
  assert.equal(deletes.length, 1);
  assert.match(deletes[0], /-n 'msp' delete pod 'b' 'a' --ignore-not-found/);
});

test('reapTerminalPods reports a failed listing instead of reaping nothing quietly', async () => {
  const kube = fakeKube([
    ['status.phase==Failed', { ok: false, stdout: '', stderr: 'connection refused' }]
  ]);

  const result = await reapTerminalPods({ kube, retainPerNamespace: 1 });
  assert.equal(result.ok, false);
  assert.equal(result.deleted, 0);
  assert.match(result.error, /connection refused/);
  assert.equal(kube.calls.some((call) => call.includes('delete pod')), false);
});

test('reapTerminalPods surfaces a partial delete failure', async () => {
  const listing = [
    'msp a Failed 2026-07-20T10:00:00Z',
    'msp b Failed 2026-07-20T11:00:00Z'
  ].join('\n');

  const kube = fakeKube([
    ['status.phase==Failed', { ok: true, stdout: listing, stderr: '' }],
    ['delete pod', { ok: false, stdout: '', stderr: 'forbidden' }]
  ]);

  const result = await reapTerminalPods({ kube, retainPerNamespace: 0 });
  assert.equal(result.ok, false);
  assert.equal(result.deleted, 0);
  assert.match(result.error, /msp: forbidden/);
});
