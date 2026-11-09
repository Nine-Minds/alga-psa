import type { Knex } from 'knex';
import { resolveReadableFile } from './access';
import { assertConversationFileBytes } from './snapshot';
import type { ConversationFileActor, ConversationFileStorage, ConversationFileSummary } from './types';

export interface ConversationFileContent { file: ConversationFileSummary & { ownerType: string; ownerId: string }; content: Uint8Array }

/** Authorized read: access decision in a transaction, bytes after it, size and hash verified. */
export async function readConversationFile(db: Knex, actor: ConversationFileActor, fileId: string, storage: ConversationFileStorage): Promise<ConversationFileContent> {
  const row = await db.transaction(trx => resolveReadableFile(trx, actor, fileId));
  const content = await storage.download(row.storage_path);
  assertConversationFileBytes(content, { size: Number(row.file_size), contentHash: row.content_hash });
  return {
    file: { fileId: row.file_id, fileName: row.file_name, mimeType: row.mime_type, size: Number(row.file_size), contentHash: row.content_hash, ownerType: row.owner_type, ownerId: row.owner_id },
    content,
  };
}
