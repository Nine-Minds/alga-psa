/**
 * Caps for upload entry points that cannot stream and hold the whole file in memory
 * (a base64 body, a mail-parser buffer, a server-action FormData).
 *
 * Every such path declares a named cap constant and a one-line reason it buffers, and derives
 * its effective cap here: never above the provider max (the ingest pipeline enforces that
 * anyway) and, for a server action, never above what Next's body limit lets through.
 * Dependency-free so native workers can load it.
 */
import { UploadSizeLimitError } from './errors';

/**
 * Fails fast on a cap that cannot limit anything (NaN from `Number("10MB")`, zero, negative,
 * Infinity): such a value would silently turn the limit off or refuse every file.
 * `name` is the constant or env var the cap came from, so the message points at the fix.
 */
export function assertValidCap(cap: number, name: string = 'upload cap'): number {
  if (typeof cap !== 'number' || !Number.isFinite(cap) || cap <= 0) {
    throw new Error(`${name} must be a finite number of bytes greater than 0 (got ${String(cap)})`);
  }
  return cap;
}

/** The cap a buffering path may advertise and enforce: its own named cap, clamped to the provider max. */
export function effectiveBufferedCap(namedCap: number, providerMaxFileSize: number, name: string = 'buffered upload cap'): number {
  assertValidCap(namedCap, name);
  assertValidCap(providerMaxFileSize, 'storage provider maxFileSize');
  return Math.min(namedCap, providerMaxFileSize);
}

/** Throws the ingest pipeline's size error (413, "File size exceeds limit of N bytes") past `cap`. */
export function assertWithinBufferedCap(size: number, cap: number, name: string = 'buffered upload cap'): void {
  assertValidCap(cap, name);
  if (size > cap) throw new UploadSizeLimitError(cap);
}

const UNIT_BYTES: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4, pb: 1024 ** 5 };

/** Parses a Next-style size string ("20mb", "1.5gb", "4096"); null when it is not one. */
export function parseByteSize(value: string): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb|pb)?\s*$/i.exec(value);
  if (!match) return null;
  const bytes = Number(match[1]) * UNIT_BYTES[(match[2] || 'b').toLowerCase()]!;
  return Number.isFinite(bytes) ? Math.floor(bytes) : null;
}

/** Next's server-action body cap when SERVER_ACTIONS_BODY_LIMIT is unset; equals next.config.mjs (pinned by test). */
export const DEFAULT_SERVER_ACTIONS_BODY_LIMIT = '26mb';

/** Room reserved for multipart framing and the action's other (serialized) arguments. */
export const SERVER_ACTION_ENVELOPE_BYTES = 64 * 1024;

/**
 * The most body Next's proxy layer passes on: `proxyClientMaxBodySize` ('100mb') in
 * server/next.config.mjs. The middleware matcher covers every page and API route, so every server
 * action and route handler request goes through it, and a larger body is silently truncated
 * ("Request body exceeded 100MB ... Only the first 100MB will be available", then "Unexpected end
 * of form"). Keep equal to next.config.mjs (a server test pins the two together).
 */
export const NEXT_PROXY_MAX_BODY_BYTES = 100 * 1024 * 1024;

/**
 * The largest file a server action can receive: the smaller of Next's `bodySizeLimit`
 * (SERVER_ACTIONS_BODY_LIMIT, default 26mb, see next.config.mjs) and the proxy's body limit
 * (NEXT_PROXY_MAX_BODY_BYTES), less the envelope. Next rejects or truncates an oversized action
 * before its handler runs, so a larger cap would be advertised but never reachable. An unparseable
 * limit throws: Next itself would not start with it, and silently assuming the default could advertise
 * more than the deployment accepts.
 */
export function serverActionFileLimitBytes(bodyLimit: string = process.env.SERVER_ACTIONS_BODY_LIMIT || DEFAULT_SERVER_ACTIONS_BODY_LIMIT): number {
  const bytes = parseByteSize(bodyLimit);
  if (bytes === null) {
    throw new Error(`SERVER_ACTIONS_BODY_LIMIT must be a size such as "26mb" or "4096" (got "${bodyLimit}")`);
  }
  return Math.max(0, Math.min(bytes, NEXT_PROXY_MAX_BODY_BYTES) - SERVER_ACTION_ENVELOPE_BYTES);
}
