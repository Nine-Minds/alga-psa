import { Knex } from 'knex';

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

export async function getClientContactVisibilityContext(
  trx: Knex.Transaction,
  tenant: string,
  contactId: string
): Promise<ContactVisibilityContext> {
  const contact = await trx('contacts')
    .where({
      tenant,
      contact_name_id: contactId
    })
    .first('contact_name_id', 'client_id', 'portal_visibility_group_id');

  if (!contact || !contact.client_id) {
    throw new Error('Contact not associated with a client');
  }

  if (!contact.portal_visibility_group_id) {
    return {
      contactId,
      clientId: contact.client_id,
      visibilityGroupId: null,
      visibleBoardIds: null,
    };
  }

  const group = await trx('client_portal_visibility_groups')
    .where({
      tenant,
      group_id: contact.portal_visibility_group_id
    })
    .first('group_id', 'client_id');

  if (!group) {
    throw new Error(VISIBILITY_GROUP_MISSING_ERROR);
  }

  if (group.client_id !== contact.client_id) {
    throw new Error(VISIBILITY_GROUP_MISMATCH_ERROR);
  }

  const boardIds = await trx('client_portal_visibility_group_boards as cvgb')
    .join('boards as b', function() {
      this.on('b.board_id', '=', 'cvgb.board_id')
        .andOn('b.tenant', '=', 'cvgb.tenant');
    })
    .where({
      'cvgb.tenant': tenant,
      'cvgb.group_id': contact.portal_visibility_group_id
    })
    .select('cvgb.board_id')
    .then((rows) => rows.map((row) => row.board_id));

  return {
    contactId,
    clientId: contact.client_id,
    visibilityGroupId: contact.portal_visibility_group_id,
    visibleBoardIds: boardIds,
  };
}

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
