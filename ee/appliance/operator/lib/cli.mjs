import { parseArgs, toBoolean } from './args.mjs';
import { discoverEnvironment } from './environment.mjs';
import { formatStatusReport, printSection } from './format.mjs';
import { runRepairRelease, runReset, runSupportBundle } from './lifecycle.mjs';
import { collectStatus } from './status.mjs';

function usage() {
  return [
    'Usage: appliance <command> [options]',
    'Note: supported installs and upgrades use the Ubuntu host setup/status service on port 8080.',
    '',
    'Commands:',
    '  tui',
    '  status',
    '  support-bundle',
    '  repair-release',
    '  reset',
    '',
    'Common options:',
    '  --site-id <id>',
    '  --node-ip <ip>',
    '  --kubeconfig <path>',
    '  --talosconfig <path>',
    '  --asset-root <path>  (standalone runtime path containing scripts/ and flux/)',
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
      const { runTui } = await import('./tui.mjs');
      return runTui(env);
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

    if (command === 'repair-release') {
      const result = await runRepairRelease(env, {
        releaseName: flags['release-name'],
        releaseNamespace: flags['release-namespace'],
        workloadNamespace: flags['workload-namespace'],
        cleanupWorkloads: toBoolean(flags['skip-cleanup-workloads']) ? false : undefined,
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
