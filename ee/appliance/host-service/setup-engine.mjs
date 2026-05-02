#!/usr/bin/env node
import dns from 'node:dns';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';

const DEFAULT_SETUP_FILE = '/etc/alga-appliance/setup-inputs.json';
const DEFAULT_STATE_FILE = '/var/lib/alga-appliance/install-state.json';
const DEFAULT_RESOLV_CONF = '/etc/resolv.conf';

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

function nowIso() {
  return new Date().toISOString();
}

function httpsRequest(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'GET', timeout: timeoutMs }, (res) => {
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

  const servers = inputs.dnsMode === 'custom'
    ? inputs.dnsServers.split(',').map((value) => value.trim()).filter(Boolean)
    : readSystemResolvers(resolvConfPath);

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
    const channelResponse = await httpsRequest(channelUrl, timeoutMs);
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
    const ghcrResponse = await httpsRequest('https://ghcr.io/v2/', timeoutMs);
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
