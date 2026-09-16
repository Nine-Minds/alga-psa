import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  type ContactVisibilityContext,
  VISIBILITY_GROUP_MISMATCH_ERROR,
  VISIBILITY_GROUP_MISSING_ERROR,
} from './clientPortalVisibility';

function tenantScopedTable<Row extends object = Record<string, unknown>>(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string
): Knex.QueryBuilder<Row, Row[]> {
  return tenantDb(conn, tenant).table<Row>(table);
}

export async function getClientContactVisibilityContext(
  trx: Knex.Transaction,
  tenant: string,
  contactId: string
): Promise<ContactVisibilityContext> {
  const contact = await tenantScopedTable<{
    contact_name_id: string;
    client_id: string | null;
    portal_visibility_group_id: string | null;
    is_client_admin: boolean | null;
  }>(trx, 'contacts', tenant)
    .where({
      contact_name_id: contactId
    })
    .first('contact_name_id', 'client_id', 'portal_visibility_group_id', 'is_client_admin');

  if (!contact || !contact.client_id) {
    throw new Error('Contact not associated with a client');
  }

  if (!contact.portal_visibility_group_id) {
    return {
      ticketScope: 'client',
      effectiveTicketScope: 'client',
      isClientAdmin: contact.is_client_admin ?? false,
      contactId,
      clientId: contact.client_id,
      visibilityGroupId: null,
      visibleBoardIds: null,
    };
  }

  const group = await tenantScopedTable<{
    group_id: string;
    client_id: string;
    ticket_scope: 'client' | 'contact';
  }>(trx, 'client_portal_visibility_groups', tenant)
    .where({
      group_id: contact.portal_visibility_group_id
    })
    .first('group_id', 'client_id', 'ticket_scope');

  if (!group) {
    throw new Error(VISIBILITY_GROUP_MISSING_ERROR);
  }

  if (group.client_id !== contact.client_id) {
    throw new Error(VISIBILITY_GROUP_MISMATCH_ERROR);
  }

  if (group.ticket_scope !== 'client' && group.ticket_scope !== 'contact') {
    throw new Error('Assigned visibility group has an invalid ticket scope');
  }

  const boardIds = await tenantDb(trx, tenant)
    .tenantJoin(
      tenantScopedTable<{ board_id: string }>(
        trx,
        'client_portal_visibility_group_boards as cvgb',
        tenant
      ),
      'boards as b',
      'b.board_id',
      'cvgb.board_id'
    )
    .where({
      'cvgb.group_id': contact.portal_visibility_group_id
    })
    .select('cvgb.board_id')
    .then((rows: Array<{ board_id: string }>) => rows.map((row) => row.board_id));

  return {
    ticketScope: group.ticket_scope,
    effectiveTicketScope: contact.is_client_admin ? 'client' : group.ticket_scope,
    isClientAdmin: contact.is_client_admin ?? false,
    contactId,
    clientId: contact.client_id,
    visibilityGroupId: contact.portal_visibility_group_id,
    visibleBoardIds: boardIds,
  };
}
