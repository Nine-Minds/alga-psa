import { parseArgs, toBoolean } from './args.mjs';
import { discoverEnvironment } from './environment.mjs';
import { formatStatusReport, printSection } from './format.mjs';
import { runBootstrap, runReset, runSupportBundle, runUpgrade } from './lifecycle.mjs';
import { collectStatus } from './status.mjs';
import { runTui } from './tui.mjs';

function usage() {
  return [
    'Usage: appliance <command> [options]',
    '',
    'Commands:',
    '  tui',
    '  bootstrap',
    '  upgrade',
    '  reset',
    '  status',
    '  support-bundle',
    '',
    'Common options:',
    '  --site-id <id>',
    '  --node-ip <ip>',
    '  --kubeconfig <path>',
    '  --talosconfig <path>',
    '  --release-version <version>',
    '  --channel <name>     Resolve release from releases/channels/<name>.json',
    '  --asset-root <path>  (standalone runtime path containing scripts/ and releases/)',
  ].join('\n');
}

function buildEnv(flags, command) {
  return discoverEnvironment({
    siteId: flags['site-id'],
    nodeIp: flags['node-ip'],
    kubeconfig: flags.kubeconfig,
    talosconfig: flags.talosconfig,
    assetRoot: flags['asset-root'],
    allowAmbiguousSiteSelection: command === 'tui',
  });
}

function logProgress(event) {
  if (event.type === 'phase') {
    process.stdout.write(`\n[${event.phase}]\n`);
    return;
  }
  if (event.type === 'line' && event.line.trim()) {
    process.stdout.write(`${event.line}\n`);
    return;
  }
  if (event.type === 'error' || event.type === 'done') {
    process.stdout.write(`${event.line}\n`);
  }
}

export async function runCli(argv) {
  try {
    const { args, flags } = parseArgs(argv);
    const command = args[0] || 'tui';

    if (flags.help || flags.h) {
      process.stdout.write(`${usage()}\n`);
      return 0;
    }

    const env = buildEnv(flags, command);

    if (command === 'tui') {
      return runTui(env);
    }

    if (command === 'bootstrap') {
      const result = await runBootstrap(env, {
        releaseVersion: flags['release-version'],
        channel: flags.channel,
        bootstrapMode: flags['bootstrap-mode'] || 'recover',
        nodeIp: flags['node-ip'],
        hostname: flags.hostname,
        appUrl: flags['app-url'],
        interface: flags.interface,
        networkMode: flags['network-mode'],
        staticAddress: flags['static-address'],
        staticGateway: flags['static-gateway'],
        dnsServers: flags['dns-servers'],
        repoUrl: flags['repo-url'],
        repoBranch: flags['repo-branch'],
        prepullImages: toBoolean(flags['prepull-images']),
        dryRun: toBoolean(flags['dry-run']),
        onProgress: logProgress,
      });
      if (!result.ok) {
        printSection('Bootstrap Failure', [
          `Failure layer: ${result.failureLayer}`,
          'Next step: run support-bundle and review status output.',
        ]);
        return 1;
      }
      return 0;
    }

    if (command === 'upgrade') {
      const result = await runUpgrade(env, {
        releaseVersion: flags['release-version'],
        channel: flags.channel,
        dryRun: toBoolean(flags['dry-run']),
        onProgress: logProgress,
      });

      if (!result.ok) {
        printSection('Upgrade Failure', [
          'Automatic rollback is disabled for appliance upgrades.',
          'Next step: run support-bundle and inspect Flux/Helm conditions.',
        ]);
        return 1;
      }

      return 0;
    }

    if (command === 'reset') {
      if (!toBoolean(flags.force)) {
        process.stderr.write('Reset is destructive. Re-run with --force.\n');
        return 1;
      }

      const result = await runReset(env, {
        dryRun: toBoolean(flags['dry-run']),
        onProgress: logProgress,
      });
      return result.ok ? 0 : 1;
    }

    if (command === 'status') {
      const status = await collectStatus(env);
      const report = formatStatusReport(status);
      printSection('Summary', report.summary);
      printSection('Talos', report.host);
      printSection('Kubernetes', report.cluster);
      printSection('Flux', report.flux);
      printSection('Workloads', report.workloads);
      printSection('Release', report.release);
      printSection('Config Paths', report.paths);
      return 0;
    }

    if (command === 'support-bundle') {
      const result = await runSupportBundle(env, {
        outputDir: flags['output-dir'],
        onProgress: logProgress,
      });
      return result.ok ? 0 : 1;
    }

    process.stderr.write(`Unknown command: ${command}\n\n${usage()}\n`);
    return 1;
  } catch (error) {
    process.stderr.write(`${error.message || String(error)}\n`);
    return 1;
  }
}
