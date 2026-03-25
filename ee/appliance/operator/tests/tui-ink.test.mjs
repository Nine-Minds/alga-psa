import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { render } from 'ink-testing-library';
import { TuiApp } from '../lib/tui.mjs';

function sleep(ms = 0) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function makeStatus() {
  return {
    siteId: 'appliance-single-node',
    nodeIp: '10.0.0.2',
    connectivityMode: 'kubernetes-available',
    topBlocker: {
      layer: 'none',
      reason: 'No blocker detected',
      nextAction: 'No immediate action required.',
    },
    host: { status: 'healthy', details: 'Talos API reachable' },
    cluster: {
      apiReachable: true,
      status: 'healthy',
      nodeReadiness: [{ name: 'node-1', ready: true, status: 'True', message: '' }],
    },
    flux: {
      status: 'healthy',
      helmStatus: 'healthy',
      sources: [],
      kustomizations: [],
      helmReleases: [],
    },
    workloads: {
      status: 'healthy',
      components: [
        { name: 'alga-core', status: 'healthy', ready: '1/1', message: '' },
        { name: 'db', status: 'healthy', ready: '1/1', message: '' },
      ],
    },
    release: {
      selectedReleaseVersion: '1.0.0',
      metadata: null,
      appUrl: 'https://psa.example.com',
    },
    configPaths: {
      configDir: '/tmp/site',
      kubeconfig: '/tmp/kubeconfig',
      talosconfig: '/tmp/talosconfig',
    },
  };
}

function makeEnv(overrides = {}) {
  return {
    runtime: {
      assetRoot: '/tmp',
      bootstrapScript: '/tmp/bootstrap-appliance.sh',
      upgradeScript: '/tmp/upgrade-appliance.sh',
      resetScript: '/tmp/reset-appliance-data.sh',
      supportBundleScript: '/tmp/collect-support-bundle.sh',
      releasesDir: '/tmp/releases',
    },
    configBaseDir: '/tmp/config-base',
    siteIds: ['appliance-single-node'],
    siteSelectionRequired: false,
    site: {
      siteId: 'appliance-single-node',
      configDir: '/tmp/site',
      kubeconfig: '/tmp/kubeconfig',
      talosconfig: '/tmp/talosconfig',
      nodeIpFile: '/tmp/site/node-ip',
      appUrlFile: '/tmp/site/app-url',
    },
    paths: {
      kubeconfig: '/tmp/kubeconfig',
      talosconfig: '/tmp/talosconfig',
    },
    releases: ['0.9.0', '1.0.0'],
    defaultReleaseVersion: '1.0.0',
    nodeIp: '10.0.0.2',
    appUrl: 'https://psa.example.com',
    ...overrides,
  };
}

function makeActions(overrides = {}) {
  return {
    collectStatus: async () => makeStatus(),
    runBootstrap: async () => ({ ok: true }),
    runUpgrade: async () => ({ ok: true }),
    runReset: async () => ({ ok: true }),
    runSupportBundle: async () => ({ ok: true }),
    listAppliancePods: async () => ({
      fetchedAt: '2026-03-25T12:00:00Z',
      namespaces: ['msp', 'alga-system', 'flux-system'],
      errors: [],
      pods: [
        {
          key: 'msp/alga-core-0',
          namespace: 'msp',
          name: 'alga-core-0',
          phase: 'Running',
          status: 'Running',
          ready: '2/2',
          restarts: 0,
          age: '10m',
        },
      ],
    }),
    readPodLogsTail: async () => ({
      ok: true,
      lines: [
        { timestamp: '2026-03-25T12:00:00Z', text: '2026-03-25T12:00:00Z ready' },
        { timestamp: '2026-03-25T12:00:01Z', text: '2026-03-25T12:00:01Z healthy' },
      ],
    }),
    readPodLogsSince: async () => ({ ok: true, lines: [] }),
    ...overrides,
  };
}

function pressEnter(ui) {
  ui.stdin.write('\r');
}

function typeText(ui, text) {
  ui.stdin.write(text);
}

function pressJ(ui, count = 1) {
  for (let index = 0; index < count; index += 1) {
    ui.stdin.write('j');
  }
}

test('T007: Ink shell renders persistent layout regions instead of sequential prompt output', async () => {
  const ui = render(
    React.createElement(TuiApp, {
      initialEnv: makeEnv(),
      actions: makeActions(),
      onExit: () => {},
    }),
  );

  await sleep(20);
  const frame = ui.lastFrame() || '';
  assert.match(frame, /Alga PSA Operator/);
  assert.match(frame, /Actions/);
  assert.match(frame, /Status Dashboard/);
  assert.doesNotMatch(frame, /Live Progress/);
  assert.match(frame, /Bootstrap/);
  assert.doesNotMatch(frame, /Select \[1\]/);
  ui.unmount();
});

