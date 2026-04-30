import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collectStatus } from '../lib/status.mjs';

class MockCaptureRunner {
  constructor(responses) {
    this.responses = responses;
  }

  async runCapture(command, args) {
    const key = `${command} ${args.join(' ')}`;
    const response = this.responses[key];
    if (!response) {
      return { ok: false, code: 1, output: 'missing mock response' };
    }
    if (response.ok) {
      return { ok: true, code: 0, output: response.output ?? '' };
    }
    return { ok: false, code: response.code ?? 1, output: response.output ?? '' };
  }
}

function buildEnv(releasesDir) {
  return {
    runtime: { assetRoot: '/tmp', releasesDir },
    site: { siteId: 'appliance-single-node', configDir: '/tmp/config' },
    paths: { kubeconfig: '/tmp/kubeconfig', talosconfig: '/tmp/talosconfig' },
    nodeIp: '10.0.0.2',
    appUrl: 'https://psa.example.com',
  };
}

function releaseFixtureDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'appliance-release-fixture-'));
  const releaseDir = path.join(root, '1.0.0');
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(
    path.join(releaseDir, 'release.json'),
    JSON.stringify({
      releaseVersion: '1.0.0',
      app: {
        version: '1.0.0',
        releaseBranch: 'release/1.0.0',
      },
    }),
  );
  return root;
}

function readyCondition(status = 'True', message = '') {
  return [{ type: 'Ready', status, message }];
}

function healthyResponses() {
  const responses = {
    'talosctl --talosconfig /tmp/talosconfig -n 10.0.0.2 -e 10.0.0.2 health --wait-timeout 20s': { ok: true, output: 'ok' },
    'kubectl --kubeconfig /tmp/kubeconfig get --raw=/readyz': { ok: true, output: 'ok' },
    'kubectl --kubeconfig /tmp/kubeconfig get nodes -o json': {
      ok: true,
      output: JSON.stringify({
        items: [{ metadata: { name: 'node-1' }, status: { conditions: readyCondition('True') } }],
      }),
    },
    'kubectl --kubeconfig /tmp/kubeconfig -n flux-system get gitrepositories.source.toolkit.fluxcd.io -o json': {
      ok: true,
      output: JSON.stringify({ items: [{ metadata: { name: 'alga-appliance' }, status: { conditions: readyCondition('True') } }] }),
    },
    'kubectl --kubeconfig /tmp/kubeconfig -n flux-system get kustomizations.kustomize.toolkit.fluxcd.io -o json': {
      ok: true,
      output: JSON.stringify({ items: [{ metadata: { name: 'alga-appliance' }, status: { conditions: readyCondition('True') } }] }),
    },
    'kubectl --kubeconfig /tmp/kubeconfig -n alga-system get helmreleases.helm.toolkit.fluxcd.io -o json': {
      ok: true,
      output: JSON.stringify({ items: [{ metadata: { name: 'alga-core' }, status: { conditions: readyCondition('True') } }] }),
    },
    'kubectl --kubeconfig /tmp/kubeconfig -n alga-system get configmap/appliance-release-selection -o json': {
      ok: true,
      output: JSON.stringify({ data: { releaseVersion: '1.0.0' } }),
    },
    'kubectl --kubeconfig /tmp/kubeconfig -n alga-system get configmap/appliance-values-alga-core -o json': {
      ok: true,
      output: JSON.stringify({ data: { 'alga-core.talos-single-node.yaml': 'appUrl: https://psa.example.com' } }),
    },
    'kubectl --kubeconfig /tmp/kubeconfig get events --sort-by=.metadata.creationTimestamp -A -o json': {
      ok: true,
      output: JSON.stringify({
        items: [
          {
            metadata: { namespace: 'msp', creationTimestamp: '2026-04-30T00:00:00Z' },
            reason: 'Pulled',
            type: 'Normal',
            message: 'Successfully pulled image',
            involvedObject: { kind: 'Pod', name: 'alga-core-sebastian-abc' },
          },
        ],
      }),
    },
  };

  const workloadResources = [
    'deployment/alga-core-sebastian',
    'statefulset/db',
    'statefulset/redis',
    'deployment/pgbouncer',
    'deployment/temporal',
    'deployment/workflow-worker',
    'deployment/email-service',
    'deployment/temporal-worker',
  ];
  for (const resource of workloadResources) {
    responses[`kubectl --kubeconfig /tmp/kubeconfig -n msp get ${resource} -o json`] = {
      ok: true,
      output: JSON.stringify({ spec: { replicas: 1 }, status: { readyReplicas: 1 } }),
    };
  }
  return responses;
}

