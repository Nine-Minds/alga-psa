import { fileTypeFromBuffer } from 'file-type';
import type { AttachmentDocument } from './types';

export interface EffectiveMime {
  mime: string;
  /** Set when the stored type was wrong (or missing) and the bytes decided. */
  note: string | null;
}

const GENERIC_STORED = new Set(['', 'application/octet-stream', 'binary/octet-stream', 'application/x-unknown']);
/** Container formats that file-type reports when it cannot see the specific format inside. */
const GENERIC_DETECTED = new Set(['application/zip', 'application/x-cfb', 'application/x-ms-installer']);

const EXTENSION_TYPES: Record<string, string> = {
  txt: 'text/plain',
  log: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  htm: 'text/html',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  bmp: 'image/bmp',
  heic: 'image/heic',
  heif: 'image/heif',
};

function normalize(mime: string | null | undefined): string {
  return (mime ?? '').split(';')[0].trim().toLowerCase();
}

function fromExtension(name: string): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  return ext ? (EXTENSION_TYPES[ext] ?? null) : null;
}

/**
 * The type the engine dispatches on: the stored `mime_type`, corrected by a `file-type` sniff of the
 * first 4 KiB when it is missing, `application/octet-stream`, or contradicts the bytes (phone uploads
 * arrive as octet-stream; HEIC is often labelled JPEG). Text formats have no magic bytes, so a stored
 * text type is never overridden, and a missing one falls back to the file extension.
 */
export async function resolveEffectiveMime(document: AttachmentDocument, bytes: Buffer): Promise<EffectiveMime> {
  const stored = normalize(document.mime_type);
  let detected: string | null = null;
  try {
    detected = normalize((await fileTypeFromBuffer(bytes.subarray(0, 4096)))?.mime) || null;
  } catch {
    detected = null;
  }

  if (GENERIC_STORED.has(stored)) {
    const mime = detected && !GENERIC_DETECTED.has(detected) ? detected : fromExtension(document.document_name) ?? detected ?? 'application/octet-stream';
    return { mime, note: stored ? `stored type ${stored}; detected ${mime}` : null };
  }
  if (detected && !GENERIC_DETECTED.has(detected) && detected !== stored) {
    return { mime: detected, note: `stored type ${stored}; detected ${detected}` };
  }
  return { mime: stored, note: null };
}
