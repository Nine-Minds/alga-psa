import assert from 'node:assert/strict';
import test from 'node:test';
import { formatStatusReport, formatStatusSummary } from '../lib/format.mjs';

test('formatStatusSummary tolerates null status', () => {
  const lines = formatStatusSummary(null);
  assert.deepEqual(lines, [
    'Site: unknown',
    'Node IP: unknown',
    'Connectivity: unknown',
    'Selected release: unknown',
  ]);
});

test('formatStatusReport tolerates null status', () => {
  const report = formatStatusReport(null);
  assert.equal(report.summary[0], 'Site: unknown');
  assert.equal(report.host[0], 'Status: unknown');
  assert.equal(report.cluster[1], 'Status: unavailable');
  assert.equal(report.release[0], 'Selected release: unknown');
});

test('formatStatusReport includes canonical rollup and tier readiness when available', () => {
  const report = formatStatusReport({
    siteId: 'appliance-single-node',
    nodeIp: '10.0.0.2',
    connectivityMode: 'kubernetes-available',
    topBlocker: { layer: 'none', reason: 'No blocker detected', nextAction: 'No immediate action required.' },
    host: { status: 'healthy', details: 'Talos API reachable' },
    cluster: { apiReachable: true, status: 'healthy', nodeReadiness: [] },
    flux: { status: 'healthy', helmStatus: 'healthy', sources: [], kustomizations: [], helmReleases: [] },
    workloads: { status: 'degraded', components: [] },
    release: { selectedReleaseVersion: '1.0.0', appUrl: 'https://psa.example.com', metadata: {} },
    configPaths: { configDir: '/tmp/site', kubeconfig: '/tmp/kubeconfig', talosconfig: '/tmp/talosconfig' },
    canonical: {
      rollup: { state: 'ready_with_background_issues', message: 'Background services need attention.' },
      tiers: {
        platform: { ready: true },
        core: { ready: true },
        bootstrap: { ready: true },
        login: { ready: true },
        background: { ready: false },
        fullHealth: { ready: false },
      },
    },
  });

  assert.ok(report.summary.some((line) => line === 'Rollup: ready_with_background_issues'));
  assert.ok(report.workloads.some((line) => line === 'Tier login: ready'));
  assert.ok(report.workloads.some((line) => line === 'Tier background: not-ready'));
});
