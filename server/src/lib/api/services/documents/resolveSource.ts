/**
 * Turns the request `source` (url | base64) into `{ body, fileName, mimeType }` for the upload
 * core. A url source is a stream (byte guard + timeouts, piped into the ingest pipeline); a
 * base64 source is the one deliberately buffered path, with its own named cap. Failures are
 * ValidationErrors (HTTP 400), or PayloadTooLargeError (413) for size, whose messages name the
 * cause but never echo a URL path/query (signed URLs are credentials).
 *
 * The MIME returned is only the *declared* type: the ingest pipeline sniffs the bytes and decides.
 */
import type { Readable } from 'node:stream';
import { getMaxUploadBytes } from './uploadLimits';
import { effectiveBufferedCap } from '@alga-psa/storage/ingest/bufferedCap';
import { LengthRequiredError, PayloadTooLargeError, ValidationError } from '../../middleware/apiMiddleware';
import type { Knex } from 'knex';
import {
  FetchHostNotAllowedError,
  UnsafeUrlError,
  UrlFetchError,
  createHostPolicy,
  safeFetchStream,
  type SafeFetchDeps,
} from '../../../net/safeFetch';
import { loadEffectiveFetchHosts } from './fetchHostSettings';

export type AttachSource =
  | { type: 'url'; url: string }
  | { type: 'base64'; content: string };

export interface ResolveSourceInput {
  source: AttachSource;
  fileName?: string;
  mimeType?: string;
}

export interface ResolvedFile {
  fileName: string;
  mimeType: string;
  /** A Buffer for base64 sources; a byte-guarded stream for url sources. */
  body: Buffer | Readable;
}

/** Stable `code` on the 400 returned when a URL source's host is not on the tenant allowlist. */
export const FETCH_HOST_NOT_ALLOWED = 'FETCH_HOST_NOT_ALLOWED';

/** The tenant a URL source is being fetched for. Required for `url` sources (allowlist lookup). */
export interface ResolveSourceTenant {
  knex: Knex;
  tenant: string;
}

/** 400 carrying the stable FETCH_HOST_NOT_ALLOWED code. */
export class FetchHostNotAllowedValidationError extends ValidationError {
  constructor(hostname: string, viaRedirect: boolean) {
    const where = viaRedirect ? `The download redirected to ${hostname}, which is` : `${hostname} is`;
    super(
      `${where} not an allowed download host for this workspace. Nothing was downloaded. ` +
        'Tell the user that an administrator can add the host under Settings > MCP Server > Allowed download hosts, ' +
        'then retry only after they confirm. Do not try other URLs.',
      [{ path: ['source'], message: `${hostname} is not an allowed download host` }],
    );
    this.code = FETCH_HOST_NOT_ALLOWED;
  }
}

export interface ResolveSourceDeps {
  fetchDeps?: SafeFetchDeps;
  /** Override the provider size cap (tests). Defaults to the default storage provider's maxFileSize. */
  maxBytes?: number;
  /** Override the url fetch timeouts (tests). */
  urlTimeouts?: { connectTimeoutMs?: number; totalTimeoutMs?: number };
}

/**
 * A base64 source is a JSON string that is parsed, decoded and held whole, so it is capped well
 * below the provider max (decoded bytes; the encoded form is a third larger). Files above this
 * go through a url source, the chunked upload session API or (tickets) multipart.
 */
export const MAX_BASE64_SOURCE_BYTES = 25 * 1024 * 1024;

/** Slack on the raw JSON string for line wrapping before the exact encoded-length check. */
const BASE64_WHITESPACE_SLACK = 1.05;

/**
 * url sources stream, so the connect timeout is per hop as in safeFetch, but the total budget
 * must cover the whole transfer of a provider-max file (500 MB in 10 minutes needs ~0.8 MB/s).
 */
export const URL_SOURCE_CONNECT_TIMEOUT_MS = 15_000;
export const URL_SOURCE_TOTAL_TIMEOUT_MS = 10 * 60 * 1000;

const LARGE_FILE_HINT =
  'To attach a larger file use a url source (an allowed https download host), or the chunked upload session API (POST /api/documents/uploads, then PUT chunks and POST .../complete); tickets also accept multipart/form-data at /api/v1/tickets/{id}/documents.';

/** Encoded (base64) length of `decodedBytes`, padding included. */
export function base64EncodedLength(decodedBytes: number): number {
  return Math.ceil(decodedBytes / 3) * 4;
}

/** The decoded-size cap that applies to a base64 source. */
export function base64SourceCap(providerMax: number): number {
  return effectiveBufferedCap(MAX_BASE64_SOURCE_BYTES, providerMax, 'MAX_BASE64_SOURCE_BYTES');
}

/** Room in a JSON attach request for everything but the base64 string (entity ids, names, source wrapper). */
export const JSON_ENVELOPE_BYTES = 64 * 1024;

