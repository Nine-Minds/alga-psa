import { createHash } from 'node:crypto';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing';
import type { QualifiedReplyArtifactProcessor } from '@alga-psa/shared/services/email/qualifiedReplyArtifacts';
import { transitionArtifact } from '@alga-psa/shared/services/email/inboundEmailDurableStore';
import { conversationUuid, TicketConversationError } from '@alga-psa/shared/lib/tickets/namedConversations';
import { transferAuthorizedCoManagedAttachment, type CoManagedAttachmentTransferContext } from './conversationAttachments';
import { readNamedConversationEmailDestination } from './inboundNamedConversationEmail';
import { admitNamedRequesterReplyIdentity } from './namedRequesterReplyIdentity';

const deny = (): never => { throw new TicketConversationError('CONVERSATION_FORBIDDEN'); };
/** Accepted external mail supplies an organizational intake capability, never a
 * fabricated staff user. Each file retains the exact receipt, audience and live
 * artifact claim through reservation, transport and publication. */
export const processNamedConversationReplyArtifact: QualifiedReplyArtifactProcessor = async (db, input, upload) => {
  if (!input || db.isTransaction || ![input.tenant, input.inboxId, input.claim?.token].every(conversationUuid) || !input.claim.owner ||
    !Number.isSafeInteger(input.claim.version) || !/^[a-f0-9]{64}$/.test(input.sourceSha256)) return deny();
  input = { ...input, claim: { ...input.claim }, payload: input.payload.kind === 'original_email' ? { ...input.payload }
    : { ...input.payload, content: Buffer.from(input.payload.content) } };
  const home = tenantDb(db, input.tenant);
  const receipt = await home.table('ticket_conversation_inbound_receipts').where('inbox_id', input.inboxId).first();
  if (!receipt || receipt.source_sha256 !== input.sourceSha256 || !receipt.envelope?.from?.email) return deny();
  const actor = { tenant: input.tenant, userId: null, externalEmail: receipt.envelope.from.email };
  const resource = { kind: 'ticket' as const, tenant: receipt.ticket_tenant, id: receipt.ticket_id,
    ...(receipt.relationship_id ? { relationshipId: receipt.relationship_id } : {}) };
  const comment = { storeTenant: receipt.conversation_store_tenant, threadId: receipt.thread_id, commentId: receipt.comment_id };
  const fence = { tenant: input.tenant, inbox_id: input.inboxId, artifact_key: input.artifactKey, owner: input.claim.owner,
    token: input.claim.token, version: input.claim.version, requireUnexpired: true };
  const authority = <T>(work: (context: CoManagedAttachmentTransferContext, path: string) => Promise<T>) => withTransaction(db, async trx => {
    await assertCoManagedOperationalWrite(trx, input.tenant);
    const scope = tenantDb(trx, input.tenant);
    const retained = await scope.table('ticket_conversation_inbound_receipts').where('inbox_id', input.inboxId).forShare().first();
    if (!retained || JSON.stringify(retained) !== JSON.stringify(receipt)) return deny();
    const inbox = await scope.table('inbound_email_inbox').where({ inbox_id: input.inboxId, provider_id: receipt.provider_id,
      status: 'succeeded', ticket_id: resource.id, comment_id: comment.commentId }).forShare().first();
    if (!inbox?.source_object_key || inbox.source_sha256 !== input.sourceSha256 || !await scope.table('inbound_email_effects')
      .where({ inbox_id: input.inboxId, effect_type: 'comment', entity_id: comment.commentId, ticket_id: resource.id, source_sha256: input.sourceSha256 }).forShare().first()) return deny();
    const liveClaim = () => scope.table('inbound_email_artifacts').where({ inbox_id: input.inboxId, artifact_key: input.artifactKey, status: 'processing',
      lease_owner: fence.owner, lease_token: fence.token, lease_version: fence.version }).where('lease_expires_at', '>', trx.raw('clock_timestamp()'));
    const artifact = await liveClaim().forUpdate().first();
    if (!artifact || artifact.artifact_type !== input.payload.kind) return deny();
    const route = await scope.table('ticket_conversation_email_routes').where({ mailbox_id: receipt.provider_id,
      operation_tenant: receipt.route_operation_tenant, operation_id: receipt.route_operation_id }).forShare().first();
    if (!route) return deny();
    const selected = await readNamedConversationEmailDestination(trx, route, receipt);
    if (selected.conversation.audience === 'requester') await admitNamedRequesterReplyIdentity(trx, {
      tenant: resource.tenant, ticketId: resource.id, parentCommentId: comment.commentId, senderEmail: receipt.envelope.from.email,
      senderAuth: receipt.sender_auth, envelope: selected.source.email_envelope,
    });
    const message = await selected.store.table('ticket_conversation_inbound_messages').where({ comment_id: comment.commentId, thread_id: comment.threadId,
      conversation_id: receipt.conversation_id, mailbox_tenant: input.tenant, mailbox_id: receipt.provider_id, inbox_id: input.inboxId }).forShare().first();
    if (!message || JSON.stringify(message.envelope) !== JSON.stringify(receipt.envelope)) return deny();
    const assertWriteAuthority = async () => {
      for (const tenant of new Set([input.tenant, resource.tenant, comment.storeTenant])) await assertCoManagedOperationalWrite(trx, tenant);
      if (!await liveClaim().first()) return deny();
    };
    await assertWriteAuthority();
    return work({ trx, actor, resource, comment, audience: selected.conversation.audience, action: 'update', assertWriteAuthority }, inbox.source_object_key);
  });
  if (input.payload.kind === 'original_email') {
    await authority(async (context, path) => {
      if (!await transitionArtifact(context.trx, { ...fence, status: 'succeeded', storage_key: path, content_digest: input.sourceSha256,
        conversation_attachment_id: null, file_id: null, document_id: null, error: null })) return deny();
    });
    return;
  }
  const hash = createHash('sha256').update(JSON.stringify([input.tenant, input.inboxId, input.artifactKey])).digest('hex');
  const attachmentId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  await transferAuthorizedCoManagedAttachment(db, actor, resource, { attachmentId, comment, fileName: input.payload.fileName,
    mimeType: input.payload.mimeType, content: input.payload.content }, authority,
  (path, bytes, mimeType) => upload(path, bytes, mimeType, comment.storeTenant), async (context, attachment, digest) => {
    if (!await transitionArtifact(context.trx, { ...fence, status: 'succeeded', conversation_attachment_id: attachment.attachmentId,
      storage_key: `co-management/${comment.storeTenant}/${attachmentId}`, content_digest: digest, file_id: null, document_id: null, error: null })) return deny();
    await tenantDb(context.trx, comment.storeTenant).table('ticket_conversations').where('conversation_id', receipt.conversation_id)
      .update({ message_version: context.trx.raw('message_version + 1'), updated_at: context.trx.fn.now() });
  });
};
