#!/usr/bin/env node
import crypto from 'node:crypto';
import dns from 'node:dns';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { persistMaintenanceMetadata } from './metadata-engine.mjs';

const DEFAULT_SETUP_FILE = '/etc/alga-appliance/setup-inputs.json';
const DEFAULT_STATE_FILE = '/var/lib/alga-appliance/install-state.json';
const DEFAULT_RESOLV_CONF = '/etc/resolv.conf';
const DEFAULT_RELEASES_DIR = '/opt/alga-appliance/releases';

function isValidIpv4(value) {
  const parts = value.split('.');
  if (parts.length !== 4) {
    return false;
  }

  return parts.every((part) => {
    if (!/^\d+$/.test(part)) {
      return false;
    }

    const n = Number(part);
    return n >= 0 && n <= 255;
  });
}

function normalizeGithubRepoUrl(repoUrl) {
  if (/^https:\/\/github\.com\//i.test(repoUrl)) {
    return repoUrl.replace(/\.git$/i, '');
  }

  const scpMatch = repoUrl.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (scpMatch) {
    return `https://github.com/${scpMatch[1]}/${scpMatch[2]}`;
  }

  throw new Error('Repo URL must target github.com via HTTPS or git@github.com:owner/repo.git format.');
}

function extractRepoParts(normalizedRepoUrl) {
  const match = normalizedRepoUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/i);
  if (!match) {
    throw new Error('Unable to parse GitHub owner/repo from repo URL.');
  }

  return { owner: match[1], repo: match[2] };
}

function readChannelRelease(channelData) {
  const releaseVersion = (channelData.releaseVersion || channelData.release || '').trim();
  const repoBranch = (channelData.repoBranch || channelData.branch || '').trim();

  if (!releaseVersion) {
    throw new Error('Channel metadata is missing releaseVersion.');
  }

  return {
    releaseVersion,
    repoBranch: repoBranch || 'main'
  };
}

function applyRepoBranchOverride(releaseSelection, inputs) {
  const requestedBranch = (inputs.repoBranch || '').trim();
  if (!requestedBranch) {
    return releaseSelection;
  }

  return {
    ...releaseSelection,
    repoBranch: requestedBranch
  };
}

function readSystemResolvers(resolvConfPath = DEFAULT_RESOLV_CONF) {
  if (!fs.existsSync(resolvConfPath)) {
    return [];
  }

  const content = fs.readFileSync(resolvConfPath, 'utf8');
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('nameserver '))
    .map((line) => line.replace('nameserver ', '').trim())
    .filter((value) => value.length > 0);
}

function writeInstallState(state, stateFile = DEFAULT_STATE_FILE) {
  const stateDir = path.dirname(stateFile);
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o750 });
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(stateDir, 0o750);
  fs.chmodSync(stateFile, 0o600);
}

function writeSecureJsonFile(targetFile, value) {
  const dir = path.dirname(targetFile);
  fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
  fs.writeFileSync(targetFile, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(dir, 0o750);
  fs.chmodSync(targetFile, 0o600);
}

function nowIso() {
  return new Date().toISOString();
}

function httpsRequest(url, timeoutMs = 8000, lookupServers = []) {
  return new Promise((resolve, reject) => {
    const requestOptions = { method: 'GET', timeout: timeoutMs };
    if (lookupServers && lookupServers.length > 0) {
      const resolver = new dns.promises.Resolver();
      resolver.setServers(lookupServers);
      requestOptions.lookup = async (hostname, _options, callback) => {
        try {
          const addresses = await resolver.resolve4(hostname);
          callback(null, addresses[0], 4);
        } catch (error) {
          callback(error);
        }
      };
    }

    const req = https.request(url, requestOptions, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          body: Buffer.concat(chunks).toString('utf8')
        });
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error(`Request timed out for ${url}`));
    });
    req.on('error', reject);
    req.end();
  });
}

function runShell(command, options = {}) {
  const result = spawnSync('sh', ['-c', command], {
    env: process.env,
    encoding: 'utf8',
    input: options.input || undefined
  });

  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function ensureCommand(command) {
  return spawnSync('sh', ['-c', `command -v ${command}`], { encoding: 'utf8' }).status === 0;
}

function ensureFluxCli(options = {}) {
  if (ensureCommand('flux')) {
    return { ok: true, installed: false };
  }

  const installCommand = options.fluxCliInstallCommand || 'curl -s https://fluxcd.io/install.sh | bash';
  const result = runShell(installCommand);
  if (!result.ok || !ensureCommand('flux')) {
    return {
      ok: false,
      stdout: result.stdout,
      stderr: result.stderr,
      message: 'Flux CLI is not installed and automatic installation failed.'
    };
  }

  return { ok: true, installed: true };
}

function rawGithubUrl(repo, branch, filePath) {
  return `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${branch}/${filePath}`;
}

async function fetchGithubText(repo, branch, filePath, timeoutMs, lookupServers = []) {
  const url = rawGithubUrl(repo, branch, filePath);
  const response = await httpsRequest(url, timeoutMs, lookupServers);
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`GET ${url} returned ${response.statusCode}`);
  }
  return response.body;
}

function yamlString(value) {
  return JSON.stringify(String(value));
}