test('T001: canonical status shape includes release, urls, rollup, tiers, blockers, components, and events', async () => {
  const releasesDir = releaseFixtureDir();
  const status = await collectStatus(buildEnv(releasesDir), {
    runner: new MockCaptureRunner(healthyResponses()),
  });

  assert.equal(status.canonical.siteId, 'appliance-single-node');
  assert.equal(status.canonical.release.selectedReleaseVersion, '1.0.0');
  assert.equal(status.canonical.release.appVersion, '1.0.0');
  assert.equal(status.canonical.urls.loginUrl, 'https://psa.example.com');
  assert.equal(status.canonical.urls.statusUrl, 'http://10.0.0.2:8080');
  assert.equal(status.canonical.rollup.state, 'fully_healthy');
  assert.equal(status.canonical.tiers.platform.ready, true);
  assert.equal(status.canonical.tiers.login.ready, true);
  assert.equal(status.canonical.topBlockers.length, 0);
  assert.equal(status.canonical.components.length, 8);
  assert.equal(status.canonical.recentEvents.length, 1);
});

test('T002: login-ready with background failures rolls up as ready_with_background_issues', async () => {
  const responses = healthyResponses();
  responses['kubectl --kubeconfig /tmp/kubeconfig -n msp get deployment/workflow-worker -o json'] = {
    ok: true,
    output: JSON.stringify({ spec: { replicas: 1 }, status: { readyReplicas: 0 } }),
  };
  const status = await collectStatus(buildEnv(releaseFixtureDir()), {
    runner: new MockCaptureRunner(responses),
  });

  assert.equal(status.canonical.tiers.login.ready, true);
  assert.equal(status.canonical.tiers.background.ready, false);
  assert.equal(status.canonical.rollup.state, 'ready_with_background_issues');
});

test('T003: core blocker keeps LOGIN_READY false and rollup failed_action_required', async () => {
  const responses = healthyResponses();
  responses['kubectl --kubeconfig /tmp/kubeconfig -n msp get statefulset/db -o json'] = {
    ok: true,
    output: JSON.stringify({ spec: { replicas: 1 }, status: { readyReplicas: 0 } }),
  };
  const status = await collectStatus(buildEnv(releaseFixtureDir()), {
    runner: new MockCaptureRunner(responses),
  });

  assert.equal(status.canonical.tiers.core.ready, false);
  assert.equal(status.canonical.tiers.login.ready, false);
  assert.equal(status.canonical.rollup.state, 'failed_action_required');
});

test('T004: status dashboard model includes talos, cluster, flux, workloads, release, and config paths', async () => {
  const releasesDir = releaseFixtureDir();
  const status = await collectStatus(buildEnv(releasesDir), {
    runner: new MockCaptureRunner(healthyResponses()),
  });

  assert.equal(status.connectivityMode, 'app-healthy');
  assert.equal(status.topBlocker.layer, 'none');
  assert.equal(status.host.status, 'healthy');
  assert.equal(status.cluster.apiReachable, true);
  assert.equal(status.flux.status, 'healthy');
  assert.equal(status.workloads.components.length, 8);
  assert.equal(status.release.selectedReleaseVersion, '1.0.0');
  assert.equal(status.release.appUrl, 'https://psa.example.com');
  assert.equal(status.configPaths.kubeconfig, '/tmp/kubeconfig');
});

test('T005: talos-only state reports Kubernetes availability as blocker', async () => {
  const responses = healthyResponses();
  responses['kubectl --kubeconfig /tmp/kubeconfig get --raw=/readyz'] = { ok: false, output: 'connection refused' };
  const status = await collectStatus(buildEnv(releaseFixtureDir()), {
    runner: new MockCaptureRunner(responses),
  });
  assert.equal(status.connectivityMode, 'talos-only');
  assert.equal(status.topBlocker.layer, 'Kubernetes availability');
});

test('T005: cluster-down with talos unreachable reports talos blocker', async () => {
  const responses = healthyResponses();
  responses['talosctl --talosconfig /tmp/talosconfig -n 10.0.0.2 -e 10.0.0.2 health --wait-timeout 20s'] = {
    ok: false,
    output: 'dial tcp timeout',
  };
  responses['kubectl --kubeconfig /tmp/kubeconfig get --raw=/readyz'] = { ok: false, output: 'connection refused' };
  const status = await collectStatus(buildEnv(releaseFixtureDir()), {
    runner: new MockCaptureRunner(responses),
  });
  assert.equal(status.connectivityMode, 'degraded');
  assert.equal(status.topBlocker.layer, 'Talos host reachability');
});

