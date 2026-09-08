import { portableSnapshotTransaction, type CoManagedPortableSnapshot } from './portableSnapshot';
import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { commentAudienceSql } from '@alga-psa/shared/lib/commentAudience';
import { withCoManagedExportAdmin } from './portableExport';
import { hasCoManagedLocalPermission } from './localPermission';
import { authorizeCoManagedLocalRecord, CoManagedSharedWorkError, isCoManagedUuid,
  snapshotCoManagedSessionActor, type CoManagedSessionActor } from './sharedWorkIdentity';
import { listPublishedCoManagedAttachmentSources } from './conversationAttachments';
import { stageCoManagedPortableBlobs } from './portableBlobStaging';

async function collect(db: Knex, actor: CoManagedSessionActor, databaseSnapshot?: CoManagedPortableSnapshot) {
  return portableSnapshotTransaction(db, databaseSnapshot, trx => retainCoManagedPortableConversationSource(trx, actor));
}

/** Provider-free source retention for coordinated final delivery admission. */
export async function retainCoManagedPortableConversationSource(trx: Knex.Transaction, inputActor: CoManagedSessionActor) {
  if (!trx.isTransaction) throw new Error('Portable retention requires a transaction');
  const actor = snapshotCoManagedSessionActor(inputActor);
  return withCoManagedExportAdmin(trx, actor, async (current, verified, subject) => {
    if (!await hasCoManagedLocalPermission(current, verified, 'ticket', 'read', true)) throw new CoManagedSharedWorkError();
    const own = tenantDb(current, actor.tenant);
    const filesExist = own.table('co_management_conversation_attachments as f')
      .where({ 'f.customer_tenant': actor.tenant, 'f.status': 'ready' }).whereNull('f.discarded_at').whereNull('f.purged_at')
      .whereRaw('f.ticket_id = c.ticket_id AND f.thread_id = c.thread_id AND f.comment_id = c.comment_id');
    const query = own.table('comments as c').where({ 'c.publish_state': 'published' }).whereNull('c.deleted_at').whereExists(filesExist);
    own.tenantJoin(query, 'comment_threads as t', 'c.thread_id', 't.thread_id', { on: join => join.andOn('t.ticket_id', '=', 'c.ticket_id') });
    own.tenantJoin(query, 'comments as root', 't.root_comment_id', 'root.comment_id', {
      on: join => join.andOn('root.thread_id', '=', 'c.thread_id').andOn('root.ticket_id', '=', 'c.ticket_id'),
    });
    own.tenantJoin(query, 'tickets as ticket', 'c.ticket_id', 'ticket.ticket_id');
    const comments = await query.where('root.publish_state', 'published').orderBy('c.comment_id').limit(100_001)
      .forShare('c', 't', 'root', 'ticket').select('c.ticket_id', 'c.thread_id', 'c.comment_id', 'c.actor_reference_id',
        'c.actor_display_name', 'c.actor_organization_name', 'c.updated_at as comment_updated_at', 'root.updated_at as root_updated_at',
        'root.deleted_at as root_deleted_at', 'ticket.client_id', 'ticket.board_id', 'ticket.entered_by', 'ticket.assigned_to', 'ticket.assigned_team_id',
        { audience: commentAudienceSql(current, 't', 'root', 'c') });
    if (comments.length > 100_000) throw new Error('Portable conversation attachment limit exceeded');
    const sources: { comment: any; attachment: any }[] = [];
    for (const comment of comments) {
      const decision = await authorizeCoManagedLocalRecord(current, actor, subject, 'ticket', 'read', {
        id: comment.ticket_id, clientId: comment.client_id, boardId: comment.board_id, ownerUserId: comment.entered_by,
        assignedUserIds: comment.assigned_to ? [comment.assigned_to] : [], teamIds: comment.assigned_team_id ? [comment.assigned_team_id] : [],
      });
      if (decision.redactedFields.length || !['requester', 'shared_it', 'organization_private'].includes(comment.audience)) throw new CoManagedSharedWorkError();
      const attachments = await listPublishedCoManagedAttachmentSources({ trx: current,
        resource: { tenant: actor.tenant, id: comment.ticket_id }, audience: comment.audience,
        comment: { storeTenant: actor.tenant, threadId: comment.thread_id, commentId: comment.comment_id } });
      for (const attachment of attachments) sources.push({ comment, attachment });
      if (sources.length > 100_000) throw new Error('Portable conversation attachment limit exceeded');
    }
    return sources;
  });
}

const checksum = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Own published canonical files remain exportable after departure. Never
 * opens an MSP-private store, pending composer upload, discarded file or live
 * foreign grant. The assembler converts these bindings to native ticket files
 * at restore, without recreating the source trust or source download routes. */
export async function exportCoManagedPortableConversationFiles(db: Knex, inputActor: CoManagedSessionActor, packageId: string, databaseSnapshot?: CoManagedPortableSnapshot) {
  if (db.isTransaction) throw new Error('Portable export requires a root database connection');
  const actor = snapshotCoManagedSessionActor(inputActor);
  if (!isCoManagedUuid(packageId)) throw new CoManagedSharedWorkError();
  const snapshot = await collect(db, actor, databaseSnapshot), original = checksum(snapshot);
  const assertCurrent = async (trx: Knex.Transaction) => {
    if (checksum(await retainCoManagedPortableConversationSource(trx, actor)) !== original) throw new CoManagedSharedWorkError();
  };
  const staged = await stageCoManagedPortableBlobs(snapshot.map(({ attachment }) => ({ id: `attachment:${attachment.attachment_id}`,
    path: attachment.storage_path, size: Number(attachment.file_size), sha256: attachment.content_hash })));
  try {
    await portableSnapshotTransaction(db, undefined, assertCurrent);
    const payload = JSON.parse(JSON.stringify({ kind: 'alga-workspace-conversation-files', version: 1, packageId, sourceTenant: actor.tenant,
      restorePolicy: { attachmentStore: 'native_ticket_documents', sponsorship: 'none' },
      attachments: snapshot.map(({ comment, attachment }) => ({ attachmentId: attachment.attachment_id, blobId: `attachment:${attachment.attachment_id}`,
        ticketId: attachment.ticket_id, threadId: attachment.thread_id, commentId: attachment.comment_id,
        audience: comment.audience, fileName: attachment.file_name, mimeType: attachment.mime_type, size: Number(attachment.file_size),
        sha256: attachment.content_hash, createdAt: attachment.created_at, actorTenant: attachment.actor_tenant, actorUserId: attachment.actor_user_id,
        actorReferenceId: comment.actor_reference_id, actorDisplayName: comment.actor_display_name, actorOrganizationName: comment.actor_organization_name })) }));
    return { component: { ...payload, sha256: checksum(payload) }, files: staged.files, dispose: staged.dispose, assertCurrent };
  } catch (error) { await staged.dispose(); throw error; }
}
