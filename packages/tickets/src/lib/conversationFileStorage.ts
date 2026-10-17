import { StorageProviderFactory } from '@alga-psa/storage/StorageProviderFactory';
import { StorageService } from '@alga-psa/storage/StorageService';
import { CoManagedAttachmentError, type NamedConversationFileStorage } from '@alga-psa/co-managed';

/** Store policy and exact provider acknowledgment apply equally to draft uploads
 * and destination copies. Protected files never create generic document rows. */
export async function uploadConversationAttachmentObject(storeTenant: string, path: string, content: Uint8Array, mimeType: string) {
  try { await StorageService.validateFileUpload(storeTenant, mimeType, content.length); } catch { throw new CoManagedAttachmentError('INVALID_ATTACHMENT'); }
  const provider = await StorageProviderFactory.createProvider();
  const result = await provider.upload(Buffer.from(content), path, { mime_type: mimeType });
  if (result.path !== path || result.size !== content.length) throw new Error('Attachment storage did not confirm the complete object');
}
export const namedConversationFileStorage: NamedConversationFileStorage = {
  upload: uploadConversationAttachmentObject,
  async download(path) { return (await StorageProviderFactory.createProvider()).download(path); },
};
