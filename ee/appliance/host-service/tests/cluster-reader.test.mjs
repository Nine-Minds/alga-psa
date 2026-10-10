import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createClusterReader } from '../cluster-reader.mjs';

// The real @kubernetes/client-node against a local stand-in for the API
// server, so request wiring (cancellation, timeouts, error classes, JSON
// shapes) is exercised end to end without a cluster.
function startFakeApi(routes) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    seen.push(url.pathname + url.search);
    const route = routes[url.pathname];
    if (!route) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ kind: 'Status', status: 'Failure', message: 'the server could not find the requested resource', code: 404 }));
      return;
    }
    route(req, res, url);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, port: server.address().port })));
}

function writeKubeconfig(port) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-cluster-reader-'));
  const file = path.join(dir, 'kubeconfig');
  fs.writeFileSync(file, `apiVersion: v1
kind: Config
clusters:
- name: fake
  cluster:
    server: http://127.0.0.1:${port}
    insecure-skip-tls-verify: true
users:
- name: fake
  user:
    token: test-token
contexts:
- name: fake
  context: { cluster: fake, user: fake }
current-context: fake
`);
  return file;
}

const sendJson = (body, delayMs = 0) => (req, res) => {
  const timer = setTimeout(() => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  }, delayMs);
  req.on('close', () => clearTimeout(timer));
};

test('cluster reader returns kubectl-shaped objects and classifies failures', async (t) => {
  delete process.env.KUBERNETES_SERVICE_HOST;
  const { server, seen, port } = await startFakeApi({
    '/api/v1/nodes': sendJson({ kind: 'NodeList', items: [{ metadata: { name: 'alga-psa', creationTimestamp: '2026-09-04T06:16:13Z' }, status: { conditions: [{ type: 'Ready', status: 'True' }] } }] }),
    '/api/v1/pods': sendJson({ kind: 'PodList', items: [{ metadata: { name: 'db-0', namespace: 'msp' }, status: { phase: 'Running' } }] }, 300),
    '/api/v1/namespaces/msp/pods/db-0/log': (req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('line one\nline two\n'); },
    '/apis/batch/v1/namespaces/msp/jobs': sendJson({ kind: 'JobList', items: [] }, 5_000)
  });
  t.after(() => server.close());
  const reader = createClusterReader({ kubeconfigPath: writeKubeconfig(port) });

  const nodes = await reader.listNodes();
  assert.equal(nodes.ok, true);
  assert.equal(nodes.items[0].metadata.name, 'alga-psa');
  // Timestamps come back as strings, exactly as `kubectl get -o json` prints.
  assert.equal(nodes.items[0].metadata.creationTimestamp, '2026-09-04T06:16:13.000Z');
  assert.equal(nodes.items[0].status.conditions[0].type, 'Ready');

  const log = await reader.readPodLog({ namespace: 'msp', pod: 'db-0', tailLines: 50 });
  assert.deepEqual(log, { ok: true, text: 'line one\nline two\n' });
  assert.ok(seen.some((entry) => entry.startsWith('/api/v1/namespaces/msp/pods/db-0/log') && entry.includes('tailLines=50')));

  // A Flux CRD that is not installed yet.
  const releases = await reader.listHelmReleases({ namespace: 'alga-system' });
  assert.equal(releases.ok, false);
  assert.equal(releases.reason, 'not-found');
  assert.equal(releases.status, 404);

  const timedOut = await reader.listJobs({ namespace: 'msp', timeoutMs: 150 });
  assert.equal(timedOut.ok, false);
  assert.equal(timedOut.reason, 'timeout');

  const controller = new AbortController();
  const pending = reader.listJobs({ namespace: 'msp', signal: controller.signal });
  setTimeout(() => controller.abort(), 50);
  const cancelled = await pending;
  assert.equal(cancelled.reason, 'cancelled');

  // Reads run concurrently: three 300ms lists finish in about one delay, not three.
  const started = Date.now();
  const results = await Promise.all([reader.listPods(), reader.listPods(), reader.listPods()]);
  assert.ok(results.every((result) => result.ok && result.items.length === 1));
  assert.ok(Date.now() - started < 800, `concurrent reads took ${Date.now() - started}ms`);
});

test('cluster reader reports an API server that is not listening as unreachable', async () => {
  delete process.env.KUBERNETES_SERVICE_HOST;
  const { server, port } = await startFakeApi({});
  await new Promise((resolve) => server.close(resolve));
  const reader = createClusterReader({ kubeconfigPath: writeKubeconfig(port) });
  const result = await reader.listNodes({ timeoutMs: 2_000 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unreachable');
});

test('cluster reader reports a missing kubeconfig as unavailable and recovers once it appears', async (t) => {
  delete process.env.KUBERNETES_SERVICE_HOST;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-cluster-reader-missing-'));
  const kubeconfigPath = path.join(dir, 'kubeconfig');
  const reader = createClusterReader({ kubeconfigPath });
  const missing = await reader.listNodes();
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'unavailable');

  const { server, port } = await startFakeApi({ '/api/v1/nodes': sendJson({ items: [] }) });
  t.after(() => server.close());
  fs.copyFileSync(writeKubeconfig(port), kubeconfigPath);
  const later = await reader.listNodes();
  assert.equal(later.ok, true);
});
