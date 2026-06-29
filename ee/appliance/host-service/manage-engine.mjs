// Post-install Management surface engine.
//
// Pure-ish backend logic for the Manage area (status aggregation, license
// apply, app-URL/DNS settings, control-plane upgrade request). All external
// effects (kubectl, the host-agent socket, registry resolves, file reads) are
// injected so server.mjs can wire its kubectl queue and tests can inject fakes.

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { appUrlFromInput, hostFromAppUrl, setYamlScalar } from './setup-engine.mjs';

const JWS_RE = /^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/;

// Licenses whose expiry lands beyond this are treated as perpetual. No genuine
// commercial term runs to 2100; far-future values (e.g. the 9999999999
// "all nines" sentinel = 2286-11-20) are placeholders meaning "never expires".
const PERPETUAL_EXP_THRESHOLD_MS = Date.UTC(2100, 0, 1);

function nowMs() {
  return new Date().getTime();
}

function nowIso() {
  return new Date().toISOString();
}

function readJsonFile(file) {
  try {
    if (!file || !fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeSecureJsonFile(targetFile, value) {
  const dir = path.dirname(targetFile);
  fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
  fs.writeFileSync(targetFile, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(targetFile, 0o600);
}

// --- License ---------------------------------------------------------------

export function isWellFormedLicenseJws(token) {
  return typeof token === 'string' && JWS_RE.test(token.trim());
}

// Decode the (unverified) JWS payload to surface edition/expiry. The app
// validates the signature at runtime; this is display/status only.
export function decodeLicenseClaims(token) {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(b64, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function licenseStatusFromClaims(claims, editionFallback) {
  const out = {
    edition: editionFallback || (claims && (claims.edition || claims.tier)) || null,
    expiresAt: null,
    perpetual: false,
    status: 'unknown'
  };
  const exp = claims && claims.exp;
  if (exp) {
    const ms = Number(exp) * 1000;
    if (Number.isFinite(ms) && ms > 0) {
      if (ms >= PERPETUAL_EXP_THRESHOLD_MS) {
        // Sentinel / far-future expiry — surface "perpetual" rather than a
        // literal year-2286 date.
        out.perpetual = true;
        out.status = 'active';
      } else {
        out.expiresAt = new Date(ms).toISOString();
        out.status = ms > nowMs() ? 'active' : 'expired';
      }
    }
  }
  return out;
}

function decodeSecretValue(value) {
  if (typeof value !== 'string') return '';
  try {
    return Buffer.from(value, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

// Read edition + license expiry from the appliance-license-seed secret.
export async function readLicenseStatus(deps) {
  const { kube, namespace = 'msp', secretName = 'appliance-license-seed' } = deps;
  const res = await kube.json(`get secret ${secretName} -n ${namespace}`);
  if (!res || !res.ok || !res.value || !res.value.data) {
    return { edition: null, expiresAt: null, status: 'unknown' };
  }
  const data = res.value.data;
  const token = decodeSecretValue(data.LICENSE_TOKEN);
  const edition = decodeSecretValue(data.EDITION_CHOICE) || null;
  const claims = token ? decodeLicenseClaims(token) : null;
  return licenseStatusFromClaims(claims, edition);
}

export async function applyLicense(deps) {
  const {
    licenseKey,
    kube,
    namespace = 'msp',
    secretName = 'appliance-license-seed',
    appDeployment = 'alga-core-sebastian',
    appNamespace = 'msp'
  } = deps;

  const token = String(licenseKey || '').trim();
  if (!token) {
    return { ok: false, status: 400, error: 'A license key is required.' };
  }
  if (!isWellFormedLicenseJws(token)) {
    return { ok: false, status: 400, error: 'Invalid license key format. Expected a signed JWS (three dot-separated base64url segments).' };
  }

  // Patch only LICENSE_TOKEN so the edition and any connected-refresh fields are
  // preserved. Secret.data values are base64.
  const tokenB64 = Buffer.from(token, 'utf8').toString('base64');
  const patch = JSON.stringify({ data: { LICENSE_TOKEN: tokenB64 } });
  const patched = await kube.run(`patch secret ${secretName} -n ${namespace} --type merge -p ${kube.quote(patch)}`);
  if (!patched.ok) {
    return { ok: false, status: 412, error: `Could not update the license secret: ${(patched.stderr || patched.stdout || '').trim()}` };
  }

  // Restart the app so it re-reads the license seed.
  const restarted = await kube.run(`rollout restart deploy/${appDeployment} -n ${appNamespace}`);
  if (!restarted.ok) {
    return { ok: false, status: 412, error: `License updated but app restart failed: ${(restarted.stderr || restarted.stdout || '').trim()}` };
  }
  return { ok: true };
}

// --- Settings: app URL / DNS ----------------------------------------------

export async function applyAppUrl(deps) {
  const {
    appHostname,
    dnsMode = 'system',
    dnsServers = '',
    kube,
    releaseSelectionFile,
    valuesNamespace = 'alga-system',
    valuesConfigMapName = 'appliance-values-alga-core',
    helmReleaseName = 'alga-core',
    timestamp
  } = deps;

  const appUrl = appUrlFromInput(appHostname);
  if (!appUrl) {
    return { ok: false, status: 400, error: 'An app URL / hostname is required.' };
  }
  if (!['system', 'custom'].includes(dnsMode)) {
    return { ok: false, status: 400, error: 'Invalid DNS mode. Use system or custom.' };
  }
  const host = hostFromAppUrl(appUrl);

  // 1. Read the current alga-core values configmap, rewrite the URL scalars.
  const cm = await kube.json(`get configmap ${valuesConfigMapName} -n ${valuesNamespace}`);
  if (!cm || !cm.ok || !cm.value || !cm.value.data) {
    return { ok: false, status: 412, error: `Could not read ${valuesConfigMapName} in ${valuesNamespace}.` };
  }
  const dataKeys = Object.keys(cm.value.data);
  const valuesKey = dataKeys.find((k) => k.startsWith('alga-core.')) || dataKeys[0];
  if (!valuesKey) {
    return { ok: false, status: 412, error: `${valuesConfigMapName} has no values data key.` };
  }
  let yaml = cm.value.data[valuesKey];
  try {
    yaml = setYamlScalar(yaml, ['appUrl'], JSON.stringify(appUrl));
    yaml = setYamlScalar(yaml, ['host'], JSON.stringify(host));
    yaml = setYamlScalar(yaml, ['domainSuffix'], '""');
  } catch (error) {
    return { ok: false, status: 412, error: `Could not rewrite app URL in values: ${error instanceof Error ? error.message : String(error)}` };
  }

  // 2. Apply the updated configmap (full object so the data key is preserved).
  const manifest = {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: valuesConfigMapName, namespace: valuesNamespace },
    data: { [valuesKey]: yaml.endsWith('\n') ? yaml : `${yaml}\n` }
  };
  const applied = await kube.apply(manifest);
  if (!applied.ok) {
    return { ok: false, status: 412, error: `Could not apply updated values: ${(applied.stderr || applied.stdout || '').trim()}` };
  }

  // 3. Persist the operator intent in release-selection.json so the next update
  //    re-applies it (and does not silently reset the URL).
  if (releaseSelectionFile) {
    const selection = readJsonFile(releaseSelectionFile) || {};
    selection.runtime = {
      ...(selection.runtime || {}),
      appHostname: appUrl,
      dnsMode,
      dnsServers: dnsMode === 'custom' ? String(dnsServers || '').trim() : ''
    };
    selection.updatedAt = nowIso();
    try {
      writeSecureJsonFile(releaseSelectionFile, selection);
    } catch (error) {
      return { ok: false, status: 412, error: `Values applied but could not persist release selection: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  // 4. Reconcile the HelmRelease so NEXTAUTH_URL re-renders from the new values.
  const ts = timestamp || String(Math.floor(nowMs() / 1000));
  const reconciled = await kube.run(`annotate helmrelease ${helmReleaseName} -n ${valuesNamespace} reconcile.fluxcd.io/requestedAt=${ts} --overwrite`);
  if (!reconciled.ok) {
    return { ok: false, status: 412, error: `Values applied but HelmRelease reconcile failed: ${(reconciled.stderr || reconciled.stdout || '').trim()}` };
  }
  return { ok: true, appUrl, host };
}

// --- Control-plane upgrade request (-> host-agent over the socket) ----------

export function requestControlPlaneUpgrade(deps) {
  const { hostAgentSocket = '/run/alga-appliance/host-agent.sock', timeoutMs = 10000 } = deps;
  return new Promise((resolve) => {
    if (!fs.existsSync(hostAgentSocket)) {
      resolve({ ok: false, status: 503, error: `Host agent socket not available at ${hostAgentSocket}.` });
      return;
    }
    const req = http.request(
      { socketPath: hostAgentSocket, path: '/v1/control-plane/upgrade', method: 'POST', timeout: timeoutMs },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          let parsed = null;
          try { parsed = JSON.parse(body); } catch {}
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ ok: true, status: 202, result: parsed || { ok: true, started: true } });
          } else {
            resolve({ ok: false, status: res.statusCode || 502, error: (parsed && parsed.error) || `Host agent returned ${res.statusCode}.` });
          }
        });
      }
    );
    req.on('timeout', () => { req.destroy(new Error('host agent request timed out')); });
    req.on('error', (err) => { resolve({ ok: false, status: 502, error: `Host agent request failed: ${err.message}` }); });
    req.end();
  });
}

// --- Status aggregation ----------------------------------------------------

function mapUpdateStatus(installStateStatus) {
  switch (installStateStatus) {
    case 'update-running':
    case 'release-config-running':
      return 'running';
    case 'update-complete':
      return 'complete';
    case 'update-blocked':
    case 'release-config-blocked':
    case 'runtime-values-blocked':
      return 'blocked';
    default:
      return 'idle';
  }
}

function digestOf(imageRef) {
  if (typeof imageRef !== 'string') return null;
  const at = imageRef.indexOf('@sha256:');
  return at >= 0 ? imageRef.slice(at + 1) : null;
}

export async function collectManageStatus(deps) {
  const {
    kube,
    releaseSelectionFile,
    installStateFile,
    cpUpgradeStatusFile,
    valuesNamespace = 'alga-system',
    valuesConfigMapName = 'appliance-values-alga-core',
    cpNamespace = 'alga-appliance-control-plane',
    cpDeployment = 'appliance-control-plane',
    resolveControlPlaneRef,
    resolveReleaseManifest,
    licenseNamespace = 'msp',
    licenseSecretName = 'appliance-license-seed'
  } = deps;

  const selection = readJsonFile(releaseSelectionFile) || {};
  const installState = readJsonFile(installStateFile) || {};
  const cpUpgrade = readJsonFile(cpUpgradeStatusFile) || {};

  const channel = selection.selectedChannel || 'stable';

  // Control-plane digests.
  let runningDigest = null;
  try {
    const dep = await kube.json(`get deployment ${cpDeployment} -n ${cpNamespace}`);
    const image = dep && dep.ok && dep.value && dep.value.spec
      ? dep.value.spec.template.spec.containers[0].image
      : null;
    runningDigest = digestOf(image);
  } catch { /* best effort */ }

  let resolvedRef = null;
  try { resolvedRef = resolveControlPlaneRef ? await resolveControlPlaneRef(channel) : null; } catch { /* best effort */ }
  const resolvedDigest = digestOf(resolvedRef) || (resolvedRef && resolvedRef.includes('sha256:') ? resolvedRef.split('@').pop() : null);
  const upgradeAvailable = Boolean(runningDigest && resolvedDigest && runningDigest !== resolvedDigest);

  // App release update availability. The box pins the channel -> release-manifest
  // digest at install time (selection.manifestDigest). Re-resolve the channel's
  // *current* manifest digest and compare: a moved channel tag (e.g. a published
  // pointer-update) points at new app images but never reaches an installed box
  // until an operator runs an update. Without this, app.updateAvailable was a
  // hardcoded false, so the Manage UI could never surface — or offer — an update.
  // LEVERAGE: pattern appliance-channel-digest-drift — "resolve channel ref, diff
  // against the installed/pinned digest -> available?" is now written twice here
  // (control-plane image above, app release below). A shared helper
  // (installedDigest + resolver -> { available, resolvedDigest }) would dedupe it.
  let resolvedReleaseDigest = null;
  let resolvedReleaseVersion = null;
  try {
    if (resolveReleaseManifest && selection.manifestDigest) {
      const resolved = await resolveReleaseManifest(channel, {
        registryHost: selection.registryHost,
        releaseRepository: selection.repository
      });
      resolvedReleaseDigest = resolved?.manifestDigest || null;
      resolvedReleaseVersion = resolved?.manifest?.version || null;
    }
  } catch { /* best effort — leave updateAvailable false when the registry is unreachable */ }
  const updateAvailable = Boolean(
    selection.manifestDigest && resolvedReleaseDigest && selection.manifestDigest !== resolvedReleaseDigest
  );

  // App URL / DNS (from persisted operator intent).
  const runtime = selection.runtime || {};
  const appUrl = {
    url: runtime.appHostname || null,
    host: runtime.appHostname ? hostFromAppUrl(runtime.appHostname) : null,
    dnsMode: runtime.dnsMode || 'system',
    dnsServers: runtime.dnsServers ? String(runtime.dnsServers).split(',').map((s) => s.trim()).filter(Boolean) : []
  };

  // License.
  let license = { edition: null, expiresAt: null, perpetual: false, status: 'unknown' };
  try {
    license = await readLicenseStatus({ kube, namespace: licenseNamespace, secretName: licenseSecretName });
  } catch { /* best effort */ }

  return {
    app: {
      version: selection.selectedReleaseVersion || null,
      channel,
      updateAvailable,
      availableVersion: updateAvailable ? resolvedReleaseVersion : null,
      pinnedReleaseDigest: selection.manifestDigest || null,
      resolvedReleaseDigest,
      update: { status: mapUpdateStatus(installState.status), message: installState.lastAction || null }
    },
    controlPlane: {
      channel,
      runningDigest,
      resolvedDigest,
      upgradeAvailable,
      upgrade: { status: cpUpgrade.status || 'idle', message: cpUpgrade.message || null }
    },
    license,
    appUrl
  };
}
