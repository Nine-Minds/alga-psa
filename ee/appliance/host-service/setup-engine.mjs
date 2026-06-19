#!/usr/bin/env node
import crypto from 'node:crypto';
import dns from 'node:dns';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { persistMaintenanceMetadata } from './metadata-engine.mjs';
import { redeemInstallCode, deriveApplianceId, licenseSeedFromRedeem } from './install-code.mjs';

// Path defaults honor the ALGA_APPLIANCE_* environment the control plane runs
// with, falling back to the bare-host locations. This keeps the setup workflow
// aligned with the pod's mounted paths (token secret, in-cluster kubeconfig,
// hostPath state) instead of hardcoded bare-host defaults.
const DEFAULT_SETUP_FILE = process.env.ALGA_APPLIANCE_SETUP_INPUTS_FILE || '/var/lib/alga-appliance/setup-inputs.json';
const DEFAULT_STATE_FILE = process.env.ALGA_APPLIANCE_STATE_FILE || '/var/lib/alga-appliance/install-state.json';
const DEFAULT_RESOLV_CONF = '/etc/resolv.conf';
// Registry-metadata source of truth: the appliance resolves a channel to an
// immutable release manifest published as an OCI artifact in this registry/repo.
const DEFAULT_REGISTRY_HOST = process.env.ALGA_APPLIANCE_REGISTRY_HOST || 'ghcr.io';
const DEFAULT_RELEASE_REPOSITORY = process.env.ALGA_APPLIANCE_RELEASE_REPOSITORY || 'nine-minds/alga-appliance-release';
const DEFAULT_KUBECONFIG = process.env.ALGA_APPLIANCE_KUBECONFIG || '/etc/rancher/k3s/k3s.yaml';
const DEFAULT_TOKEN_FILE = process.env.ALGA_APPLIANCE_TOKEN_FILE || '/var/lib/alga-appliance/setup-token';
const DEFAULT_RELEASE_SELECTION_FILE = process.env.ALGA_APPLIANCE_RELEASE_SELECTION_FILE || '/var/lib/alga-appliance/release-selection.json';

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

async function resolveAddressesWithServers(servers, hostname, family = 0) {
  const resolver = new dns.promises.Resolver();
  resolver.setServers(servers);

  const records = [];
  if (family !== 6) {
    try {
      for (const address of await resolver.resolve4(hostname)) {
        records.push({ address, family: 4 });
      }
    } catch {
      // No IPv4 records (or query error); fall through to IPv6 before giving up.
    }
  }
  if (family !== 4 && records.length === 0) {
    try {
      for (const address of await resolver.resolve6(hostname)) {
        records.push({ address, family: 6 });
      }
    } catch {
      // Surfaced by the empty-result check below.
    }
  }

  if (records.length === 0) {
    throw new Error(`No A or AAAA records resolved for ${hostname} via DNS server(s) ${servers.join(', ')}`);
  }

  return records;
}

// Custom DNS lookup for https.request that resolves against explicit servers.
// Guards against empty results (which previously yielded "Invalid IP address:
// undefined") and honors Node's all/family lookup options.
function resolverLookup(servers) {
  return (hostname, options, callback) => {
    const done = typeof options === 'function' ? options : callback;
    const opts = typeof options === 'object' && options ? options : {};
    resolveAddressesWithServers(servers, hostname, opts.family || 0)
      .then((records) => {
        if (opts.all) {
          done(null, records);
        } else {
          done(null, records[0].address, records[0].family);
        }
      })
      .catch((error) => done(error));
  };
}

