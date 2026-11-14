import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { coManagedAttachmentParent } from './attachmentParent';
import { assertCoManagedAttachmentPath } from './attachmentStoragePath';
import { coManagedArchiveStorageProvider } from './archiveStorageProvider';

/**
 * Reader primitives inherited by L7a (closure enumeration) and L7b3 (portable
 * export). They are exported, deliberately NOT registered anywhere: registering
 * into L7b1's registry from here would be a downward dependency.
 */
const TABLE = 'co_management_conversation_attachments';

export interface ConversationDocumentScope {
  /** Work item whose files are listed (kind defaults to `ticket`). */
  parent: { kind?: string; id: string };
  /** Restrict to one relationship; omitted lists every relationship's files for the work item. */
  relationshipId?: string;
}
export interface ConversationDocumentMeta {
  attachmentId: string; threadId: string; commentId: string; fileName: string; mimeType: string; size: number;
  contentHash: string; storagePath: string; createdAt: string; actorTenant: string; actorUserId: string;
  /** Present when the file was copied by a thread disclosure. */
  disclosureOperationId: string | null;
  /** True when the file is inside an `organization_private` thread; the policy below keeps it out of any export. */
  organizationPrivate: boolean;
}

/** Attachment metadata only, no bytes. Published, ready, not removed/purged. `tenant` is the store tenant: files in a sponsor's store whose customer differs are private-thread files. */
export async function listConversationDocumentsForExport(db: Knex, tenant: string, scope: ConversationDocumentScope): Promise<ConversationDocumentMeta[]> {
  const owner = tenantDb(db, tenant);
  const rows = await owner.table(TABLE).where({ ...coManagedAttachmentParent(scope.parent), status: 'ready' })
    .whereNull('discarded_at').whereNull('purged_at')
    .modify(query => { if (scope.relationshipId) query.where('relationship_id', scope.relationshipId); })
    .where(query => query.whereNull('draft_operation_id').orWhereExists(owner.table('co_management_conversation_drafts as d')
      .where('d.status', 'published').whereRaw('d.operation_id = co_management_conversation_attachments.draft_operation_id')
      .whereRaw('d.relationship_id = co_management_conversation_attachments.relationship_id')))
    .orderBy('created_at').orderBy('attachment_id');
  return rows.map((row: any) => {
    assertCoManagedAttachmentPath(row);
    return { attachmentId: row.attachment_id, threadId: row.thread_id, commentId: row.comment_id, fileName: row.file_name, mimeType: row.mime_type,
      size: row.file_size, contentHash: row.content_hash, storagePath: row.storage_path, createdAt: new Date(row.created_at).toISOString(),
      actorTenant: row.actor_tenant, actorUserId: row.actor_user_id, disclosureOperationId: row.disclosure_operation_id ?? null,
      organizationPrivate: row.customer_tenant !== row.tenant };
  });
}

/** Streams the bytes through the lazy provider; the caller verifies `contentHash` while consuming. */
export async function openAttachmentStream(attachment: Pick<ConversationDocumentMeta, 'storagePath'>): Promise<NodeJS.ReadableStream> {
  const provider: any = await coManagedArchiveStorageProvider();
  if (typeof provider.getReadStream === 'function') return provider.getReadStream(attachment.storagePath);
  const { Readable } = await import('node:stream');
  return Readable.from([Buffer.from(await provider.download(attachment.storagePath))]);
}

export type AttachmentExportDecision = { export: true } | { export: false; tombstone: { attachmentId: string; fileName: string; reason: 'organization_private' } };
/** `organization_private` content is never exported; the manifest keeps a tombstone entry (no name leak beyond the entry itself). */
export function attachmentRedactionPolicy(attachment: Pick<ConversationDocumentMeta, 'attachmentId' | 'fileName' | 'organizationPrivate'>): AttachmentExportDecision {
  return attachment.organizationPrivate
    ? { export: false, tombstone: { attachmentId: attachment.attachmentId, fileName: attachment.fileName, reason: 'organization_private' } }
    : { export: true };
}
