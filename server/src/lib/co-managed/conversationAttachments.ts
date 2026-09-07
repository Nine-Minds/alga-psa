import { StorageProviderFactory } from '@alga-psa/storage/StorageProviderFactory';
import { StorageService } from '@alga-psa/storage/StorageService';
import { uploadCoManagedConversationAttachment, downloadCoManagedConversationAttachment, CoManagedAttachmentError } from '@alga-psa/co-managed';
import type { CoManagedAttachmentUpload, CoManagedAttachmentReference, CoManagedSharedResource, CoManagedSessionActor } from '@alga-psa/co-managed';
import type { Knex } from 'knex';

export async function uploadConversationAttachment(db: Knex, actor: CoManagedSessionActor, resource: CoManagedSharedResource, request: CoManagedAttachmentUpload) {
  const storeTenant = request.comment.storeTenant;
  return uploadCoManagedConversationAttachment(db, actor, resource, request, async (path, content, mimeType) => {
    try { await StorageService.validateFileUpload(storeTenant, mimeType, content.length); } catch { throw new CoManagedAttachmentError('INVALID_ATTACHMENT'); }
    const provider = await StorageProviderFactory.createProvider();
    const result = await provider.upload(Buffer.from(content), path, { mime_type: mimeType });
    if (result.path !== path || result.size !== content.length) throw new Error('Attachment storage did not confirm the complete object');
  });
}
export async function downloadConversationAttachment(db: Knex, actor: CoManagedSessionActor, resource: CoManagedSharedResource, reference: CoManagedAttachmentReference) {
  return downloadCoManagedConversationAttachment(db, actor, resource, reference, async path => {
    const provider = await StorageProviderFactory.createProvider();
    return provider.download(path);
  });
}
