/**
 * safeFetch — server-side GET of a caller-supplied URL with SSRF protection.
 *
 * Policy (ee/docs/plans/2026-10-20-mcp-doc-attachments.md §4):
 *  - https only, no userinfo, default port / 443 only
 *  - every resolved address must be public (IPv4-mapped IPv6 is unwrapped first)
 *  - the connection is pinned to the vetted address (no check-then-refetch gap)
 *  - manual redirects, at most 3, each hop fully re-validated, no https -> http
 *  - 15 s to response headers, 20 s overall, hard byte cap (header + streamed)
 *  - fails closed: there is deliberately NO environment override for private ranges
 *  - optional caller-supplied `hostPolicy` (host allowlist), checked BEFORE any DNS
 *    lookup and again on every redirect hop. It is an extra check that sits in front of
 *    the rules above and never replaces them. safeFetch stays tenant-agnostic: the
 *    caller decides what the policy is.
 *
 * `lookup` and `fetch` are injected so tests run without a network.
 *
 * Error messages never include the URL path or query: callers hand us signed
 * (credential-bearing) URLs. Only the hostname may be mentioned.
 */
import dns from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { domainToASCII } from 'node:url';
import { Agent, fetch as undiciFetch } from 'undici';

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

/**
 * The host is not permitted by the caller's `hostPolicy`. Carries the (normalised)
 * hostname only: never the path or query, which may hold a signed credential.
 */
export class FetchHostNotAllowedError extends Error {
  readonly hostname: string;
  /** True when the refused host was reached through a redirect from an allowed host. */
  readonly viaRedirect: boolean;

  constructor(hostname: string, viaRedirect = false) {
    super(
      viaRedirect
        ? `A redirect led to ${hostname}, which is not an allowed download host`
        : `${hostname} is not an allowed download host`,
    );
    this.name = 'FetchHostNotAllowedError';
    this.hostname = hostname;
    this.viaRedirect = viaRedirect;
  }
}

export type UrlFetchFailureReason =
  | 'status'
  | 'too_large'
  | 'timeout'
  | 'too_many_redirects'
  | 'bad_redirect'
  | 'network';

export class UrlFetchError extends Error {
  readonly reason: UrlFetchFailureReason;
  /** Status returned by the remote server. Informational only — never our own response status. */
  readonly upstreamStatus?: number;

  constructor(reason: UrlFetchFailureReason, message: string, upstreamStatus?: number) {
    super(message);
    this.name = 'UrlFetchError';
    this.reason = reason;
    this.upstreamStatus = upstreamStatus;
  }
}

export interface ResolvedAddress {
  address: string;
  family: number;
}

export interface SafeFetchDeps {
  /** Resolve every address for a hostname (`dns.lookup(host, { all: true })` shape). */
  lookup?: (hostname: string) => Promise<ResolvedAddress[]>;
  /**
   * Perform one HTTP request. `pin` is the vetted address the connection MUST use,
   * regardless of what the hostname would resolve to now. Must honour `init.signal`.
   */
  fetch?: (url: string, init: SafeFetchInit, pin: ResolvedAddress) => Promise<Response>;
}

export interface SafeFetchInit {
  method: 'GET';
  headers: Record<string, string>;
  redirect: 'manual';
  signal: AbortSignal;
}

export interface SafeFetchOptions {
  /** Maximum response body size in bytes. */
  maxBytes: number;
  /** Time allowed to reach response headers, per hop. Default 15 s. */
  connectTimeoutMs?: number;
  /** Total budget for all hops plus body streaming. Default 20 s. */
  totalTimeoutMs?: number;
  /** Maximum redirects followed. Default 3. */
  maxRedirects?: number;
  /**
   * Host allowlist predicate. Receives the lowercased, IDNA (punycode) hostname.
   * Returning false refuses the host with `FetchHostNotAllowedError` before any DNS
   * lookup. Applied to the first URL and to every redirect target. Build one with
   * `createHostPolicy`.
   */
  hostPolicy?: (hostname: string) => boolean;
}

export interface SafeFetchResult {
  bytes: Buffer;
  status: number;
  headers: Headers;
}

