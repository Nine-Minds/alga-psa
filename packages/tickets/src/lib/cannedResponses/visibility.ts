// Pure visibility rules for canned responses. One definition drives both the SQL filter the actions apply
// and the in-memory check (and its tests), so the two cannot drift.
//
//   personal       -> only its owner
//   team           -> members of that team
//   board          -> tickets on that board
//   client_portal  -> only on the client-portal surface
//
// `all` is for the admin library, where a manager sees every shared response to maintain it; personal
// responses of other users are never visible to anyone.

import type { Knex } from 'knex';
import type { CannedResponseScope, CannedResponseSurface } from '@alga-psa/types';

export interface CannedResponseVisibility {
  userId: string;
  /** Teams the viewer belongs to, or 'all' (library management). */
  teamIds: readonly string[] | 'all';
  /** Boards whose responses are offered: the ticket's board, or 'all' (library management). */
  boardIds: readonly string[] | 'all';
  /** Offer client_portal responses. */
  includeClientPortal: boolean;
}

export interface CannedResponseVisibilityRow {
  scope: CannedResponseScope;
  owner_user_id: string | null;
  team_id: string | null;
  board_id: string | null;
}

/** Visibility for the quick-insert picker on a given surface and ticket board. */
export function pickerVisibility(input: {
  userId: string;
  teamIds: readonly string[];
  boardId: string | null | undefined;
  surface: CannedResponseSurface;
}): CannedResponseVisibility {
  return {
    userId: input.userId,
    teamIds: input.teamIds,
    boardIds: input.boardId ? [input.boardId] : [],
    includeClientPortal: input.surface === 'client_portal',
  };
}

/** Visibility for the admin library. */
export function libraryVisibility(userId: string): CannedResponseVisibility {
  return { userId, teamIds: 'all', boardIds: 'all', includeClientPortal: true };
}

export function isCannedResponseVisible(row: CannedResponseVisibilityRow, viewer: CannedResponseVisibility): boolean {
  switch (row.scope) {
    case 'personal':
      return row.owner_user_id !== null && row.owner_user_id === viewer.userId;
    case 'team':
      return row.team_id !== null && (viewer.teamIds === 'all' || viewer.teamIds.includes(row.team_id));
    case 'board':
      return row.board_id !== null && (viewer.boardIds === 'all' || viewer.boardIds.includes(row.board_id));
    case 'client_portal':
      return viewer.includeClientPortal;
    default:
      return false;
  }
}

export function filterVisibleCannedResponses<T extends CannedResponseVisibilityRow>(
  rows: readonly T[],
  viewer: CannedResponseVisibility
): T[] {
  return rows.filter((row) => isCannedResponseVisible(row, viewer));
}

/**
 * Applies the same rules as isCannedResponseVisible to a knex query as a single parenthesised OR group.
 * `column` maps a column name to its (optionally alias-qualified) form.
 */
export function applyVisibilityToQuery(
  query: Knex.QueryBuilder,
  viewer: CannedResponseVisibility,
  column: (name: 'scope' | 'owner_user_id' | 'team_id' | 'board_id') => string = (name) => name
): Knex.QueryBuilder {
  return query.where((group) => {
    group.orWhere((personal) => {
      personal.where(column('scope'), 'personal').where(column('owner_user_id'), viewer.userId);
    });

    if (viewer.teamIds === 'all') {
      group.orWhere((team) => { team.where(column('scope'), 'team'); });
    } else if (viewer.teamIds.length > 0) {
      group.orWhere((team) => {
        team.where(column('scope'), 'team').whereIn(column('team_id'), viewer.teamIds as string[]);
      });
    }

    if (viewer.boardIds === 'all') {
      group.orWhere((board) => { board.where(column('scope'), 'board'); });
    } else if (viewer.boardIds.length > 0) {
      group.orWhere((board) => {
        board.where(column('scope'), 'board').whereIn(column('board_id'), viewer.boardIds as string[]);
      });
    }

    if (viewer.includeClientPortal) {
      group.orWhere((portal) => { portal.where(column('scope'), 'client_portal'); });
    }
  });
}
