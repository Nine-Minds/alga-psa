import { StorageProviderFactory } from '@alga-psa/storage/StorageProviderFactory';
import { StorageService } from '@alga-psa/storage/StorageService';
import { ConversationFileError } from './errors';
import type { ConversationFileStorage } from './types';

/** Main's file storage (the provider documents use), without `documents` rows. Server-only:
 * import this from `@alga-psa/conversations/files/storage`, never from a client bundle. */
export function createConversationFileStorage(tenant: string): ConversationFileStorage {
  return {
    async upload(path, content, mimeType) {
      // LEVERAGE: pattern conversation-object-upload — second instance of the validate/upload/confirm sequence in server/src/lib/co-managed/conversationAttachments.ts.
      try { await StorageService.validateFileUpload(tenant, mimeType, content.length); } catch { throw new ConversationFileError('INVALID_FILE'); }
      const provider = await StorageProviderFactory.createProvider();
      const result = await provider.upload(Buffer.from(content), path, { mime_type: mimeType });
      if (result.path !== path || result.size !== content.length) throw new Error('File storage did not confirm the complete object');
    },
    async download(path) {
      const provider = await StorageProviderFactory.createProvider();
      return provider.download(path);
    },
    async delete(path) {
      const provider = await StorageProviderFactory.createProvider();
      await provider.delete(path);
    },
  };
}
