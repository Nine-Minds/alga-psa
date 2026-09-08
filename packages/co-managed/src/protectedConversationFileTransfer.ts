import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { isCoManagedUuid, CoManagedSharedWorkError } from './sharedWorkIdentity';

export class CoManagedAttachmentError extends Error {
  constructor(public readonly code: 'INVALID_ATTACHMENT' | 'ATTACHMENT_OPERATION_CONFLICT' | 'ATTACHMENT_CONTENT_MISMATCH') {
    super({ INVALID_ATTACHMENT: 'The attachment is not valid.', ATTACHMENT_OPERATION_CONFLICT: 'This upload was already used for another attachment.',
      ATTACHMENT_CONTENT_MISMATCH: 'The stored attachment does not match its original content.' }[code]);
    this.name = 'CoManagedAttachmentError';
  }
}
export interface ConversationFileBytes { attachmentId: string; fileName: string; mimeType: string; content: Uint8Array }
export function snapshotConversationFileBytes(input: ConversationFileBytes) {
  if (!input || !isCoManagedUuid(input.attachmentId) || typeof input.fileName !== 'string' || !input.fileName.trim() || input.fileName.length > 255 ||
    /[\\/\u0000-\u001f\u007f]/.test(input.fileName) || typeof input.mimeType !== 'string' || input.mimeType.length > 127 ||
    !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(input.mimeType) || !(input.content instanceof Uint8Array) || input.content.length > 26214400)
    throw new CoManagedAttachmentError('INVALID_ATTACHMENT');
  const content = Buffer.from(input.content);
  return { attachmentId: input.attachmentId.toLowerCase(), fileName: input.fileName, mimeType: input.mimeType.toLowerCase(), content,
    contentHash: createHash('sha256').update(content).digest('hex') };
}
export interface ProtectedConversationFileBinding {
  tenant: string; customer_tenant: string; relationship_id?: string | null; ticket_id: string;
  actor_tenant: string; actor_user_id: string | null; external_author_email?: string | null;
  thread_id: string | null; comment_id: string | null; draft_operation_id: string | null;
  named_editor_store_tenant?: string | null; named_editor_conversation_id?: string | null;
  named_publication_operation_id?: string | null;
}
export interface ProtectedConversationFileAuthority { trx: Knex.Transaction; assertWriteAuthority: () => Promise<void> }
/** Shared byte-transfer mechanics. The caller supplies one typed, immutable
 * binding and retains its domain authority separately in both transactions. */
export async function transferProtectedConversationFile<C extends ProtectedConversationFileAuthority, R>(db: Knex,
  file: ReturnType<typeof snapshotConversationFileBytes>, binding: ProtectedConversationFileBinding, requestHash: string,
  withAuthority: <T>(work: (context: C) => Promise<T>) => Promise<T>,
  upload: (path: string, content: Uint8Array, mimeType: string) => Promise<void>,
  complete: (context: C, row: any, digest: string) => Promise<R>): Promise<R> {
  if (db.isTransaction || !isCoManagedUuid(binding.tenant) || !/^[a-f0-9]{64}$/.test(requestHash)) throw new CoManagedAttachmentError('INVALID_ATTACHMENT');
  const table = 'co_management_conversation_attachments', path = `co-management/${binding.tenant}/${file.attachmentId}`;
  const conflict = (): never => { throw new CoManagedAttachmentError('ATTACHMENT_OPERATION_CONFLICT'); };
  const validate = (row: any) => {
    if (!row || row.discarded_at || row.request_hash !== requestHash ||
      Object.entries(binding).some(([key, value]) => (row[key] ?? null) !== (value ?? null))) return conflict();
    if (row.storage_path !== path) throw new CoManagedSharedWorkError();
  };
  await withAuthority(async context => {
    if (!context.trx.isTransaction) return conflict();
    const owner = tenantDb(context.trx, binding.tenant);
    await context.assertWriteAuthority();
    await owner.table(table).insert({ ...binding, attachment_id: file.attachmentId, file_name: file.fileName, mime_type: file.mimeType,
      file_size: file.content.length, content_hash: file.contentHash, request_hash: requestHash, storage_path: path, status: 'pending' })
      .onConflict(['tenant', 'attachment_id']).ignore();
    const row = await owner.table(table).where('attachment_id', file.attachmentId).forUpdate().first();
    validate(row);
    await owner.table(table).where('attachment_id', file.attachmentId).update({ last_activity_at: context.trx.raw('clock_timestamp()') });
  });
  return withAuthority(async context => {
    if (!context.trx.isTransaction) return conflict();
    const query = () => tenantDb(context.trx, binding.tenant).table(table).where('attachment_id', file.attachmentId);
    const row = await query().forUpdate().first();
    validate(row);
    if (row.status !== 'ready') {
      await upload(path, file.content, file.mimeType);
      await context.assertWriteAuthority();
      await query().update({ status: 'ready', ready_at: context.trx.raw('clock_timestamp()'), last_activity_at: context.trx.raw('clock_timestamp()') });
    } else await context.assertWriteAuthority();
    return complete(context, row, file.contentHash);
  });
}
