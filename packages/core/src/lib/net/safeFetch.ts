/**
 * safeFetch: server-side fetching of user-influenced URLs without SSRF.
 *
 * Policy (checked in this order, on the first URL and on every redirect hop):
 *   1. http/https only, no embedded credentials
 *   2. a literal IP host must be public
 *   3. every address returned by DNS must be public (any private answer refuses the URL)
 *   4. the connection is pinned to the validated address (no second DNS lookup)
 *   5. at most MAX_REDIRECTS redirects
 *   6. body size and total time are capped
 *   7. only allowed content types (default image/*) are returned
 */
import dns from 'node:dns';
import { isIP } from 'node:net';
import { Agent, request as undiciRequest } from 'undici';

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

const MAX_REDIRECTS = 3;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// Address classification
// ---------------------------------------------------------------------------

function parseIPv4(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return octets.every((o) => o >= 0 && o <= 255) ? octets : null;
}

function isPublicIPv4Octets([a, b, c]: number[]): boolean {
  if (a === 0) return false; // "this network", 0.0.0.0
  if (a === 10) return false; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 127) return false; // loopback
  if (a === 169 && b === 254) return false; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false; // RFC1918
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // IETF protocol / TEST-NET-1
  if (a === 192 && b === 168) return false; // RFC1918
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false; // TEST-NET-3
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

