/**
 * The issuer logo on a label, as a `data:` URL.
 *
 * `fetchTenantParty` yields an app URL (`/api/documents/view/{file_id}?t=...`) that needs a session, and
 * the label HTML is printed by Puppeteer with no session and no base URL, so the logo would never load.
 * The PDF service therefore reads the bytes server-side and inlines them. A logo that cannot be read, is
 * too large or is not a recognised image is OMITTED (null) - never an error: a label without a logo is
 * still a correct label.
 */

export const MAX_LABEL_LOGO_BYTES = 256 * 1024;

const FILE_ID_IN_URL = /\/api\/documents\/view\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[?#]|$)/i;

export function fileIdFromLogoUrl(logoUrl: string | null | undefined): string | null {
  return (logoUrl && FILE_ID_IN_URL.exec(logoUrl)?.[1]) || null;
}

/** Sniff the real format from the bytes (the stored mime type is not trusted). */
function sniffImageMime(bytes: Buffer): string | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 6 && /^GIF8[79]a/.test(bytes.subarray(0, 6).toString('latin1'))) {
    return 'image/gif';
  }
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  const head = bytes.subarray(0, 1024).toString('utf8').trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)?(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(head)) {
    // Inside an <img>, an SVG cannot run script or load resources; still refuse anything active.
    const whole = bytes.toString('utf8');
    if (/<script|<foreignObject|\son\w+\s*=|javascript:/i.test(whole)) {
      return null;
    }
    return 'image/svg+xml';
  }
  return null;
}

/** Bytes -> `data:` URL, or null when oversized or not a whitelisted image. */
export function toLogoDataUrl(bytes: Buffer | null | undefined): string | null {
  if (!bytes || bytes.length === 0 || bytes.length > MAX_LABEL_LOGO_BYTES) {
    return null;
  }
  const mime = sniffImageMime(bytes);
  return mime ? `data:${mime};base64,${bytes.toString('base64')}` : null;
}

/**
 * Inline the logo behind `logoUrl`. `loadFile` is injected (the storage download), so this stays pure
 * and testable; any failure yields null.
 */
export async function inlineLogoDataUrl(
  logoUrl: string | null | undefined,
  loadFile: (fileId: string) => Promise<Buffer | null>
): Promise<string | null> {
  const fileId = fileIdFromLogoUrl(logoUrl);
  if (!fileId) {
    return null;
  }
  try {
    return toLogoDataUrl(await loadFile(fileId));
  } catch {
    return null;
  }
}
