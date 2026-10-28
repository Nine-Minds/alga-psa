import type { Knex } from 'knex';

/**
 * Comment-event contributors. A contributor may retain the event in the caller's
 * transaction (for example into an outbox) and return `true`, which suppresses native
 * publication. With no contributor, or when all return `false`, `publishCommentEvent`
 * runs the caller's `native` closure, which is exactly today's publication path.
 *
 * Retention only means something inside the caller's transaction: a write on an
 * autocommit connection would survive the caller's rollback. So the parameter is a
 * `Knex.Transaction` and is asserted before any contributor sees it.
 */

// Lives in @alga-psa/db so tickets, projects, client-portal and shared can all import it
// without a dependency cycle; @alga-psa/tickets re-exports it and proves at compile time
// that every CommentEventType is an event-bus EventType (db cannot import event-schemas).

/** Comment events per source; each name is an `EventType` in `@alga-psa/event-schemas`. */
export interface CommentEventTypesBySource {
  ticket: 'TICKET_COMMENT_ADDED' | 'TICKET_COMMENT_UPDATED';
  'project-task': 'TASK_COMMENT_ADDED' | 'TASK_COMMENT_UPDATED';
}

export type CommentEventSource = keyof CommentEventTypesBySource;
export type CommentEventType = CommentEventTypesBySource[CommentEventSource];

interface CommentEventBase {
  tenantId: string;
  commentId: string;
  userId?: string;
  actor?: unknown;
  metadata?: Record<string, unknown>;
}

export interface TicketCommentEvent extends CommentEventBase {
  eventType: CommentEventTypesBySource['ticket'];
  ticketId: string;
  taskId?: never;
}

export interface ProjectTaskCommentEvent extends CommentEventBase {
  eventType: CommentEventTypesBySource['project-task'];
  taskId: string;
  ticketId?: never;
}

export interface CommentEventsBySource {
  ticket: TicketCommentEvent;
  'project-task': ProjectTaskCommentEvent;
}

export type CommentEvent = CommentEventsBySource[CommentEventSource];

/** What a contributor receives: the source and its event, discriminated together. */
export type CommentEventEnvelope = {
  [S in CommentEventSource]: { source: S; event: CommentEventsBySource[S] };
}[CommentEventSource];

export interface CommentEventContributor {
  name: string;
  /** Resolve `true` when the event was retained in `trx` and native publication must be skipped. */
  retain?: (trx: Knex.Transaction, envelope: CommentEventEnvelope) => Promise<boolean>;
}

const KEY = '__algaCommentEventContributors';

function contributors(): CommentEventContributor[] {
  const g = globalThis as Record<string, unknown>;
  return (g[KEY] ??= []) as CommentEventContributor[];
}

export function registerCommentEventContributor(contributor: CommentEventContributor): void {
  contributors().push(contributor);
}

/** Returns true when a contributor retained the event (native publication skipped). */
export async function publishCommentEvent<S extends CommentEventSource>(
  trx: Knex.Transaction,
  source: S,
  event: CommentEventsBySource[S],
  native?: () => Promise<void>,
): Promise<boolean> {
  const retainers = contributors().filter((contributor) => contributor.retain);
  if (retainers.length > 0) {
    // Checked only when someone would write through trx, so the default path never touches it.
    if (!trx?.isTransaction) {
      throw new Error('publishCommentEvent requires an open transaction when a contributor is registered');
    }
    const envelope = { source, event } as CommentEventEnvelope;
    for (const contributor of retainers) {
      try {
        if (await contributor.retain!(trx, envelope)) return true;
      } catch (error) {
        console.error('[commentEvents] contributor failed; isolated', {
          contributor: contributor.name,
          tenant: event.tenantId,
          source,
          subjectId: envelope.source === 'ticket' ? envelope.event.ticketId : envelope.event.taskId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  if (native) await native();
  return false;
}

/** Test-only. */
export function resetCommentEventContributors(): void {
  contributors().length = 0;
}