/** Expand an IPv6 literal to 8 16-bit groups, or null if malformed. */
function parseIPv6(input: string): number[] | null {
  let ip = input;
  const zone = ip.indexOf('%');
  if (zone !== -1) ip = ip.slice(0, zone);

  // Embedded dotted IPv4 tail (e.g. ::ffff:127.0.0.1)
  const lastColon = ip.lastIndexOf(':');
  if (lastColon !== -1 && ip.slice(lastColon + 1).includes('.')) {
    const v4 = parseIPv4(ip.slice(lastColon + 1));
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    ip = `${ip.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const toGroups = (s: string) => (s === '' ? [] : s.split(':'));
  const head = toGroups(halves[0]);
  const tail = halves.length === 2 ? toGroups(halves[1]) : [];
  let groups: string[];
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    groups = [...head, ...Array(missing).fill('0'), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  const out = groups.map((g) => (/^[0-9a-fA-F]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return out.every((n) => !Number.isNaN(n)) ? out : null;
}

function v4FromGroups(hi: number, lo: number): number[] {
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
}

/**
 * True only for globally routable unicast addresses. Anything unparseable is
 * treated as non-public (fail closed).
 */
export function isPublicAddress(ip: string): boolean {
  const host = ip.startsWith('[') && ip.endsWith(']') ? ip.slice(1, -1) : ip;
  const family = isIP(host.split('%')[0]);
  if (family === 4) {
    const octets = parseIPv4(host);
    return octets ? isPublicIPv4Octets(octets) : false;
  }
  if (family === 6) {
    const g = parseIPv6(host);
    if (!g) return false;

    const first96Zero = g.slice(0, 5).every((x) => x === 0);
    // ::ffff:a.b.c.d (IPv4-mapped): judge the embedded IPv4 address
    if (first96Zero && g[5] === 0xffff) return isPublicIPv4Octets(v4FromGroups(g[6], g[7]));
    // ::/96 (unspecified, loopback, deprecated IPv4-compatible): never public
    if (g.slice(0, 6).every((x) => x === 0)) return false;
    // 64:ff9b::/96 (NAT64): judge the embedded IPv4 address
    if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
      return isPublicIPv4Octets(v4FromGroups(g[6], g[7]));
    }
    // 2002::/16 (6to4): judge the embedded IPv4 address
    if (g[0] === 0x2002) return isPublicIPv4Octets(v4FromGroups(g[1], g[2]));
    // Only global unicast 2000::/3 is public; this excludes ::1, fe80::/10,
    // fc00::/7, ff00::/8 and everything else.
    if ((g[0] & 0xe000) !== 0x2000) return false;
    if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

export interface ResolvedAddress {
  address: string;
  family: number;
}
export type LookupFn = (hostname: string) => Promise<ResolvedAddress[]>;

export interface SafeFetchDeps {
  lookup?: LookupFn;
}

const defaultLookup: LookupFn = async (hostname) => {
  const results = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  return results.map((r) => ({ address: r.address, family: r.family }));
};

/**
 * Validate a URL against the policy and return the address the connection must use.
 * Throws UnsafeUrlError on any violation.
 */
export async function assertPublicUrl(
  rawUrl: string,
  deps: SafeFetchDeps = {}
): Promise<{ url: URL; address: string; family: number }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeUrlError(`Unsupported protocol: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError('URLs with embedded credentials are not allowed');
  }

  const hostname = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
  if (!hostname) throw new UnsafeUrlError('URL has no host');

  const literalFamily = isIP(hostname);
  if (literalFamily) {
    if (!isPublicAddress(hostname)) {
      throw new UnsafeUrlError('Address is not publicly routable');
    }
    return { url, address: hostname, family: literalFamily };
  }

  const lookup = deps.lookup ?? defaultLookup;
  let answers: ResolvedAddress[];
  try {
    answers = await lookup(hostname);
  } catch (error) {
    throw new UnsafeUrlError(`DNS resolution failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!answers || answers.length === 0) {
    throw new UnsafeUrlError('DNS returned no addresses');
  }
  if (answers.some((a) => !isPublicAddress(a.address))) {
    throw new UnsafeUrlError('Host resolves to a non-public address');
  }
  return { url, address: answers[0].address, family: answers[0].family || isIP(answers[0].address) };
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export interface SafeRequestInit {
  url: URL;
  /** Validated address the connection MUST use. */
  address: string;
  family: number;
  signal: AbortSignal;
}
export interface SafeResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Uint8Array>;
  destroy?: () => void;
}
export type SafeRequestFn = (init: SafeRequestInit) => Promise<SafeResponse>;

/** Default transport: undici with the connection pinned to the validated address. */
const defaultRequest: SafeRequestFn = async ({ url, address, family, signal }) => {
  const dispatcher = new Agent({
    connect: {
      // Ignore the hostname: always connect to the address we validated.
      // TLS SNI / certificate checks still use the URL hostname.
      lookup: (_hostname: string, options: any, callback: any) => {
        if (options && options.all) callback(null, [{ address, family }]);
        else callback(null, address, family);
      },
    },
  });
  const res = await undiciRequest(url, {
    method: 'GET',
    dispatcher,
    signal,
    headers: { accept: 'image/*', 'user-agent': 'alga-psa-safe-fetch' },
  });
  const closeAgent = () => {
    void dispatcher.close().catch(() => undefined);
  };
  async function* body() {
    try {
      for await (const chunk of res.body) yield chunk as Uint8Array;
    } finally {
      closeAgent();
    }
  }
  return {
    status: res.statusCode,
    headers: res.headers,
    body: body(),
    destroy: () => {
      res.body.destroy();
      closeAgent();
    },
  };
};

export interface FetchPublicBytesOptions extends SafeFetchDeps {
  maxBytes?: number;
  timeoutMs?: number;
  /** Content-type prefixes or exact types; default ['image/']. */
  allowedContentTypes?: string[];
  request?: SafeRequestFn;
}

function headerValue(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? '' : v ?? '';
}

export async function fetchPublicBytes(
  rawUrl: string,
  opts: FetchPublicBytesOptions = {}
): Promise<{ bytes: Buffer; contentType: string; finalUrl: string }> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const allowed = (opts.allowedContentTypes ?? ['image/']).map((t) => t.toLowerCase());
  const request = opts.request ?? defaultRequest;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let current = rawUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      // Full policy on every hop, before connecting.
      const { url, address, family } = await assertPublicUrl(current, { lookup: opts.lookup });
      const res = await request({ url, address, family, signal: controller.signal });

      if ([301, 302, 303, 307, 308].includes(res.status)) {
        res.destroy?.();
        const location = headerValue(res.headers['location']);
        if (!location) throw new Error('Redirect without Location header');
        if (hop === MAX_REDIRECTS) throw new UnsafeUrlError('Too many redirects');
        current = new URL(location, url).toString();
        continue;
      }

      if (res.status < 200 || res.status >= 300) {
        res.destroy?.();
        throw new Error(`Unexpected response status ${res.status}`);
      }

      const contentType = headerValue(res.headers['content-type']).split(';')[0].trim().toLowerCase();
      if (!allowed.some((a) => contentType === a || (a.endsWith('/') && contentType.startsWith(a)))) {
        res.destroy?.();
        throw new UnsafeUrlError(`Content type not allowed: ${contentType || '(none)'}`);
      }

      const declared = Number(headerValue(res.headers['content-length']));
      if (Number.isFinite(declared) && declared > maxBytes) {
        res.destroy?.();
        throw new Error(`Response exceeds ${maxBytes} bytes`);
      }

      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of res.body) {
        total += chunk.byteLength;
        if (total > maxBytes) {
          res.destroy?.();
          throw new Error(`Response exceeds ${maxBytes} bytes`);
        }
        chunks.push(Buffer.from(chunk));
      }
      return { bytes: Buffer.concat(chunks), contentType, finalUrl: url.toString() };
    }
    throw new UnsafeUrlError('Too many redirects');
  } finally {
    clearTimeout(timer);
  }
}
