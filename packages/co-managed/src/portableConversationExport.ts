import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { isCommentAudienceVisible, resolveCommentAudienceForRead, type CommentAudience } from '@alga-psa/shared/lib/commentAudience';
import { portableSnapshotTransaction } from './portableSnapshot';
import { validatePortableRecordSection, type PortableRecords } from './portableRecordValidation';
import type { PortableContributor } from './portableContributorRegistry';
import { withCoManagedExportAdmin } from './portableExport';
import { hasCoManagedLocalPermission } from './localPermission';
import { projectTaskAudience } from './projectTaskAudience';
import { CoManagedSharedWorkError, isCoManagedUuid, snapshotCoManagedSessionActor } from './sharedWorkIdentity';

/** Conversation text, threads, reactions and audience labels belong to `work`.
 * This contributor owns the one conversation table `work` does not: the
 * attachment links of ticket comments. `draft` uploads were never part of a
 * conversation and are excluded; `removed` rows are access tombstones and stay.
 * Attachment bytes travel with the documents contributor, not here.
 * L4b's co_management_conversation_attachments does not exist on this base and
 * is therefore not read. */
export const CO_MANAGED_PORTABLE_CONVERSATION_COLUMNS = {
  ticket_comment_attachments: ['attachment_id', 'ticket_id', 'document_id', 'created_by', 'comment_id', 'state', 'created_at', 'expires_at'],
} as const;
export const CO_MANAGED_PORTABLE_CONVERSATION_REFERENCES = [
  ['ticket_comment_attachments', 'ticket_id', 'tickets', 'ticket_id'],
] as const;
const STATES = ['attached', 'removed'] as const;
const LIMIT = 100_000, CHUNK = 1000;
type Rows = Record<string, unknown>[];

/** THE audience function of this export. Ticket threads follow the shared reader
 * twin; project-task threads keep their stricter native rule. A row is exportable
 * only when the shared visibility predicate admits it for the owning tenant. */
export function portableConversationAudience(thread: { collaboration_audience?: unknown; is_internal?: unknown; project_task_id?: unknown }): CommentAudience {
  return thread.project_task_id ? projectTaskAudience(thread as { collaboration_audience?: string | null; is_internal?: boolean | null })
    : resolveCommentAudienceForRead(thread);
}
export const portableConversationVisible = (audience: CommentAudience, tenant: string) => isCommentAudienceVisible(audience, tenant, tenant);

export function validateCoManagedPortableConversationRecords(input: unknown, workspace?: PortableRecords): asserts input is PortableRecords {
  validatePortableRecordSection(input, { columns: CO_MANAGED_PORTABLE_CONVERSATION_COLUMNS, references: CO_MANAGED_PORTABLE_CONVERSATION_REFERENCES });
  const rows = (input as PortableRecords).ticket_comment_attachments;
  if (rows.some(row => !(STATES as readonly unknown[]).includes(row.state) || (row.state === 'attached' && !row.comment_id))) throw new Error('Invalid portable conversation attachment');
  if (!workspace) return;
  // MSP-private conversation stores live in the author tenant and may never ride in a customer package.
  if (Object.keys(workspace).some(table => table.startsWith('co_management_private_'))) throw new Error('Portable conversation carries MSP-private records');
  const comments = new Map((workspace.comments ?? []).map(row => [String(row.comment_id), row]));
  const threads = new Map((workspace.comment_threads ?? []).map(row => [String(row.thread_id), row]));
  for (const row of rows.filter(row => row.state === 'attached')) {
    const comment = comments.get(String(row.comment_id));
    const thread = comment && threads.get(String(comment.thread_id));
    if (!comment || !thread || comment.ticket_id !== row.ticket_id) throw new Error('Portable conversation attachment has no exported comment');
  }
}

