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

/**
 * Boards flagged client_portal_visible = false are hidden from every portal
 * user, regardless of visibility group. Subtracting them here means every
 * consumer of the context (lists, dashboards, creation, authorization) inherits
 * the rule without knowing about the flag.
 *
 * Returns the group's list untouched (including a literal null for "no group =
 * all boards") when nothing is hidden, so callers that branch on null keep
 * their existing contract.
 */
async function resolveVisibleBoardIds(
  trx: Knex.Transaction,
  tenant: string,
  groupBoardIds: string[] | null
): Promise<string[] | null> {
  const boards = await tenantScopedTable<{ board_id: string; client_portal_visible: boolean | null }>(
    trx,
    'boards',
    tenant
  ).select('board_id', 'client_portal_visible');

  const visible = boards.filter((board) => board.client_portal_visible !== false);
  if (visible.length === boards.length) {
    return groupBoardIds;
  }

  const visibleIds = new Set(visible.map((board) => board.board_id));
  return groupBoardIds === null
    ? [...visibleIds]
    : groupBoardIds.filter((boardId) => visibleIds.has(boardId));
}

/**
 * The billing profiles this contact may read every ticket of, plus their
 * client's default profile.
 *
 * Only called under contact scope: a client-scoped user already sees the whole
 * client, so loading grants for them would be two queries answering a question
 * nobody asked. Grants are filtered to profiles of the contact's *own* client,
 * so an association left behind by a merge cannot leak another client's
 * tickets.
 */
async function resolveGrantedTicketProfiles(
  trx: Knex.Transaction,
  tenant: string,
  contactId: string,
  clientId: string
): Promise<{ grantedTicketProfileIds: string[]; defaultBillingProfileId: string | null }> {
  const profiles = await tenantScopedTable<{
    billing_profile_id: string;
    is_default: boolean;
    client_id: string;
  }>(
    trx,
    'client_billing_profiles',
    tenant
  )
    .where({ client_id: clientId })
    .select('billing_profile_id', 'is_default');

  const ownedProfileIds = new Set(profiles.map((profile) => profile.billing_profile_id));
  const defaultBillingProfileId =
    profiles.find((profile) => profile.is_default)?.billing_profile_id ?? null;

  const grants = await tenantScopedTable<{
    billing_profile_id: string;
    contact_name_id: string;
    can_view_profile_tickets: boolean;
  }>(
    trx,
    'billing_profile_contacts',
    tenant
  )
    .where({ contact_name_id: contactId, can_view_profile_tickets: true })
    .select('billing_profile_id');

  return {
    grantedTicketProfileIds: grants
      .map((grant) => grant.billing_profile_id)
      .filter((profileId) => ownedProfileIds.has(profileId)),
    defaultBillingProfileId,
  };
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
      visibleBoardIds: await resolveVisibleBoardIds(trx, tenant, null),
      // Client scope already sees every ticket of the client, so a profile
      // grant could only ever be a no-op here.
      grantedTicketProfileIds: [],
      defaultBillingProfileId: null,
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

  const effectiveTicketScope = contact.is_client_admin ? 'client' : group.ticket_scope;
  const profileGrants = effectiveTicketScope === 'contact'
    ? await resolveGrantedTicketProfiles(trx, tenant, contactId, contact.client_id)
    : { grantedTicketProfileIds: [], defaultBillingProfileId: null };

  return {
    ticketScope: group.ticket_scope,
    effectiveTicketScope,
    isClientAdmin: contact.is_client_admin ?? false,
    contactId,
    clientId: contact.client_id,
    visibilityGroupId: contact.portal_visibility_group_id,
    visibleBoardIds: await resolveVisibleBoardIds(trx, tenant, boardIds),
    ...profileGrants,
  };
}
