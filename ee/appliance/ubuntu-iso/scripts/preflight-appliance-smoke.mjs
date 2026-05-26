#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse, parseAllDocuments } from 'yaml';

const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..', '..', '..'));
const defaultRepoUrl = 'https://github.com/Nine-Minds/alga-psa.git';
const expectedHelmReleases = ['alga-core', 'pgbouncer', 'temporal', 'workflow-worker', 'email-service', 'temporal-worker'];

function parseArgs(argv) {
  const args = {
    channel: 'stable',
    repoUrl: defaultRepoUrl,
    repoBranch: '',
    iso: '',
    workRoot: '',
    allowChannelBranch: false,
    allowUnpushed: false,
    skipRemote: false,
    keepExtracted: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--channel') args.channel = argv[++i] || '';
    else if (arg === '--repo-url') args.repoUrl = argv[++i] || '';
    else if (arg === '--repo-branch') args.repoBranch = argv[++i] || '';
    else if (arg === '--iso') args.iso = argv[++i] || '';
    else if (arg === '--work-root') args.workRoot = argv[++i] || '';
    else if (arg === '--allow-channel-branch') args.allowChannelBranch = true;
    else if (arg === '--allow-unpushed') args.allowUnpushed = true;
    else if (arg === '--skip-remote') args.skipRemote = true;
    else if (arg === '--keep-extracted') args.keepExtracted = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  args.channel = String(args.channel || '').trim();
  args.repoUrl = String(args.repoUrl || '').trim();
  args.repoBranch = String(args.repoBranch || '').trim();
  args.iso = String(args.iso || '').trim();
  args.workRoot = String(args.workRoot || '').trim();
  return args;
}

function usage() {
  return `Usage: node ee/appliance/ubuntu-iso/scripts/preflight-appliance-smoke.mjs [options]\n\nRequired for smoke unless --allow-channel-branch is set:\n  --repo-branch <branch>       Branch Flux will reconcile during the VM run\n\nOptions:\n  --channel <stable|nightly>   Release channel submitted to setup (default: stable)\n  --repo-url <url>             GitHub repo URL submitted to setup\n  --iso <path>                 Extract and validate a built appliance ISO\n  --work-root <path>           Validate an ISO build work root containing iso-root\n  --allow-channel-branch       Permit blank repoBranch and validate channel-selected branch\n  --allow-unpushed             Do not require local HEAD to be present on the selected remote branch\n  --skip-remote                Skip remote branch freshness checks\n  --keep-extracted             Keep temporary ISO extraction directory\n`;
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    encoding: 'utf8',
    input: options.input,
    timeout: options.timeout || 120_000,
    env: { ...process.env, ...(options.env || {}) }
  });
}

