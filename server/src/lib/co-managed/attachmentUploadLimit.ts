import { serverActionFileLimitBytes } from '@alga-psa/storage/ingest/bufferedCap';

/**
 * Largest co-managed attachment: the shared server-action file limit (SERVER_ACTIONS_BODY_LIMIT less
 * the multipart envelope, clamped to 25 MiB). Throws on an unparseable SERVER_ACTIONS_BODY_LIMIT.
 */
export function coManagedAttachmentUploadLimit(bodyLimit?: string): number {
  return bodyLimit === undefined ? serverActionFileLimitBytes() : serverActionFileLimitBytes(bodyLimit);
}
