import type { Knex } from 'knex';

/**
 * Comment-event contributors. A contributor may retain the event in the caller's
 * transaction (for example into an outbox) and return `true`, which suppresses native
 * publication. With no contributor, or when all return `false`, `publishCommentEvent`
 * runs the caller's `native` closure, which is exactly today's publication path.
 */

export type CommentEventSource = 'ticket' | 'project-task';

export interface CommentEvent {
  tenantId: string;
  ticketId: string;
  commentId: string;
  userId?: string;
  actor?: unknown;
  metadata?: Record<string, unknown>;
}

export interface CommentEventContributor {
  name: string;
  /** Resolve `true` when the event was retained and native publication must be skipped. */
  retain?: (trx: Knex | Knex.Transaction, source: CommentEventSource, event: CommentEvent) => Promise<boolean>;
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
export async function publishCommentEvent(
  trx: Knex | Knex.Transaction,
  source: CommentEventSource,
  event: CommentEvent,
  native?: () => Promise<void>,
): Promise<boolean> {
  for (const contributor of [...contributors()]) {
    if (!contributor.retain) continue;
    try {
      if (await contributor.retain(trx, source, event)) return true;
    } catch (error) {
      console.error('[commentEvents] contributor failed; isolated', {
        contributor: contributor.name,
        tenant: event.tenantId,
        ticketId: event.ticketId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (native) await native();
  return false;
}

/** Test-only. */
export function resetCommentEventContributors(): void {
  contributors().length = 0;
}
