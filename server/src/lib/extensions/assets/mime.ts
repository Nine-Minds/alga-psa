/**
 * Deprecated when EXT_UI_HOST_MODE === 'rust'. Retained for legacy mode only.
 *
 * MIME type map for legacy Next.js static serving path. The Rust host sets
 * equivalent content-types for /ext-ui responses.
 */
const map: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.txt': 'text/plain; charset=utf-8'
};

export function contentTypeFor(filename: string): string {
  // Light runtime note to discourage use in rust mode (no behavior change here).
  if ((process.env.EXT_UI_HOST_MODE || 'rust').toLowerCase() === 'rust') {
    // Avoid noisy logs during normal operation by keeping this as a debug-level hint.
    // Consumers should not be calling legacy helpers in rust mode.
    if (process.env.DEBUG?.includes('ext-ui')) {
      console.warn(JSON.stringify({
        module: 'assets/mime',
        action: 'deprecated_in_rust_mode'
      }));
    }
  }

  const i = filename.lastIndexOf('.');
  if (i < 0) return 'application/octet-stream';
  return map[filename.slice(i).toLowerCase()] || 'application/octet-stream';
}

