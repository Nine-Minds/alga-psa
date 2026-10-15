/**
 * Install-code redemption for appliance setup.
 *
 * At first-boot setup the operator enters a one-time INSTALL CODE (from their
 * registration email). The host-service redeems it against the alga-license
 * service `/register` endpoint, which returns the registry-minted tenant id the
 * appliance adopts (INITIAL_TENANT_ID) plus the edition and — for paid tiers —
 * the first license JWT + per-appliance credential + check-in URL. Those flow
 * into the appliance-initial-tenant and appliance-license-seed Secrets, so the
 * appliance comes up already bound to its registry tenant.
 *
 * Pure/host-only: no kube or DB access, so it's unit-testable with a mock fetch.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { httpsRequest, diagnoseResolution, requireHttpsUrl } from './http-transport.mjs';

/**
 * Stable per-appliance id for /register (appliances are keyed by it, so check-in
 * later reuses the same one). Prefer the host machine-id; fall back to a hash of
 * the app hostname.
 */
export function deriveApplianceId(appHostname, machineIdPath = '/etc/machine-id') {
  try {
    const mid = fs.readFileSync(machineIdPath, 'utf8').trim();
    if (mid) return `appliance-${mid.replace(/[^a-f0-9]/gi, '').slice(0, 16)}`;
  } catch {
    // no machine-id (non-Linux / restricted) — fall through to the hostname hash
  }
  const h = crypto.createHash('sha256').update(String(appHostname || 'appliance')).digest('hex').slice(0, 16);
  return `appliance-${h}`;
}

const FRIENDLY_ERRORS = {
  invalid_claim_code: 'Invalid install code. Check the code from your registration email and try again.',
  expired_claim_code: 'Install code has expired. Request a fresh one from the portal (re-issue).',
  consumed_claim_code: 'Install code has already been used. Request a fresh one from the portal (re-issue).',
};

function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return String(url);
  }
}

// Build a reachability error that names the destination and the resolver path
// without ever echoing the install code or any credential.
function reachabilityError(url, error, diagnostics) {
  const hostname = hostnameOf(url);
  const cause = error instanceof Error ? error.message : String(error);
  const code = error && typeof error === 'object' ? (error.code || error.errno || null) : null;
  // Addresses the failing connection itself looked up (captured by the
  // transport) are reported as the destination; a later query is labeled as a
  // later diagnostic lookup, never as the failed connection's destination.
  const lookupAddresses = Array.isArray(error?.lookupAddresses) ? error.lookupAddresses : [];
  const parts = [`Could not reach the license service at ${url} to redeem the install code: ${cause}`];
  if (code) parts.push(`(${code})`);
  if (diagnostics && diagnostics.servers?.length) {
    parts.push(`DNS servers: ${diagnostics.servers.join(', ')}.`);
  }
  if (lookupAddresses.length > 0) {
    parts.push(`The failed connection resolved ${hostname} to ${lookupAddresses.join(', ')}.`);
  }
  if (diagnostics) {
    parts.push(diagnostics.ok
      ? `A later diagnostic lookup of ${hostname} returned: ${diagnostics.addresses.join(', ')}.`
      : `A later diagnostic lookup of ${hostname} also failed: ${diagnostics.error}`);
  }
  const wrapped = new Error(parts.join(' '));
  wrapped.cause = error;
  wrapped.network = {
    hostname,
    servers: diagnostics?.servers || [],
    lookupAddresses,
    addresses: diagnostics?.addresses || [],
    dnsOk: Boolean(diagnostics?.ok),
    dnsError: diagnostics?.error || null,
    code
  };
  return wrapped;
}

/**
 * Redeem an install code against alga-license `/register`.
 * @returns {Promise<{tenantId,edition,companyName,contactEmail,licenseToken,applianceCredential,checkInUrl,applianceId}>}
 * @throws {Error} with a setup-friendly message on a bad/expired/used code or an
 *   unreachable service (surfaced to the setup UI; install is blocked, never
 *   silently falls back to a self-generated tenant).
 */