test('T008: Ink lifecycle forms are keyboard-navigable, including reset confirmation and missing release states', async () => {
  const bootstrapUi = render(
    React.createElement(TuiApp, {
      initialEnv: makeEnv(),
      actions: makeActions(),
      onExit: () => {},
    }),
  );

  await sleep(20);

  // Open Bootstrap form from default selection.
  pressEnter(bootstrapUi);
  await sleep(20);
  let frame = bootstrapUi.lastFrame() || '';
  assert.match(frame, /Bootstrap Form/);
  assert.match(frame, /Release Version/);
  assert.match(frame, /Network Mode/);
  bootstrapUi.unmount();

  // Open a fresh shell for reset flow.
  const resetUi = render(
    React.createElement(TuiApp, {
      initialEnv: makeEnv(),
      actions: makeActions(),
      onExit: () => {},
    }),
  );
  await sleep(20);

  // Navigate to Reset and verify challenge behavior.
  pressJ(resetUi, 5);
  await sleep(20);
  pressEnter(resetUi);
  await sleep(20);
  frame = resetUi.lastFrame() || '';
  assert.match(frame, /Reset Form/);
  assert.match(frame, /Wipes namespace msp/);

  pressEnter(resetUi);
  await sleep(20);
  frame = resetUi.lastFrame() || '';
  assert.match(frame, /Reset confirmation mismatch/i);

  resetUi.unmount();

  const resetConfirmUi = render(
    React.createElement(TuiApp, {
      initialEnv: makeEnv(),
      actions: makeActions(),
      onExit: () => {},
    }),
  );
  await sleep(20);
  pressJ(resetConfirmUi, 5);
  await sleep(20);
  pressEnter(resetConfirmUi);
  await sleep(20);
  typeText(resetConfirmUi, 'WIPE appliance-single-node');
  pressEnter(resetConfirmUi);
  await sleep(20);
  frame = resetConfirmUi.lastFrame() || '';
  assert.match(frame, /Type WIPE appliance-single-node: WIPE/);
  assert.match(frame, /Reset confirmation mismatch|Enter confirm/i);
  resetConfirmUi.unmount();

  // Missing-release state (bootstrap flow).
  const noReleaseUi = render(
    React.createElement(TuiApp, {
      initialEnv: makeEnv({ releases: [], defaultReleaseVersion: null }),
      actions: makeActions(),
      onExit: () => {},
    }),
  );
  await sleep(20);
  pressEnter(noReleaseUi);
  await sleep(20);
  const noReleaseFrame = noReleaseUi.lastFrame() || '';
  assert.match(noReleaseFrame, /Bootstrap Unavailable/);
  assert.match(noReleaseFrame, /No published appliance releases were/);
  assert.match(noReleaseFrame, /found\./);
  noReleaseUi.unmount();
});

test('T009: Ink progress stream stays in dedicated region while status dashboard remains visible', async () => {
  const ui = render(
    React.createElement(TuiApp, {
      initialEnv: makeEnv(),
      actions: makeActions({
        runUpgrade: async (_env, options) => {
          options.onProgress?.({ type: 'phase', phase: 'Helm', line: 'Helm phase' });
          options.onProgress?.({ type: 'line', line: 'helmrelease/alga-core reconciling' });
          options.onProgress?.({ type: 'done', line: 'upgrade complete' });
          await sleep(10);
          return { ok: true };
        },
      }),
      onExit: () => {},
    }),
  );

  await sleep(20);
  pressJ(ui); // Upgrade
  await sleep(20);
  pressEnter(ui); // Form
  await sleep(20);
  let frame = ui.lastFrame() || '';
  assert.match(frame, /Upgrade Form/);

  pressEnter(ui); // Confirm
  await sleep(20);
  pressEnter(ui); // Run
  await sleep(40);

  frame = ui.lastFrame() || '';
  assert.match(frame, /Upgrade completed successfully/);
  assert.match(frame, /Live Progress/);
  assert.match(frame, /Helm phase/);
  assert.match(frame, /helmrelease\/alga-core reconciling/);
  assert.match(frame, /Status Dashboard/);
  ui.unmount();
});

