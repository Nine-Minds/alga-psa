#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse, parseAllDocuments } from 'yaml';

const repoRoot = path.resolve(path.join(import.meta.dirname, '..', '..', '..', '..'));
const expectedHelmReleases = ['alga-core', 'pgbouncer', 'temporal', 'workflow-worker', 'email-service', 'temporal-worker'];

function parseArgs(argv) {
  const args = {
    channel: 'stable',
    iso: '',
    workRoot: '',
    keepExtracted: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--channel') args.channel = argv[++i] || '';
    else if (arg === '--iso') args.iso = argv[++i] || '';
    else if (arg === '--work-root') args.workRoot = argv[++i] || '';
    else if (arg === '--keep-extracted') args.keepExtracted = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  args.channel = String(args.channel || '').trim();
  args.iso = String(args.iso || '').trim();
  args.workRoot = String(args.workRoot || '').trim();
  return args;
}

function usage() {
  return `Usage: node ee/appliance/ubuntu-iso/scripts/preflight-appliance-smoke.mjs [options]\n\nOptions:\n  --channel <stable|nightly>   Release channel submitted to setup (default: stable)\n  --iso <path>                 Extract and validate a built appliance ISO\n  --work-root <path>           Validate an ISO build work root containing iso-root\n  --keep-extracted             Keep temporary ISO extraction directory\n`;
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
  if (setupText.includes('name="installCode"') && setupText.includes('name="channel"') && setupText.includes('name="releaseRef"')) {
    checks.pass(`${label}: setup UI submits install code, channel, and optional release pin`);
  } else {
    checks.fail(`${label}: setup UI submits install code, channel, and optional release pin`, setupPage);
  }

  const serverText = fs.existsSync(server) ? readText(server) : '';
  if (serverText.includes('acceptedInputs') && serverText.includes('releaseRef: payload.releaseRef') && serverText.includes('installCode: payload.installCode')) {
    checks.pass(`${label}: setup API accepts registry release inputs and install code`);
  } else {
    checks.fail(`${label}: setup API accepts registry release inputs and install code`, server);
  }

  const setupEngineText = fs.existsSync(setupEngine) ? readText(setupEngine) : '';
  if (setupEngineText.includes('resolveReleaseManifest') && setupEngineText.includes('DEFAULT_RELEASE_REPOSITORY') && setupEngineText.includes('releaseRef')) {
    checks.pass(`${label}: setup engine resolves appliance release metadata from OCI`);
  } else {
    checks.fail(`${label}: setup engine resolves appliance release metadata from OCI`, setupEngine);
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
  if (combined.includes('setup-install-code') && combined.includes('releaseRef')) {
    checks.pass(`${label}: status UI dist contains install code and release-pin payload logic`);
  } else {
    checks.fail(`${label}: status UI dist contains install code and release-pin payload logic`, distRoot);
  }
}

function assertLocalRepo(checks) {
  assertHelmReleaseRetries(checks, repoRoot, 'local source');
  assertApplianceStatusNoHostNetwork(checks, repoRoot, 'local source');
  assertAlgaCoreProgressDeadline(checks, repoRoot, 'local source');
  assertSetupUiAndApi(checks, repoRoot, 'local source');
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
  if (serverText.includes('acceptedInputs') && serverText.includes('releaseRef: payload.releaseRef') && serverText.includes('installCode: payload.installCode')) {
    checks.pass(`${label}: packaged setup API accepts registry release inputs and install code`);
  } else {
    checks.fail(`${label}: packaged setup API accepts registry release inputs and install code`, server);
  }
  if (setupEngineText.includes('resolveReleaseManifest') && setupEngineText.includes('DEFAULT_RELEASE_REPOSITORY')) {
    checks.pass(`${label}: packaged setup engine resolves OCI release metadata`);
  } else {
    checks.fail(`${label}: packaged setup engine resolves OCI release metadata`, setupEngine);
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

  assertLocalRepo(checks);

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