test('T005: flux-degraded state reports Flux blocker', async () => {
  const responses = healthyResponses();
  responses['kubectl --kubeconfig /tmp/kubeconfig -n flux-system get kustomizations.kustomize.toolkit.fluxcd.io -o json'] = {
    ok: true,
    output: JSON.stringify({
      items: [{ metadata: { name: 'alga-appliance' }, status: { conditions: readyCondition('False', 'reconcile failed') } }],
    }),
  };
  const status = await collectStatus(buildEnv(releaseFixtureDir()), {
    runner: new MockCaptureRunner(responses),
  });
  assert.equal(status.topBlocker.layer, 'Flux source/reconcile failure');
});

test('T005: workload-unhealthy state reports workload blocker', async () => {
  const responses = healthyResponses();
  responses['kubectl --kubeconfig /tmp/kubeconfig -n msp get deployment/temporal-worker -o json'] = {
    ok: true,
    output: JSON.stringify({ spec: { replicas: 1 }, status: { readyReplicas: 0 } }),
  };
  const status = await collectStatus(buildEnv(releaseFixtureDir()), {
    runner: new MockCaptureRunner(responses),
  });
  assert.equal(status.workloads.status, 'unhealthy');
  assert.equal(status.topBlocker.layer, 'workload readiness failure');
});

test('T004: DNS resolver failures are classified with explicit DNS remediation guidance', async () => {
  const responses = healthyResponses();
  responses['kubectl --kubeconfig /tmp/kubeconfig get events --sort-by=.metadata.creationTimestamp -A -o json'] = {
    ok: true,
    output: JSON.stringify({
      items: [
        {
          metadata: { namespace: 'flux-system', creationTimestamp: '2026-04-30T00:00:00Z' },
          reason: 'Failed',
          type: 'Warning',
          message: 'lookup factory.talos.dev on 192.168.64.1:53: connection refused',
          involvedObject: { kind: 'Pod', name: 'source-controller-abc' },
        },
      ],
    }),
  };

  const status = await collectStatus(buildEnv(releaseFixtureDir()), {
    runner: new MockCaptureRunner(responses),
  });

  assert.equal(status.topBlocker.layer, 'Platform DNS resolution');
  assert.match(status.topBlocker.reason, /DNS resolver failure detected/i);
  assert.match(status.topBlocker.nextAction, /Configure explicit DNS servers/i);
});

test('T005: Postgres subPath failure is classified as a core storage blocker', async () => {
  const responses = healthyResponses();
  responses['kubectl --kubeconfig /tmp/kubeconfig -n msp get statefulset/db -o json'] = {
    ok: true,
    output: JSON.stringify({ spec: { replicas: 1 }, status: { readyReplicas: 0 } }),
  };
  responses['kubectl --kubeconfig /tmp/kubeconfig get events --sort-by=.metadata.creationTimestamp -A -o json'] = {
    ok: true,
    output: JSON.stringify({
      items: [
        {
          metadata: { namespace: 'msp', creationTimestamp: '2026-04-30T00:00:00Z' },
          reason: 'Failed',
          type: 'Warning',
          message: 'failed to create subPath directory for volumeMount "db-data"',
          involvedObject: { kind: 'Pod', name: 'db-0' },
        },
      ],
    }),
  };

  const status = await collectStatus(buildEnv(releaseFixtureDir()), {
    runner: new MockCaptureRunner(responses),
  });

  assert.equal(status.topBlocker.layer, 'Core Postgres storage initialization');
  assert.match(status.topBlocker.reason, /PVC\/subPath initialization failed/i);
  assert.match(status.topBlocker.nextAction, /repair or recreate the Postgres PVC subPath/i);
});

test('T006: workflow-worker missing image tag is classified as background-only blocker', async () => {
  const responses = healthyResponses();
  responses['kubectl --kubeconfig /tmp/kubeconfig -n msp get deployment/workflow-worker -o json'] = {
    ok: true,
    output: JSON.stringify({ spec: { replicas: 1 }, status: { readyReplicas: 0 } }),
  };
  responses['kubectl --kubeconfig /tmp/kubeconfig get events --sort-by=.metadata.creationTimestamp -A -o json'] = {
    ok: true,
    output: JSON.stringify({
      items: [
        {
          metadata: { namespace: 'msp', creationTimestamp: '2026-04-30T00:00:00Z' },
          reason: 'Failed',
          type: 'Warning',
          message: 'Failed to pull image "ghcr.io/nine-minds/workflow-worker:61e4a00e": not found',
          involvedObject: { kind: 'Pod', name: 'workflow-worker-6c5f8f7d9b-abcde' },
        },
      ],
    }),
  };

  const status = await collectStatus(buildEnv(releaseFixtureDir()), {
    runner: new MockCaptureRunner(responses),
  });

  assert.equal(status.topBlocker.layer, 'Image tag availability');
  assert.equal(status.topBlocker.component, 'workflow-worker');
  assert.equal(status.topBlocker.loginBlocking, false);
  assert.match(status.topBlocker.reason, /workflow-worker:61e4a00e/i);
});

