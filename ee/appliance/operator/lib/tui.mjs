import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { collectStatus } from './status.mjs';
import { formatStatusReport, formatStatusSummary, printSection } from './format.mjs';
import { runBootstrap, runReset, runSupportBundle, runUpgrade } from './lifecycle.mjs';

function printHeader(status, env) {
  const summary = status
    ? formatStatusSummary(status)
    : [
        `Site: ${env.site.siteId}`,
        `Node IP: ${env.nodeIp || 'unknown'}`,
        'Connectivity: unknown',
        'Selected release: unknown',
      ];
  printSection('Appliance Operator', summary);
}

function progressLogger(event) {
  if (event.type === 'phase') {
    output.write(`\n[${event.phase}]\n`);
    return;
  }
  if (event.type === 'line' && event.line.trim()) {
    output.write(`${event.line}\n`);
    return;
  }
  if (event.type === 'error' || event.type === 'done') {
    output.write(`${event.line}\n`);
  }
}

async function promptChoice(rl, label, choices, defaultIndex = 0) {
  const rendered = choices.map((entry, index) => `${index + 1}) ${entry}`).join('\n');
  const answer = await rl.question(`${label}\n${rendered}\nSelect [${defaultIndex + 1}]: `);
  const parsed = Number(answer.trim() || String(defaultIndex + 1));
  if (Number.isNaN(parsed) || parsed < 1 || parsed > choices.length) {
    return choices[defaultIndex];
  }
  return choices[parsed - 1];
}

async function runBootstrapFlow(rl, env) {
  const releaseVersion = await promptChoice(rl, 'Select target release version', env.releases, env.releases.length - 1);
  const bootstrapMode = await promptChoice(rl, 'Select bootstrap mode', ['recover', 'fresh'], 0);
  const nodeIp = (await rl.question(`Node IP [${env.nodeIp || ''}]: `)).trim() || env.nodeIp || '';
  const hostname = (await rl.question(`Hostname [${env.site.siteId}]: `)).trim() || env.site.siteId;
  const appUrlDefault = env.appUrl || (nodeIp ? `http://${nodeIp}:3000` : '');
  const appUrl = (await rl.question(`App URL [${appUrlDefault}]: `)).trim() || appUrlDefault;
  const networkMode = await promptChoice(rl, 'Network mode', ['dhcp', 'static'], 0);
  const iface = (await rl.question('Network interface [enp0s1]: ')).trim() || 'enp0s1';
  const staticAddress = networkMode === 'static' ? (await rl.question('Static address CIDR: ')).trim() : '';
  const staticGateway = networkMode === 'static' ? (await rl.question('Static gateway: ')).trim() : '';
  const dnsServers = (await rl.question('DNS servers csv (optional): ')).trim();

  printSection('Bootstrap Confirmation', [
    `Site: ${env.site.siteId}`,
    `Release: ${releaseVersion}`,
    `Mode: ${bootstrapMode}`,
    `Node IP: ${nodeIp}`,
    `Hostname: ${hostname}`,
    `App URL: ${appUrl}`,
    `Network: ${networkMode}`,
  ]);

  const confirm = (await rl.question('Proceed with bootstrap? [y/N]: ')).trim().toLowerCase();
  if (confirm !== 'y' && confirm !== 'yes') {
    output.write('Bootstrap cancelled.\n');
    return;
  }

  const result = await runBootstrap(env, {
    releaseVersion,
    bootstrapMode,
    nodeIp,
    hostname,
    appUrl,
    networkMode,
    interface: iface,
    staticAddress,
    staticGateway,
    dnsServers,
    onProgress: progressLogger,
  });

  if (!result.ok) {
    printSection('Bootstrap Failed', [
      `Failure layer: ${result.failureLayer}`,
      'Next step: collect support bundle from the Support Bundle action.',
    ]);
  } else {
    printSection('Bootstrap Complete', ['Appliance bootstrap completed successfully.']);
  }
}

async function runUpgradeFlow(rl, env) {
  const status = await collectStatus(env).catch(() => null);
  const current = status?.release?.selectedReleaseVersion || 'unknown';
  printSection('Upgrade', [
    `Current release: ${current}`,
    'No auto-rollback policy: failed upgrades stop for investigation.',
  ]);

  const releaseVersion = await promptChoice(rl, 'Select target release version', env.releases, env.releases.length - 1);
  const confirm = (await rl.question(`Upgrade to ${releaseVersion}? [y/N]: `)).trim().toLowerCase();
  if (confirm !== 'y' && confirm !== 'yes') {
    output.write('Upgrade cancelled.\n');
    return;
  }

  const result = await runUpgrade(env, {
    releaseVersion,
    onProgress: progressLogger,
  });

  if (!result.ok) {
    printSection('Upgrade Failed', [
      'Automatic rollback is disabled for appliance Helm releases.',
      'Next step: collect a support bundle and investigate Flux/Helm status.',
    ]);
  } else {
    printSection('Upgrade Complete', [`Upgrade to ${releaseVersion} submitted successfully.`]);
  }
}

async function runResetFlow(rl, env) {
  printSection('Reset Warning', [
    `Target appliance: ${env.site.siteId}`,
    'This wipes namespace msp, namespace alga-system, and /opt/local-path-provisioner data.',
    'This action is destructive and cannot be reversed.',
  ]);

  const challenge = `WIPE ${env.site.siteId}`;
  const typed = (await rl.question(`Type "${challenge}" to continue: `)).trim();
  if (typed !== challenge) {
    output.write('Reset cancelled.\n');
    return;
  }

  const result = await runReset(env, { onProgress: progressLogger });
  if (!result.ok) {
    printSection('Reset Failed', ['Reset command failed. Collect a support bundle and inspect cluster state.']);
  } else {
    printSection('Reset Complete', ['Appliance state wipe completed.']);
  }
}

async function runStatusFlow(env) {
  const status = await collectStatus(env);
  const report = formatStatusReport(status);
  printSection('Summary', report.summary);
  printSection('Talos', report.host);
  printSection('Kubernetes', report.cluster);
  printSection('Flux', report.flux);
  printSection('Workloads', report.workloads);
  printSection('Release', report.release);
  printSection('Config Paths', report.paths);
}

async function runSupportBundleFlow(rl, env) {
  const outputDir = (await rl.question(`Bundle output directory [${process.cwd()}]: `)).trim() || process.cwd();
  const result = await runSupportBundle(env, {
    outputDir,
    onProgress: progressLogger,
  });

  if (!result.ok) {
    printSection('Support Bundle Failed', ['Support bundle collection failed.']);
  }
}

export async function runTui(env) {
  const rl = readline.createInterface({ input, output });
  try {
    let exit = false;
    while (!exit) {
      const status = await collectStatus(env).catch(() => null);
      printHeader(status, env);

      const choice = await promptChoice(rl, 'Actions', [
        'Bootstrap',
        'Upgrade',
        'Reset',
        'Status',
        'Support Bundle',
        'Exit',
      ]);

      if (choice === 'Bootstrap') {
        await runBootstrapFlow(rl, env);
      } else if (choice === 'Upgrade') {
        await runUpgradeFlow(rl, env);
      } else if (choice === 'Reset') {
        await runResetFlow(rl, env);
      } else if (choice === 'Status') {
        await runStatusFlow(env);
      } else if (choice === 'Support Bundle') {
        await runSupportBundleFlow(rl, env);
      } else {
        exit = true;
      }
    }
  } finally {
    rl.close();
  }

  return 0;
}