test('T010: Workload console lists appliance-scoped pods with status columns and preserves selection on refresh', async () => {
  let pollCount = 0;
  const ui = render(
    React.createElement(TuiApp, {
      initialEnv: makeEnv(),
      actions: makeActions({
        listAppliancePods: async () => {
          pollCount += 1;
          const updatedAge = pollCount > 1 ? '11m' : '10m';
          return {
            fetchedAt: `2026-03-25T12:00:0${Math.min(pollCount, 9)}Z`,
            namespaces: ['msp', 'alga-system', 'flux-system'],
            errors: [],
            pods: [
              {
                key: 'msp/alga-core-0',
                namespace: 'msp',
                name: 'alga-core-0',
                phase: 'Running',
                status: 'Running',
                ready: '2/2',
                restarts: 0,
                age: updatedAge,
              },
              {
                key: 'alga-system/release-controller',
                namespace: 'alga-system',
                name: 'release-controller',
                phase: 'Running',
                status: 'CrashLoopBackOff',
                ready: '0/1',
                restarts: 4,
                age: '5m',
              },
            ],
          };
        },
      }),
      onExit: () => {},
    }),
  );

  await sleep(20);
  pressJ(ui, 3); // Workloads
  await sleep(20);
  pressEnter(ui);
  await sleep(60);

  let frame = ui.lastFrame() || '';
  assert.match(frame, /Workloads/);
  assert.match(frame, /Namespaces: msp, alga-system, flux-system/);
  assert.match(frame, /alga-core-0/);
  assert.match(frame, /release-controller/);
  assert.match(frame, /CrashLoopBackOff/);
  assert.match(frame, /Ready\s+Restarts\s+Age/);

  pressJ(ui); // select second row
  await sleep(20);
  pressJ(ui); // wrap
  await sleep(20);
  ui.stdin.write('r');
  await sleep(40);

  frame = ui.lastFrame() || '';
  assert.match(frame, /> alga-core-0/);
  assert.match(frame, /11m|10m/);
  ui.unmount();
});

test('T011: Log viewer opens from workload list and Escape returns to workloads layout', async () => {
  const ui = render(
    React.createElement(TuiApp, {
      initialEnv: makeEnv(),
      actions: makeActions(),
      onExit: () => {},
    }),
  );
  await sleep(20);
  pressJ(ui, 3);
  await sleep(20);
  pressEnter(ui);
  await sleep(50);
  pressEnter(ui);
  await sleep(40);

  let frame = ui.lastFrame() || '';
  assert.match(frame, /Logs: msp\/alga-core-0/);
  assert.match(frame, /ready/);

  ui.stdin.write('\u001B'); // escape
  await sleep(40);
  frame = ui.lastFrame() || '';
  assert.match(frame, /Workloads/);
  assert.match(frame, /> alga-core-0/);
  ui.unmount();
});

test('T012: Log viewer prepends older chunks, toggles follow mode, and bounds line count', async () => {
  let tailCalls = 0;
  const ui = render(
    React.createElement(TuiApp, {
      initialEnv: makeEnv(),
      actions: makeActions({
        readPodLogsTail: async (_env, _pod, options) => {
          tailCalls += 1;
          const tail = Number(options?.tailLines || 0);
          const lines = [];
          for (let index = 0; index < tail; index += 1) {
            const stamp = `2026-03-25T12:00:${String(index % 60).padStart(2, '0')}Z`;
            lines.push({ timestamp: stamp, text: `${stamp} line-${index}` });
          }
          return { ok: true, lines };
        },
        readPodLogsSince: async () => ({
          ok: true,
          lines: [{ timestamp: '2026-03-25T12:10:00Z', text: '2026-03-25T12:10:00Z live-line' }],
        }),
      }),
      onExit: () => {},
    }),
  );

  await sleep(20);
  pressJ(ui, 3);
  await sleep(20);
  pressEnter(ui);
  await sleep(40);
  pressEnter(ui); // open logs
  await sleep(40);

  let frame = ui.lastFrame() || '';
  assert.match(frame, /Follow: on/);

  ui.stdin.write('k');
  await sleep(40);
  frame = ui.lastFrame() || '';
  assert.match(frame, /Follow: paused/);

  for (let index = 0; index < 140; index += 1) {
    ui.stdin.write('k');
  }
  await sleep(40);
  pressEnter(ui);
  await sleep(70);

  frame = ui.lastFrame() || '';
  const countMatch = frame.match(/Lines:\s+(\d+)/);
  assert.ok(countMatch);
  const lineCount = Number(countMatch[1]);
  assert.ok(lineCount > 120);
  assert.ok(lineCount <= 400);
  assert.ok(tailCalls >= 2);

  for (let index = 0; index < 260; index += 1) {
    ui.stdin.write('j');
  }
  await sleep(1700);
  frame = ui.lastFrame() || '';
  assert.match(frame, /Follow: on/);
  assert.match(frame, /live-line|line-/);
  ui.unmount();
});