export const SAFE_FETCH_DEFAULTS = {
  connectTimeoutMs: 15_000,
  totalTimeoutMs: 20_000,
  maxRedirects: 3,
} as const;

// ---------------------------------------------------------------------------
// Address policy
// ---------------------------------------------------------------------------

const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv4');
}
blocked.addAddress('255.255.255.255', 'ipv4');
blocked.addAddress('::', 'ipv6');
blocked.addAddress('::1', 'ipv6');
blocked.addSubnet('fc00::', 7, 'ipv6');
blocked.addSubnet('fe80::', 10, 'ipv6');
blocked.addSubnet('ff00::', 8, 'ipv6');
blocked.addSubnet('64:ff9b::', 96, 'ipv6');
blocked.addSubnet('2001:db8::', 32, 'ipv6');

/** Expand an IPv6 literal to eight 16-bit groups, or null when malformed. */
function expandIPv6(input: string): number[] | null {
  let addr = input.split('%')[0]!;
  // Trailing dotted IPv4 ("::ffff:127.0.0.1") -> two hex groups.
  const dotted = /^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(addr);
  if (dotted) {
    const octets = dotted[2]!.split('.').map(Number);
    if (octets.some((o) => o > 255)) return null;
    const hi = ((octets[0]! << 8) | octets[1]!).toString(16);
    const lo = ((octets[2]! << 8) | octets[3]!).toString(16);
    addr = `${dotted[1]}${hi}:${lo}`;
  }
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === '' ? [] : part.split(':'));
  const head = parse(halves[0]!);
  const tail = halves.length === 2 ? parse(halves[1]!) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN));
  return nums.length === 8 && nums.every((n) => !Number.isNaN(n)) ? nums : null;
}

/** If an IPv6 address embeds an IPv4 address (mapped or compatible), return it dotted. */
function unwrapEmbeddedIPv4(groups: number[]): string | null {
  const leadingZero = groups.slice(0, 5).every((g) => g === 0);
  const mapped = leadingZero && groups[5] === 0xffff;
  const compatible = leadingZero && groups[5] === 0;
  if (!mapped && !compatible) return null;
  const hi = groups[6]!;
  const lo = groups[7]!;
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

/** True when `address` (a literal IP) is in a range this fetcher must never connect to. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, 'ipv4');
  if (family === 6) {
    const groups = expandIPv6(address);
    if (!groups) return true; // unparseable -> fail closed
    const embedded = unwrapEmbeddedIPv4(groups);
    if (embedded) return blocked.check(embedded, 'ipv4');
    return blocked.check(address, 'ipv6');
  }
  return true; // not an IP at all -> fail closed
}

// ---------------------------------------------------------------------------
// Host allowlist matching
// ---------------------------------------------------------------------------

/** Lowercase + IDNA (punycode) form of a host or pattern label sequence; '' when invalid. */
export function normalizeHostForMatching(host: string): string {
  return domainToASCII(host.replace(/\.$/, '').toLowerCase());
}

/**
 * Does `hostname` match `pattern`?
 *  - an exact pattern matches only itself;
 *  - `*.label.domain` matches one or more labels below `label.domain`, but not
 *    `label.domain` itself and not `evillabel.domain`.
 * Both sides are normalised (lowercase + IDNA) first.
 */
export function hostMatchesPattern(hostname: string, pattern: string): boolean {
  const host = normalizeHostForMatching(hostname);
  if (!host) return false;
  if (pattern.startsWith('*.')) {
    const base = normalizeHostForMatching(pattern.slice(2));
    return base !== '' && host.length > base.length + 1 && host.endsWith(`.${base}`);
  }
  const exact = normalizeHostForMatching(pattern);
  return exact !== '' && host === exact;
}

/** Build a `hostPolicy` predicate from a list of exact / wildcard patterns. */
export function createHostPolicy(patterns: readonly string[]): (hostname: string) => boolean {
  const list = [...patterns];
  return (hostname) => list.some((pattern) => hostMatchesPattern(hostname, pattern));
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '').toLowerCase();
}

// ---------------------------------------------------------------------------
// Default (production) dependencies
// ---------------------------------------------------------------------------

