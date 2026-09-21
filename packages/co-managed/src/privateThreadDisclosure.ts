import { coManagedAttachmentParent } from './attachmentParent';
import { createHash, randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing';
import { snapshotCoManagedSessionActor, assertCoManagedSessionUnexpired, isCoManagedUuid, type CoManagedSessionActor } from './sharedWorkIdentity';
import type { CoManagedSharedResource, CoManagedSharedWorkContext } from './sharedWork';
import type { CoManagedThreadDisclosureContext } from './threadDisclosure';
import { withAuthority as withDisclosureAuthority, target, resourceSnapshot, hash, deny, invalid, conflict, CoManagedThreadDisclosureError,
  type CoManagedThreadReference, type CoManagedThreadDisclosurePreview, type CoManagedThreadDisclosureRequest, type CoManagedThreadDisclosureReceipt } from './threadDisclosureAdmission';
import { assertCoManagedAttachmentPath, disclosedAttachmentPath } from './attachmentStoragePath';

function withAuthority<T>(db: Knex, actor: CoManagedSessionActor, resource: CoManagedSharedResource, work: (context: CoManagedSharedWorkContext) => Promise<T>) {
  return withDisclosureAuthority(db, actor, resource, work, true);
}
const TABLE = 'co_management_thread_transfers', FILES = 'co_management_conversation_attachments';
export interface CoManagedPrivateThreadDisclosureReceipt extends CoManagedThreadDisclosureReceipt { sourceStoreTenant: string; sourceThreadId: string }
interface TransferFile { sourceId: string; targetId: string; sourceCommentId: string; path: string; copied: boolean }
async function sourceThread(context: CoManagedSharedWorkContext, reference: CoManagedThreadReference) {
  const { trx, actor, resource } = context;
  if (actor.tenant === resource.tenant || reference.storeTenant !== actor.tenant) deny();
  const home = tenantDb(trx, actor.tenant);
  const thread = await home.table('co_management_private_threads').where({ thread_id: reference.threadId, customer_tenant: resource.tenant,
    relationship_id: resource.relationshipId, resource_type: resource.kind, resource_id: resource.id }).select('*', { created_at_exact: trx.raw('created_at::text') }).forUpdate().first();
  if (!thread || thread.disclosure_operation_id) deny();
  const comments = await home.table('co_management_private_comments').where('thread_id', reference.threadId).select('*', { created_at_exact: trx.raw('created_at::text'), deleted_at_exact: trx.raw('deleted_at::text') }).orderBy('comment_id').forUpdate();
  const root = comments.find(row => row.comment_id === thread.root_comment_id);
  if (!root || root.deleted_at || root.actor_user_id !== actor.userId || root.parent_comment_id) deny();
  const ids = new Set(comments.map(row => row.comment_id));
  for (const row of comments) {
    const visited = new Set([row.comment_id]); let parent = row.parent_comment_id;
    while (parent) {
      if (!ids.has(parent) || visited.has(parent)) deny(); visited.add(parent);
      parent = comments.find(value => value.comment_id === parent)!.parent_comment_id;
    }
    if (!visited.has(root.comment_id)) deny();
  }
  const drafts = resource.kind === 'project_task' ? [] : await home.table('co_management_conversation_drafts').where({ customer_tenant: resource.tenant, relationship_id: resource.relationshipId,
    ticket_id: resource.id, thread_id: reference.threadId }).orderBy('operation_id').forShare();
  const files = await home.table(FILES).where({ customer_tenant: resource.tenant, relationship_id: resource.relationshipId,
    ...coManagedAttachmentParent(resource), thread_id: reference.threadId }).whereNull('discarded_at').select('*', { created_at_exact: trx.raw('created_at::text') }).orderBy('attachment_id').forShare();
  const publishedIds = new Set(drafts.filter(row => row.status === 'published').map(row => row.operation_id));
  const visibleFiles = files.filter(row => comments.some(comment => comment.comment_id === row.comment_id && !comment.deleted_at) &&
    (!row.draft_operation_id || publishedIds.has(row.draft_operation_id)));
  for (const file of visibleFiles) {
    if (file.actor_tenant !== actor.tenant || file.actor_user_id !== comments.find(comment => comment.comment_id === file.comment_id)?.actor_user_id) deny();
  }
  const preview: CoManagedThreadDisclosurePreview = { ...reference, audience: 'organization_private', snapshot: hash({ resource, thread, comments, drafts, files }),
    comments: comments.filter(row => !row.deleted_at).length, attachments: visibleFiles.filter(row => row.status === 'ready').length,
    pendingAttachments: visibleFiles.filter(row => row.status === 'pending').length };
  return { thread, root, comments, files: visibleFiles.filter(row => row.status === 'ready'), preview };
}
export async function previewCoManagedPrivateThreadDisclosure(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource, input: CoManagedThreadReference) {
  if (!input || Object.keys(input).some(key => !['storeTenant', 'threadId'].includes(key))) invalid();
  const actor = snapshotCoManagedSessionActor(inputActor), resource = resourceSnapshot(inputResource), reference = target(input);
  return withAuthority(db, actor, resource, async context => (await sourceThread(context, reference)).preview);
}
function checkedPlan(row: any, source: Awaited<ReturnType<typeof sourceThread>>, context: CoManagedSharedWorkContext) {
  const mapping = row.comment_map as Record<string, string>, manifest = row.manifest as TransferFile[];
  if (!mapping || Array.isArray(mapping) || Object.keys(mapping).length !== source.comments.length ||
    source.comments.some(comment => !isCoManagedUuid(mapping[comment.comment_id]) || mapping[comment.comment_id] !== mapping[comment.comment_id].toLowerCase()) ||
    mapping[source.root.comment_id] !== row.operation_id || new Set(Object.values(mapping)).size !== source.comments.length ||
    !Array.isArray(manifest) || manifest.length !== source.files.length || new Set(manifest.map(file => file?.targetId)).size !== manifest.length ||
    new Set(manifest.map(file => file?.sourceId)).size !== manifest.length) conflict();
  for (const file of manifest) {
    if (!file || Object.keys(file).some(key => !['sourceId', 'targetId', 'sourceCommentId', 'path', 'copied'].includes(key)) || typeof file.copied !== 'boolean' ||
      !source.files.some(original => original.attachment_id === file.sourceId && original.comment_id === file.sourceCommentId) ||
      file.path !== disclosedAttachmentPath(context.resource.tenant, context.actor.tenant, row.operation_id, file.targetId, context.resource.kind)) conflict();
  }
  return { mapping, manifest };
}
function checkedReceipt(row: any): CoManagedPrivateThreadDisclosureReceipt {
  const receipt = row.receipt;
  if (!receipt || receipt.storeTenant !== row.customer_tenant || receipt.threadId !== row.operation_id || receipt.operationId !== row.operation_id || receipt.audience !== row.audience ||
    receipt.sourceStoreTenant !== row.tenant || receipt.sourceThreadId !== row.source_thread_id || !Number.isFinite(Date.parse(receipt.appliedAt))) conflict();
  return { storeTenant: receipt.storeTenant, threadId: receipt.threadId, operationId: receipt.operationId, audience: receipt.audience, appliedAt: receipt.appliedAt,
    sourceStoreTenant: receipt.sourceStoreTenant, sourceThreadId: receipt.sourceThreadId };
}
/** The source-owned ledger reserves immutable destination paths before transfer.
 * No customer comment/file row exists until the final publication transaction. */
export async function discloseCoManagedPrivateThread(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource,
  input: CoManagedThreadDisclosureRequest, transport: { download: (path: string) => Promise<Uint8Array>; upload: (path: string, content: Uint8Array, mime: string) => Promise<void> },
  afterChange: (context: CoManagedThreadDisclosureContext) => Promise<void>): Promise<CoManagedPrivateThreadDisclosureReceipt> {
  try {
    if (db.isTransaction || !input || Object.keys(input).some(key => !['storeTenant', 'threadId', 'operationId', 'expectedSnapshot', 'audience', 'confirmed'].includes(key)) ||
      input.confirmed !== true || !['requester', 'shared_it'].includes(input.audience) || typeof input.expectedSnapshot !== 'string' || !/^[0-9a-f]{64}$/.test(input.expectedSnapshot)) invalid();
    const actor = snapshotCoManagedSessionActor(inputActor), resource = resourceSnapshot(inputResource), reference = target(input);
    const operationId = target({ storeTenant: reference.storeTenant, threadId: input.operationId }).threadId;
    const request = { ...reference, operationId, expectedSnapshot: input.expectedSnapshot, audience: input.audience, confirmed: true };
    if (reference.storeTenant !== actor.tenant || actor.tenant === resource.tenant) deny();
    const requestHash = hash({ resource, actor: { tenant: actor.tenant, userId: actor.userId }, request, command: 'private_thread_disclosure' });
    const withTransfer = <T>(work: (context: CoManagedSharedWorkContext, row: any) => Promise<T>) => withAuthority(db, actor, resource, async context => {
      const owner = tenantDb(context.trx, actor.tenant), row = await owner.table(TABLE).where('operation_id', operationId).forUpdate().first();
      if (!row || row.request_hash !== requestHash || row.customer_tenant !== resource.tenant || row.relationship_id !== resource.relationshipId || Object.entries(coManagedAttachmentParent(resource)).some(([key,value]) => row[key] !== value) ||
        row.source_thread_id !== reference.threadId || row.actor_user_id !== actor.userId || row.audience !== request.audience || row.source_snapshot !== request.expectedSnapshot) throw new CoManagedThreadDisclosureError('THREAD_DISCLOSURE_OPERATION_CONFLICT');
      if (row.status === 'abandoned') conflict();
      if (row.status === 'prepared') await owner.table(TABLE).where('operation_id', operationId).update({ last_activity_at: context.trx.raw('now()') });
      return work(context, row);
    });
    await withAuthority(db, actor, resource, async context => {
      const home = tenantDb(context.trx, actor.tenant), previous = await home.table(TABLE).where('operation_id', operationId).forUpdate().first();
      if (previous) {
        if (previous.request_hash !== requestHash) throw new CoManagedThreadDisclosureError('THREAD_DISCLOSURE_OPERATION_CONFLICT');
        if (previous.status === 'abandoned') conflict(); return;
      }
      const source = await sourceThread(context, reference);
      if (source.preview.snapshot !== request.expectedSnapshot || source.preview.pendingAttachments) conflict();
      const commentMap = Object.fromEntries(source.comments.map(row => [row.comment_id, row.comment_id === source.root.comment_id ? operationId : randomUUID()]));
      const manifest: TransferFile[] = source.files.map(row => {
        const targetId = randomUUID(); return { sourceId: row.attachment_id, targetId, sourceCommentId: row.comment_id,
          path: disclosedAttachmentPath(resource.tenant, actor.tenant, operationId, targetId, resource.kind), copied: false };
      });
      await home.table(TABLE).insert({ tenant: actor.tenant, operation_id: operationId, customer_tenant: resource.tenant, relationship_id: resource.relationshipId, ...coManagedAttachmentParent(resource),
        source_thread_id: reference.threadId, actor_user_id: actor.userId, audience: request.audience, request_hash: requestHash, source_snapshot: request.expectedSnapshot,
        comment_map: JSON.stringify(commentMap), manifest: JSON.stringify(manifest) });
    });
    // Each completed file has its own commit. A lost acknowledgement retries only
    // the same immutable path/bytes; concurrently submitted retries serialize here.
    while (await withTransfer(async (context, row) => {
      if (row.status === 'published') return false;
      const source = await sourceThread(context, reference);
      if (source.preview.snapshot !== row.source_snapshot || source.preview.pendingAttachments) conflict();
      const { manifest } = checkedPlan(row, source, context), pending = manifest.find(file => !file.copied);
      if (!pending) return false;
      const file = source.files.find(file => file.attachment_id === pending.sourceId && file.comment_id === pending.sourceCommentId);
      if (!file || pending.path !== disclosedAttachmentPath(resource.tenant, actor.tenant, operationId, pending.targetId, resource.kind)) conflict();
      await assertCoManagedSessionUnexpired(context.trx, actor); await assertCoManagedOperationalWrite(context.trx, resource.tenant);
      const bytes = await transport.download(assertCoManagedAttachmentPath(file));
      if (bytes.length !== file.file_size || createHash('sha256').update(bytes).digest('hex') !== file.content_hash) conflict();
      await assertCoManagedSessionUnexpired(context.trx, actor); await assertCoManagedOperationalWrite(context.trx, resource.tenant);
      await transport.upload(pending.path, bytes, file.mime_type);
      pending.copied = true;
      await tenantDb(context.trx, actor.tenant).table(TABLE).where('operation_id', operationId).update({ manifest: JSON.stringify(manifest) });
      return true;
    })) { /* resume the next reserved object */ }
    return await withTransfer(async (context, row) => {
      if (row.status === 'published') return checkedReceipt(row);
      const { trx } = context, source = await sourceThread(context, reference), home = tenantDb(trx, actor.tenant), customer = tenantDb(trx, resource.tenant);
      if (source.preview.snapshot !== row.source_snapshot || source.preview.pendingAttachments) conflict();
      const { mapping, manifest } = checkedPlan(row, source, context);
      if (manifest.length !== source.files.length || manifest.some(file => !file.copied) || Object.keys(mapping).length !== source.comments.length || mapping[source.root.comment_id] !== operationId ||
        new Set(Object.values(mapping)).size !== source.comments.length) conflict();
      const actorRefs = new Map<string, string>();
      for (const comment of source.comments) {
        if (!mapping[comment.comment_id]) conflict();
        if (!actorRefs.has(comment.actor_user_id)) {
          const previous = await customer.table('collaboration_actor_references').where({ actor_tenant: actor.tenant, actor_user_id: comment.actor_user_id }).forShare().first();
          let id = previous?.actor_reference_id;
          if (!id) {
            id = randomUUID();
            await customer.table('collaboration_actor_references').insert({ tenant: resource.tenant, actor_reference_id: id, actor_tenant: actor.tenant,
              actor_user_id: comment.actor_user_id, display_name: comment.actor_display_name, organization_name: comment.actor_organization_name }).onConflict(['tenant', 'actor_tenant', 'actor_user_id']).ignore();
            id = (await customer.table('collaboration_actor_references').where({ actor_tenant: actor.tenant, actor_user_id: comment.actor_user_id }).forShare().first()).actor_reference_id;
          }
          actorRefs.set(comment.actor_user_id, id);
        }
      }
      await assertCoManagedSessionUnexpired(trx, actor); await assertCoManagedOperationalWrite(trx, resource.tenant);
      const clock = await trx.raw('SELECT clock_timestamp() AS value'), appliedAt = (clock.rows[0].value as Date).toISOString();
      await customer.table('comment_threads').insert({ tenant: resource.tenant, thread_id: operationId, ...coManagedAttachmentParent(resource), root_comment_id: operationId,
        is_internal: request.audience !== 'requester', collaboration_audience: request.audience, reply_count: source.comments.length - 1,
        created_at: source.thread.created_at_exact, last_activity_at: appliedAt, created_by: null });
      const ordered: any[] = [], remaining = [...source.comments];
      while (remaining.length) {
        const index = remaining.findIndex(comment => !comment.parent_comment_id || ordered.some(parent => parent.comment_id === comment.parent_comment_id));
        if (index < 0) conflict(); ordered.push(...remaining.splice(index, 1));
      }
      for (const comment of ordered) await customer.table(resource.kind === 'project_task' ? 'project_task_comments' : 'comments').insert({ tenant: resource.tenant,
        [resource.kind === 'project_task' ? 'task_comment_id' : 'comment_id']: mapping[comment.comment_id], [resource.kind === 'project_task' ? 'task_id' : 'ticket_id']: resource.id,
        thread_id: operationId, parent_comment_id: comment.parent_comment_id ? mapping[comment.parent_comment_id] : null, user_id: null, author_type: 'internal',
        actor_reference_id: actorRefs.get(comment.actor_user_id), actor_display_name: comment.actor_display_name, actor_organization_name: comment.actor_organization_name,
        note: comment.deleted_at ? '' : comment.note, markdown_content: comment.deleted_at ? '' : comment.markdown_content,
        ...(resource.kind === 'project_task' ? { collaboration_revision: comment.revision } : { contact_id: null, is_internal: request.audience !== 'requester', is_resolution: false, publish_state: 'published' }), created_at: comment.created_at_exact, updated_at: appliedAt, deleted_at: comment.deleted_at_exact });
      for (const file of source.files) {
        const prepared = manifest.find(value => value.sourceId === file.attachment_id && value.sourceCommentId === file.comment_id) ?? conflict();
        if (prepared.path !== disclosedAttachmentPath(resource.tenant, actor.tenant, operationId, prepared.targetId, resource.kind)) conflict();
        await customer.table(FILES).insert({ tenant: resource.tenant, attachment_id: prepared.targetId, customer_tenant: resource.tenant, relationship_id: resource.relationshipId,
          ...coManagedAttachmentParent(resource), thread_id: operationId, comment_id: mapping[file.comment_id], actor_tenant: file.actor_tenant, actor_user_id: file.actor_user_id,
          file_name: file.file_name, mime_type: file.mime_type, file_size: file.file_size, content_hash: file.content_hash,
          request_hash: hash({ requestHash, sourceId: file.attachment_id }), storage_path: prepared.path, status: 'ready', created_at: file.created_at_exact, ready_at: appliedAt,
          disclosure_operation_id: operationId, disclosure_sponsor_tenant: actor.tenant });
      }
      const receipt: CoManagedPrivateThreadDisclosureReceipt = { storeTenant: resource.tenant, threadId: operationId, operationId, audience: request.audience, appliedAt,
        sourceStoreTenant: actor.tenant, sourceThreadId: reference.threadId };
      await home.table('co_management_private_threads').where('thread_id', reference.threadId).update({ disclosure_operation_id: operationId });
      await home.table(TABLE).where('operation_id', operationId).update({ status: 'published', receipt: JSON.stringify(receipt) });
      await afterChange({ ...context, operationId, threadId: operationId, rootCommentId: operationId, commentIds: Object.values(mapping), previousAudience: 'organization_private',
        audience: request.audience, appliedAt, actorReferenceId: actorRefs.get(actor.userId) });
      return receipt;
    });
  } catch (error) {
    if ((error as { code?: string })?.code === '23505' && ['co_management_thread_transfers_pkey', 'comment_threads_pkey', 'comments_pkey', 'project_task_comments_pkey', 'co_management_conversation_attachments_pkey']
      .includes((error as { constraint?: string })?.constraint ?? '')) throw new CoManagedThreadDisclosureError('THREAD_DISCLOSURE_OPERATION_CONFLICT');
    throw error;
  }

}

/** Preserve the existing ticket-only public entry point. */
export async function discloseCoManagedPrivateTicketThread(...args: Parameters<typeof discloseCoManagedPrivateThread>) {
  if (args[2]?.kind !== 'ticket') deny();
  return discloseCoManagedPrivateThread(...args);
}
