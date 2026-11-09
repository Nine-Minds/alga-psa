/** Conversation file limits. Client-safe: no node or server imports. The DB CHECKs in
 * 20261109120000_create_conversation_files.cjs enforce the same bounds. */
export const CONVERSATION_FILE_MAX_BYTES = 26_214_400; // 25 MiB, per file
export const CONVERSATION_FILE_MAX_COUNT = 20; // files per publication
export const CONVERSATION_FILE_NAME_MAX_LENGTH = 255;
export const CONVERSATION_FILE_MIME_MAX_LENGTH = 127;
export const CONVERSATION_FILE_RETENTION_DAYS = 7;
export const CONVERSATION_FILE_CLEANUP_MAX_BATCH = 500;
const BODY_ENVELOPE_BYTES = 64 * 1024;

/** The largest file a server-action body limit (e.g. '20mb') can carry: the limit minus a
 * 64 KiB envelope for multipart headers and arguments, capped at the per-file maximum. */
// LEVERAGE: pattern conversation-file-engine — port of server/src/lib/co-managed/attachmentUploadLimit.ts; converge when co-managed attachments move onto this engine.
export function conversationFileUploadLimit(bodyLimit: string = process.env.SERVER_ACTIONS_BODY_LIMIT || '20mb'): number {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb|pb)?\s*$/i.exec(bodyLimit);
  if (!match) return 0;
  const units: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4, pb: 1024 ** 5 };
  const bytes = Number(match[1]) * units[(match[2] || 'b').toLowerCase()];
  return Number.isFinite(bytes) ? Math.max(0, Math.min(CONVERSATION_FILE_MAX_BYTES, Math.floor(bytes) - BODY_ENVELOPE_BYTES)) : 0;
}
