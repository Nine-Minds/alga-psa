import { createHash } from 'node:crypto';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing/lifecycle';
import type { QualifiedReplyArtifactProcessor } from '../../../shared/services/email/qualifiedReplyArtifacts';
import { transitionArtifact } from '../../../shared/services/email/inboundEmailDurableStore';
import { transferAuthorizedCoManagedAttachment, type CoManagedAttachmentTransferContext } from './conversationAttachments';
import { authorizeCoManagedWorkRecord, CoManagedSharedWorkError, isCoManagedUuid, lockCoManagedRecipientIdentity } from './sharedWorkIdentity';
import { readLockedTicketCommentNotification } from './ticketCommentNotificationContent';
import { coManagedConversationBodySources, coManagedConversationAttachmentSources } from './conversationPolicy';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';

function deny(): never { throw new CoManagedSharedWorkError(); }
/** Customer-owned accepted mail does not depend on an old token still being
 * valid. Current identity, ticket policy, exact admitted audience and a live
 * fenced artifact lease remain mandatory throughout transfer and publication. */
export const processCoManagedReplyArtifact: QualifiedReplyArtifactProcessor = async (db, input, upload) => {
  if (!input || (db as any).isTransaction || ![input.tenant, input.inboxId, input.claim?.token].every(isCoManagedUuid) ||
      !input.artifactKey || !input.claim.owner || !Number.isSafeInteger(input.claim.version) || !/^[a-f0-9]{64}$/.test(input.sourceSha256)) deny();
  input = { ...input, claim: { ...input.claim }, payload: { ...input.payload } };
  const owner = tenantDb(db, input.tenant);
  const receipt = await owner.table('co_management_inbound_reply_receipts').where('inbox_id', input.inboxId).first();
  if (!receipt || receipt.actor_tenant !== input.tenant || receipt.source_sha256 !== input.sourceSha256) deny();
  const actor = { tenant: input.tenant, userId: receipt.actor_user_id };
  const resource = { tenant: input.tenant, kind: 'ticket' as const, id: receipt.ticket_id, relationshipId: receipt.relationship_id };
  const comment = { storeTenant: input.tenant, commentId: receipt.comment_id, threadId: receipt.thread_id };
  const fence = { tenant: input.tenant, inbox_id: input.inboxId, artifact_key: input.artifactKey,
    owner: input.claim.owner, token: input.claim.token, version: input.claim.version, requireUnexpired: true };
  const authority = <T>(work: (context: CoManagedAttachmentTransferContext, sourcePath: string) => Promise<T>) => withTransaction(db, async trx => {
    await assertCoManagedOperationalWrite(trx, input.tenant);
    const scope = tenantDb(trx, input.tenant);
    const tenant = await scope.table('tenants').forShare().first('product_code', 'suspended_at');
    if (!tenant || !['co_managed', 'psa'].includes(tenant.product_code) || tenant.suspended_at) deny();
    const retained = await scope.table('co_management_inbound_reply_receipts').where('inbox_id', input.inboxId).forShare().first();
    if (!retained || Object.keys(receipt).some(key => key !== 'created_at' && receipt[key] !== retained[key])) deny();
    const inbox = await scope.table('inbound_email_inbox').where({ inbox_id: input.inboxId, status: 'succeeded', ticket_id: resource.id, comment_id: comment.commentId }).forShare().first();
    if (!inbox || !inbox.source_object_key || inbox.source_sha256 !== receipt.source_sha256 ||
        !await scope.table('inbound_email_effects').where({ inbox_id: input.inboxId, effect_type: 'comment', entity_id: comment.commentId,
          ticket_id: resource.id, source_sha256: receipt.source_sha256 }).forShare().first()) deny();
    const liveClaim = () => scope.table('inbound_email_artifacts').where({ inbox_id: input.inboxId, artifact_key: input.artifactKey,
      status: 'processing', lease_owner: fence.owner, lease_token: fence.token, lease_version: fence.version })
      .where('lease_expires_at', '>', trx.raw('clock_timestamp()'));
    const artifact = await liveClaim().forUpdate().first();
    if (!artifact || artifact.artifact_type !== input.payload.kind) deny();
    const subject = await lockCoManagedRecipientIdentity(trx, actor);
    const ticket = await scope.table('tickets').where('ticket_id', resource.id).forShare().first();
    if (!ticket) deny();
    // LEVERAGE: pattern customer-ticket-policy-record — receipt workers retain the same current owner policy as local writes.
    const record = { id: ticket.ticket_id, clientId: ticket.client_id, boardId: ticket.board_id, ownerUserId: ticket.entered_by,
      assignedUserIds: ticket.assigned_to ? [ticket.assigned_to] : [], teamIds: ticket.assigned_team_id ? [ticket.assigned_team_id] : [] };
    const redactedFields: string[] = [];
    for (const action of ['read', 'update'] as const) {
      const decision = await authorizeCoManagedWorkRecord(trx, actor, subject, 'ticket', action, record);
      redactedFields.push(...decision.redactedFields);
    }
    if (isCoManagedReadFieldHidden(redactedFields, [...coManagedConversationBodySources, ...coManagedConversationAttachmentSources])) deny();
    // Self-suppression is a notification concern. This internal reader follows
    // explicit upload admission and must read the accepted author's own comment.
    const message = await readLockedTicketCommentNotification({ trx, actor: null, resource, redactedFields }, comment.commentId, [receipt.audience]);
    const current = await scope.table('comments').where('comment_id', comment.commentId).first();
    if (!message || message.threadId !== comment.threadId || message.audience !== receipt.audience ||
        !current || current.user_id !== actor.userId || current.author_type !== 'internal' || current.actor_reference_id || current.contact_id) deny();
    const assertWriteAuthority = async () => {
      await assertCoManagedOperationalWrite(trx, input.tenant);
      if (!await liveClaim().first()) deny();
    };
    await assertWriteAuthority();
    return work({ trx, actor, resource, comment, audience: message.audience, action: 'update', assertWriteAuthority }, inbox.source_object_key);
  });
  if (input.payload.kind === 'original_email') {
    await authority(async (context, sourcePath) => {
      await context.assertWriteAuthority();
      // MIME contains quoted history and reply credentials. Retain the staged
      // object as customer audit evidence, never as a requester-visible file.
      if (!await transitionArtifact(context.trx, { ...fence, status: 'succeeded', storage_key: sourcePath,
        content_digest: receipt.source_sha256, conversation_attachment_id: null, file_id: null, document_id: null, error: null })) deny();
    });
    return;
  }
  const digest = createHash('sha256').update(JSON.stringify([input.tenant, input.inboxId, input.artifactKey])).digest('hex');
  const attachmentId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
  await transferAuthorizedCoManagedAttachment(db, actor, resource, { attachmentId, comment, fileName: input.payload.fileName,
    mimeType: input.payload.mimeType, content: input.payload.content }, authority, upload, async (context, attachment, contentHash) => {
    if (!await transitionArtifact(context.trx, { ...fence, status: 'succeeded', conversation_attachment_id: attachment.attachmentId,
      storage_key: `co-management/${input.tenant}/${attachment.attachmentId}`, content_digest: contentHash, file_id: null, document_id: null, error: null })) deny();
  });
};
