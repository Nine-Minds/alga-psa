import type { Knex } from 'knex';
import { resolveReadableFile } from './access';
import { ConversationFileError } from './errors';
import { assertConversationFileBytes, isConversationFileUuid } from './snapshot';
import type { ConversationFileActor, ConversationFileRow, ConversationFileStorage } from './types';

/** The only file shape an email payload carries: no path, URL or bytes. */
export interface ConversationFileDescriptor { tenant: string; fileId: string; fileName: string; mimeType: string; size: number; contentHash: string }

export const describeConversationFile = (row: Pick<ConversationFileRow, 'tenant' | 'file_id' | 'file_name' | 'mime_type' | 'file_size' | 'content_hash'>): ConversationFileDescriptor => ({
  tenant: row.tenant, fileId: row.file_id, fileName: row.file_name, mimeType: row.mime_type, size: Number(row.file_size), contentHash: row.content_hash,
});

/** A retained descriptor is not a standing capability: the row is re-read under the CURRENT
 * authority, the path is derived, and bytes are verified against the descriptor's digest. */
export async function rehydrateConversationFile(db: Knex, descriptor: ConversationFileDescriptor, storage: ConversationFileStorage, authority: ConversationFileActor): Promise<{ descriptor: ConversationFileDescriptor; content: Uint8Array }> {
  if (!descriptor || descriptor.tenant !== authority?.tenant || !isConversationFileUuid(descriptor.fileId)) throw new ConversationFileError('FILE_NOT_FOUND');
  const row = await db.transaction(trx => resolveReadableFile(trx, authority, descriptor.fileId));
  const current = describeConversationFile(row);
  if (current.contentHash !== descriptor.contentHash || current.size !== descriptor.size || current.fileName !== descriptor.fileName || current.mimeType !== descriptor.mimeType) throw new ConversationFileError('FILE_CONTENT_MISMATCH');
  const content = await storage.download(row.storage_path);
  assertConversationFileBytes(content, descriptor);
  return { descriptor: current, content };
}
