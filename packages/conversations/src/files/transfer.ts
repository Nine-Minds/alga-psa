import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { ConversationFileError } from './errors';
import { assertActor, assertOwnerAccess, FILES } from './access';
import { assertConversationFileBytes, isConversationFileUuid, sha256Hex, snapshotConversationFile, type ConversationFileSnapshot } from './snapshot';
import { assertConversationFilePath, conversationFilePath } from './storagePath';
import type { ConversationFileActor, ConversationFileOwner, ConversationFileRow, ConversationFileStorage, ConversationFileSummary } from './types';

export interface ConversationFileUpload { fileId: string; fileName: string; mimeType: string; content: Uint8Array }
/** Internal binding for a publication copy: set by publication.ts, never by callers. */
export interface ConversationFileCopyBinding { publicationOperationId: string; sourceFileId: string }

const summary = (row: ConversationFileRow): ConversationFileSummary => ({
  fileId: row.file_id, fileName: row.file_name, mimeType: row.mime_type, size: Number(row.file_size), contentHash: row.content_hash,
});

/** Reserve → upload outside any row lock → mark ready. The request hash binds a file id to one
 * exact request, so a retry is safe and an id can never be reused for different bytes.
 * Transport only: the caller has already decided the actor may write the owner. */
// LEVERAGE: pattern conversation-file-engine — same reserve/upload/ready state machine as transferAuthorizedCoManagedAttachment in packages/co-managed/src/conversationAttachments.ts; converge when co-managed attachments move onto this engine.
export async function transferConversationFile(db: Knex, actorInput: ConversationFileActor, ownerInput: ConversationFileOwner, upload: ConversationFileUpload,
  storage: ConversationFileStorage, binding?: ConversationFileCopyBinding): Promise<ConversationFileSummary> {
  if ((db as Knex.Transaction).isTransaction) throw new ConversationFileError('INVALID_FILE');
  const actor = assertActor(actorInput);
  if (!isConversationFileUuid(upload?.fileId) || !isConversationFileUuid(ownerInput?.ownerId)) throw new ConversationFileError('INVALID_FILE');
  const snap: ConversationFileSnapshot = snapshotConversationFile(upload);
  const fileId = upload.fileId.toLowerCase(), ownerId = ownerInput.ownerId.toLowerCase();
  const conversationId = ownerInput.conversationId?.toLowerCase() ?? null;
  const path = conversationFilePath(actor.tenant, fileId);
  const requestHash = sha256Hex(JSON.stringify({ actor, owner: { ownerType: ownerInput.ownerType, ownerId, conversationId }, fileId,
    fileName: snap.fileName, mimeType: snap.mimeType, contentHash: snap.contentHash, size: snap.size, binding: binding ?? null }));
  const conflict = (): never => { throw new ConversationFileError('FILE_OPERATION_CONFLICT'); };

  const reserved = await db.transaction(async trx => {
    const owner = tenantDb(trx, actor.tenant);
    await owner.table(FILES).insert({
      tenant: actor.tenant, file_id: fileId, owner_type: ownerInput.ownerType, owner_id: ownerId, conversation_id: conversationId, actor_user_id: actor.userId,
      file_name: snap.fileName, mime_type: snap.mimeType, file_size: snap.size, content_hash: snap.contentHash, request_hash: requestHash, storage_path: path,
      status: 'pending', publication_operation_id: binding?.publicationOperationId ?? null, source_file_id: binding?.sourceFileId ?? null,
    }).onConflict(['tenant', 'file_id']).ignore();
    const row = await owner.table<ConversationFileRow>(FILES).where('file_id', fileId).forUpdate().first();
    if (!row || row.discarded_at || row.request_hash !== requestHash) return conflict();
    assertConversationFilePath(row);
    return row;
  });
  if (reserved.status === 'ready') return summary(reserved);

  await storage.upload(path, snap.content, snap.mimeType);
  // Citus forbids volatile functions in UPDATE, so the wall clock is bound, not `now()`.
  const readyAt = new Date();
  return db.transaction(async trx => {
    const owner = tenantDb(trx, actor.tenant);
    const row = await owner.table<ConversationFileRow>(FILES).where('file_id', fileId).forUpdate().first();
    if (!row || row.discarded_at || row.request_hash !== requestHash) return conflict();
    if (row.status !== 'ready') await owner.table(FILES).where('file_id', fileId).update({ status: 'ready', ready_at: readyAt, last_activity_at: readyAt });
    return summary({ ...row, status: 'ready' });
  });
}

/** Stage a file on an owning record (a draft attachment). Requires write authority on the owner. */
export async function uploadConversationFile(db: Knex, actorInput: ConversationFileActor, owner: ConversationFileOwner, upload: ConversationFileUpload,
  storage: ConversationFileStorage): Promise<ConversationFileSummary> {
  const actor = assertActor(actorInput);
  await db.transaction(trx => assertOwnerAccess(trx, actor, owner, 'write'));
  return transferConversationFile(db, actor, owner, upload, storage);
}

export { assertConversationFileBytes };
