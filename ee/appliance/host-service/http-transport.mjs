/**
 * Shared resolver-aware HTTPS transport for appliance setup.
 *
 * Registry requests and install-code redemption must resolve through the same
 * explicit DNS servers. Global `fetch` uses the host resolver (and therefore its
 * search domains); `https.request` with an injected `lookup` uses only the
 * configured resolvers and absolute queries, so a customer search suffix can
 * never hijack an outbound name. keep every caller on this one transport.
 *
 * Pure-ish: no fs/kube access, and every lookup/request seam is injectable so
 * resolver selection, absolute queries, POST bodies, TLS behavior and redirect
 * handling are unit-testable without touching the network.
 */
import dns from 'node:dns';
import https from 'node:https';

// Always query the absolute name so the resolver cannot append a search suffix.
export function absoluteHostname(hostname) {
  const value = String(hostname || '');
  return value.endsWith('.') ? value : `${value}.`;
}

export async function resolveAddressesWithServers(servers, hostname, family = 0) {
  const resolver = new dns.promises.Resolver();
  resolver.setServers(servers);
  const query = absoluteHostname(hostname);

  const records = [];
  if (family !== 6) {
    try {
      for (const address of await resolver.resolve4(query)) {
        records.push({ address, family: 4 });
      }
    } catch {
      // No IPv4 records (or query error); fall through to IPv6 before giving up.
    }
  }
  if (family !== 4 && records.length === 0) {
    try {
      for (const address of await resolver.resolve6(query)) {
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
export function resolverLookup(servers) {
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

// Wrap a Node lookup so the addresses it actually returned are observed, while
// preserving the callback contract (including `all: true`). Used only to enrich
// failure diagnostics; a throwing observer never affects the request.
function capturingLookup(baseLookup, onResolved) {
  return (hostname, options, callback) => {
    const done = typeof options === 'function' ? options : callback;
    baseLookup(hostname, options, (error, address, family) => {
      if (!error && address) {
        const records = Array.isArray(address) ? address : [{ address, family }];
        try {
          onResolved(hostname, records);
        } catch {
          // diagnostics only
        }
      }
      done(error, address, family);
    });
  };
}

// A later diagnostic lookup is labeled as such elsewhere; this helper only
// reports what a fresh query returns, never the failed connection's peer.
export async function diagnoseResolution(servers, hostname) {
  const configured = Array.isArray(servers) ? servers.filter(Boolean) : [];
  if (configured.length === 0) {
    return { hostname, servers: configured, ok: false, addresses: [], error: 'No DNS servers configured.' };
  }
  try {
    const records = await resolveAddressesWithServers(configured, hostname);
    return { hostname, servers: configured, ok: true, addresses: records.map((record) => record.address), error: null };
  } catch (error) {
    return { hostname, servers: configured, ok: false, addresses: [], error: error instanceof Error ? error.message : String(error) };
  }
}

function redirectStatus(status) {
  return status >= 300 && status < 400;
}

// The transport is HTTPS-only: TLS SNI/certificate verification is the security
// boundary for both registry pulls and credential-bearing redemption. Reject a
// non-HTTPS (or unparseable) URL up front with an actionable error instead of
// letting https.request surface a cryptic one.
export function requireHttpsUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Unsupported request URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`Unsupported request URL protocol "${parsed.protocol}"; only https: is supported for ${parsed.host || url}.`);
  }
  return parsed;
}

export function httpsRequest(url, timeoutMs = 8000, lookupServers = [], extra = {}) {
  return new Promise((resolve, reject) => {
    try {
      requireHttpsUrl(url);
    } catch (error) {
      reject(error);
      return;
    }
    const requestOptions = {
      method: extra.method || 'GET',
      timeout: timeoutMs,
      headers: extra.headers || {},
      ...(extra.requestOptions || {})
    };
    const body = extra.body;
    let bodyBuffer = null;
    if (body !== undefined && body !== null) {
      bodyBuffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
      requestOptions.headers = { ...requestOptions.headers, 'content-length': bodyBuffer.byteLength };
    }
    // Record what the transport's own lookup resolved so a failure can name the
    // address the failed connection actually used. A later diagnostic query is
    // reported separately (and labeled as later), never as this destination.
    const observedAddresses = [];
    let observedHostname = null;
    const recordLookup = (hostname, records) => {
      if (typeof hostname === 'string' && hostname) observedHostname = hostname;
      for (const record of records || []) {
        if (record && record.address) observedAddresses.push(record.address);
      }
    };
    if (typeof extra.lookup === 'function') {
      requestOptions.lookup = capturingLookup(extra.lookup, recordLookup);
    } else if (lookupServers && lookupServers.length > 0) {
      requestOptions.lookup = capturingLookup(resolverLookup(lookupServers), recordLookup);
    }
    const annotate = (error) => {
      if (error && typeof error === 'object' && observedAddresses.length > 0 && !error.lookupAddresses) {
        error.lookupAddresses = observedAddresses.slice();
        if (observedHostname) error.lookupHostname = observedHostname;
      }
      return error;
    };

    const req = https.request(url, requestOptions, (res) => {
      const status = res.statusCode || 0;
      // Reject (never forward) credential-bearing POSTs across redirects: a
      // claim code must only ever reach its configured service.
      if (redirectStatus(status) && extra.rejectRedirects) {
        res.resume();
        reject(new Error(`Refusing to follow a ${status} redirect for a credential-bearing request to ${url}.`));
        return;
      }
      // Opt-in redirect following (OCI blob fetches 307 to a CDN). On a
      // cross-host redirect, drop Authorization — the redirect target is a
      // pre-signed URL and forwarding a bearer to a third party is unsafe.
      const redirectsLeft = extra.followRedirects ? (extra.maxRedirects ?? 5) : 0;
      if (redirectStatus(status) && res.headers.location && redirectsLeft > 0) {
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
          body: Buffer.concat(chunks).toString('utf8'),
          remoteAddress: res.socket?.remoteAddress || null
        });
      });
    });

    req.on('timeout', () => {
      req.destroy(annotate(new Error(`Request timed out for ${url}`)));
    });
    req.on('error', (error) => reject(annotate(error)));
    if (bodyBuffer) {
      req.write(bodyBuffer);
    }
    req.end();
  });
}