function appUrlFromInput(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function hostFromAppUrl(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return String(value || '').replace(/^https?:\/\//i, '').split('/')[0];
  }
}

function setYamlScalar(yaml, target, value) {
  const output = [];
  const stack = [];
  let replaced = false;

  for (const line of yaml.split(/\r?\n/)) {
    const match = line.match(/^(\s*)([A-Za-z0-9_-]+):(?:\s|$)/);
    const indent = line.match(/^\s*/)?.[0].length || 0;

    while (stack.length && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    if (match) {
      const key = match[2];
      const parentPath = stack.map((entry) => entry.key);
      if (!replaced && parentPath.length === target.length - 1 && parentPath.every((part, index) => part === target[index]) && key === target[target.length - 1]) {
        output.push(`${line.slice(0, indent)}${key}: ${value}`);
        replaced = true;
        stack.push({ indent, key });
        continue;
      }
      stack.push({ indent, key });
    }

    output.push(line);
  }

  if (!replaced) {
    throw new Error(`Failed to update YAML value ${target.join('.')}`);
  }

  return output.join('\n');
}

function resolverServersForInputs(inputs, resolvConfPath = DEFAULT_RESOLV_CONF) {
  return inputs.dnsMode === 'custom'
    ? inputs.dnsServers.split(',').map((value) => value.trim()).filter(Boolean)
    : readSystemResolvers(resolvConfPath);
}

async function dnsLookup(hostname, servers) {
  if (servers && servers.length > 0) {
    const resolver = new dns.promises.Resolver();
    resolver.setServers(servers);
    return resolver.resolve4(hostname);
  }

  return dns.promises.resolve4(hostname);
}

export function validateSetupInputs(raw) {
  const channel = raw.channel || 'stable';
  const appHostname = raw.appHostname || '';
  const dnsMode = raw.dnsMode || 'system';
  const dnsServers = raw.dnsServers || '';
  const repoUrl = raw.repoUrl || 'https://github.com/Nine-Minds/alga-psa.git';
  const repoBranch = raw.repoBranch || '';

  if (!['stable', 'nightly'].includes(channel)) {
    throw new Error('Invalid channel. Use stable or nightly.');
  }

  if (!['system', 'custom'].includes(dnsMode)) {
    throw new Error('Invalid DNS mode. Use system or custom.');
  }

  if (dnsMode === 'custom') {
    const parsed = dnsServers
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    if (parsed.length === 0) {
      throw new Error('Custom DNS mode requires at least one DNS server.');
    }

    const invalid = parsed.filter((value) => !isValidIpv4(value));
    if (invalid.length > 0) {
      throw new Error(`Invalid custom DNS server(s): ${invalid.join(', ')}`);
    }
  }

  return {
    channel,
    appHostname,
    dnsMode,
    dnsServers,
    repoUrl,
    repoBranch,
    submittedAt: nowIso()
  };
}

export function persistSetupInputs(inputs, setupInputsFile = DEFAULT_SETUP_FILE) {
  const setupDir = path.dirname(setupInputsFile);
  fs.mkdirSync(setupDir, { recursive: true, mode: 0o750 });
  fs.writeFileSync(setupInputsFile, `${JSON.stringify(inputs, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(setupDir, 0o750);
  fs.chmodSync(setupInputsFile, 0o600);
}

function preflightFailure(phase, step, message, details) {
  return {
    ok: false,
    phase,
    step,
    message,
    details,
    suspectedCause: message,
    suggestedNextStep: details,
    retrySafe: true
  };
}

function baseState(inputs) {
  return {
    status: 'preflight-running',
    phase: 'preflight',
    lastAction: 'Running setup preflight checks before host mutation',
    updatedAt: nowIso(),
    setupInputs: {
      channel: inputs.channel,
      dnsMode: inputs.dnsMode,
      repoUrl: inputs.repoUrl,
      repoBranch: inputs.repoBranch || 'main'
    }
  };
}

export async function runSetupPreflight(inputs, options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const resolvConfPath = options.resolvConfPath || DEFAULT_RESOLV_CONF;
  const timeoutMs = Number(options.timeoutMs || 8000);
  const repoBranch = (inputs.repoBranch || 'main').trim() || 'main';
  const normalizedRepoUrl = normalizeGithubRepoUrl(inputs.repoUrl);
  const repo = extractRepoParts(normalizedRepoUrl);
  const proxySet = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy']
    .filter((name) => (process.env[name] || '').trim().length > 0);

  const state = baseState(inputs);
  writeInstallState(state, stateFile);

  const servers = resolverServersForInputs(inputs, resolvConfPath);

  if (inputs.dnsMode === 'system' && servers.length === 0) {
    const failure = preflightFailure(
      'dns',
      'resolve-system-resolvers',
      'No system DNS resolvers detected from /etc/resolv.conf.',
      'Confirm DHCP/static resolver configuration and retry setup.'
    );
    writeInstallState({ ...state, status: 'preflight-blocked', phase: 'dns', lastAction: failure.message, failure, updatedAt: nowIso() }, stateFile);
    return failure;
  }

  try {
    await dnsLookup('raw.githubusercontent.com', servers);
  } catch (error) {
    const failure = preflightFailure(
      'dns',
      'resolve-raw-githubusercontent-com',
      'DNS lookup failed for raw.githubusercontent.com.',
      `Verify DNS resolver reachability and split-horizon policy. ${error instanceof Error ? error.message : String(error)}`
    );
    writeInstallState({ ...state, status: 'preflight-blocked', phase: 'dns', lastAction: failure.message, failure, updatedAt: nowIso() }, stateFile);
    return failure;
  }

  const channelUrl = `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${repoBranch}/ee/appliance/releases/channels/${inputs.channel}.json`;
  let channelBody = '';
  try {
    const channelResponse = await httpsRequest(channelUrl, timeoutMs, servers);
    channelBody = channelResponse.body;
    if (channelResponse.statusCode < 200 || channelResponse.statusCode >= 300) {
      const failure = preflightFailure(
        'github-release-source',
        'fetch-channel-metadata',
        `Unable to fetch channel metadata (${channelResponse.statusCode}) from GitHub.`,
        'Verify repo URL/branch, outbound HTTPS to GitHub, and proxy/firewall policy.'
      );
      writeInstallState({ ...state, status: 'preflight-blocked', phase: 'github-release-source', lastAction: failure.message, failure, updatedAt: nowIso() }, stateFile);
      return failure;
    }
  } catch (error) {
    const failure = preflightFailure(
      'network',
      'fetch-channel-metadata',
      'Network failure while fetching GitHub channel metadata.',
      `Check outbound HTTPS and proxy settings. ${error instanceof Error ? error.message : String(error)}`
    );
    writeInstallState({ ...state, status: 'preflight-blocked', phase: 'network', lastAction: failure.message, failure, updatedAt: nowIso() }, stateFile);
    return failure;
  }

  try {
    JSON.parse(channelBody);
  } catch {
    const failure = preflightFailure(
      'github-release-source',
      'parse-channel-metadata',
      'Channel metadata is not valid JSON.',
      'Verify the selected branch and channel file format before retrying.'
    );
    writeInstallState({ ...state, status: 'preflight-blocked', phase: 'github-release-source', lastAction: failure.message, failure, updatedAt: nowIso() }, stateFile);
    return failure;
  }

  try {
    const ghcrResponse = await httpsRequest('https://ghcr.io/v2/', timeoutMs, servers);
    if (![200, 401].includes(ghcrResponse.statusCode)) {
      const failure = preflightFailure(
        'network',
        'reach-ghcr',
        `GHCR reachability check returned ${ghcrResponse.statusCode}.`,
        'Ensure outbound HTTPS to ghcr.io is allowed by firewall/proxy policy.'
      );
      writeInstallState({ ...state, status: 'preflight-blocked', phase: 'network', lastAction: failure.message, failure, updatedAt: nowIso() }, stateFile);
      return failure;
    }
  } catch (error) {
    const failure = preflightFailure(
      'network',
      'reach-ghcr',
      'Network failure while contacting ghcr.io.',
      `Check outbound HTTPS and proxy settings for GHCR. ${error instanceof Error ? error.message : String(error)}`
    );
    writeInstallState({ ...state, status: 'preflight-blocked', phase: 'network', lastAction: failure.message, failure, updatedAt: nowIso() }, stateFile);
    return failure;
  }

  const success = {
    ok: true,
    phase: 'preflight',
    message: 'Preflight checks passed. Safe to continue with k3s installation.',
    checks: {
      dns: {
        mode: inputs.dnsMode,
        resolvers: servers
      },
      github: {
        channelUrl,
        repoUrl: normalizedRepoUrl,
        branch: repoBranch
      },
      ghcr: {
        endpoint: 'https://ghcr.io/v2/'
      },
      egress: {
        proxyVariablesDetected: proxySet
      }
    }
  };

  writeInstallState({
    ...state,
    status: 'preflight-complete',
    phase: 'preflight',
    lastAction: success.message,
    preflight: success.checks,
    updatedAt: nowIso()
  }, stateFile);

  return success;
}

export function installK3sSingleNode(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const kubeconfigPath = options.kubeconfigPath || '/etc/rancher/k3s/k3s.yaml';
  const installScriptUrl = options.installScriptUrl || 'https://get.k3s.io';
  const k3sVersion = options.k3sVersion || process.env.ALGA_APPLIANCE_K3S_VERSION || 'v1.31.4+k3s1';
  const installExec = options.installExec || process.env.ALGA_APPLIANCE_K3S_EXEC || `server --write-kubeconfig ${kubeconfigPath} --write-kubeconfig-mode 600 --disable traefik --disable servicelb`;
  const installCommand = options.installCommand || `curl -sfL ${installScriptUrl} | sh -s -`;

  writeInstallState({
    status: 'k3s-install-running',
    phase: 'k3s',
    lastAction: `Installing k3s ${k3sVersion}`,
    updatedAt: nowIso()
  }, stateFile);

  const env = {
    ...process.env,
    INSTALL_K3S_VERSION: k3sVersion,
    INSTALL_K3S_EXEC: installExec
  };

  const result = spawnSync('sh', ['-c', installCommand], {
    env,
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    const stdout = (result.stdout || '').trim();
    const message = stderr || stdout || `k3s install command failed with exit code ${result.status ?? 1}`;

    const failure = preflightFailure(
      'k3s',
      'install-k3s-server',
      'k3s installation command failed.',
      `Inspect installer output and host networking/firewall state. ${message}`
    );

    writeInstallState({
      status: 'k3s-install-blocked',
      phase: 'k3s',
      lastAction: failure.message,
      failure,
      installerOutput: {
        stdout: result.stdout || '',
        stderr: result.stderr || ''
      },
      updatedAt: nowIso()
    }, stateFile);

    return failure;
  }

  if (!fs.existsSync(kubeconfigPath)) {
    const failure = preflightFailure(
      'k3s',
      'verify-kubeconfig-path',
      `k3s install completed but kubeconfig was not found at ${kubeconfigPath}.`,
      'Validate k3s service startup and kubeconfig path configuration, then retry.'
    );

    writeInstallState({
      status: 'k3s-install-blocked',
      phase: 'k3s',
      lastAction: failure.message,
      failure,
      updatedAt: nowIso()
    }, stateFile);

    return failure;
  }

  const success = {
    ok: true,
    phase: 'k3s',
    message: `k3s installed successfully with kubeconfig at ${kubeconfigPath}.`,
    k3sVersion,
    kubeconfigPath
  };

  writeInstallState({
    status: 'k3s-install-complete',
    phase: 'k3s',
    lastAction: success.message,
    k3s: {
      version: k3sVersion,
      kubeconfigPath
    },
    updatedAt: nowIso()
  }, stateFile);

  return success;
}

export function ensureLocalPathStorage(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const kubeconfigPath = options.kubeconfigPath || '/etc/rancher/k3s/k3s.yaml';
  const storageInstallScript = options.storageInstallScript || '/opt/alga-appliance/scripts/install-storage.sh';
  const storageInstallCommand = options.storageInstallCommand || `${storageInstallScript} --kubeconfig ${kubeconfigPath}`;

  writeInstallState({
    status: 'storage-config-running',
    phase: 'storage',
    lastAction: 'Ensuring local-path storage class is installed as default',
    updatedAt: nowIso()
  }, stateFile);

  const result = spawnSync('sh', ['-c', storageInstallCommand], {
    env: process.env,
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    const stdout = (result.stdout || '').trim();
    const message = stderr || stdout || `storage install command failed with exit code ${result.status ?? 1}`;
    const failure = preflightFailure(
      'storage',
      'install-local-path-storage',
      'Failed to install local-path storage defaults.',
      `Inspect storage installer output and retry. ${message}`
    );

    writeInstallState({
      status: 'storage-config-blocked',
      phase: 'storage',
      lastAction: failure.message,
      failure,
      installerOutput: {
        stdout: result.stdout || '',
        stderr: result.stderr || ''
      },
      updatedAt: nowIso()
    }, stateFile);

    return failure;
  }

  const success = {
    ok: true,
    phase: 'storage',
    message: 'local-path storage installer completed successfully.',
    kubeconfigPath
  };

  writeInstallState({
    status: 'storage-config-complete',
    phase: 'storage',
    lastAction: success.message,
    storage: {
      installer: storageInstallScript,
      kubeconfigPath
    },
    updatedAt: nowIso()
  }, stateFile);

  return success;
}

export function installFlux(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const kubeconfigPath = options.kubeconfigPath || '/etc/rancher/k3s/k3s.yaml';
  const fluxInstallCommand = options.fluxInstallCommand || `flux install --namespace flux-system --kubeconfig ${kubeconfigPath}`;

  const cli = ensureFluxCli(options);
  if (!cli.ok) {
    const failure = preflightFailure(
      'flux',
      'install-flux-cli',
      'Flux CLI is required before installing Flux controllers.',
      `${cli.message || 'Install Flux CLI and retry.'} ${(cli.stderr || cli.stdout || '').trim()}`.trim()
    );
    writeInstallState({
      status: 'flux-install-blocked',
      phase: 'flux',
      lastAction: failure.message,
      failure,
      updatedAt: nowIso()
    }, stateFile);
    return failure;
  }

  writeInstallState({
    status: 'flux-install-running',
    phase: 'flux',
    lastAction: 'Installing Flux controllers into k3s cluster',
    updatedAt: nowIso()
  }, stateFile);

  const result = spawnSync('sh', ['-c', fluxInstallCommand], {
    env: process.env,
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    const stdout = (result.stdout || '').trim();
    const message = stderr || stdout || `flux install command failed with exit code ${result.status ?? 1}`;
    const failure = preflightFailure(
      'flux',
      'install-flux',
      'Flux installation failed.',
      `Verify Flux CLI availability and cluster access. ${message}`
    );

    writeInstallState({
      status: 'flux-install-blocked',
      phase: 'flux',
      lastAction: failure.message,
      failure,
      installerOutput: {
        stdout: result.stdout || '',
        stderr: result.stderr || ''
      },
      updatedAt: nowIso()
    }, stateFile);

    return failure;
  }

  const success = {
    ok: true,
    phase: 'flux',
    message: 'Flux installation completed successfully.',
    kubeconfigPath
  };

  writeInstallState({
    status: 'flux-install-complete',
    phase: 'flux',
    lastAction: success.message,
    flux: {
      namespace: 'flux-system',
      kubeconfigPath
    },
    updatedAt: nowIso()
  }, stateFile);

  return success;
}

export async function resolveChannelMetadata(inputs, options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const timeoutMs = Number(options.timeoutMs || 8000);
  const normalizedRepoUrl = normalizeGithubRepoUrl(inputs.repoUrl);
  const repo = extractRepoParts(normalizedRepoUrl);
  const branch = (inputs.repoBranch || 'main').trim() || 'main';
  const releasesDir = options.releasesDir || DEFAULT_RELEASES_DIR;
  const localChannelFile = path.join(releasesDir, 'channels', `${inputs.channel}.json`);
  const channelUrl = `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${branch}/ee/appliance/releases/channels/${inputs.channel}.json`;

  writeInstallState({
    status: 'release-resolve-running',
    phase: 'github-release-source',
    lastAction: `Resolving ${inputs.channel} channel metadata`,
    updatedAt: nowIso()
  }, stateFile);

  let channelData;
  if (options.channelMetadataOverride) {
    channelData = options.channelMetadataOverride;
  } else if (fs.existsSync(localChannelFile)) {
    channelData = JSON.parse(fs.readFileSync(localChannelFile, 'utf8'));
  } else {
    const response = await httpsRequest(channelUrl, timeoutMs, resolverServersForInputs(inputs, options.resolvConfPath || DEFAULT_RESOLV_CONF));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      const failure = preflightFailure(
        'github-release-source',
        'resolve-channel-metadata',
        `Unable to resolve channel metadata from ${channelUrl} (${response.statusCode}).`,
        'Verify release channel file exists for the selected branch and retry.'
      );
      writeInstallState({
        status: 'release-resolve-blocked',
        phase: 'github-release-source',
        lastAction: failure.message,
        failure,
        updatedAt: nowIso()
      }, stateFile);
      return failure;
    }
    channelData = JSON.parse(response.body);
  }

  let releaseSelection;
  try {
    releaseSelection = applyRepoBranchOverride(readChannelRelease(channelData), inputs);
  } catch (error) {
    const failure = preflightFailure(
      'github-release-source',
      'parse-channel-release',
      'Channel metadata does not contain required release fields.',
      error instanceof Error ? error.message : String(error)
    );
    writeInstallState({
      status: 'release-resolve-blocked',
      phase: 'github-release-source',
      lastAction: failure.message,
      failure,
      updatedAt: nowIso()
    }, stateFile);
    return failure;
  }

  const success = {
    ok: true,
    phase: 'github-release-source',
    message: `Resolved channel ${inputs.channel} to release ${releaseSelection.releaseVersion}.`,
    repoUrl: normalizedRepoUrl,
    channel: inputs.channel,
    repoBranch: releaseSelection.repoBranch,
    releaseVersion: releaseSelection.releaseVersion
  };

  writeInstallState({
    status: 'release-resolve-complete',
    phase: 'github-release-source',
    lastAction: success.message,
    release: {
      selectedChannel: success.channel,
      selectedReleaseVersion: success.releaseVersion,
      repoUrl: success.repoUrl,
      repoBranch: success.repoBranch
    },
    updatedAt: nowIso()
  }, stateFile);

  return success;
}

export async function applyRuntimeValuesAndReleaseSelection(inputs, releaseSelection, options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const kubeconfigPath = options.kubeconfigPath || '/etc/rancher/k3s/k3s.yaml';
  const timeoutMs = Number(options.timeoutMs || 8000);
  const normalizedRepoUrl = normalizeGithubRepoUrl(releaseSelection.repoUrl || inputs.repoUrl);
  const repo = extractRepoParts(normalizedRepoUrl);
  const branch = releaseSelection.repoBranch || inputs.repoBranch || 'main';
  const releaseVersion = releaseSelection.releaseVersion;
  const tempDir = options.runtimeValuesDir || fs.mkdtempSync(path.join(os.tmpdir(), 'alga-runtime-values-'));
  const valuesDir = path.join(tempDir, 'values');
  const releasesDir = options.releasesDir || DEFAULT_RELEASES_DIR;
  const localReleaseFile = path.join(releasesDir, releaseVersion, 'release.json');
  const localFluxDir = options.fluxDir || '/opt/alga-appliance/flux';

  writeInstallState({
    status: 'runtime-values-running',
    phase: 'github-release-source',
    lastAction: 'Creating Kubernetes runtime values and release selection',
    updatedAt: nowIso()
  }, stateFile);

  let releaseManifest;
  try {
    const lookupServers = resolverServersForInputs(inputs, options.resolvConfPath || DEFAULT_RESOLV_CONF);
    const releaseBody = options.releaseManifestOverride
      ? JSON.stringify(options.releaseManifestOverride)
      : fs.existsSync(localReleaseFile)
        ? fs.readFileSync(localReleaseFile, 'utf8')
        : await fetchGithubText(repo, branch, `ee/appliance/releases/${releaseVersion}/release.json`, timeoutMs, lookupServers);
    releaseManifest = JSON.parse(releaseBody);
  } catch (error) {
    const failure = preflightFailure(
      'github-release-source',
      'fetch-release-manifest',
      `Unable to fetch release manifest ${releaseVersion}.`,
      error instanceof Error ? error.message : String(error)
    );
    writeInstallState({ status: 'runtime-values-blocked', phase: 'github-release-source', lastAction: failure.message, failure, updatedAt: nowIso() }, stateFile);
    return failure;
  }

  const profile = releaseManifest.app?.valuesProfile || 'talos-single-node';
  const names = ['alga-core', 'pgbouncer', 'temporal', 'workflow-worker', 'email-service', 'temporal-worker'];
  const values = {};

  try {
    fs.mkdirSync(valuesDir, { recursive: true, mode: 0o700 });
    for (const name of names) {
      const key = `${name}.${profile}.yaml`;
      const override = options.profileValuesOverride?.[key];
      const localProfileValuesFile = path.join(localFluxDir, 'profiles', profile, 'values', key);
      values[key] = override
        ?? (fs.existsSync(localProfileValuesFile) ? fs.readFileSync(localProfileValuesFile, 'utf8') : null)
        ?? await fetchGithubText(repo, branch, `ee/appliance/flux/profiles/${profile}/values/${key}`, timeoutMs, resolverServersForInputs(inputs, options.resolvConfPath || DEFAULT_RESOLV_CONF));
    }

    const images = releaseManifest.app?.images || {};
    const bootstrapMode = options.bootstrapMode || 'recover';
    values[`alga-core.${profile}.yaml`] = setYamlScalar(values[`alga-core.${profile}.yaml`], ['bootstrap', 'mode'], yamlString(bootstrapMode));
    const appUrl = appUrlFromInput(inputs.appHostname);
    if (appUrl) {
      values[`alga-core.${profile}.yaml`] = setYamlScalar(values[`alga-core.${profile}.yaml`], ['appUrl'], yamlString(appUrl));
      values[`alga-core.${profile}.yaml`] = setYamlScalar(values[`alga-core.${profile}.yaml`], ['host'], yamlString(hostFromAppUrl(appUrl)));
      values[`alga-core.${profile}.yaml`] = setYamlScalar(values[`alga-core.${profile}.yaml`], ['domainSuffix'], '""');
    }
    if (images.algaCore) {
      values[`alga-core.${profile}.yaml`] = setYamlScalar(values[`alga-core.${profile}.yaml`], ['setup', 'image', 'tag'], yamlString(images.algaCore));
      values[`alga-core.${profile}.yaml`] = setYamlScalar(values[`alga-core.${profile}.yaml`], ['server', 'image', 'tag'], yamlString(images.algaCore));
    }
    if (images.workflowWorker) {
      values[`workflow-worker.${profile}.yaml`] = setYamlScalar(values[`workflow-worker.${profile}.yaml`], ['image', 'tag'], yamlString(images.workflowWorker));
    }
    if (images.emailService) {
      values[`email-service.${profile}.yaml`] = setYamlScalar(values[`email-service.${profile}.yaml`], ['image', 'tag'], yamlString(images.emailService));
    }
    if (images.temporalWorker) {
      values[`temporal-worker.${profile}.yaml`] = setYamlScalar(values[`temporal-worker.${profile}.yaml`], ['image', 'tag'], yamlString(images.temporalWorker));
    }

    for (const [key, content] of Object.entries(values)) {
      fs.writeFileSync(path.join(valuesDir, key), content.endsWith('\n') ? content : `${content}\n`, { mode: 0o600 });
    }

    fs.writeFileSync(path.join(tempDir, 'kustomization.yaml'), `apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\ngeneratorOptions:\n  disableNameSuffixHash: true\nconfigMapGenerator:\n${names.map((name) => `  - name: appliance-values-${name}\n    namespace: alga-system\n    files:\n      - ${name}.${profile}.yaml=values/${name}.${profile}.yaml`).join('\n')}\n`, { mode: 0o600 });
  } catch (error) {
    const failure = preflightFailure(
      'github-release-source',
      'render-runtime-values',
      'Unable to render runtime values for the selected release.',
      error instanceof Error ? error.message : String(error)
    );
    writeInstallState({ status: 'runtime-values-blocked', phase: 'github-release-source', lastAction: failure.message, failure, updatedAt: nowIso() }, stateFile);
    return failure;
  }

  const authKey = options.algaAuthKey || crypto.randomBytes(32).toString('base64url');
  const statusToken = fs.existsSync(options.tokenFile || '/var/lib/alga-appliance/setup-token')
    ? fs.readFileSync(options.tokenFile || '/var/lib/alga-appliance/setup-token', 'utf8').trim()
    : crypto.randomBytes(24).toString('base64url');

  const commands = [
    `kubectl --kubeconfig ${shellQuote(kubeconfigPath)} create namespace msp --dry-run=client -o yaml | kubectl --kubeconfig ${shellQuote(kubeconfigPath)} apply -f -`,
    `kubectl --kubeconfig ${shellQuote(kubeconfigPath)} create namespace alga-system --dry-run=client -o yaml | kubectl --kubeconfig ${shellQuote(kubeconfigPath)} apply -f -`,
    `kubectl --kubeconfig ${shellQuote(kubeconfigPath)} create namespace appliance-system --dry-run=client -o yaml | kubectl --kubeconfig ${shellQuote(kubeconfigPath)} apply -f -`,
    `kubectl --kubeconfig ${shellQuote(kubeconfigPath)} -n msp create secret generic alga-psa-shared --from-literal=ALGA_AUTH_KEY=${shellQuote(authKey)} --dry-run=client -o yaml | kubectl --kubeconfig ${shellQuote(kubeconfigPath)} apply -f -`,
    `kubectl --kubeconfig ${shellQuote(kubeconfigPath)} -n appliance-system create secret generic appliance-status-auth --from-literal=token=${shellQuote(statusToken)} --dry-run=client -o yaml | kubectl --kubeconfig ${shellQuote(kubeconfigPath)} apply -f -`,
    `kubectl --kubeconfig ${shellQuote(kubeconfigPath)} apply -k ${shellQuote(tempDir)}`,
    `kubectl --kubeconfig ${shellQuote(kubeconfigPath)} -n alga-system create configmap appliance-release-selection --from-literal=releaseVersion=${shellQuote(releaseVersion)} --from-literal=selectedChannel=${shellQuote(inputs.channel)} --from-literal=appVersion=${shellQuote(releaseManifest.app?.version || '')} --from-literal=releaseBranch=${shellQuote(releaseManifest.app?.releaseBranch || branch)} --from-literal=algaCoreTag=${shellQuote(releaseManifest.app?.images?.algaCore || '')} --from-literal=workflowWorkerTag=${shellQuote(releaseManifest.app?.images?.workflowWorker || '')} --from-literal=emailServiceTag=${shellQuote(releaseManifest.app?.images?.emailService || '')} --from-literal=temporalWorkerTag=${shellQuote(releaseManifest.app?.images?.temporalWorker || '')} --dry-run=client -o yaml | kubectl --kubeconfig ${shellQuote(kubeconfigPath)} apply -f -`
  ];

  for (const command of commands) {
    const result = runShell(command);
    if (!result.ok) {
      const failure = preflightFailure(
        'github-release-source',
        'apply-runtime-values',
        'Failed to apply Kubernetes runtime values or release selection.',
        (result.stderr || result.stdout || `exit ${result.status}`).trim()
      );
      writeInstallState({ status: 'runtime-values-blocked', phase: 'github-release-source', lastAction: failure.message, failure, updatedAt: nowIso() }, stateFile);
      return failure;
    }
  }

  const success = {
    ok: true,
    phase: 'github-release-source',
    message: `Runtime values and release selection applied for ${releaseVersion}.`,
    releaseVersion,
    profile
  };

  writeInstallState({
    status: 'runtime-values-complete',
    phase: 'github-release-source',
    lastAction: success.message,
    runtimeValues: { profile, releaseVersion },
    updatedAt: nowIso()
  }, stateFile);

  return success;
}

export function applyFluxSource(inputs, releaseSelection, options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const kubeconfigPath = options.kubeconfigPath || '/etc/rancher/k3s/k3s.yaml';
  const fluxPath = options.fluxPath || './ee/appliance/flux/base';
  const sourceName = options.fluxSourceName || 'alga-appliance';
  const sourceNamespace = options.fluxNamespace || 'flux-system';
  const applyCommand = options.fluxSourceApplyCommand || `kubectl --kubeconfig ${kubeconfigPath} apply -f -`;
  const normalizedRepoUrl = normalizeGithubRepoUrl(releaseSelection.repoUrl || inputs.repoUrl);
  const sourceBranch = releaseSelection.repoBranch || inputs.repoBranch || 'main';

  const manifest = `apiVersion: source.toolkit.fluxcd.io/v1\nkind: GitRepository\nmetadata:\n  name: ${sourceName}\n  namespace: ${sourceNamespace}\nspec:\n  interval: 1m0s\n  url: ${normalizedRepoUrl}\n  ref:\n    branch: ${sourceBranch}\n---\napiVersion: kustomize.toolkit.fluxcd.io/v1\nkind: Kustomization\nmetadata:\n  name: ${sourceName}\n  namespace: ${sourceNamespace}\nspec:\n  interval: 5m0s\n  path: ${fluxPath}\n  prune: true\n  sourceRef:\n    kind: GitRepository\n    name: ${sourceName}\n`;

  writeInstallState({
    status: 'flux-source-running',
    phase: 'flux',
    lastAction: 'Applying Flux GitRepository/Kustomization source configuration',
    updatedAt: nowIso()
  }, stateFile);

  const result = spawnSync('sh', ['-c', applyCommand], {
    env: process.env,
    input: manifest,
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    const stdout = (result.stdout || '').trim();
    const message = stderr || stdout || `Flux source apply failed with exit code ${result.status ?? 1}`;
    const failure = preflightFailure(
      'flux',
      'apply-flux-source',
      'Failed to apply Flux GitRepository/Kustomization manifests.',
      message
    );

    writeInstallState({
      status: 'flux-source-blocked',
      phase: 'flux',
      lastAction: failure.message,
      failure,
      updatedAt: nowIso()
    }, stateFile);

    return failure;
  }

  const success = {
    ok: true,
    phase: 'flux',
    message: 'Flux source manifests applied successfully.',
    source: {
      name: sourceName,
      namespace: sourceNamespace,
      repoUrl: normalizedRepoUrl,
      branch: sourceBranch,
      path: fluxPath
    }
  };

  writeInstallState({
    status: 'flux-source-complete',
    phase: 'flux',
    lastAction: success.message,
    fluxSource: success.source,
    updatedAt: nowIso()
  }, stateFile);

  return success;
}

export function applyReleaseSelectionConfiguration(inputs, releaseSelection, options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const releaseSelectionFile = options.releaseSelectionFile || '/etc/alga-appliance/release-selection.json';

  writeInstallState({
    status: 'release-config-running',
    phase: 'github-release-source',
    lastAction: 'Persisting runtime values and selected release configuration',
    updatedAt: nowIso()
  }, stateFile);

  const payload = {
    updatedAt: nowIso(),
    selectedChannel: releaseSelection.channel || inputs.channel,
    selectedReleaseVersion: releaseSelection.releaseVersion,
    repoUrl: releaseSelection.repoUrl,
    repoBranch: releaseSelection.repoBranch,
    runtime: {
      appHostname: inputs.appHostname,
      dnsMode: inputs.dnsMode,
      dnsServers: inputs.dnsServers
    }
  };

  try {
    writeSecureJsonFile(releaseSelectionFile, payload);
  } catch (error) {
    const failure = preflightFailure(
      'github-release-source',
      'write-release-selection',
      'Unable to persist release selection configuration.',
      error instanceof Error ? error.message : String(error)
    );
    writeInstallState({
      status: 'release-config-blocked',
      phase: 'github-release-source',
      lastAction: failure.message,
      failure,
      updatedAt: nowIso()
    }, stateFile);
    return failure;
  }

  const success = {
    ok: true,
    phase: 'github-release-source',
    message: `Release selection persisted to ${releaseSelectionFile}.`,
    releaseSelectionFile
  };

  writeInstallState({
    status: 'release-config-complete',
    phase: 'github-release-source',
    lastAction: success.message,
    releaseSelection: {
      file: releaseSelectionFile,
      selectedChannel: payload.selectedChannel,
      selectedReleaseVersion: payload.selectedReleaseVersion
    },
    updatedAt: nowIso()
  }, stateFile);

  return success;
}

export async function runSetupWorkflow(inputs, options = {}) {
  const preflight = await runSetupPreflight(inputs, options);
  if (!preflight.ok) {
    return preflight;
  }

  if (options.skipK3sInstall === true) {
    return {
      ok: true,
      phase: 'preflight',
      message: 'Preflight succeeded; k3s install skipped by option override.'
    };
  }

  const k3sResult = installK3sSingleNode(options);
  if (!k3sResult.ok) {
    return k3sResult;
  }

  const storageResult = ensureLocalPathStorage(options);
  if (!storageResult.ok) {
    return storageResult;
  }

  const fluxResult = installFlux(options);
  if (!fluxResult.ok) {
    return fluxResult;
  }

  const releaseSelection = await resolveChannelMetadata(inputs, options);
  if (!releaseSelection.ok) {
    return releaseSelection;
  }

  const runtimeValuesResult = await applyRuntimeValuesAndReleaseSelection(inputs, releaseSelection, { ...options, bootstrapMode: options.bootstrapMode || 'recover' });
  if (!runtimeValuesResult.ok) {
    return runtimeValuesResult;
  }

  const fluxSourceResult = applyFluxSource(inputs, releaseSelection, options);
  if (!fluxSourceResult.ok) {
    return fluxSourceResult;
  }

  const configResult = applyReleaseSelectionConfiguration(inputs, releaseSelection, options);
  if (!configResult.ok) {
    return configResult;
  }

  persistMaintenanceMetadata({
    metadataFile: options.metadataFile,
    releaseSelectionFile: options.releaseSelectionFile,
    installStateFile: options.stateFile
  });
  return configResult;
}

function parseCliArgs(argv) {
  const parsed = { command: argv[0] || '' };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--setup-inputs') {
      parsed.setupInputsFile = argv[i + 1];
      i += 1;
    } else if (arg === '--state-file') {
      parsed.stateFile = argv[i + 1];
      i += 1;
    } else if (arg === '--kubeconfig') {
      parsed.kubeconfigPath = argv[i + 1];
      i += 1;
    } else if (arg === '--release-selection-file') {
      parsed.releaseSelectionFile = argv[i + 1];
      i += 1;
    }
  }
  return parsed;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.command === 'run') {
    const setupInputsFile = args.setupInputsFile || DEFAULT_SETUP_FILE;
    try {
      const raw = JSON.parse(fs.readFileSync(setupInputsFile, 'utf8'));
      const inputs = validateSetupInputs(raw);
      const result = await runSetupWorkflow(inputs, args);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (!result.ok) process.exitCode = 1;
    } catch (error) {
      const failure = preflightFailure(
        'setup',
        'run-setup-workflow',
        'Setup workflow failed before it could complete.',
        error instanceof Error ? error.message : String(error)
      );
      writeInstallState({ status: 'setup-blocked', phase: 'setup', lastAction: failure.message, failure, updatedAt: nowIso() }, args.stateFile || DEFAULT_STATE_FILE);
      process.stderr.write(`${JSON.stringify(failure)}\n`);
      process.exitCode = 1;
    }
  }
}