async function retainCoManagedPortableConversation(trx: Knex.Transaction, inputActor: Parameters<typeof snapshotCoManagedSessionActor>[0], packageId: string) {
  if (!trx.isTransaction) throw new Error('Portable retention requires a transaction');
  const actor = snapshotCoManagedSessionActor(inputActor);
  if (!isCoManagedUuid(packageId)) throw new CoManagedSharedWorkError();
  return withCoManagedExportAdmin(trx, actor, async (current, verified) => {
    if (!await hasCoManagedLocalPermission(current, verified, 'ticket', 'read', true)) throw new CoManagedSharedWorkError();
    const own = tenantDb(current, verified.tenant), columns = CO_MANAGED_PORTABLE_CONVERSATION_COLUMNS.ticket_comment_attachments;
    const all: Rows = await own.table('ticket_comment_attachments').whereIn('state', [...STATES]).orderBy('attachment_id')
      .select(...columns).limit(LIMIT + 1).forShare();
    if (all.length > LIMIT) throw new Error('Portable conversation attachment limit exceeded');
    const ticketIds = new Set<string>();
    const ids = [...new Set(all.map(row => String(row.ticket_id)))];
    for (let offset = 0; offset < ids.length; offset += CHUNK) {
      for (const row of await own.table('tickets').whereIn('ticket_id', ids.slice(offset, offset + CHUNK)).select('ticket_id').forShare()) ticketIds.add(String(row.ticket_id));
    }
    const commentIds = [...new Set(all.map(row => row.comment_id).filter((id): id is string => typeof id === 'string'))];
    const comments = new Map<string, Record<string, unknown>>(), threads = new Map<string, Record<string, unknown>>();
    for (let offset = 0; offset < commentIds.length; offset += CHUNK) {
      for (const row of await own.table('comments').whereIn('comment_id', commentIds.slice(offset, offset + CHUNK))
        .select('comment_id', 'thread_id', 'ticket_id').forShare()) comments.set(String(row.comment_id), row);
    }
    const threadIds = [...new Set([...comments.values()].map(row => row.thread_id).filter((id): id is string => typeof id === 'string'))];
    for (let offset = 0; offset < threadIds.length; offset += CHUNK) {
      for (const row of await own.table('comment_threads').whereIn('thread_id', threadIds.slice(offset, offset + CHUNK))
        .select('thread_id', 'project_task_id', 'collaboration_audience', 'is_internal').forShare()) threads.set(String(row.thread_id), row);
    }
    let orphaned = 0, hidden = 0;
    const records = { ticket_comment_attachments: all.filter(row => {
      if (!ticketIds.has(String(row.ticket_id))) { orphaned++; return false; }
      if (row.comment_id === null) return row.state === 'removed';
      const comment = comments.get(String(row.comment_id)), thread = comment && threads.get(String(comment.thread_id));
      // The comment or thread is gone: only a tombstone can survive that, and it names no content.
      if (!comment || !thread) { if (row.state === 'removed') return true; hidden++; return false; }
      if (!portableConversationVisible(portableConversationAudience(thread), verified.tenant)) { hidden++; return false; }
      return true;
    }) } as PortableRecords;
    validateCoManagedPortableConversationRecords(records);
    const exclusions = [
      { class: 'msp_private', name: 'co_management_private_threads', reason: 'MSP-private conversations live in the author tenant, are never customer data, and are not in this package.' },
      { class: 'msp_private', name: 'co_management_private_comments', reason: 'MSP-private comment bodies and their tombstones remain in the author tenant.' },
      { class: 'deferred_domain', name: 'co_management_conversation_attachments', reason: 'The L4b conversation-attachment store does not exist on this base; only ticket_comment_attachments is exported.' },
      { class: 'deferred_domain', name: 'ticket_comment_attachments_draft', reason: `Draft uploads are not conversation state and are excluded; ${orphaned} orphaned and ${hidden} audience-hidden attachment rows were skipped.` },
    ];
    return { records: JSON.parse(JSON.stringify(records)) as PortableRecords,
      annotations: { exclusions, audienceRule: 'portableConversationAudience+isCommentAudienceVisible', attachmentStates: STATES } };
  });
}

// LEVERAGE: pattern portable-contributor-boilerplate — repeats the admission wrapper, permission check, tenantDb handle and JSON round-trip of the core/work/assets contributors.
export const portableConversationContributor: PortableContributor = {
  id: 'conversations', version: 1, reason: 'customer-visible conversation attachment links and tombstones',
  columns: CO_MANAGED_PORTABLE_CONVERSATION_COLUMNS, references: CO_MANAGED_PORTABLE_CONVERSATION_REFERENCES,
  export: async ctx => {
    if (ctx.db.isTransaction) throw new Error('Portable export requires a root database connection');
    const actor = snapshotCoManagedSessionActor(ctx.actor);
    if (!isCoManagedUuid(ctx.packageId)) throw new CoManagedSharedWorkError();
    // LEVERAGE: pattern portable-export-is-snapshot-retain — export is the retain run at the shared snapshot.
    return portableSnapshotTransaction(ctx.db, ctx.snapshot, trx => retainCoManagedPortableConversation(trx, actor, ctx.packageId));
  },
  retain: ctx => retainCoManagedPortableConversation(ctx.trx, ctx.actor, ctx.packageId),
  validate: (records, workspace) => validateCoManagedPortableConversationRecords(records, workspace),
};
