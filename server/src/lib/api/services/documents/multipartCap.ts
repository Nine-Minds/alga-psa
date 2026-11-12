/**
 * The one place a multipart upload request is bounded.
 *
 * `req.formData()` reads the whole request body into memory before a handler sees the file part,
 * and the proxy layer in front of route handlers carries at most 100 MB
 * (`proxyClientMaxBodySize` in next.config.mjs). So multipart is an explicitly buffered path: the
 * file is streamed from that parsed part into the ingest (no second copy, one validator), but the
 * request itself is capped here. Larger files belong on the chunked upload session API.
 */
import { effectiveBufferedCap } from '@alga-psa/storage/ingest/bufferedCap';
import { PayloadTooLargeError } from '../../middleware/apiErrors';
import { getMaxUploadBytes } from './resolveSource';

/** Whole multipart request (file plus framing), equal to Next's proxyClientMaxBodySize. */
export const MAX_MULTIPART_REQUEST_BYTES = 100 * 1024 * 1024;

/**
 * 413 before the body is read when the declared Content-Length is over the cap. A request with
 * no Content-Length (chunked) cannot be pre-checked; the ingest's byte counter still bounds the file.
 */
export async function assertMultipartRequestWithinCap(
  req: { headers: { get(name: string): string | null } },
  providerMax?: number,
): Promise<void> {
  const cap = effectiveBufferedCap(MAX_MULTIPART_REQUEST_BYTES, providerMax ?? (await getMaxUploadBytes()));
  const declared = req.headers.get('content-length');
  if (declared === null || !/^\d+$/.test(declared) || Number(declared) <= cap) return;
  const mb = Math.floor(cap / (1024 * 1024));
  throw new PayloadTooLargeError(
    `Multipart uploads are limited to ${mb} MB per request. For larger files use the chunked upload session API (POST /api/documents/uploads, then PUT chunks and POST .../complete).`,
    [{ path: ['file'], message: `request exceeds ${mb} MB` }],
  );
}
