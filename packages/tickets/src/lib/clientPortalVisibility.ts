import type { Knex } from 'knex';

export interface ContactVisibilityContext {
  contactId: string;
  clientId: string;
  visibilityGroupId: string | null;
  visibleBoardIds: string[] | null;
}

export const VISIBILITY_GROUP_MISMATCH_ERROR =
  'Assigned visibility group does not match contact client';
export const VISIBILITY_GROUP_MISSING_ERROR =
  'Assigned visibility group is missing or inaccessible';

export function applyVisibilityBoardFilter(
  query: Knex.QueryBuilder,
  visibleBoardIds: string[] | null,
  boardColumn = 't.board_id'
): Knex.QueryBuilder {
  if (visibleBoardIds === null) {
    return query;
  }

  if (visibleBoardIds.length === 0) {
    query.whereRaw('1 = 0');
    return query;
  }

  query.whereIn(boardColumn, visibleBoardIds);
  return query;
}
