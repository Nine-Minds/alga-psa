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
  assert.match(frame, /Appliance Operator \(Ink\)/);
  assert.match(frame, /Actions/);
  assert.match(frame, /Status Dashboard/);
  assert.match(frame, /Live Progress/);
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
  pressJ(resetUi, 2);
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
  pressJ(resetConfirmUi, 2);
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