function httpsRequest(url, timeoutMs = 8000, lookupServers = [], extra = {}) {
  return new Promise((resolve, reject) => {
    const requestOptions = {
      method: extra.method || 'GET',
      timeout: timeoutMs,
      headers: extra.headers || {}
    };
    if (lookupServers && lookupServers.length > 0) {
      requestOptions.lookup = resolverLookup(lookupServers);
    }

    const req = https.request(url, requestOptions, (res) => {
      const status = res.statusCode || 0;
      // Opt-in redirect following (OCI blob fetches 307 to a CDN). On a
      // cross-host redirect, drop Authorization — the redirect target is a
      // pre-signed URL and forwarding a bearer to a third party is unsafe.
      const redirectsLeft = extra.followRedirects ? (extra.maxRedirects ?? 5) : 0;
      if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
        res.resume();
        let nextUrl;
        try {
          nextUrl = new URL(res.headers.location, url).toString();
        } catch (error) {
          reject(error);
          return;
        }
        const nextHeaders = { ...(extra.headers || {}) };
        try {
          if (new URL(nextUrl).host !== new URL(url).host) {
            delete nextHeaders.Authorization;
            delete nextHeaders.authorization;
          }
        } catch {
          // keep headers if URL parsing fails; the next request will surface errors
        }
        httpsRequest(nextUrl, timeoutMs, lookupServers, {
          ...extra,
          headers: nextHeaders,
          maxRedirects: redirectsLeft - 1
        }).then(resolve, reject);
        return;
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: status,
          headers: res.headers || {},
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

// --- OCI registry client -----------------------------------------------------
// Release metadata is pulled from an OCI registry (ghcr) instead of git. The
// release manifest is the artifact's config blob; everything it references
// (chart versions, the flux base bundle digest, image tags) is content-pinned.

const OCI_MANIFEST_ACCEPT = [
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json'
].join(', ');

const RELEASE_MANIFEST_SCHEMA = 'alga.appliance.release/v1';

// ghcr and Docker-style registries hand out an anonymous pull token for public
// repositories via the token endpoint advertised in the 401 challenge.
async function fetchRegistryPullToken(registryHost, repository, timeoutMs, lookupServers = []) {
  const scope = encodeURIComponent(`repository:${repository}:pull`);
  const url = `https://${registryHost}/token?service=${encodeURIComponent(registryHost)}&scope=${scope}`;
  const response = await httpsRequest(url, timeoutMs, lookupServers, { headers: { Accept: 'application/json' } });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Registry token request to ${registryHost} returned ${response.statusCode}`);
  }
  let token;
  try {
    const parsed = JSON.parse(response.body);
    token = parsed.token || parsed.access_token;
  } catch (error) {
    throw new Error(`Registry token response was not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!token) {
    throw new Error('Registry token response did not include a token.');
  }
  return token;
}

function ociV2Url(registryHost, repository, kind, reference) {
  return `https://${registryHost}/v2/${repository}/${kind}/${reference}`;
}

// Resolve an OCI artifact reference (tag or digest) to its config blob parsed as
// JSON. The blob fetch follows the registry's redirect to its CDN.
async function fetchOciConfigJson(registryHost, repository, reference, timeoutMs, lookupServers = []) {
  const token = await fetchRegistryPullToken(registryHost, repository, timeoutMs, lookupServers);
  const authHeaders = { Authorization: `Bearer ${token}` };

  const manifestUrl = ociV2Url(registryHost, repository, 'manifests', reference);
  const manifestResponse = await httpsRequest(manifestUrl, timeoutMs, lookupServers, {
    headers: { ...authHeaders, Accept: OCI_MANIFEST_ACCEPT }
  });
  if (manifestResponse.statusCode < 200 || manifestResponse.statusCode >= 300) {
    throw new Error(`GET ${manifestUrl} returned ${manifestResponse.statusCode}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestResponse.body);
  } catch (error) {
    throw new Error(`OCI manifest for ${repository}:${reference} was not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const configDigest = manifest?.config?.digest;
  if (!configDigest) {
    throw new Error(`OCI manifest for ${repository}:${reference} has no config descriptor.`);
  }
  const manifestDigest = manifestResponse.headers['docker-content-digest'] || null;

  const blobUrl = ociV2Url(registryHost, repository, 'blobs', configDigest);
  const blobResponse = await httpsRequest(blobUrl, timeoutMs, lookupServers, {
    headers: { ...authHeaders, Accept: 'application/json' },
    followRedirects: true
  });
  if (blobResponse.statusCode < 200 || blobResponse.statusCode >= 300) {
    throw new Error(`GET ${blobUrl} returned ${blobResponse.statusCode}`);
  }
  let config;
  try {
    config = JSON.parse(blobResponse.body);
  } catch (error) {
    throw new Error(`OCI config blob ${configDigest} was not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { config, configDigest, manifestDigest };
}

// Validate + normalize a release manifest into the shape the engine consumes.
export function validateReleaseManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('Release manifest is empty or not an object.');
  }
  if (manifest.schema && manifest.schema !== RELEASE_MANIFEST_SCHEMA) {
    throw new Error(`Unsupported release manifest schema "${manifest.schema}" (expected ${RELEASE_MANIFEST_SCHEMA}).`);
  }
  const version = String(manifest.version || '').trim();
  if (!version) {
    throw new Error('Release manifest is missing "version".');
  }
  const images = manifest.images && typeof manifest.images === 'object' ? manifest.images : null;
  if (!images || !String(images.algaCore || '').trim()) {
    throw new Error('Release manifest is missing images.algaCore.');
  }
  const config = manifest.config && typeof manifest.config === 'object' ? manifest.config : null;
  if (!config || !String(config.repository || '').trim() || !String(config.digest || '').trim()) {
    throw new Error('Release manifest is missing config.repository/config.digest (the flux base OCI bundle).');
  }
  return {
    schema: RELEASE_MANIFEST_SCHEMA,
    version,
    valuesProfile: String(manifest.valuesProfile || 'single-node').trim() || 'single-node',
    images,
    controlPlane: manifest.controlPlane ? String(manifest.controlPlane).trim() : null,
    config: {
      repository: String(config.repository).trim(),
      tag: config.tag ? String(config.tag).trim() : version,
      digest: String(config.digest).trim()
    },
    charts: manifest.charts && typeof manifest.charts === 'object' ? manifest.charts : {},
    // Per-service profile values (e.g. "alga-core.single-node.yaml" -> yaml text)
    // are carried in the manifest so the host can render the runtime-values
    // ConfigMaps without fetching anything from git.
    profileValues: manifest.profileValues && typeof manifest.profileValues === 'object' ? manifest.profileValues : {}
  };
}

// Resolve a channel (or an explicit version/digest reference) to a validated,
// immutable release manifest pulled from the OCI registry. No git involved.
export async function resolveReleaseManifest(reference, options = {}) {
  const registryHost = options.registryHost || DEFAULT_REGISTRY_HOST;
  const repository = options.releaseRepository || DEFAULT_RELEASE_REPOSITORY;
  const timeoutMs = Number(options.timeoutMs || 8000);
  const lookupServers = options.lookupServers || [];

  if (options.releaseManifestOverride) {
    return {
      manifest: validateReleaseManifest(options.releaseManifestOverride),
      registryHost,
      repository,
      reference,
      manifestDigest: null
    };
  }

  const { config, manifestDigest } = await fetchOciConfigJson(registryHost, repository, reference, timeoutMs, lookupServers);
  return {
    manifest: validateReleaseManifest(config),
    registryHost,
    repository,
    reference,
    manifestDigest
  };
}

function yamlString(value) {
  return JSON.stringify(String(value));
}

function validatePassword(value) {
  if (value.length < 8) return 'Initial admin password must be at least 8 characters.';
  if (!/[a-z]/.test(value)) return 'Initial admin password must include a lowercase letter.';
  if (!/[A-Z]/.test(value)) return 'Initial admin password must include an uppercase letter.';
  if (!/\d/.test(value)) return 'Initial admin password must include a number.';
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(value)) return 'Initial admin password must include a special character.';
  return null;
}

function requiredText(raw, label) {
  const value = String(raw || '').trim();
  if (!value) {
    throw new Error(`${label} is required.`);
  }
  return value;
}

function normalizeInitialTenant(raw) {
  const source = raw.initialTenant && typeof raw.initialTenant === 'object' ? raw.initialTenant : raw;
  const tenantName = requiredText(source.tenantName ?? source.initialTenantName ?? source.companyName, 'Company name');
  const adminFirstName = requiredText(source.adminFirstName ?? source.initialAdminFirstName, 'Admin first name');
  const adminLastName = requiredText(source.adminLastName ?? source.initialAdminLastName, 'Admin last name');
  const adminEmail = requiredText(source.adminEmail ?? source.initialAdminEmail, 'Admin email').toLowerCase();
  const adminPassword = String(source.adminPassword ?? source.initialAdminPassword ?? '');
  const adminPasswordConfirm = source.adminPasswordConfirm ?? source.initialAdminPasswordConfirm;

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail)) {
    throw new Error('Enter a valid admin email address.');
  }
  if (adminPasswordConfirm !== undefined && adminPassword !== String(adminPasswordConfirm)) {
    throw new Error('Initial admin password confirmation does not match.');
  }
  const passwordError = validatePassword(adminPassword);
  if (passwordError) {
    throw new Error(passwordError);
  }

  return {
    tenantName,
    adminFirstName,
    adminLastName,
    adminEmail,
    adminPassword
  };
}

function initialTenantSecretYaml(initialTenant, initialTenantId) {
  // INITIAL_TENANT_ID (when an install code was redeemed) makes the bootstrap's
  // create-tenant adopt the registry-minted tenant id instead of DB-generating
  // one. Omitted (empty) on the legacy/no-code path — create-tenant then mints
  // its own, unchanged. create-tenant.ts reads it from the pod env.
  const tenantIdLine = initialTenantId ? `\n  INITIAL_TENANT_ID: ${yamlString(initialTenantId)}` : '';
  return `apiVersion: v1\nkind: Secret\nmetadata:\n  name: appliance-initial-tenant\n  namespace: msp\ntype: Opaque\nstringData:\n  INITIAL_TENANT_NAME: ${yamlString(initialTenant.tenantName)}\n  INITIAL_ADMIN_FIRST_NAME: ${yamlString(initialTenant.adminFirstName)}\n  INITIAL_ADMIN_LAST_NAME: ${yamlString(initialTenant.adminLastName)}\n  INITIAL_ADMIN_EMAIL: ${yamlString(initialTenant.adminEmail)}\n  INITIAL_ADMIN_PASSWORD: ${yamlString(initialTenant.adminPassword)}${tenantIdLine}\n`;
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
    return (await resolveAddressesWithServers(servers, hostname)).map((record) => record.address);
  }

  return dns.promises.resolve4(hostname);
}

export function validateSetupInputs(raw, options = {}) {
  const channel = String(raw.channel || 'stable').trim();
  const appHostname = String(raw.appHostname || '').trim();
  const dnsMode = String(raw.dnsMode || 'system').trim();
  const dnsServers = String(raw.dnsServers || '').trim();
  // Optional advanced override: pin to a specific release version or digest
  // instead of following the channel tag; release metadata is resolved from
  // the OCI registry.
  const releaseRef = String(raw.releaseRef || '').trim();
  const initialTenant = options.requireInitialTenant === false ? null : normalizeInitialTenant(raw);

  // Edition licensing fields (F078)
  const editionChoice = String(raw.editionChoice || 'ee').trim();
  if (!['ee', 'ce'].includes(editionChoice)) {
    throw new Error('Invalid edition choice. Use ee or ce.');
  }
  const licenseKey = raw.licenseKey ? String(raw.licenseKey).trim() : null;
  // Install code (from the registration email). When present it's the PRIMARY
  // licensing path: redeemed at apply time to derive the tenant id + edition +
  // (paid) license, overriding the manual editionChoice/licenseKey, which remain
  // the airgap/manual fallback when no code is entered.
  const installCode = raw.installCode ? String(raw.installCode).trim().toUpperCase() : null;

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
    releaseRef,
    initialTenant,
    editionChoice,
    licenseKey,
    installCode,
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
      releaseRef: inputs.releaseRef || undefined,
      initialTenant: inputs.initialTenant ? {
        tenantName: inputs.initialTenant.tenantName,
        adminEmail: inputs.initialTenant.adminEmail
      } : undefined
    }
  };
}

export async function runSetupPreflight(inputs, options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const resolvConfPath = options.resolvConfPath || DEFAULT_RESOLV_CONF;
  const timeoutMs = Number(options.timeoutMs || 8000);
  const registryHost = options.registryHost || DEFAULT_REGISTRY_HOST;
  const releaseReference = (inputs.releaseRef || inputs.channel || 'stable').trim();
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
    await dnsLookup(registryHost, servers);
  } catch (error) {
    const failure = preflightFailure(
      'dns',
      'resolve-registry-host',
      `DNS lookup failed for ${registryHost}.`,
      `Verify DNS resolver reachability and split-horizon policy. ${error instanceof Error ? error.message : String(error)}`
    );
    writeInstallState({ ...state, status: 'preflight-blocked', phase: 'dns', lastAction: failure.message, failure, updatedAt: nowIso() }, stateFile);
    return failure;
  }

  let resolvedRelease;
  try {
    resolvedRelease = await resolveReleaseManifest(releaseReference, {
      registryHost,
      releaseRepository: options.releaseRepository,
      timeoutMs,
      lookupServers: servers,
      releaseManifestOverride: options.releaseManifestOverride
    });
  } catch (error) {
    const failure = preflightFailure(
      'registry-release-source',
      'resolve-release-manifest',
      `Unable to resolve release manifest for "${releaseReference}" from ${registryHost}.`,
      `Verify the channel/release exists in the registry and outbound HTTPS to ${registryHost} is allowed by firewall/proxy policy. ${error instanceof Error ? error.message : String(error)}`
    );
    writeInstallState({ ...state, status: 'preflight-blocked', phase: 'registry-release-source', lastAction: failure.message, failure, updatedAt: nowIso() }, stateFile);
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
      release: {
        registryHost,
        reference: releaseReference,
        version: resolvedRelease.manifest.version
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

// Read-only network reachability checks (DNS + GitHub channel + GHCR).
// Unlike runSetupPreflight, this writes no install-state and has no side
// effects, so it is safe to call repeatedly from the live status path to
// re-validate a previously recorded network failure instead of trusting a
// stale record forever.
export async function runNetworkChecks(inputs, options = {}) {
  const resolvConfPath = options.resolvConfPath || DEFAULT_RESOLV_CONF;
  const timeoutMs = Number(options.timeoutMs || 8000);
  const checkedAt = nowIso();
  const errText = (error) => (error instanceof Error ? error.message : String(error));

  const registryHost = options.registryHost || DEFAULT_REGISTRY_HOST;
  const releaseReference = (inputs.releaseRef || inputs.channel || 'stable').trim();

  const servers = resolverServersForInputs(inputs, resolvConfPath);
  if (inputs.dnsMode === 'system' && servers.length === 0) {
    return { ok: false, checkedAt, failure: preflightFailure('dns', 'resolve-system-resolvers', 'No system DNS resolvers detected from /etc/resolv.conf.', 'Confirm DHCP/static resolver configuration and retry setup.') };
  }

  try {
    await dnsLookup(registryHost, servers);
  } catch (error) {
    return { ok: false, checkedAt, failure: preflightFailure('dns', 'resolve-registry-host', `DNS lookup failed for ${registryHost}.`, `Verify DNS resolver reachability and split-horizon policy. ${errText(error)}`) };
  }

  try {
    const ghcrResponse = await httpsRequest('https://ghcr.io/v2/', timeoutMs, servers);
    if (![200, 401].includes(ghcrResponse.statusCode)) {
      return { ok: false, checkedAt, failure: preflightFailure('network', 'reach-ghcr', `GHCR reachability check returned ${ghcrResponse.statusCode}.`, 'Ensure outbound HTTPS to ghcr.io is allowed by firewall/proxy policy.') };
    }
  } catch (error) {
    return { ok: false, checkedAt, failure: preflightFailure('network', 'reach-ghcr', 'Network failure while contacting ghcr.io.', `Check outbound HTTPS and proxy settings for GHCR. ${errText(error)}`) };
  }

  let resolvedRelease;
  try {
    resolvedRelease = await resolveReleaseManifest(releaseReference, {
      registryHost,
      releaseRepository: options.releaseRepository,
      timeoutMs,
      lookupServers: servers,
      releaseManifestOverride: options.releaseManifestOverride
    });
  } catch (error) {
    return { ok: false, checkedAt, failure: preflightFailure('registry-release-source', 'resolve-release-manifest', `Unable to resolve release manifest for "${releaseReference}" from ${registryHost}.`, `Verify the channel/release exists in the registry and outbound HTTPS to ${registryHost} is allowed by firewall/proxy policy. ${errText(error)}`) };
  }

  return { ok: true, checkedAt, failure: null, checks: { registryHost, reference: releaseReference, version: resolvedRelease.manifest.version } };
}

export function installFlux(options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const kubeconfigPath = options.kubeconfigPath || DEFAULT_KUBECONFIG;
  const fluxInstallCommand = options.fluxInstallCommand || `flux install --namespace flux-system --kubeconfig ${kubeconfigPath}`;

  const cli = options.fluxInstallCommand ? { ok: true, installed: false } : ensureFluxCli(options);
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
  const registryHost = options.registryHost || DEFAULT_REGISTRY_HOST;
  // Single source of truth: an immutable release manifest published as an OCI
  // artifact in the registry, resolved by channel tag (or an explicit
  // version/digest pin via inputs.releaseRef). No git, no branch.
  const reference = (inputs.releaseRef || inputs.channel || 'stable').trim();

  writeInstallState({
    status: 'release-resolve-running',
    phase: 'registry-release-source',
    lastAction: `Resolving ${inputs.channel} release manifest from ${registryHost}`,
    updatedAt: nowIso()
  }, stateFile);

  let resolved;
  try {
    resolved = await resolveReleaseManifest(reference, {
      registryHost,
      releaseRepository: options.releaseRepository,
      timeoutMs,
      lookupServers: resolverServersForInputs(inputs, options.resolvConfPath || DEFAULT_RESOLV_CONF),
      releaseManifestOverride: options.releaseManifestOverride
    });
  } catch (error) {
    const failure = preflightFailure(
      'registry-release-source',
      'resolve-release-manifest',
      `Unable to resolve release manifest for "${reference}" from ${registryHost}.`,
      error instanceof Error ? error.message : String(error)
    );
    writeInstallState({
      status: 'release-resolve-blocked',
      phase: 'registry-release-source',
      lastAction: failure.message,
      failure,
      updatedAt: nowIso()
    }, stateFile);
    return failure;
  }

  const manifest = resolved.manifest;
  const success = {
    ok: true,
    phase: 'registry-release-source',
    message: `Resolved channel ${inputs.channel} to release ${manifest.version}.`,
    channel: inputs.channel,
    reference,
    releaseVersion: manifest.version,
    registryHost,
    repository: resolved.repository,
    manifestDigest: resolved.manifestDigest,
    manifest
  };

  writeInstallState({
    status: 'release-resolve-complete',
    phase: 'registry-release-source',
    lastAction: success.message,
    release: {
      selectedChannel: success.channel,
      selectedReleaseVersion: success.releaseVersion,
      registryHost,
      repository: resolved.repository,
      manifestDigest: resolved.manifestDigest
    },
    updatedAt: nowIso()
  }, stateFile);

  return success;
}

export async function applyRuntimeValuesAndReleaseSelection(inputs, releaseSelection, options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const kubeconfigPath = options.kubeconfigPath || DEFAULT_KUBECONFIG;
  const releaseVersion = releaseSelection.releaseVersion;
  const manifest = options.releaseManifestOverride
    ? validateReleaseManifest(options.releaseManifestOverride)
    : releaseSelection.manifest;
  const tempDir = options.runtimeValuesDir || fs.mkdtempSync(path.join(os.tmpdir(), 'alga-runtime-values-'));
  const valuesDir = path.join(tempDir, 'values');
  writeInstallState({
    status: 'runtime-values-running',
    phase: 'registry-release-source',
    lastAction: 'Creating Kubernetes runtime values and release selection',
    updatedAt: nowIso()
  }, stateFile);

  if (!manifest) {
    const failure = preflightFailure(
      'registry-release-source',
      'missing-release-manifest',
      'Release selection did not include a resolved manifest.',
      'resolveChannelMetadata must run (and succeed) before applyRuntimeValuesAndReleaseSelection.'
    );
    writeInstallState({ status: 'runtime-values-blocked', phase: 'registry-release-source', lastAction: failure.message, failure, updatedAt: nowIso() }, stateFile);
    return failure;
  }

  const profile = manifest.valuesProfile || 'single-node';
  const names = ['alga-core', 'pgbouncer', 'temporal', 'workflow-worker', 'email-service', 'temporal-worker'];
  const values = {};

  try {
    fs.mkdirSync(valuesDir, { recursive: true, mode: 0o700 });
    for (const name of names) {
      const key = `${name}.${profile}.yaml`;
      const value = options.profileValuesOverride?.[key] ?? manifest.profileValues?.[key];
      if (typeof value !== 'string') {
        throw new Error(`Release manifest is missing profileValues["${key}"].`);
      }
      values[key] = value;
    }

    const images = manifest.images || {};
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
      'registry-release-source',
      'render-runtime-values',
      'Unable to render runtime values for the selected release.',
      error instanceof Error ? error.message : String(error)
    );
    writeInstallState({ status: 'runtime-values-blocked', phase: 'registry-release-source', lastAction: failure.message, failure, updatedAt: nowIso() }, stateFile);
    return failure;
  }

  const authKey = options.algaAuthKey || crypto.randomBytes(32).toString('base64url');
  const statusToken = fs.existsSync(options.tokenFile || DEFAULT_TOKEN_FILE)
    ? fs.readFileSync(options.tokenFile || DEFAULT_TOKEN_FILE, 'utf8').trim()
    : crypto.randomBytes(24).toString('base64url');
  // ── Install-code redemption (registration-driven licensing) ────────────────
  // When the operator entered an install code, redeem it now against the
  // alga-license service: this yields the registry-minted tenant id (adopted as
  // INITIAL_TENANT_ID), the edition, and — for paid tiers — the first license +
  // per-appliance credential + check-in URL. A bad/expired/used code or an
  // unreachable service blocks the install with a clear message (it never
  // silently self-generates a tenant). NOTE: the code is single-use and consumed
  // here, so a failed install past this point needs a re-issued code.
  let redeemResult = null;
  if (inputs.installCode) {
    const serviceUrl = options.algaLicenseServiceUrl || process.env.ALGA_LICENSE_SERVICE_URL;
    const applianceId = deriveApplianceId(inputs.appHostname);
    const doRedeem = options.redeemInstallCode || redeemInstallCode;
    try {
      redeemResult = await doRedeem({ serviceUrl, installCode: inputs.installCode, applianceId });
    } catch (error) {
      const failure = preflightFailure(
        'registry-release-source',
        'redeem-install-code',
        'Could not redeem the install code.',
        error instanceof Error ? error.message : String(error)
      );
      // A bad/expired/used code is operator-correctable: stop auto-retrying (it
      // will never succeed) so the control-plane keeps the setup form open for a
      // re-issued code. Transient/network errors stay retry-safe (unflagged).
      if (error && error.correctable) {
        failure.correctable = true;
        failure.retrySafe = false;
      }
      writeInstallState({ status: 'runtime-values-blocked', phase: 'registry-release-source', lastAction: failure.message, failure, updatedAt: nowIso() }, stateFile);
      return failure;
    }
  }

  const initialTenantSecretPath = path.join(tempDir, 'initial-tenant-secret.yaml');
  const hasInitialTenant = Boolean(inputs.initialTenant);

  if (hasInitialTenant) {
    try {
      fs.writeFileSync(initialTenantSecretPath, initialTenantSecretYaml(inputs.initialTenant, redeemResult?.tenantId || ''), { mode: 0o600 });
    } catch (error) {
      const failure = preflightFailure(
        'registry-release-source',
        'render-initial-tenant-secret',
        'Unable to render initial tenant Secret for appliance bootstrap.',
        error instanceof Error ? error.message : String(error)
      );
      writeInstallState({ status: 'runtime-values-blocked', phase: 'registry-release-source', lastAction: failure.message, failure, updatedAt: nowIso() }, stateFile);
      return failure;
    }
  }

  // Build appliance-license-seed secret command (F079-F080). When an install code
  // was redeemed it drives the edition + license (+ connected-refresh fields);
  // otherwise fall back to the manual editionChoice/licenseKey path (airgap).
  const licenseSeedLiterals = redeemResult
    ? licenseSeedFromRedeem(redeemResult)
    : { EDITION_CHOICE: inputs.editionChoice || 'ee', ...(inputs.licenseKey ? { LICENSE_TOKEN: inputs.licenseKey } : {}) };
  const licenseSeedArgs = Object.entries(licenseSeedLiterals)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `--from-literal=${key}=${shellQuote(value)}`)
    .join(' ');
  const licenseSeedCmd = `kubectl --kubeconfig ${shellQuote(kubeconfigPath)} -n msp create secret generic appliance-license-seed ${licenseSeedArgs} --dry-run=client -o yaml | kubectl --kubeconfig ${shellQuote(kubeconfigPath)} apply -f -`;

  const commands = [
    `kubectl --kubeconfig ${shellQuote(kubeconfigPath)} create namespace msp --dry-run=client -o yaml | kubectl --kubeconfig ${shellQuote(kubeconfigPath)} apply -f -`,
    `kubectl --kubeconfig ${shellQuote(kubeconfigPath)} create namespace alga-system --dry-run=client -o yaml | kubectl --kubeconfig ${shellQuote(kubeconfigPath)} apply -f -`,
    `kubectl --kubeconfig ${shellQuote(kubeconfigPath)} create namespace appliance-system --dry-run=client -o yaml | kubectl --kubeconfig ${shellQuote(kubeconfigPath)} apply -f -`,
    ...(hasInitialTenant ? [`kubectl --kubeconfig ${shellQuote(kubeconfigPath)} apply -f ${shellQuote(initialTenantSecretPath)}`] : []),
    `kubectl --kubeconfig ${shellQuote(kubeconfigPath)} -n msp create secret generic alga-psa-shared --from-literal=ALGA_AUTH_KEY=${shellQuote(authKey)} --dry-run=client -o yaml | kubectl --kubeconfig ${shellQuote(kubeconfigPath)} apply -f -`,
    `kubectl --kubeconfig ${shellQuote(kubeconfigPath)} -n appliance-system create secret generic appliance-status-auth --from-literal=token=${shellQuote(statusToken)} --dry-run=client -o yaml | kubectl --kubeconfig ${shellQuote(kubeconfigPath)} apply -f -`,
    licenseSeedCmd,
    `kubectl --kubeconfig ${shellQuote(kubeconfigPath)} apply -k ${shellQuote(tempDir)}`,
    `kubectl --kubeconfig ${shellQuote(kubeconfigPath)} -n alga-system create configmap appliance-release-selection --from-literal=releaseVersion=${shellQuote(releaseVersion)} --from-literal=selectedChannel=${shellQuote(inputs.channel)} --from-literal=appVersion=${shellQuote(manifest.version)} --from-literal=registryHost=${shellQuote(releaseSelection.registryHost || DEFAULT_REGISTRY_HOST)} --from-literal=repository=${shellQuote(releaseSelection.repository || DEFAULT_RELEASE_REPOSITORY)} --from-literal=manifestDigest=${shellQuote(releaseSelection.manifestDigest || '')} --from-literal=algaCoreTag=${shellQuote(manifest.images?.algaCore || '')} --from-literal=workflowWorkerTag=${shellQuote(manifest.images?.workflowWorker || '')} --from-literal=emailServiceTag=${shellQuote(manifest.images?.emailService || '')} --from-literal=temporalWorkerTag=${shellQuote(manifest.images?.temporalWorker || '')} --from-literal=controlPlaneTag=${shellQuote(manifest.controlPlane || '')} --dry-run=client -o yaml | kubectl --kubeconfig ${shellQuote(kubeconfigPath)} apply -f -`
  ];

  for (const command of commands) {
    const result = runShell(command);
    if (!result.ok) {
      const failure = preflightFailure(
        'registry-release-source',
        'apply-runtime-values',
        'Failed to apply Kubernetes runtime values or release selection.',
        (result.stderr || result.stdout || `exit ${result.status}`).trim()
      );
      writeInstallState({ status: 'runtime-values-blocked', phase: 'registry-release-source', lastAction: failure.message, failure, updatedAt: nowIso() }, stateFile);
      return failure;
    }
  }

  const success = {
    ok: true,
    phase: 'registry-release-source',
    message: `Runtime values and release selection applied for ${releaseVersion}.`,
    releaseVersion,
    profile
  };

  writeInstallState({
    status: 'runtime-values-complete',
    phase: 'registry-release-source',
    lastAction: success.message,
    runtimeValues: { profile, releaseVersion },
    updatedAt: nowIso()
  }, stateFile);

  return success;
}

export function applyFluxSource(inputs, releaseSelection, options = {}) {
  const stateFile = options.stateFile || DEFAULT_STATE_FILE;
  const kubeconfigPath = options.kubeconfigPath || DEFAULT_KUBECONFIG;
  const fluxPath = options.fluxPath || './base';
  const sourceName = options.fluxSourceName || 'alga-appliance';
  const sourceNamespace = options.fluxNamespace || 'flux-system';
  const applyCommand = options.fluxSourceApplyCommand || `kubectl --kubeconfig ${kubeconfigPath} apply -f -`;
  const releaseManifest = options.releaseManifestOverride
    ? validateReleaseManifest(options.releaseManifestOverride)
    : releaseSelection.manifest;

  if (!releaseManifest) {
    const failure = preflightFailure(
      'flux',
      'missing-release-manifest',
      'Release selection did not include a resolved manifest.',
      'resolveChannelMetadata must run (and succeed) before applyFluxSource.'
    );
    writeInstallState({ status: 'flux-source-blocked', phase: 'flux', lastAction: failure.message, failure, updatedAt: nowIso() }, stateFile);
    return failure;
  }

  const configRepository = releaseManifest.config.repository;
  const configDigest = releaseManifest.config.digest;
  const configTag = releaseManifest.config.tag;
  const ociUrl = `oci://${configRepository}`;

  // Flux pulls the appliance config bundle (the rendered flux base overlay) as
  // an OCI artifact pinned to its digest -- no GitRepository, no branch.
  const manifest = `apiVersion: source.toolkit.fluxcd.io/v1\nkind: OCIRepository\nmetadata:\n  name: ${sourceName}\n  namespace: ${sourceNamespace}\nspec:\n  interval: 1m0s\n  url: ${ociUrl}\n  ref:\n    digest: ${configDigest}\n---\napiVersion: kustomize.toolkit.fluxcd.io/v1\nkind: Kustomization\nmetadata:\n  name: ${sourceName}\n  namespace: ${sourceNamespace}\nspec:\n  interval: 5m0s\n  path: ${fluxPath}\n  prune: true\n  sourceRef:\n    kind: OCIRepository\n    name: ${sourceName}\n`;

  writeInstallState({
    status: 'flux-source-running',
    phase: 'flux',
    lastAction: 'Applying Flux OCIRepository/Kustomization source configuration',
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
      'Failed to apply Flux OCIRepository/Kustomization manifests.',
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
      url: ociUrl,
      digest: configDigest,
      tag: configTag,
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
  const releaseSelectionFile = options.releaseSelectionFile || DEFAULT_RELEASE_SELECTION_FILE;

  writeInstallState({
    status: 'release-config-running',
    phase: 'registry-release-source',
    lastAction: 'Persisting runtime values and selected release configuration',
    updatedAt: nowIso()
  }, stateFile);

  const payload = {
    updatedAt: nowIso(),
    selectedChannel: releaseSelection.channel || inputs.channel,
    selectedReleaseVersion: releaseSelection.releaseVersion,
    registryHost: releaseSelection.registryHost || DEFAULT_REGISTRY_HOST,
    repository: releaseSelection.repository,
    manifestDigest: releaseSelection.manifestDigest,
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
      'registry-release-source',
      'write-release-selection',
      'Unable to persist release selection configuration.',
      error instanceof Error ? error.message : String(error)
    );
    writeInstallState({
      status: 'release-config-blocked',
      phase: 'registry-release-source',
      lastAction: failure.message,
      failure,
      updatedAt: nowIso()
    }, stateFile);
    return failure;
  }

  const success = {
    ok: true,
    phase: 'registry-release-source',
    message: `Release selection persisted to ${releaseSelectionFile}.`,
    releaseSelectionFile
  };

  writeInstallState({
    status: 'release-config-complete',
    phase: 'registry-release-source',
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

  // The k3s substrate and local-path storage are provisioned by the host
  // bootstrap (bootstrap-control-plane.sh) before this control-plane workflow
  // ever runs. The setup workflow only layers Flux and the application release
  // on top of that substrate.
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