function commandOutput(command, args, options = {}) {
  const result = run(command, args, options);
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`);
  }
  return result.stdout.trim();
}

function normalizeRepoUrl(value) {
  return String(value || '')
    .trim()
    .replace(/^git@github\.com:/i, 'https://github.com/')
    .replace(/^http:\/\//i, 'https://')
    .replace(/\.git$/i, '')
    .replace(/\/$/, '')
    .toLowerCase();
}

function collect() {
  const checks = [];
  return {
    pass(name, detail = '') { checks.push({ ok: true, name, detail }); },
    fail(name, detail = '') { checks.push({ ok: false, name, detail }); },
    get checks() { return checks; },
    get failed() { return checks.filter((check) => !check.ok); }
  };
}

function safeRm(target) {
  if (!target || !fs.existsSync(target)) return;
  let result = run('rm', ['-rf', target], { cwd: '/' });
  if (result.status !== 0 && fs.existsSync(target)) {
    run('chmod', ['-R', 'u+rwX', target], { cwd: '/' });
    result = run('rm', ['-rf', target], { cwd: '/' });
  }
  if (result.status !== 0 && fs.existsSync(target)) {
    process.stderr.write(`Warning: unable to remove temporary directory ${target}: ${(result.stderr || result.stdout || '').trim()}\n`);
  }
}

function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

function parseYamlFile(file) {
  return parse(readText(file));
}

function parseYamlDocsFile(file) {
  return parseAllDocuments(readText(file)).map((doc) => doc.toJSON()).filter(Boolean);
}

function assertHelmReleaseRetries(checks, root, label) {
  const releaseDir = path.join(root, 'ee', 'appliance', 'flux', 'base', 'releases');
  for (const name of expectedHelmReleases) {
    const file = path.join(releaseDir, `${name}.yaml`);
    if (!fs.existsSync(file)) {
      checks.fail(`${label}: ${name} HelmRelease exists`, file);
      continue;
    }
    const doc = parseYamlFile(file);
    const installRetries = Number(doc?.spec?.install?.remediation?.retries ?? 0);
    const upgradeRetries = Number(doc?.spec?.upgrade?.remediation?.retries ?? 0);
    if (installRetries >= 1 && upgradeRetries >= 1) {
      checks.pass(`${label}: ${name} HelmRelease has retries`, `install=${installRetries}, upgrade=${upgradeRetries}`);
    } else {
      checks.fail(`${label}: ${name} HelmRelease has retries`, `install=${installRetries}, upgrade=${upgradeRetries}`);
    }
  }
}

function assertApplianceStatusNoHostNetwork(checks, root, label) {
  const file = path.join(root, 'ee', 'appliance', 'flux', 'base', 'platform', 'appliance-status.yaml');
  if (!fs.existsSync(file)) {
    checks.fail(`${label}: appliance-status manifest exists`, file);
    return;
  }
  const docs = parseYamlDocsFile(file);
  const deployment = docs.find((doc) => doc.kind === 'Deployment' && doc.metadata?.name === 'appliance-status');
  if (!deployment) {
    checks.fail(`${label}: appliance-status Deployment exists`, file);
    return;
  }
  if (deployment.spec?.template?.spec?.hostNetwork === true) {
    checks.fail(`${label}: appliance-status does not use hostNetwork`, 'hostNetwork=true would collide with host service port 8080');
  } else {
    checks.pass(`${label}: appliance-status does not use hostNetwork`);
  }
  if (deployment.spec?.template?.spec?.dnsPolicy === 'ClusterFirst') {
    checks.pass(`${label}: appliance-status dnsPolicy is ClusterFirst`);
  } else {
    checks.fail(`${label}: appliance-status dnsPolicy is ClusterFirst`, `dnsPolicy=${deployment.spec?.template?.spec?.dnsPolicy}`);
  }
}

function assertAlgaCoreProgressDeadline(checks, root, label) {
  const valuesFile = path.join(root, 'ee', 'appliance', 'flux', 'profiles', 'single-node', 'values', 'alga-core.single-node.yaml');
  const deploymentTemplate = path.join(root, 'helm', 'templates', 'deployment.yaml');
  const values = fs.existsSync(valuesFile) ? parseYamlFile(valuesFile) : null;
  const template = fs.existsSync(deploymentTemplate) ? readText(deploymentTemplate) : '';
  const progressDeadline = Number(values?.server?.progressDeadlineSeconds ?? 0);

  if (template.includes('progressDeadlineSeconds') && template.includes('Values.server.progressDeadlineSeconds')) {
    checks.pass(`${label}: alga-core chart renders configurable progressDeadlineSeconds`);
  } else {
    checks.fail(`${label}: alga-core chart renders configurable progressDeadlineSeconds`, deploymentTemplate);
  }

  if (progressDeadline >= 1800) {
    checks.pass(`${label}: appliance alga-core progressDeadlineSeconds is first-install safe`, String(progressDeadline));
  } else {
    checks.fail(`${label}: appliance alga-core progressDeadlineSeconds is first-install safe`, `progressDeadlineSeconds=${progressDeadline}`);
  }
}

function assertSetupUiAndApi(checks, root, label) {
  const setupPage = path.join(root, 'ee', 'appliance', 'status-ui', 'app', 'setup', 'page.tsx');
  const server = path.join(root, 'ee', 'appliance', 'host-service', 'server.mjs');
  const setupEngine = path.join(root, 'ee', 'appliance', 'host-service', 'setup-engine.mjs');

  const setupText = fs.existsSync(setupPage) ? readText(setupPage) : '';
  if (setupText.includes('new FormData(event.currentTarget)') && setupText.includes('name="repoBranch"') && setupText.includes('repoBranch')) {
    checks.pass(`${label}: setup UI submits repoBranch from form data`);
  } else {
    checks.fail(`${label}: setup UI submits repoBranch from form data`, setupPage);
  }

  const serverText = fs.existsSync(server) ? readText(server) : '';
  if (serverText.includes('acceptedInputs') && serverText.includes('repoBranch: payload.repoBranch')) {
    checks.pass(`${label}: setup API echoes accepted inputs and persists repoBranch`);
  } else {
    checks.fail(`${label}: setup API echoes accepted inputs and persists repoBranch`, server);
  }

  const setupEngineText = fs.existsSync(setupEngine) ? readText(setupEngine) : '';
  if (setupEngineText.includes('applyRepoBranchOverride') && setupEngineText.includes('requestedBranch') && setupEngineText.includes('repoBranch: requestedBranch')) {
    checks.pass(`${label}: setup engine applies repoBranch override to release selection`);
  } else {
    checks.fail(`${label}: setup engine applies repoBranch override to release selection`, setupEngine);
  }
}

function assertStatusUiDist(checks, distRoot, label) {
  if (!fs.existsSync(distRoot)) {
    checks.fail(`${label}: status UI dist exists`, distRoot);
    return;
  }
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(distRoot);
  const setupHtml = path.join(distRoot, 'setup', 'index.html');
  if (fs.existsSync(setupHtml)) checks.pass(`${label}: setup static HTML exists`);
  else checks.fail(`${label}: setup static HTML exists`, setupHtml);

  const combined = files
    .filter((file) => /\.(html|js)$/.test(file))
    .map((file) => readText(file))
    .join('\n');
  if (combined.includes('setup-repo-branch') && combined.includes('repoBranch')) {
    checks.pass(`${label}: status UI dist contains repoBranch field and payload logic`);
  } else {
    checks.fail(`${label}: status UI dist contains repoBranch field and payload logic`, distRoot);
  }
}

function assertLocalRepo(checks) {
  assertHelmReleaseRetries(checks, repoRoot, 'local source');
  assertApplianceStatusNoHostNetwork(checks, repoRoot, 'local source');
  assertAlgaCoreProgressDeadline(checks, repoRoot, 'local source');
  assertSetupUiAndApi(checks, repoRoot, 'local source');
}

function localRemoteNameFor(repoUrl) {
  const remotes = commandOutput('git', ['remote']).split(/\r?\n/).filter(Boolean);
  const normalized = normalizeRepoUrl(repoUrl);
  for (const remote of remotes) {
    const remoteUrl = commandOutput('git', ['remote', 'get-url', remote]);
    if (normalizeRepoUrl(remoteUrl) === normalized) return remote;
  }
  return null;
}

function selectedBranchFromChannel(repoUrl, channel) {
  const channelFile = path.join(repoRoot, 'ee', 'appliance', 'releases', 'channels', `${channel}.json`);
  if (!fs.existsSync(channelFile)) throw new Error(`Missing local channel file: ${channelFile}`);
  const data = JSON.parse(readText(channelFile));
  return String(data.repoBranch || data.branch || 'main').trim() || 'main';
}

function assertRemoteBranch(checks, args, selectedBranch) {
  const remote = localRemoteNameFor(args.repoUrl);
  if (!remote) {
    checks.fail('remote branch: repo URL matches a local git remote', `repoUrl=${args.repoUrl}`);
    return;
  }
  const fetch = run('git', ['fetch', '--quiet', remote, selectedBranch], { timeout: 180_000 });
  if (fetch.status !== 0) {
    checks.fail('remote branch: fetch selected branch', (fetch.stderr || fetch.stdout || '').trim());
    return;
  }

  const remoteRef = 'FETCH_HEAD';
  const remoteSha = commandOutput('git', ['rev-parse', remoteRef]);
  checks.pass('remote branch: selected branch fetched', `${remote}/${selectedBranch}@${remoteSha.slice(0, 12)}`);

  if (!args.allowUnpushed) {
    const localHead = commandOutput('git', ['rev-parse', 'HEAD']);
    const contains = run('git', ['merge-base', '--is-ancestor', localHead, remoteRef]);
    if (contains.status === 0) {
      checks.pass('remote branch: local HEAD is present on selected branch', localHead.slice(0, 12));
    } else {
      checks.fail('remote branch: local HEAD is present on selected branch', `local HEAD ${localHead.slice(0, 12)} is not an ancestor of ${selectedBranch}@${remoteSha.slice(0, 12)}; push first or use --allow-unpushed`);
    }
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-remote-tree-'));
  const criticalFiles = [
    ...expectedHelmReleases.map((name) => `ee/appliance/flux/base/releases/${name}.yaml`),
    'ee/appliance/flux/base/platform/appliance-status.yaml',
    'ee/appliance/flux/profiles/single-node/values/alga-core.single-node.yaml',
    'ee/appliance/status-ui/app/setup/page.tsx',
    'ee/appliance/host-service/server.mjs',
    'ee/appliance/host-service/setup-engine.mjs',
    'helm/templates/deployment.yaml'
  ];

  for (const file of criticalFiles) {
    const result = run('git', ['show', `${remoteRef}:${file}`], { timeout: 120_000 });
    if (result.status !== 0) {
      checks.fail('remote branch: read critical file', `${file}: ${(result.stderr || result.stdout || '').trim()}`);
      continue;
    }
    const target = path.join(tmp, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, result.stdout);
  }

  assertHelmReleaseRetries(checks, tmp, 'remote branch');
  assertApplianceStatusNoHostNetwork(checks, tmp, 'remote branch');
  assertAlgaCoreProgressDeadline(checks, tmp, 'remote branch');
  assertSetupUiAndApi(checks, tmp, 'remote branch');
  safeRm(tmp);
}

function overlayRootFromWorkRoot(workRoot) {
  const direct = path.join(workRoot, 'iso-root', 'alga-overlay', 'opt', 'alga-appliance');
  if (fs.existsSync(direct)) return direct;
  const alternate = path.join(workRoot, 'alga-overlay', 'opt', 'alga-appliance');
  if (fs.existsSync(alternate)) return alternate;
  return direct;
}

function assertOverlay(checks, overlayRoot, label) {
  const fluxRoot = path.join(overlayRoot, 'flux');
  const pseudoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-overlay-root-'));
  fs.mkdirSync(path.join(pseudoRoot, 'ee', 'appliance'), { recursive: true });
  fs.symlinkSync(fluxRoot, path.join(pseudoRoot, 'ee', 'appliance', 'flux'));
  assertHelmReleaseRetries(checks, pseudoRoot, label);
  assertApplianceStatusNoHostNetwork(checks, pseudoRoot, label);
  fs.rmSync(pseudoRoot, { recursive: true, force: true });

  assertStatusUiDist(checks, path.join(overlayRoot, 'status-ui', 'dist'), label);

  const server = path.join(overlayRoot, 'host-service', 'server.mjs');
  const setupEngine = path.join(overlayRoot, 'host-service', 'setup-engine.mjs');
  const serverText = fs.existsSync(server) ? readText(server) : '';
  const setupEngineText = fs.existsSync(setupEngine) ? readText(setupEngine) : '';
  if (serverText.includes('acceptedInputs') && serverText.includes('repoBranch: payload.repoBranch')) {
    checks.pass(`${label}: packaged setup API echoes accepted repoBranch`);
  } else {
    checks.fail(`${label}: packaged setup API echoes accepted repoBranch`, server);
  }
  if (setupEngineText.includes('applyRepoBranchOverride') && setupEngineText.includes('repoBranch: requestedBranch')) {
    checks.pass(`${label}: packaged setup engine applies branch override`);
  } else {
    checks.fail(`${label}: packaged setup engine applies branch override`, setupEngine);
  }
}

function assertIso(checks, isoPath, keepExtracted) {
  if (!fs.existsSync(isoPath)) {
    checks.fail('ISO: file exists', isoPath);
    return;
  }
  const xorriso = run('sh', ['-c', 'command -v xorriso']);
  if (xorriso.status !== 0) {
    checks.fail('ISO: xorriso available for extraction', 'Install xorriso or omit --iso.');
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-iso-preflight-'));
  fs.mkdirSync(path.join(tmp, '.disk'), { recursive: true });
  const extractOverlay = run('xorriso', ['-osirrox', 'on', '-indev', isoPath, '-extract', '/alga-overlay', path.join(tmp, 'alga-overlay')], { timeout: 300_000 });
  const extractDiskInfo = run('xorriso', ['-osirrox', 'on', '-indev', isoPath, '-extract', '/.disk/info', path.join(tmp, '.disk', 'info')], { timeout: 60_000 });
  if (extractOverlay.status !== 0 || extractDiskInfo.status !== 0) {
    checks.fail('ISO: critical artifact extraction succeeds', `${(extractOverlay.stderr || extractOverlay.stdout || '').trim()} ${(extractDiskInfo.stderr || extractDiskInfo.stdout || '').trim()}`.trim());
    safeRm(tmp);
    return;
  }
  checks.pass('ISO: critical artifact extraction succeeds', tmp);
  assertOverlay(checks, path.join(tmp, 'alga-overlay', 'opt', 'alga-appliance'), 'ISO overlay');
  const diskInfo = path.join(tmp, '.disk', 'info');
  if (fs.existsSync(diskInfo) && readText(diskInfo).trim() === 'AlgaPSA Install') {
    checks.pass('ISO: boot label is AlgaPSA Install');
  } else {
    checks.fail('ISO: boot label is AlgaPSA Install', diskInfo);
  }
  if (keepExtracted) {
    checks.pass('ISO: extracted tree kept', tmp);
  } else {
    safeRm(tmp);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  const checks = collect();
  if (!['stable', 'nightly'].includes(args.channel)) {
    checks.fail('inputs: channel is stable or nightly', args.channel);
  } else {
    checks.pass('inputs: channel is stable or nightly', args.channel);
  }

  let selectedBranch = args.repoBranch;
  if (!selectedBranch && args.allowChannelBranch) {
    try {
      selectedBranch = selectedBranchFromChannel(args.repoUrl, args.channel);
      checks.pass('inputs: blank repoBranch allowed; using channel branch', selectedBranch);
    } catch (error) {
      checks.fail('inputs: blank repoBranch allowed; using channel branch', error instanceof Error ? error.message : String(error));
    }
  } else if (!selectedBranch) {
    checks.fail('inputs: repoBranch override is required for smoke', 'Pass --repo-branch <branch> or --allow-channel-branch.');
  } else {
    checks.pass('inputs: repoBranch override provided', selectedBranch);
  }

  assertLocalRepo(checks);

  if (!args.skipRemote && selectedBranch) {
    assertRemoteBranch(checks, args, selectedBranch);
  } else if (args.skipRemote) {
    checks.pass('remote branch: skipped by request');
  }

  if (args.workRoot) {
    assertOverlay(checks, overlayRootFromWorkRoot(args.workRoot), 'work-root overlay');
  }

  if (args.iso) {
    assertIso(checks, args.iso, args.keepExtracted);
  }

  for (const check of checks.checks) {
    const mark = check.ok ? 'PASS' : 'FAIL';
    process.stdout.write(`${mark} ${check.name}${check.detail ? ` — ${check.detail}` : ''}\n`);
  }

  if (checks.failed.length > 0) {
    process.stderr.write(`\n${checks.failed.length} preflight gate(s) failed. Do not launch a fresh VM until these are fixed.\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write('\nAll appliance smoke preflight gates passed.\n');
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
}