export async function redeemInstallCode({ serviceUrl, installCode, applianceId, fetchImpl, lookupServers = [], requestImpl }) {
  if (!serviceUrl) {
    throw new Error('License service URL is not configured (ALGA_LICENSE_SERVICE_URL); cannot redeem the install code.');
  }
  // Reject a non-HTTPS or unparseable service URL clearly instead of letting the
  // transport surface a cryptic error; the claim code must only travel over TLS.
  const baseUrl = String(serviceUrl).replace(/\/$/, '');
  try {
    requireHttpsUrl(baseUrl);
  } catch (error) {
    throw new Error(`Invalid license service URL (ALGA_LICENSE_SERVICE_URL): ${error instanceof Error ? error.message : String(error)}`);
  }
  const url = `${baseUrl}/register`;
  const code = String(installCode || '').trim().toUpperCase();
  const hostname = hostnameOf(url);

  let res;
  if (fetchImpl) {
    // Injectable seam for unit tests (and callers that must supply a transport).
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ claim_code: code, appliance_id: applianceId }),
      });
    } catch (err) {
      throw reachabilityError(url, err, await diagnoseResolution(lookupServers, hostname));
    }
  } else {
    // Production path: the same explicit-resolver transport registry requests
    // use, so global-fetch search-domain behavior cannot diverge.
    const doRequest = requestImpl || httpsRequest;
    let raw;
    try {
      raw = await doRequest(url, 8000, lookupServers, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ claim_code: code, appliance_id: applianceId }),
        // Never forward a claim code across a redirect to another host.
        rejectRedirects: true,
      });
    } catch (err) {
      throw reachabilityError(url, err, await diagnoseResolution(lookupServers, hostname));
    }
    if (raw.statusCode >= 300 && raw.statusCode < 400) {
      throw new Error(`Install-code redemption was redirected away from ${hostname}; refusing to forward the install code.`);
    }
    res = {
      ok: raw.statusCode >= 200 && raw.statusCode < 300,
      status: raw.statusCode,
      json: async () => {
        try {
          return JSON.parse(raw.body || '{}');
        } catch {
          return {};
        }
      },
    };
  }

  if (!res.ok) {
    let body = {};
    try { body = await res.json(); } catch { /* non-JSON error body */ }
    const err = new Error(FRIENDLY_ERRORS[body.code] || body.error || `Install-code redemption failed (HTTP ${res.status}).`);
    // An invalid/expired/used code is operator-correctable: setup keeps the form
    // open so they can re-enter a fresh (re-issued) code, and stops auto-retrying
    // a code that will never change. (Network/reach errors are transient — they
    // stay retry-safe and are NOT flagged here.)
    if (FRIENDLY_ERRORS[body.code]) err.correctable = true;
    throw err;
  }

  const data = await res.json();
  const edition = data.edition === 'premium' ? 'pro' : (data.edition || 'essentials');
  return {
    tenantId: data.tenant_id || '',
    edition,
    companyName: data.company_name || '',
    contactEmail: data.contact_email || '',
    licenseToken: data.first_jwt || null,
    applianceCredential: data.appliance_credential || null,
    checkInUrl: data.check_in_url || null,
    applianceId,
  };
}

/**
 * Map a redeem result to the appliance-license-seed Secret literals consumed by
 * the bootstrap (appliance-bootstrap.sh). The appliance always runs the EE image:
 *   - essentials  → EE, no token, no auto-trial (INSTALL_EDITION suppresses it)
 *   - pro         → EE, licensed via the minted token (+ connected refresh)
 */
export function licenseSeedFromRedeem(redeem) {
  return {
    EDITION_CHOICE: 'ee',
    INSTALL_EDITION: redeem.edition || 'essentials',
    LICENSE_TOKEN: redeem.licenseToken || '',
    APPLIANCE_ID: redeem.applianceId || '',
    APPLIANCE_CREDENTIAL: redeem.applianceCredential || '',
    CHECK_IN_URL: redeem.checkInUrl || '',
  };
}