const defaultLookup: NonNullable<SafeFetchDeps['lookup']> = async (hostname) => {
  const results = await dns.lookup(hostname, { all: true, verbatim: true });
  return results.map((r) => ({ address: r.address, family: r.family }));
};

/**
 * A `net.connect` compatible lookup that always answers with the vetted address.
 * Exported so the pinning contract can be tested directly.
 */
export function createPinnedLookup(pin: ResolvedAddress) {
  return (
    _hostname: string,
    options: { all?: boolean } | undefined,
    callback: (err: Error | null, address: any, family?: number) => void,
  ): void => {
    if (options && options.all) {
      callback(null, [{ address: pin.address, family: pin.family }]);
    } else {
      callback(null, pin.address, pin.family);
    }
  };
}

const defaultFetch: NonNullable<SafeFetchDeps['fetch']> = async (url, init, pin) => {
  // A fresh Agent per hop whose connect() can only reach the vetted IP. The URL (and
  // therefore TLS SNI and certificate verification) still uses the original hostname.
  const agent = new Agent({
    connect: { lookup: createPinnedLookup(pin) as any },
    connections: 1,
    pipelining: 0,
  });
  const res = (await undiciFetch(url, {
    method: init.method,
    headers: init.headers,
    redirect: init.redirect,
    signal: init.signal,
    dispatcher: agent,
  })) as unknown as Response;
  // Release the socket when the body is finished or abandoned.
  init.signal.addEventListener('abort', () => void agent.destroy(), { once: true });
  const origBody = res.body;
  if (origBody) {
    const reader = origBody.getReader();
    const wrapped = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            void agent.close();
          } else {
            controller.enqueue(value);
          }
        } catch (error) {
          controller.error(error);
          void agent.destroy();
        }
      },
      async cancel(reason) {
        await reader.cancel(reason).catch(() => undefined);
        void agent.destroy();
      },
    });
    return new Response(wrapped, { status: res.status, statusText: res.statusText, headers: res.headers });
  }
  void agent.close();
  return res;
};

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

function parseAndCheckUrl(raw: string, previous?: URL, hostPolicy?: SafeFetchOptions['hostPolicy']): URL {
  let url: URL;
  try {
    url = previous ? new URL(raw, previous) : new URL(raw);
  } catch {
    throw new UnsafeUrlError('URL is not valid');
  }
  if (previous && previous.protocol === 'https:' && url.protocol === 'http:') {
    throw new UnsafeUrlError('Redirect downgrades from https to http');
  }
  if (url.protocol !== 'https:') {
    throw new UnsafeUrlError('Only https URLs are allowed');
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError('URLs with embedded credentials are not allowed');
  }
  if (url.port !== '' && url.port !== '443') {
    throw new UnsafeUrlError('Only the default https port (443) is allowed');
  }
  const host = normalizeHostname(url.hostname);
  if (!host || host === 'localhost' || host.endsWith('.localhost')) {
    throw new UnsafeUrlError('URL host resolves to a local address');
  }
  // Allowlist check: runs here, before resolveVettedAddress (DNS), on the first URL and on
  // every redirect target. `url.hostname` is already lowercased and punycoded by WHATWG URL.
  if (hostPolicy && !hostPolicy(host)) {
    throw new FetchHostNotAllowedError(host, previous !== undefined);
  }
  return url;
}

async function resolveVettedAddress(
  url: URL,
  lookup: NonNullable<SafeFetchDeps['lookup']>,
): Promise<ResolvedAddress> {
  const host = normalizeHostname(url.hostname);
  const literalFamily = isIP(host);
  let addresses: ResolvedAddress[];
  if (literalFamily) {
    addresses = [{ address: host, family: literalFamily }];
  } else {
    try {
      addresses = await lookup(host);
    } catch {
      throw new UrlFetchError('network', `Could not resolve host ${host}`);
    }
  }
  if (addresses.length === 0) {
    throw new UrlFetchError('network', `Could not resolve host ${host}`);
  }
  // Reject if ANY answer is non-public: a mixed answer set is a classic rebinding setup.
  if (addresses.some((a) => isBlockedAddress(a.address))) {
    throw new UnsafeUrlError('URL resolved to a private or reserved address');
  }
  return addresses[0]!;
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function megabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}

