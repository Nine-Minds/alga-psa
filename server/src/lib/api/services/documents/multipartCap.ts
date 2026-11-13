/**
 * The one place a multipart upload request is bounded.
 *
 * `req.formData()` reads the whole request body into memory before a handler sees the file part,
 * and the proxy layer in front of route handlers carries at most 100 MB
 * (`proxyClientMaxBodySize` in next.config.mjs). So multipart is an explicitly buffered path, and
 * the ingest's byte counter cannot bound it: the request has to be bounded *before* `formData()`
 * runs, from its declared Content-Length. A request that declares none (chunked) cannot be
 * bounded that way and is refused with 411. Once parsed, the file part is streamed into the ingest
 * (no second copy), and the ingest alone enforces the provider's per-file max and MIME allowlist.
 * Larger files belong on the chunked upload session API.
 */
import { NEXT_PROXY_MAX_BODY_BYTES, effectiveBufferedCap } from '@alga-psa/storage/ingest/bufferedCap';
import { LengthRequiredError, PayloadTooLargeError } from '../../middleware/apiErrors';
import { getMaxUploadBytes } from './uploadLimits';

/** Whole multipart request (file plus framing): Next's proxyClientMaxBodySize. */
export const MAX_MULTIPART_REQUEST_BYTES = NEXT_PROXY_MAX_BODY_BYTES;

/** Room for multipart boundaries, part headers and the small non-file form fields. */
export const MULTIPART_ENVELOPE_BYTES = 64 * 1024;

/**
 * Largest whole request: the transport cap, or (when the provider max is lower) the provider max
 * plus the envelope, so a file exactly at the provider max still gets through to the ingest, which
 * enforces the per-file limit.
 */
export function multipartRequestCap(providerMax: number): number {
  return effectiveBufferedCap(
    MAX_MULTIPART_REQUEST_BYTES,
    providerMax + MULTIPART_ENVELOPE_BYTES,
    'MAX_MULTIPART_REQUEST_BYTES',
  );
}

/**
 * Before the body is read: 411 when there is no numeric Content-Length (the body could not be
 * bounded), 413 when it is over the request cap.
 */
export async function assertMultipartRequestWithinCap(
  req: { headers: { get(name: string): string | null } },
  providerMax?: number,
): Promise<void> {
  const cap = multipartRequestCap(providerMax ?? (await getMaxUploadBytes()));
  const declared = req.headers.get('content-length');
  const mb = Math.floor(cap / (1024 * 1024));
  if (declared === null || !/^\d+$/.test(declared.trim())) {
    throw new LengthRequiredError(
      `Multipart uploads must declare a Content-Length (at most ${mb} MB). For larger files, or a streaming client, use the chunked upload session API (POST /api/documents/uploads, then PUT chunks and POST .../complete).`,
      [{ path: ['file'], message: 'Content-Length header is required' }],
    );
  }
  if (Number(declared) <= cap) return;
  throw new PayloadTooLargeError(
    `Multipart uploads are limited to ${mb} MB per request. For larger files use the chunked upload session API (POST /api/documents/uploads, then PUT chunks and POST .../complete).`,
    [{ path: ['file'], message: `request exceeds ${mb} MB` }],
  );
}