function base64TooLarge(cap: number): PayloadTooLargeError {
  return new PayloadTooLargeError(
    `base64 sources are limited to ${formatLimit(cap)} (about ${formatLimit(base64EncodedLength(cap))} encoded). ${LARGE_FILE_HINT}`,
    [{ path: ['source'], message: `base64 content exceeds ${formatLimit(cap)}` }],
  );
}

/**
 * 413 for a base64 body whose encoded size is past `cap`; checked on lengths only, before
 * anything is decoded (and before whitespace is stripped, via a slack on the raw length).
 */
export function assertBase64EncodedWithinCap(rawLength: number, cap: number, compactLength?: number): void {
  const encodedLimit = base64EncodedLength(cap);
  const over =
    compactLength === undefined ? rawLength > encodedLimit * BASE64_WHITESPACE_SLACK : compactLength > encodedLimit;
  if (over) throw base64TooLarge(cap);
}

/**
 * The JSON attach request, before `req.json()` buffers it: 411 when no Content-Length bounds the
 * body, 413 when it is past the encoded cap plus whitespace slack plus the fixed JSON envelope
 * (so a file exactly at the cap is accepted; the exact decoded check follows in resolveSource).
 */
export function assertJsonBodyWithinCap(contentLength: string | null, cap: number): void {
  if (contentLength === null || !/^\d+$/.test(contentLength.trim())) {
    throw new LengthRequiredError(
      `JSON requests must declare a Content-Length (the body is held in memory; base64 sources are limited to ${formatLimit(cap)}). ${LARGE_FILE_HINT}`,
      [{ path: ['body'], message: 'Content-Length header is required' }],
    );
  }
  const limit = Math.ceil(base64EncodedLength(cap) * BASE64_WHITESPACE_SLACK) + JSON_ENVELOPE_BYTES;
  if (Number(contentLength) > limit) throw base64TooLarge(cap);
}

const MAX_FILE_NAME_BYTES = 255;
const GENERIC_MIME = 'application/octet-stream';

/**
 * Text formats have no magic bytes, so the sniffer cannot identify them; this is the
 * fallback when nothing else classified the file. Binary formats are always sniffed.
 */
const TEXT_EXTENSION_MIME: Record<string, string> = {
  txt: 'text/plain',
  log: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  htm: 'text/html',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  ics: 'text/calendar',
  vcf: 'text/vcard',
};

function mimeFromExtension(fileName: string): string | null {
  const ext = /\.([A-Za-z0-9]+)$/.exec(fileName)?.[1]?.toLowerCase();
  return ext ? (TEXT_EXTENSION_MIME[ext] ?? null) : null;
}
function fail(source: string, message: string, extra?: Record<string, unknown>): never {
  throw new ValidationError('Validation failed', [{ path: [source], message, ...extra }]);
}

export { getMaxUploadBytes };

function formatLimit(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}

/** Strip path separators and control characters, cap at 255 bytes (keeping the extension). */
export function sanitizeFileName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  let name = raw.replace(/[\u0000-\u001f\u007f\u0080-\u009f]/g, '').replace(/[\\/]/g, '').trim();
  if (/^\.*$/.test(name)) return '';
  if (Buffer.byteLength(name, 'utf8') > MAX_FILE_NAME_BYTES) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : '';
    let base = ext ? name.slice(0, dot) : name;
    const budget = MAX_FILE_NAME_BYTES - Buffer.byteLength(ext, 'utf8');
    while (base.length > 0 && Buffer.byteLength(base, 'utf8') > budget) {
      base = Array.from(base).slice(0, -1).join('');
    }
    name = base + ext;
  }
  return name;
}

/** Extract `filename*=UTF-8''...` or `filename="..."` from a Content-Disposition header. */
export function fileNameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[2]!.trim());
    } catch {
      /* fall through to plain filename */
    }
  }
  const quoted = /filename\s*=\s*"((?:[^"\\]|\\.)*)"/i.exec(header);
  if (quoted) return quoted[1]!.replace(/\\(.)/g, '$1');
  const bare = /filename\s*=\s*([^;]+)/i.exec(header);
  return bare ? bare[1]!.trim() : null;
}

function fileNameFromUrlPath(rawUrl: string): string | null {
  try {
    const segments = new URL(rawUrl).pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    if (!last) return null;
    return decodeURIComponent(last);
  } catch {
    return null;
  }
}

