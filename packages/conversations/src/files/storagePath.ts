import { ConversationFileError } from './errors';
import { isConversationFileUuid } from './snapshot';

/** The storage path is derived, never accepted from a caller. */
export const conversationFilePath = (tenant: string, fileId: string): string => `conversations/${tenant}/${fileId}`;

export function assertConversationFilePath(row: { tenant: string; file_id: string; storage_path: string }): void {
  if (!isConversationFileUuid(row.tenant) || !isConversationFileUuid(row.file_id) || row.storage_path !== conversationFilePath(row.tenant, row.file_id)) {
    throw new ConversationFileError('FILE_NOT_FOUND');
  }
}
