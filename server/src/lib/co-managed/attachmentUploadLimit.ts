import { serverActionFileLimitBytes } from '@alga-psa/storage/ingest/bufferedCap';

/** Ceiling on a co-managed attachment, however high SERVER_ACTIONS_BODY_LIMIT is set. */
export const CO_MANAGED_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Largest co-managed attachment: the shared server-action file limit (SERVER_ACTIONS_BODY_LIMIT less
 * the multipart envelope), clamped to 25 MiB. Throws on an unparseable SERVER_ACTIONS_BODY_LIMIT.
 */
export function coManagedAttachmentUploadLimit(bodyLimit?: string): number {
  const actionLimit = bodyLimit === undefined ? serverActionFileLimitBytes() : serverActionFileLimitBytes(bodyLimit);
  return Math.min(CO_MANAGED_ATTACHMENT_MAX_BYTES, actionLimit);
}
