/** The bare, lowercased media type: "Image/PNG; charset=x" -> "image/png". */
function normalizeMime(mimeType: string): string {
  return mimeType.split(';')[0]!.trim().toLowerCase();
}

/**
 * MIME allowlist matching shared by validateFileUpload and the upload ingest pipeline.
 * Case-insensitive and ignores `;` parameters, so a header value matches the same as a bare type.
 */
export function isMimeAllowed(allowedMimeTypes: string[], mimeType: string): boolean {
  const allowedList = allowedMimeTypes.map(normalizeMime);
  if (allowedList.includes('*/*')) return true;
  const mime = normalizeMime(mimeType);
  return allowedList.some((allowed) => {
    if (allowed.endsWith('/*')) {
      return mime.startsWith(allowed.slice(0, -1));
    }
    return mime === allowed;
  });
}
