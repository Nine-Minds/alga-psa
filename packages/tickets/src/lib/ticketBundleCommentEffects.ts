import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { attachNativeRootToConversation } from '@alga-psa/shared/lib/tickets/namedConversations';
import { maybeReopenBundleMasterFromChildReply } from '../actions/ticketBundleUtils';

/** Existing bundle effects belong to the published default Requester stream.
 * Callers retain their source admission; scoped commands additionally admit
 * every affected ticket before this engine changes it. */
export async function applyTicketBundleCommentEffects(trx: Knex.Transaction, tenant: string, commentId: string,
  userId: string | null, authorizeTarget?: (ticketId: string, effect: 'mirror' | 'reopen') => Promise<void>) {
  const store = tenantDb(trx, tenant);
  const source = await store.table('comments').where('comment_id', commentId).forUpdate().first();
  if (!source || source.is_internal || source.deleted_at || source.publish_state !== 'published' || !source.ticket_id) return;
  const root = await store.table('comment_threads').where({ thread_id: source.thread_id, ticket_id: source.ticket_id }).first();
  const conversation = root?.conversation_id
    ? await store.table('ticket_conversations').where({ conversation_id: root.conversation_id, ticket_id: source.ticket_id,
      ticket_tenant: tenant, audience: 'requester', default_slot: 'requester' }).first()
    : null;
  // Additional Requester, vendor and internal containers never broadcast into a
  // bundle or acquire its child-reply status effects.
  if (!conversation) return;
  const ticket = await store.table('tickets').where('ticket_id', source.ticket_id).first('master_ticket_id');
  if (ticket?.master_ticket_id) {
    const settings = await store.table('ticket_bundle_settings').where('master_ticket_id', ticket.master_ticket_id).forShare().first();
    const master = settings?.reopen_on_child_reply
      ? await store.table('tickets').where('ticket_id', ticket.master_ticket_id).forUpdate().first('status_id') : null;
    const status = master ? await store.table('statuses').where('status_id', master.status_id).first('is_closed') : null;
    if (status?.is_closed) {
      await authorizeTarget?.(ticket.master_ticket_id, 'reopen');
      await maybeReopenBundleMasterFromChildReply(trx, tenant, source.ticket_id, userId);
    }
  }
  const settings = await store.table('ticket_bundle_settings').where('master_ticket_id', source.ticket_id).forShare().first();
  if (settings?.mode !== 'sync_updates') return;
  const children = await store.table('tickets').where('master_ticket_id', source.ticket_id).orderBy('ticket_id').forUpdate().select('ticket_id');
  for (const child of children) {
    if (await store.table('ticket_bundle_mirrors').where({ source_comment_id: commentId, child_ticket_id: child.ticket_id }).first()) continue;
    await authorizeTarget?.(child.ticket_id, 'mirror');
    const ids = await trx.raw('SELECT gen_random_uuid() AS comment_id, gen_random_uuid() AS thread_id');
    const generated = ids.rows?.[0];
    if (!generated?.comment_id || !generated?.thread_id) throw new Error('Database UUID generation did not return mirrored comment/thread identifiers.');
    const now = new Date().toISOString();
    await store.table('comment_threads').insert({ tenant, thread_id: generated.thread_id, ticket_id: child.ticket_id,
      project_task_id: null, root_comment_id: generated.comment_id, is_internal: false, reply_count: 0,
      last_activity_at: now, created_at: now, created_by: null });
    await store.table('comments').insert({ tenant, comment_id: generated.comment_id, thread_id: generated.thread_id,
      ticket_id: child.ticket_id, user_id: null, author_type: 'unknown', note: source.note, is_internal: false,
      is_resolution: source.is_resolution, is_system_generated: true, markdown_content: source.markdown_content, created_at: now });
    const destination = await attachNativeRootToConversation({ trx, ticket: { tenant, ticketId: child.ticket_id }, storeTenant: tenant }, generated.thread_id);
    await store.table('ticket_conversations').where('conversation_id', destination.conversationId)
      .increment('message_version', 1).update({ updated_at: trx.fn.now() });
    await store.table('ticket_bundle_mirrors').insert({ tenant, source_comment_id: commentId, child_ticket_id: child.ticket_id,
      child_comment_id: generated.comment_id });
  }
}