test('T007: alga-core missing image tag is classified as login-blocking blocker', async () => {
  const responses = healthyResponses();
  responses['kubectl --kubeconfig /tmp/kubeconfig -n msp get deployment/alga-core-sebastian -o json'] = {
    ok: true,
    output: JSON.stringify({ spec: { replicas: 1 }, status: { readyReplicas: 0 } }),
  };
  responses['kubectl --kubeconfig /tmp/kubeconfig get events --sort-by=.metadata.creationTimestamp -A -o json'] = {
    ok: true,
    output: JSON.stringify({
      items: [
        {
          metadata: { namespace: 'msp', creationTimestamp: '2026-04-30T00:00:00Z' },
          reason: 'Failed',
          type: 'Warning',
          message: 'ImagePullBackOff: Failed to pull image "ghcr.io/nine-minds/alga-psa-ee:deadbeef": not found',
          involvedObject: { kind: 'Pod', name: 'alga-core-sebastian-5bd8b8d9f8-xxyyy' },
        },
      ],
    }),
  };

  const status = await collectStatus(buildEnv(releaseFixtureDir()), {
    runner: new MockCaptureRunner(responses),
  });

  assert.equal(status.topBlocker.layer, 'Image tag availability');
  assert.equal(status.topBlocker.component, 'alga-core');
  assert.equal(status.topBlocker.loginBlocking, true);
  assert.match(status.topBlocker.reason, /alga-psa-ee:deadbeef/i);
});

test('T008: image pull context canceled is classified as retryable interruption', async () => {
  const responses = healthyResponses();
  responses['kubectl --kubeconfig /tmp/kubeconfig -n msp get deployment/email-service -o json'] = {
    ok: true,
    output: JSON.stringify({ spec: { replicas: 1 }, status: { readyReplicas: 0 } }),
  };
  responses['kubectl --kubeconfig /tmp/kubeconfig get events --sort-by=.metadata.creationTimestamp -A -o json'] = {
    ok: true,
    output: JSON.stringify({
      items: [
        {
          metadata: { namespace: 'msp', creationTimestamp: '2026-04-30T00:00:00Z' },
          reason: 'Failed',
          type: 'Warning',
          message: 'Failed to pull image "ghcr.io/nine-minds/email-service:61e4a00e": context canceled',
          involvedObject: { kind: 'Pod', name: 'email-service-7cc4f7f9d8-abcde' },
        },
      ],
    }),
  };

  const status = await collectStatus(buildEnv(releaseFixtureDir()), {
    runner: new MockCaptureRunner(responses),
  });

  assert.equal(status.topBlocker.layer, 'Image pull interruption');
  assert.equal(status.topBlocker.component, 'email-service');
  assert.match(status.topBlocker.reason, /retryable/i);
  assert.match(status.topBlocker.nextAction, /automatic retry/i);
});

test('T009: helm timeout with db subPath failure reports db storage blocker as top cause', async () => {
  const responses = healthyResponses();
  responses['kubectl --kubeconfig /tmp/kubeconfig -n alga-system get helmreleases.helm.toolkit.fluxcd.io -o json'] = {
    ok: true,
    output: JSON.stringify({
      items: [{ metadata: { name: 'alga-core' }, status: { conditions: readyCondition('False', 'context deadline exceeded') } }],
    }),
  };
  responses['kubectl --kubeconfig /tmp/kubeconfig -n msp get statefulset/db -o json'] = {
    ok: true,
    output: JSON.stringify({ spec: { replicas: 1 }, status: { readyReplicas: 0 } }),
  };
  responses['kubectl --kubeconfig /tmp/kubeconfig get events --sort-by=.metadata.creationTimestamp -A -o json'] = {
    ok: true,
    output: JSON.stringify({
      items: [
        {
          metadata: { namespace: 'msp', creationTimestamp: '2026-04-30T00:00:00Z' },
          reason: 'Failed',
          type: 'Warning',
          message: 'failed to create subPath directory for volumeMount "db-data"',
          involvedObject: { kind: 'Pod', name: 'db-0' },
        },
      ],
    }),
  };

  const status = await collectStatus(buildEnv(releaseFixtureDir()), {
    runner: new MockCaptureRunner(responses),
  });

  assert.equal(status.flux.helmStatus, 'unhealthy');
  assert.equal(status.topBlocker.layer, 'Core Postgres storage initialization');
  assert.match(status.topBlocker.reason, /subPath/i);
});
