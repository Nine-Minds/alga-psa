/** MIME allowlist matching shared by validateFileUpload and the upload ingest pipeline. */
export function isMimeAllowed(allowedMimeTypes: string[], mimeType: string): boolean {
  if (allowedMimeTypes.includes('*/*')) return true;
  return allowedMimeTypes.some((allowed) => {
    if (allowed.endsWith('/*')) {
      return mimeType.startsWith(allowed.slice(0, -1));
    }
    return mimeType === allowed;
  });
}
