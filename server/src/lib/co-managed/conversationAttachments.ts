import { uploadConversationAttachmentObject } from '@alga-psa/tickets/lib/conversationFileStorage';
import { StorageProviderFactory } from '@alga-psa/storage/StorageProviderFactory';
import { uploadCoManagedConversationAttachment, downloadCoManagedConversationAttachment } from '@alga-psa/co-managed';
import type { CoManagedAttachmentUpload, CoManagedAttachmentReference, CoManagedSharedResource, CoManagedSessionActor } from '@alga-psa/co-managed';
import type { Knex } from 'knex';

export async function uploadConversationAttachment(db: Knex, actor: CoManagedSessionActor, resource: CoManagedSharedResource, request: CoManagedAttachmentUpload) {
  const storeTenant = request.comment.storeTenant;
  return uploadCoManagedConversationAttachment(db, actor, resource, request, async (path, content, mimeType) => {
    await uploadConversationAttachmentObject(storeTenant, path, content, mimeType);
  });
}
export async function downloadConversationAttachment(db: Knex, actor: CoManagedSessionActor, resource: CoManagedSharedResource, reference: CoManagedAttachmentReference) {
  return downloadCoManagedConversationAttachment(db, actor, resource, reference, async path => {
    const provider = await StorageProviderFactory.createProvider();
    return provider.download(path);
  });
}

export { uploadConversationAttachmentObject } from '@alga-psa/tickets/lib/conversationFileStorage';
