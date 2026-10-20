import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APPLIANCE_FLUX_CONTROLLERS,
  LEADER_ELECTION_DISABLED_ARG,
  fluxControllerTuningPatch,
  tuneFluxControllers
} from '../flux-controller-tuning.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

// Shape of a Deployment as `flux install` creates it (upstream install.yaml).
function upstreamDeployment(name, { strategy = { type: 'RollingUpdate', rollingUpdate: { maxSurge: '25%', maxUnavailable: '25%' } } } = {}) {
  return {
    metadata: { name, namespace: 'flux-system' },
    spec: {
      strategy,
      template: {
        spec: {
          containers: [{
            name: 'manager',
            args: [
              '--events-addr=http://notification-controller.flux-system.svc.cluster.local./',
              '--watch-all-namespaces',
              '--log-level=info',
              '--log-encoding=json',
              '--enable-leader-election'
            ]
          }]
        }
      }
    }
  };
}

// Apply the JSON patch ops the way the API server would (replace/add/test only).
function applyPatch(doc, patch) {
  const next = structuredClone(doc);
  for (const op of patch) {
    const keys = op.path.split('/').slice(1);
    const last = keys.pop();
    const parent = keys.reduce((node, key) => node[key], next);
    if (op.op === 'test') assert.deepEqual(parent[last], op.value, `test op failed at ${op.path}`);
    else parent[last] = op.value;
  }
  return next;
}

test('tuning disables leader election and switches to Recreate in one patch; re-running is a no-op', () => {
  const deployment = upstreamDeployment('helm-controller');
  const patch = fluxControllerTuningPatch(deployment);
  const tuned = applyPatch(deployment, patch);

  const args = tuned.spec.template.spec.containers[0].args;
  assert.equal(args.filter((arg) => arg.startsWith('--enable-leader-election')).length, 1);
  assert.equal(args.at(-1), LEADER_ELECTION_DISABLED_ARG);
  assert.ok(args.includes('--watch-all-namespaces'), 'other upstream args are preserved');
  assert.deepEqual(tuned.spec.strategy, { type: 'Recreate' });
  // Strategy must change before (with) the args so the tuning rollout itself
  // never overlaps two controllers.
  const opPaths = patch.filter((op) => op.op !== 'test').map((op) => op.path);
  assert.deepEqual(opPaths, ['/spec/strategy', '/spec/template/spec/containers/0/args']);

  assert.equal(fluxControllerTuningPatch(tuned), null);
});

test('source-controller (already Recreate upstream) only gets the args change', () => {
  const deployment = upstreamDeployment('source-controller', { strategy: { type: 'Recreate' } });
  const patch = fluxControllerTuningPatch(deployment);
  assert.deepEqual(patch.filter((op) => op.op !== 'test').map((op) => op.path), ['/spec/template/spec/containers/0/args']);
});

test('tuneFluxControllers patches each installed controller, skips absent ones, and reports failures', () => {
  const calls = [];
  const runKubectl = (args) => {
    calls.push(args);
    const name = args[4];
    if (args[2] === 'get') {
      if (name === 'notification-controller') return { ok: false, status: 1, stdout: '', stderr: 'Error from server (NotFound): deployments.apps "notification-controller" not found' };
      if (name === 'source-controller') return { ok: true, status: 0, stdout: JSON.stringify(applyPatch(upstreamDeployment(name), fluxControllerTuningPatch(upstreamDeployment(name)))), stderr: '' };
      return { ok: true, status: 0, stdout: JSON.stringify(upstreamDeployment(name)), stderr: '' };
    }
    if (name === 'helm-controller') return { ok: false, status: 1, stdout: '', stderr: 'the server rejected our request' };
    return { ok: true, status: 0, stdout: 'patched', stderr: '' };
  };

  const result = tuneFluxControllers({ runKubectl });

  assert.deepEqual(result.controllers.map((c) => [c.name, c.action]), [
    ['source-controller', 'unchanged'],
    ['kustomize-controller', 'patched'],
    ['helm-controller', 'failed'],
    ['notification-controller', 'absent']
  ]);
  assert.equal(result.ok, false);
  const patchCall = calls.find((args) => args[2] === 'patch' && args[4] === 'kustomize-controller');
  assert.deepEqual(patchCall.slice(0, 6), ['-n', 'flux-system', 'patch', 'deployment', 'kustomize-controller', '--type=json']);
});

test('a box without Flux yet (all controllers absent) is not a failure', () => {
  const result = tuneFluxControllers({
    runKubectl: () => ({ ok: false, status: 1, stdout: '', stderr: 'Error from server (NotFound): namespaces "flux-system" not found' })
  });
  assert.equal(result.ok, true);
  assert.ok(result.controllers.every((c) => c.action === 'absent'));
  assert.equal(result.controllers.length, APPLIANCE_FLUX_CONTROLLERS.length);
});

test('control-plane entrypoint re-applies the tuning on every start (how existing appliances receive it)', () => {
  const entrypoint = fs.readFileSync(path.join(here, '..', '..', 'scripts', 'control-plane-entrypoint.sh'), 'utf8');
  assert.match(entrypoint, /node \/opt\/alga-appliance\/host-service\/flux-controller-tuning\.mjs/);
  // Must run in the background, before exec'ing the server.
  assert.ok(entrypoint.indexOf('flux-controller-tuning.mjs') < entrypoint.indexOf('exec node /opt/alga-appliance/host-service/server.mjs'));
});
