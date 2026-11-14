import { fileTypeFromBuffer, supportedMimeTypes } from 'file-type';
import { isMimeAllowed } from '../config/storage-mime';
import { UploadContentTypeError } from './errors';

/** Text and XML formats are matched by file-type only when a recognisable header is present. */
function isTextual(mime: string): boolean {
  return mime.startsWith('text/') || mime === 'application/xml' || mime.endsWith('+xml') || mime.endsWith('+json');
}

/**
 * True if file-type has a signature for the declared type, so bytes matching nothing are evidence
 * of a mismatch. Types it has no signature for (message/rfc822, S/MIME, PGP, vendor types, plain
 * text, CSV, JSON, SVG, octet-stream...) can never be detected, so their absence proves nothing.
 * Textual formats are exempt even when file-type knows one by header (ics, vcard, xml).
 */
export function isDetectableDeclaredType(mime: string): boolean {
  const m = mime.toLowerCase();
  return supportedMimeTypes.has(m as never) && !isTextual(m);
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

const GENERIC_MIME = 'application/octet-stream';

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
 *  2. Nothing matched: reject only if the declared type is one file-type could have recognised
 *     (it is in supportedMimeTypes; a declared image/png, video/mp4 or application/pdf whose bytes
 *     match nothing). Otherwise fall back to the declared type, which must be allowlisted.
 *
 * An empty stream has no bytes to contradict the declaration: only the allowlist applies.
 *
 * `allowedMimeTypes` null means no allowlist applies (system artifacts never reach here).
 */
export function resolveUploadMime(
  declaredMime: string,
  detectedMime: string | undefined,
  allowedMimeTypes: string[] | null,
  { empty = false }: { empty?: boolean } = {}
): ResolvedUploadMime {
  const allowed = (mime: string) => allowedMimeTypes === null || isMimeAllowed(allowedMimeTypes, mime);
  const reject = (why: string) => new UploadContentTypeError(why, declaredMime, detectedMime);
  const declared = declaredMime.toLowerCase();
  const detected = detectedMime?.toLowerCase();

  if (empty) {
    if (!allowed(declared)) throw reject('File type not allowed');
    return { mime: declaredMime, source: 'declared' };
  }

  if (detected && !isTextual(detected)) {
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

  if (isDetectableDeclaredType(declared)) {
    throw reject(`File content does not match the declared type ${declaredMime}`);
  }
  if (!allowed(declared)) throw reject('File type not allowed');
  return { mime: declaredMime, source: 'declared' };
}

/**
 * Resolves the type of an already-stored object whose declared type is unknown (null in the row),
 * by sniffing its bytes, through the same rule as an upload. Types that file-type cannot recognise
 * fall back to application/octet-stream, which the allowlist then judges.
 */
export async function resolveMimeForBuffer(
  declaredMime: string | null,
  content: Buffer,
  allowedMimeTypes: string[] | null,
): Promise<ResolvedUploadMime> {
  const detected = (await fileTypeFromBuffer(new Uint8Array(content)))?.mime;
  return resolveUploadMime(declaredMime || GENERIC_MIME, detected, allowedMimeTypes, { empty: content.length === 0 });
}
