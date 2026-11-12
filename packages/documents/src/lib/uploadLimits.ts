/**
 * Browser-side cap on a single uploaded file, so an oversized file is rejected
 * with a clear message before any request goes out.
 *
 * STOPGAP: this exists only because the Next proxy truncates request bodies at
 * `experimental.proxyClientMaxBodySize` and the server action then fails with an
 * opaque "Unexpected end of form". Card 7 ("retire the body caps") replaces this
 * constant with the provider's `maxFileSize` from the upload-session API (card 4).
 */

/**
 * `experimental.proxyClientMaxBodySize: '100mb'` in server/next.config.mjs.
 * Next parses that string with the `bytes` package, where 'mb' is 1024 * 1024
 * (1 << 20), so the clamp is 100 MiB = 104,857,600 bytes. Duplicated here because
 * next.config.mjs is not importable from a client bundle. Keep the two in sync.
 */
const PROXY_BODY_LIMIT_BYTES = 100 * 1024 * 1024;

/**
 * Headroom for everything in the request body besides the file bytes: multipart
 * boundaries and part headers (a few hundred bytes), the other form fields, and
 * the server-action payload carrying the upload options. Those total a few KB;
 * 1 MiB is several hundred times that, so the effective limit stays conservative,
 * and it keeps the displayed limit a round "99 MB".
 */
const MULTIPART_OVERHEAD_RESERVE_BYTES = 1024 * 1024;

/** Largest single file (in bytes) the upload UI sends: 99 MiB. */
export const MAX_UPLOAD_BYTES = PROXY_BODY_LIMIT_BYTES - MULTIPART_OVERHEAD_RESERVE_BYTES;
