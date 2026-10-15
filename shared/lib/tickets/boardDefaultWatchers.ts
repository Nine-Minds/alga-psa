import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  mergeTicketWatchListRecipients,
  setTicketWatchListOnAttributes,
  type TicketWatchListRecipientInput,
} from './watchList';

/**
 * Board default watchers: internal users seeded into a new ticket's
 * `attributes.watch_list` (source `board_default`) when it is created on the
 * board. After that they follow the ticket through the normal watcher path.
 */

type Conn = Knex | Knex.Transaction;

export const BOARD_DEFAULT_WATCHER_SOURCE = 'board_default';

export async function loadBoardDefaultWatcherUserIds(
  conn: Conn,
  tenant: string,
  boardId: string
): Promise<string[]> {
  return tenantDb(conn, tenant).table('board_default_watchers').where({ board_id: boardId }).pluck('user_id');
}

/** Active internal users with an email, as watch-list recipient inputs. */
export async function loadBoardDefaultWatcherRecipients(
  conn: Conn,
  tenant: string,
  boardId: string | null | undefined
): Promise<TicketWatchListRecipientInput[]> {
  if (!boardId) {
    return [];
  }
  const db = tenantDb(conn, tenant);
  const userIds = await loadBoardDefaultWatcherUserIds(conn, tenant, boardId);
  if (userIds.length === 0) {
    return [];
  }
  const users = await db
    .table('users')
    .select('user_id', 'email', 'first_name', 'last_name')
    .whereIn('user_id', userIds)
    .where({ is_inactive: false, user_type: 'internal' })
    .whereNotNull('email')
    .where('email', '<>', '');

  return users.map((user: any) => ({
    email: user.email as string,
    active: true,
    name: [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || null,
    source: BOARD_DEFAULT_WATCHER_SOURCE,
    entity_type: 'user',
    entity_id: user.user_id as string,
  }));
}

/**
 * Returns `attributes` with the board's default watchers merged into the watch
 * list. Existing entries win, so an inbound To/Cc watcher keeps its source.
 * Returns the input untouched when the board has no usable default watchers.
 */
export async function applyBoardDefaultWatchers(
  conn: Conn,
  tenant: string,
  boardId: string | null | undefined,
  attributes: Record<string, unknown> | null | undefined
): Promise<Record<string, unknown> | null> {
  const recipients = await loadBoardDefaultWatcherRecipients(conn, tenant, boardId);
  if (recipients.length === 0) {
    return attributes ?? null;
  }
  const existing = (attributes as Record<string, unknown> | null | undefined)?.watch_list;
  const merged = mergeTicketWatchListRecipients(existing, recipients);
  return setTicketWatchListOnAttributes(attributes, merged);
}
