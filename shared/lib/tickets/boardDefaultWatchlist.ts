/**
 * Board "Default watchlist" application (alga-2026-0002379).
 *
 * A board can hold a set of recipients — internal users and/or free-form email
 * addresses — that become watchers of every ticket created on it. Watchers are
 * NOT assignees: this never touches `assigned_to`, `assigned_team_id` or
 * `ticket_resources`.
 *
 * The ticket side reuses the existing watcher store: a ticket's watchers are
 * `tickets.attributes.watch_list` entries (see ./watchList.ts), so notification
 * fan-out, the Watch list card and inbound-sender policy all see these watchers
 * with no further wiring. The board document's shape and validation live in
 * ./boardDefaultWatchlistSchema.ts (pure, shared with the settings UI).
 */
import { tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';
import { normalizeEmailAddress } from '../email/addressUtils';
import {
  mergeTicketWatchListRecipients,
  normalizeTicketWatchListEntries,
  type TicketWatchListRecipientInput,
} from './watchList';
import { BOARD_DEFAULT_WATCHLIST_SOURCE, readBoardDefaultWatchlist } from './boardDefaultWatchlistSchema';

export * from './boardDefaultWatchlistSchema';

/**
 * Resolve a board's default watchlist into watch-list recipients for a new
 * ticket. Returns [] when the board is unknown, the feature is off, or the list
 * is empty. Internal users are resolved to their current address; inactive,
 * removed, non-internal or address-less users are skipped. Tenant-scoped.
 */
export async function resolveBoardDefaultWatchers(
  trx: Knex | Knex.Transaction,
  tenant: string,
  boardId: string | null | undefined
): Promise<TicketWatchListRecipientInput[]> {
  if (!boardId) return [];

  const db = tenantDb(trx, tenant);
  const board = await db.table('boards')
    .where({ board_id: boardId })
    .first<{ default_watchlist_enabled?: boolean | null; default_watchlist?: unknown } | undefined>(
      'default_watchlist_enabled',
      'default_watchlist'
    );

  if (!board || board.default_watchlist_enabled !== true) return [];

  const watchlist = readBoardDefaultWatchlist(board.default_watchlist);
  const recipients: TicketWatchListRecipientInput[] = [];

  if (watchlist.user_ids.length > 0) {
    const users = await db.table('users')
      .whereIn('user_id', watchlist.user_ids)
      .where({ user_type: 'internal', is_inactive: false })
      .select('user_id', 'email', 'first_name', 'last_name');

    for (const user of users as Array<{ user_id: string; email: string | null; first_name?: string | null; last_name?: string | null }>) {
      if (!user.email) continue;
      recipients.push({
        email: user.email,
        active: true,
        source: BOARD_DEFAULT_WATCHLIST_SOURCE,
        name: `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || null,
        entity_type: 'user',
        entity_id: user.user_id,
      });
    }
  }

  for (const email of watchlist.emails) {
    recipients.push({ email, active: true, source: BOARD_DEFAULT_WATCHLIST_SOURCE });
  }

  return recipients;
}

/**
 * Merge a board's default watchers into a ticket's initial watch list. Existing
 * entries (from the creation input, e.g. inbound-email To/Cc) win on conflict,
 * so a watcher already present — even one the requester deactivated — is never
 * duplicated or re-activated.
 */
export function withBoardDefaultWatchers(
  attributes: Record<string, unknown> | null | undefined,
  defaults: TicketWatchListRecipientInput[]
): Record<string, unknown> | null | undefined {
  if (defaults.length === 0) return attributes;

  const next: Record<string, unknown> = { ...(attributes ?? {}) };
  const existing = normalizeTicketWatchListEntries(next.watch_list);
  const present = new Set(existing.map((entry) => entry.email));
  const additions = defaults.filter((recipient) => {
    const email = normalizeEmailAddress(recipient.email);
    return !!email && !present.has(email);
  });
  if (additions.length === 0) return attributes;

  next.watch_list = mergeTicketWatchListRecipients(existing, additions);
  return next;
}
