import { isMimeAllowed } from '../config/storage-mime';
import { UploadContentTypeError } from './errors';

/**
 * Declared types `file-type` cannot detect because the format has no magic bytes
 * (plain text, CSV, JSON, SVG, HTML, ...), plus generic binary. Only these may be
 * stored on the strength of the client's declaration alone.
 */
const UNDETECTABLE_EXACT = new Set([
  'application/json',
  'application/ld+json',
  'application/x-ndjson',
  'application/xml',
  'application/javascript',
  'application/x-javascript',
  'application/x-yaml',
  'application/yaml',
  'application/x-sh',
  'application/sql',
  'application/csv',
  'application/octet-stream',
  'image/svg+xml',
]);

export function isUndetectableDeclaredType(mime: string): boolean {
  const m = mime.toLowerCase();
  return m.startsWith('text/') || UNDETECTABLE_EXACT.has(m) || m.endsWith('+xml') || m.endsWith('+json');
}

/**
 * file-type reports a family for these containers; the real document type
 * (e.g. .doc is a CFB file) is only knowable from the declaration, so a declared
 * type belonging to the family is accepted.
 */
const CONTAINER_FAMILIES: Record<string, RegExp> = {
  'application/x-cfb': /^application\/(msword|vnd\.ms-[a-z0-9.-]+|x-msi)$/,
  'application/zip': /^application\/(vnd\.openxmlformats-officedocument\.[a-z0-9.+-]+|vnd\.oasis\.opendocument\.[a-z0-9.+-]+|epub\+zip|x-zip-compressed)$/,
};

export interface ResolvedUploadMime {
  /** MIME to store on the object and the file_stores row. */
  mime: string;
  source: 'detected' | 'declared';
}

/**
 * The single rule deciding which MIME an upload is stored as, and whether it is accepted.
 *
 *  1. Bytes matched a type (and it is not a generic text/xml match): the detected type must be
 *     on the allowlist and is what we store. Exception: a container family (zip, CFB) whose
 *     declared type belongs to that family stores the declared type, which must be allowlisted.
 *  2. Nothing matched: fall back to the declared type, but only if it is a type file-type
 *     cannot detect anyway (text, CSV, JSON, SVG, octet-stream...). A declared image/png or
 *     video/mp4 whose bytes match nothing is rejected, as is a declared type not on the allowlist.
 *
 * `allowedMimeTypes` null means no allowlist applies (system artifacts never reach here).
 */
export function resolveUploadMime(
  declaredMime: string,
  detectedMime: string | undefined,
  allowedMimeTypes: string[] | null
): ResolvedUploadMime {
  const allowed = (mime: string) => allowedMimeTypes === null || isMimeAllowed(allowedMimeTypes, mime);
  const reject = (why: string) => new UploadContentTypeError(why, declaredMime, detectedMime);
  const declared = declaredMime.toLowerCase();
  const detected = detectedMime?.toLowerCase();

  if (detected && !isUndetectableDeclaredType(detected)) {
    const family = CONTAINER_FAMILIES[detected];
    if (family && family.test(declared)) {
      if (!allowed(declared)) throw reject('File type not allowed');
      return { mime: declared, source: 'declared' };
    }
    if (!allowed(detected)) {
      throw reject(`File content (${detected}) is not an allowed file type`);
    }
    return { mime: detected, source: 'detected' };
  }

  if (!isUndetectableDeclaredType(declared)) {
    throw reject(`File content does not match the declared type ${declaredMime}`);
  }
  if (!allowed(declared)) throw reject('File type not allowed');
  return { mime: declaredMime, source: 'declared' };
}
