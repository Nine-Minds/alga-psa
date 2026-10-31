/** Reserve space for multipart headers and the action's qualified arguments.
 * Next rejects an oversized action before its handler can return a typed error. */
export function coManagedAttachmentUploadLimit(bodyLimit = process.env.SERVER_ACTIONS_BODY_LIMIT || '20mb'): number {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb|pb)?\s*$/i.exec(bodyLimit);
  if (!match) return 0;
  const units: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4, pb: 1024 ** 5 };
  const bytes = Number(match[1]) * units[(match[2] || 'b').toLowerCase()];
  return Number.isFinite(bytes) ? Math.max(0, Math.min(26214400, Math.floor(bytes) - 65536)) : 0;
}