/** Strict base64: standard alphabet, correct padding, no stray characters. Whitespace (line wrapping) is ignored. */
export function decodeBase64Strict(content: string, maxBytes: number): Buffer {
  // Length checks first: neither the whitespace strip nor the decode runs on an over-cap body.
  assertBase64EncodedWithinCap(content.length, maxBytes);
  const compact = content.replace(/[\r\n\t ]+/g, '');
  assertBase64EncodedWithinCap(content.length, maxBytes, compact.length);
  if (compact.length === 0) {
    fail('source', 'base64 content is empty');
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 !== 0) {
    fail('source', 'base64 content is not valid standard base64 (invalid characters or padding)');
  }
  const decoded = Buffer.from(compact, 'base64');
  // The encoded-length checks are only estimates (padding); the decoded size is the exact cap.
  if (decoded.length > maxBytes) throw base64TooLarge(maxBytes);
  return decoded;
}

/**
 * The type the caller (or the remote server) claims. A claim only: the ingest pipeline sniffs the
 * bytes and a sniffed type wins over this one before the allowlist judges it.
 */
function declaredMimeType(fileName: string, explicit?: string, headerType?: string | null): string {
  const declared =
    explicit?.trim() ||
    (headerType ? headerType.split(';')[0]!.trim().toLowerCase() : '') ||
    '';
  const declaredUsable = declared && declared !== GENERIC_MIME ? declared : '';
  return declaredUsable || mimeFromExtension(fileName) || GENERIC_MIME;
}

export async function resolveSource(
  input: ResolveSourceInput,
  deps: ResolveSourceDeps = {},
  tenantCtx?: ResolveSourceTenant,
): Promise<ResolvedFile> {
  const providerMax = deps.maxBytes ?? (await getMaxUploadBytes());
  const { source } = input;

  if (source.type === 'base64') {
    if (!input.fileName?.trim()) {
      fail('file_name', 'file_name is required when the source is base64');
    }
    const fileName = sanitizeFileName(input.fileName);
    if (!fileName) fail('file_name', 'file_name is not usable after sanitising');
    const bytes = decodeBase64Strict(source.content, base64SourceCap(providerMax));
    return { fileName, body: bytes, mimeType: declaredMimeType(fileName, input.mimeType) };
  }

  if (!tenantCtx) {
    throw new Error('resolveSource: a url source requires the tenant context for the download-host allowlist');
  }
  // One indexed query per request, no cache. The policy is checked before DNS and on every hop.
  const hostPolicy = createHostPolicy(await loadEffectiveFetchHosts(tenantCtx.knex, tenantCtx.tenant));

  let fetched;
  try {
    // The byte guard aborts the transfer once the provider max is exceeded (Content-Length is
    // only an early out); the timeouts bound connect and the whole download.
    fetched = await safeFetchStream(
      source.url,
      {
        maxBytes: providerMax,
        hostPolicy,
        connectTimeoutMs: deps.urlTimeouts?.connectTimeoutMs ?? URL_SOURCE_CONNECT_TIMEOUT_MS,
        totalTimeoutMs: deps.urlTimeouts?.totalTimeoutMs ?? URL_SOURCE_TOTAL_TIMEOUT_MS,
      },
      deps.fetchDeps,
    );
  } catch (error) {
    throw mapFetchError(error, tenantCtx.tenant, providerMax);
  }

  const candidate =
    (input.fileName?.trim() ? input.fileName : null) ||
    fileNameFromContentDisposition(fetched.headers.get('content-disposition')) ||
    fileNameFromUrlPath(source.url);
  const fileName = candidate ? sanitizeFileName(candidate) : '';
  if (!fileName) {
    fetched.stream.destroy();
    fail('file_name', 'Could not determine a file name from the URL; pass file_name');
  }

  return {
    fileName,
    body: fetched.stream,
    mimeType: declaredMimeType(fileName, input.mimeType, fetched.headers.get('content-type')),
  };
}

/**
 * Translate a failed fetch (before the body, or surfacing mid-stream from the ingest) into the
 * API error. `too_large` is a 413; everything else about the URL is a 400.
 */
export function mapFetchError(error: unknown, tenant: string, providerMax: number): unknown {
  if (error instanceof FetchHostNotAllowedError) {
    // Hostname only: the path/query of a signed URL is the credential.
    console.warn(
      `[documents] URL source refused: host not on the tenant download allowlist tenant=${tenant} host=${error.hostname}${error.viaRedirect ? ' (via redirect)' : ''}`,
    );
    return new FetchHostNotAllowedValidationError(error.hostname, error.viaRedirect);
  }
  if (error instanceof UnsafeUrlError) {
    return new ValidationError('Validation failed', [{ path: ['source'], message: error.message }]);
  }
  if (error instanceof UrlFetchError) {
    if (error.reason === 'too_large') {
      return new PayloadTooLargeError(`${error.message} (limit ${formatLimit(providerMax)})`, [
        { path: ['source'], message: error.message },
      ]);
    }
    return new ValidationError('Validation failed', [
      {
        path: ['source'],
        message: error.message,
        ...(error.upstreamStatus !== undefined ? { upstream_status: error.upstreamStatus } : {}),
      },
    ]);
  }
  return error;
}