export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions,
  deps: SafeFetchDeps = {},
): Promise<SafeFetchResult> {
  const lookup = deps.lookup ?? defaultLookup;
  const doFetch = deps.fetch ?? defaultFetch;
  const connectTimeoutMs = options.connectTimeoutMs ?? SAFE_FETCH_DEFAULTS.connectTimeoutMs;
  const totalTimeoutMs = options.totalTimeoutMs ?? SAFE_FETCH_DEFAULTS.totalTimeoutMs;
  const maxRedirects = options.maxRedirects ?? SAFE_FETCH_DEFAULTS.maxRedirects;
  const tooLarge = () =>
    new UrlFetchError('too_large', `Download exceeded ${megabytes(options.maxBytes)}`);

  const total = new AbortController();
  let timedOut = false;
  const totalTimer = setTimeout(() => {
    timedOut = true;
    total.abort();
  }, totalTimeoutMs);

  try {
    let url = parseAndCheckUrl(rawUrl, undefined, options.hostPolicy);

    for (let hop = 0; ; hop += 1) {
      const pin = await resolveVettedAddress(url, lookup);

      // Per-hop controller so the connect/headers timer can fire independently.
      const hopController = new AbortController();
      const onTotalAbort = () => hopController.abort();
      total.signal.addEventListener('abort', onTotalAbort, { once: true });
      const connectTimer = setTimeout(() => {
        timedOut = true;
        hopController.abort();
      }, connectTimeoutMs);

      let response: Response;
      try {
        response = await doFetch(
          url.toString(),
          {
            method: 'GET',
            headers: { accept: '*/*', 'user-agent': 'alga-psa-file-fetch/1' },
            redirect: 'manual',
            signal: hopController.signal,
          },
          pin,
        );
      } catch (error) {
        if (timedOut || hopController.signal.aborted) {
          throw new UrlFetchError('timeout', 'Timed out fetching URL');
        }
        if (error instanceof UnsafeUrlError || error instanceof UrlFetchError) throw error;
        throw new UrlFetchError('network', `Could not fetch URL from ${normalizeHostname(url.hostname)}`);
      } finally {
        clearTimeout(connectTimer);
      }

      try {
        if (REDIRECT_STATUSES.has(response.status)) {
          await response.body?.cancel().catch(() => undefined);
          const location = response.headers.get('location');
          if (!location) {
            throw new UrlFetchError('bad_redirect', 'Redirect response had no Location header', response.status);
          }
          if (hop >= maxRedirects) {
            throw new UrlFetchError('too_many_redirects', `Too many redirects (limit ${maxRedirects})`);
          }
          url = parseAndCheckUrl(location, url, options.hostPolicy);
          continue;
        }

        if (response.status < 200 || response.status > 299) {
          await response.body?.cancel().catch(() => undefined);
          throw new UrlFetchError('status', `Remote server returned ${response.status}`, response.status);
        }

        const declared = response.headers.get('content-length');
        if (declared !== null && /^\d+$/.test(declared) && Number(declared) > options.maxBytes) {
          await response.body?.cancel().catch(() => undefined);
          throw tooLarge();
        }

        const chunks: Buffer[] = [];
        let received = 0;
        if (response.body) {
          const reader = response.body.getReader();
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              received += value.byteLength;
              if (received > options.maxBytes) {
                await reader.cancel().catch(() => undefined);
                throw tooLarge();
              }
              chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
            }
          } catch (error) {
            if (error instanceof UrlFetchError || error instanceof UnsafeUrlError) throw error;
            if (timedOut || total.signal.aborted) {
              throw new UrlFetchError('timeout', 'Timed out downloading URL');
            }
            throw new UrlFetchError('network', 'Download from URL failed');
          }
        }
        return { bytes: Buffer.concat(chunks, received), status: response.status, headers: response.headers };
      } finally {
        total.signal.removeEventListener('abort', onTotalAbort);
      }
    }
  } finally {
    clearTimeout(totalTimer);
    total.abort();
  }
}
