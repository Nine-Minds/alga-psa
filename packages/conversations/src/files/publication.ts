import type { Knex } from 'knex';
import { v5 as uuidv5 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { CONVERSATION_FILE_MAX_COUNT } from '../limits';
import { ConversationFileError } from './errors';
import { assertActor, assertOwnerAccess, FILES, PUBLICATIONS, resolveReadableFile } from './access';
import { assertConversationFileBytes, isConversationFileUuid, sha256Hex } from './snapshot';
import { transferConversationFile } from './transfer';
import type {
  ConversationFileActor, ConversationFileOwner, ConversationFilePublicationReceipt, ConversationFileRow, ConversationFileStorage, PublicationManifestEntry,
} from './types';

const iso = (value: Date | string | null): string | null => (value ? new Date(value).toISOString() : null);
const receiptOf = (row: any): ConversationFilePublicationReceipt => ({
  operationId: row.operation_id, ownerType: row.owner_type, ownerId: row.owner_id, conversationId: row.conversation_id, status: row.status,
  requestHash: row.request_hash, manifest: typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest,
  preparedAt: iso(row.prepared_at)!, publishedAt: iso(row.published_at), abandonedAt: iso(row.abandoned_at),
});
const conflict = (): never => { throw new ConversationFileError('FILE_OPERATION_CONFLICT'); };
const notFound = (): never => { throw new ConversationFileError('FILE_NOT_FOUND'); };

/** A copy's id is a function of the operation and its source, so a retry rewrites the same row. */
export const publicationCopyId = (tenant: string, sourceFileId: string, operationId: string): string => uuidv5(`file:${tenant}:${sourceFileId}`, operationId);

/** Prepare operation-scoped copies of `sourceFileIds` on `destination`. Copies stay unreadable
 * until `publishConversationFilePublication` runs in the caller's message transaction.
 *  - same operation id, same request  => the original receipt (idempotent retry; no second copy)
 *  - same operation id, other request => FILE_OPERATION_CONFLICT
 * Each source needs `canRead` on its own owner; the destination needs `canWrite`. */
export async function prepareConversationFilePublication(db: Knex, actorInput: ConversationFileActor, destination: ConversationFileOwner, operationId: string,
  sourceFileIds: readonly string[], storage: ConversationFileStorage): Promise<ConversationFilePublicationReceipt> {
  if ((db as Knex.Transaction).isTransaction) throw new ConversationFileError('INVALID_FILE');
  const actor = assertActor(actorInput);
  if (!isConversationFileUuid(operationId) || !isConversationFileUuid(destination?.ownerId) || !Array.isArray(sourceFileIds) || !sourceFileIds.every(isConversationFileUuid)) throw new ConversationFileError('INVALID_FILE');
  if (sourceFileIds.length > CONVERSATION_FILE_MAX_COUNT) throw new ConversationFileError('FILE_LIMIT_EXCEEDED');
  const sources = sourceFileIds.map(id => id.toLowerCase());
  if (sources.length === 0 || new Set(sources).size !== sources.length) throw new ConversationFileError('INVALID_FILE');
  const op = operationId.toLowerCase(), ownerId = destination.ownerId.toLowerCase(), conversationId = destination.conversationId?.toLowerCase() ?? null;
  const requestHash = sha256Hex(JSON.stringify({ actor, destination: { ownerType: destination.ownerType, ownerId, conversationId }, operationId: op, sources }));

  const receipt = await db.transaction(async trx => {
    await assertOwnerAccess(trx, actor, destination, 'write');
    const owner = tenantDb(trx, actor.tenant);
    const existing = await owner.table(PUBLICATIONS).where('operation_id', op).forUpdate().first();
    if (existing) {
      if (existing.request_hash !== requestHash || existing.actor_user_id !== actor.userId || existing.status === 'abandoned') return conflict();
      return receiptOf(existing);
    }
    const manifest: PublicationManifestEntry[] = [];
    for (const sourceId of sources) {
      const source = await resolveReadableFile(trx, actor, sourceId);
      manifest.push({ fileId: publicationCopyId(actor.tenant, sourceId, op), sourceFileId: sourceId, fileName: source.file_name, contentHash: source.content_hash, size: Number(source.file_size) });
    }
    const now = new Date();
    await owner.table(PUBLICATIONS).insert({
      tenant: actor.tenant, operation_id: op, owner_type: destination.ownerType, owner_id: ownerId, conversation_id: conversationId, actor_user_id: actor.userId,
      request_hash: requestHash, status: 'prepared', prepared_at: now, last_activity_at: now, manifest: JSON.stringify(manifest),
    }).onConflict(['tenant', 'operation_id']).ignore();
    const row = await owner.table(PUBLICATIONS).where('operation_id', op).forUpdate().first();
    if (row.request_hash !== requestHash || row.actor_user_id !== actor.userId) return conflict();
    return receiptOf(row);
  });
  if (receipt.status === 'published') return receipt;

  // Byte transfer happens outside the receipt lock; each copy is itself idempotent.
  for (const entry of receipt.manifest) {
    const source = await db.transaction(trx => resolveReadableFile(trx, actor, entry.sourceFileId));
    const content = await storage.download(source.storage_path);
    assertConversationFileBytes(content, { size: Number(source.file_size), contentHash: source.content_hash });
    if (source.content_hash !== entry.contentHash) throw new ConversationFileError('FILE_CONTENT_MISMATCH');
    await transferConversationFile(db, actor, { ownerType: receipt.ownerType, ownerId: receipt.ownerId, conversationId: receipt.conversationId },
      { fileId: entry.fileId, fileName: source.file_name, mimeType: source.mime_type, content }, storage,
      { publicationOperationId: receipt.operationId, sourceFileId: entry.sourceFileId });
  }
  await db.transaction(trx => tenantDb(trx, actor.tenant).table(PUBLICATIONS).where('operation_id', op).where('status', 'prepared').update({ last_activity_at: new Date() }));
  return receipt;
}

/** Runs INSIDE the caller's message transaction. Locks the receipt, asserts every manifest copy
 * is ready, live and matches its recorded hash and size, then flips prepared → published. */
export async function publishConversationFilePublication(trx: Knex.Transaction, actorInput: ConversationFileActor, operationId: string): Promise<ConversationFilePublicationReceipt> {
  if (!trx?.isTransaction) throw new ConversationFileError('INVALID_FILE');
  const actor = assertActor(actorInput);
  if (!isConversationFileUuid(operationId)) return notFound();
  const owner = tenantDb(trx, actor.tenant);
  const row = await owner.table(PUBLICATIONS).where('operation_id', operationId.toLowerCase()).forUpdate().first();
  if (!row || row.actor_user_id !== actor.userId) return notFound();
  if (row.status === 'published') return receiptOf(row);
  if (row.status !== 'prepared') return conflict();
  await assertOwnerAccess(trx, actor, { ownerType: row.owner_type, ownerId: row.owner_id }, 'write');
  const receipt = receiptOf(row);
  const copies = await owner.table<ConversationFileRow>(FILES).where('publication_operation_id', receipt.operationId).forUpdate();
  for (const entry of receipt.manifest) {
    const copy = copies.find(c => c.file_id === entry.fileId);
    if (!copy || copy.status !== 'ready' || copy.discarded_at || copy.purged_at || copy.owner_type !== row.owner_type || copy.owner_id !== row.owner_id
      || copy.content_hash !== entry.contentHash || Number(copy.file_size) !== entry.size || copy.file_name !== entry.fileName || copy.source_file_id !== entry.sourceFileId) return conflict();
  }
  const now = new Date();
  await owner.table(PUBLICATIONS).where('operation_id', receipt.operationId).update({ status: 'published', published_at: now, last_activity_at: now });
  return { ...receipt, status: 'published', publishedAt: now.toISOString() };
}

/** prepared → abandoned: the copies are discarded for cleanup. A published receipt cannot be abandoned. */
export async function abandonConversationFilePublication(db: Knex, actorInput: ConversationFileActor, operationId: string): Promise<ConversationFilePublicationReceipt> {
  const actor = assertActor(actorInput);
  if (!isConversationFileUuid(operationId)) return notFound();
  return db.transaction(async trx => {
    const owner = tenantDb(trx, actor.tenant);
    const row = await owner.table(PUBLICATIONS).where('operation_id', operationId.toLowerCase()).forUpdate().first();
    if (!row || row.actor_user_id !== actor.userId) return notFound();
    if (row.status === 'published') return conflict();
    if (row.status === 'abandoned') return receiptOf(row);
    const now = new Date();
    await owner.table(PUBLICATIONS).where('operation_id', row.operation_id).update({ status: 'abandoned', abandoned_at: now, last_activity_at: now });
    await owner.table(FILES).where('publication_operation_id', row.operation_id).whereNull('discarded_at').update({ discarded_at: now, cleanup_next_attempt_at: now });
    return { ...receiptOf(row), status: 'abandoned' as const, abandonedAt: now.toISOString() };
  });
}
