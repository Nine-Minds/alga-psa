/**
 * Turns the request `source` (url | base64) into `{ bytes, fileName, mimeType }`
 * for the upload core. All failures are ValidationErrors (HTTP 400) whose
 * messages name the cause but never echo a URL path/query (signed URLs are
 * credentials).
 */
import { fileTypeFromBuffer } from 'file-type';
import { getStorageConfig } from '@alga-psa/storage/config/storage';
import { ValidationError } from '../../middleware/apiMiddleware';
import type { Knex } from 'knex';
import {
  FetchHostNotAllowedError,
  UnsafeUrlError,
  UrlFetchError,
  createHostPolicy,
  safeFetch,
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
  bytes: Buffer;
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
  /** Override the size cap (tests). Defaults to the default storage provider's maxFileSize. */
  maxBytes?: number;
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
/** Sniffed container formats that many specific types (docx, xlsx, doc, ...) share; a declared type is more precise. */
const CONTAINER_SNIFF_TYPES = new Set(['application/zip', 'application/x-cfb']);

function fail(source: string, message: string, extra?: Record<string, unknown>): never {
  throw new ValidationError('Validation failed', [{ path: [source], message, ...extra }]);
}

export async function getMaxUploadBytes(): Promise<number> {
  const config = await getStorageConfig();
  return config.providers[config.defaultProvider].maxFileSize;
}

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
  const compact = content.replace(/[\r\n\t ]+/g, '');
  if (compact.length === 0) {
    fail('source', 'base64 content is empty');
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 !== 0) {
    fail('source', 'base64 content is not valid standard base64 (invalid characters or padding)');
  }
  const decodedEstimate = Math.ceil((compact.length * 3) / 4);
  if (decodedEstimate > maxBytes) {
    fail('source', `File size exceeds limit of ${formatLimit(maxBytes)}`);
  }
  return Buffer.from(compact, 'base64');
}

async function sniffMime(bytes: Buffer): Promise<string | null> {
  try {
    const detected = await fileTypeFromBuffer(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    return detected?.mime ?? null;
  } catch {
    return null;
  }
}

/**
 * Decide the MIME type. The bytes win over claims: a sniffed type overrides a declared
 * or Content-Type value so the storage allowlist judges what the file actually is.
 * (Generic container sniffs such as zip yield to a more specific declared type.)
 */
async function resolveMimeType(
  bytes: Buffer,
  fileName: string,
  explicit?: string,
  headerType?: string | null,
): Promise<string> {
  const declared =
    explicit?.trim() ||
    (headerType ? headerType.split(';')[0]!.trim().toLowerCase() : '') ||
    '';
  const declaredUsable = declared && declared !== GENERIC_MIME ? declared : '';
  const sniffed = await sniffMime(bytes);
  if (sniffed && !(CONTAINER_SNIFF_TYPES.has(sniffed) && declaredUsable)) return sniffed;
  return declaredUsable || mimeFromExtension(fileName) || GENERIC_MIME;
}

export async function resolveSource(
  input: ResolveSourceInput,
  deps: ResolveSourceDeps = {},
  tenantCtx?: ResolveSourceTenant,
): Promise<ResolvedFile> {
  const maxBytes = deps.maxBytes ?? (await getMaxUploadBytes());
  const { source } = input;

  if (source.type === 'base64') {
    if (!input.fileName?.trim()) {
      fail('file_name', 'file_name is required when the source is base64');
    }
    const fileName = sanitizeFileName(input.fileName);
    if (!fileName) fail('file_name', 'file_name is not usable after sanitising');
    const bytes = decodeBase64Strict(source.content, maxBytes);
    return { fileName, bytes, mimeType: await resolveMimeType(bytes, fileName, input.mimeType) };
  }

  if (!tenantCtx) {
    throw new Error('resolveSource: a url source requires the tenant context for the download-host allowlist');
  }
  // One indexed query per request, no cache. The policy is checked before DNS and on every hop.
  const hostPolicy = createHostPolicy(await loadEffectiveFetchHosts(tenantCtx.knex, tenantCtx.tenant));

  let fetched;
  try {
    fetched = await safeFetch(source.url, { maxBytes, hostPolicy }, deps.fetchDeps);
  } catch (error) {
    if (error instanceof FetchHostNotAllowedError) {
      // Hostname only: the path/query of a signed URL is the credential.
      console.warn(
        `[documents] URL source refused: host not on the tenant download allowlist tenant=${tenantCtx.tenant} host=${error.hostname}${error.viaRedirect ? ' (via redirect)' : ''}`,
      );
      throw new FetchHostNotAllowedValidationError(error.hostname, error.viaRedirect);
    }
    if (error instanceof UnsafeUrlError) fail('source', error.message);
    if (error instanceof UrlFetchError) {
      fail(
        'source',
        error.reason === 'too_large' ? `${error.message} (limit ${formatLimit(maxBytes)})` : error.message,
        error.upstreamStatus !== undefined ? { upstream_status: error.upstreamStatus } : undefined,
      );
    }
    throw error;
  }

  const candidate =
    (input.fileName?.trim() ? input.fileName : null) ||
    fileNameFromContentDisposition(fetched.headers.get('content-disposition')) ||
    fileNameFromUrlPath(source.url);
  const fileName = candidate ? sanitizeFileName(candidate) : '';
  if (!fileName) {
    fail('file_name', 'Could not determine a file name from the URL; pass file_name');
  }

  return {
    fileName,
    bytes: fetched.bytes,
    mimeType: await resolveMimeType(fetched.bytes, fileName, input.mimeType, fetched.headers.get('content-type')),
  };
}
