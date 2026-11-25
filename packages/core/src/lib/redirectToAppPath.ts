import { NextResponse } from 'next/server';

/**
 * Redirect to a path inside this app with a *relative* `Location`.
 *
 * Why not `NextResponse.redirect`: it needs an absolute URL, and the only origin a
 * route handler can see is `request.nextUrl.origin`, which behind Istio/CloudFront is
 * the internal upstream (`https://localhost:3000`), not the host the browser used.
 * A relative `Location` (RFC 9110 §10.2.2) is resolved by the client against the URL it
 * requested, which is by definition the public one, so no origin or forwarded-header
 * trust decision is involved. No environment or configuration is read here.
 *
 * Only single-slash-rooted app paths are accepted, so this can never become an open
 * redirect. For a destination on another host (OAuth providers, custom-scheme mobile
 * callbacks, documents, emails) use `NextResponse.redirect` with an explicit absolute URL.
 */

export interface RedirectToAppPathOptions {
  /** Default 307. */
  status?: 301 | 302 | 303 | 307 | 308;
  /** Extra response headers; `Location` is always set by the helper. */
  headers?: HeadersInit;
  /**
   * Query params to carry onto the destination (typically `request.nextUrl.searchParams`).
   * Params the destination already has win; only missing keys are appended.
   */
  carryQuery?: URLSearchParams;
}

// Placeholder origin used only to parse/normalise; it never reaches the response.
const PARSE_BASE = 'http://app-path.invalid';

// C0 controls and DEL. URL parsers silently strip tab/CR/LF, which would let
// `/\t/evil.com` collapse into `//evil.com`, so they are refused outright.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** Returns the normalised `path?query#fragment`, or throws `TypeError` if `path` is not an app path. */
export function toAppRelativeLocation(path: string, carryQuery?: URLSearchParams): string {
  if (typeof path !== 'string' || path.length === 0) {
    throw new TypeError('redirectToAppPath: path must be a non-empty string');
  }
  if (path[0] !== '/' || path[1] === '/' || path.includes('\\') || CONTROL_CHARS.test(path)) {
    throw new TypeError(`redirectToAppPath: not an app path: ${JSON.stringify(path)}`);
  }

  const parsed = new URL(path, PARSE_BASE);
  // `/.//host` normalises to pathname `//host`, which a client would read as scheme-relative.
  if (parsed.origin !== PARSE_BASE || parsed.pathname.startsWith('//')) {
    throw new TypeError(`redirectToAppPath: not an app path: ${JSON.stringify(path)}`);
  }

  if (carryQuery) {
    // Snapshot first so a repeated carried key (`a=1&a=2`) keeps every value.
    const destinationKeys = new Set(parsed.searchParams.keys());
    carryQuery.forEach((value, key) => {
      if (!destinationKeys.has(key)) parsed.searchParams.append(key, value);
    });
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function redirectToAppPath(path: string, options: RedirectToAppPathOptions = {}): NextResponse {
  const location = toAppRelativeLocation(path, options.carryQuery);
  const headers = new Headers(options.headers);
  headers.set('Location', location);
  return new NextResponse(null, { status: options.status ?? 307, headers });
}
