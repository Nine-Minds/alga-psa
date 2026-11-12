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

/** The cap a buffering path may advertise and enforce: its own named cap, clamped to the provider max. */
export function effectiveBufferedCap(namedCap: number, providerMaxFileSize: number): number {
  return Math.min(namedCap, providerMaxFileSize);
}

/** Throws the ingest pipeline's size error (413, "File size exceeds limit of N bytes") past `cap`. */
export function assertWithinBufferedCap(size: number, cap: number): void {
  if (size > cap) throw new UploadSizeLimitError(cap);
}

const UNIT_BYTES: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 };

/** Parses a Next-style size string ("20mb", "1.5gb", "4096"); null when it is not one. */
export function parseByteSize(value: string): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?\s*$/i.exec(value);
  if (!match) return null;
  const bytes = Number(match[1]) * UNIT_BYTES[(match[2] || 'b').toLowerCase()]!;
  return Number.isFinite(bytes) ? Math.floor(bytes) : null;
}

/** Room reserved for multipart framing and the action's other (serialized) arguments. */
export const SERVER_ACTION_ENVELOPE_BYTES = 64 * 1024;

/**
 * The largest file a server action can receive: Next's `bodySizeLimit` (SERVER_ACTIONS_BODY_LIMIT,
 * default 20mb, see next.config.mjs) less the envelope. Next rejects an oversized action before
 * its handler runs, so a larger cap would be advertised but never reachable.
 */
// LEVERAGE: pattern server-action-file-limit — kbImportLimits.ts hardcodes the 20mb default and coManagedAttachmentUploadLimit re-parses the env; both could use this.
export function serverActionFileLimitBytes(bodyLimit: string = process.env.SERVER_ACTIONS_BODY_LIMIT || '20mb'): number {
  const bytes = parseByteSize(bodyLimit) ?? parseByteSize('20mb')!;
  return Math.max(0, bytes - SERVER_ACTION_ENVELOPE_BYTES);
}
