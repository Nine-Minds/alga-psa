import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { getClientContactVisibilityContext } from '@alga-psa/shared/lib/tickets/clientPortalVisibility.server';
import { VISIBILITY_GROUP_MISMATCH_ERROR, VISIBILITY_GROUP_MISSING_ERROR } from '@alga-psa/shared/lib/tickets/clientPortalVisibility';
import { CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';
import type { CoManagedCustomerTicketResource } from './customerCommentNotification';
import { readLockedTicketCommentNotification, type TicketCommentNotificationContent } from './ticketCommentNotificationContent';

/** Durable requester identity never substitutes an address for a contact, or a
 * new default location for the location selected by the original discovery. */
export type CoManagedRequesterEmailRecipient =
  | { kind: 'requester_contact'; tenant: string; clientId: string; contactId: string }
  | { kind: 'requester_location'; tenant: string; clientId: string; locationId: string };
export interface CoManagedRequesterCommentEmail extends Omit<TicketCommentNotificationContent<CoManagedCustomerTicketResource>, 'audience'> {
  audience: 'requester';
}
export interface CoManagedRequesterEmailContext {
  trx: Knex.Transaction;
  recipient: CoManagedRequesterEmailRecipient;
  email: string;
  resource: CoManagedCustomerTicketResource;
}
const address = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const validAddress = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

function snapshotRecipient(input: CoManagedRequesterEmailRecipient): CoManagedRequesterEmailRecipient {
  if (!input || ![input.tenant, input.clientId].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  if (input.kind === 'requester_contact' && isCoManagedUuid(input.contactId)) return { kind: input.kind, tenant: input.tenant, clientId: input.clientId, contactId: input.contactId };
  if (input.kind === 'requester_location' && isCoManagedUuid(input.locationId)) return { kind: input.kind, tenant: input.tenant, clientId: input.clientId, locationId: input.locationId };
  throw new CoManagedSharedWorkError();
}
function sameRecipient(a: CoManagedRequesterEmailRecipient, b: CoManagedRequesterEmailRecipient) {
  return a.kind === b.kind && a.tenant === b.tenant && a.clientId === b.clientId &&
    (a.kind === 'requester_contact' && b.kind === 'requester_contact' ? a.contactId === b.contactId
      : a.kind === 'requester_location' && b.kind === 'requester_location' && a.locationId === b.locationId);
}
/** Trusted event discovery may select the current requester once. The callback
 * persists this identity, not a rendered body or email address. */
export async function discoverCoManagedRequesterCommentEmail<T>(db: Knex, resource: CoManagedCustomerTicketResource, commentId: string,
  discover: (context: CoManagedRequesterEmailContext, message: CoManagedRequesterCommentEmail) => Promise<T>): Promise<T | null> {
  return withRequesterEmail(db, null, resource, commentId, discover);
}
/** Background delivery rechecks the originally selected requester. A changed
 * contact/client/default location cancels that recipient; it cannot silently
 * redirect the old event to a newly selected party. This grants no portal session
 * or linked-resource authority. Email preferences remain the adapter's concern. */
export async function withCoManagedRequesterCommentEmail<T>(db: Knex, recipient: CoManagedRequesterEmailRecipient,
  resource: CoManagedCustomerTicketResource, commentId: string,
  deliver: (context: CoManagedRequesterEmailContext, message: CoManagedRequesterCommentEmail) => Promise<T>): Promise<T | null> {
  return withRequesterEmail(db, snapshotRecipient(recipient), resource, commentId, deliver);
}
async function withRequesterEmail<T>(db: Knex, expected: CoManagedRequesterEmailRecipient | null,
  inputResource: CoManagedCustomerTicketResource, commentId: string,
  deliver: (context: CoManagedRequesterEmailContext, message: CoManagedRequesterCommentEmail) => Promise<T>): Promise<T | null> {
  if (!inputResource || inputResource.kind !== 'ticket' || ![inputResource.tenant, inputResource.id, commentId].every(isCoManagedUuid) ||
      (expected && expected.tenant !== inputResource.tenant)) throw new CoManagedSharedWorkError();
  const resource: CoManagedCustomerTicketResource = { tenant: inputResource.tenant, kind: 'ticket', id: inputResource.id };
  return withTransaction(db, async trx => {
    const owner = tenantDb(trx, resource.tenant);
    const tenant = await owner.table('tenants').forShare().first('product_code', 'suspended_at');
    if (!tenant || !['co_managed', 'psa'].includes(tenant.product_code) || tenant.suspended_at) throw new CoManagedSharedWorkError();
    const ticket = await owner.table('tickets').where('ticket_id', resource.id).forShare().first('ticket_id', 'client_id', 'contact_name_id', 'board_id');
    if (!ticket?.client_id) return null;
    const client = await owner.table('clients').where('client_id', ticket.client_id).forShare().first('client_id', 'is_inactive');
    if (!client || client.is_inactive === true) return null;
    const contact = ticket.contact_name_id ? await owner.table('contacts').where('contact_name_id', ticket.contact_name_id).forShare()
      .first('contact_name_id', 'client_id', 'email', 'is_inactive') : null;
    if (ticket.contact_name_id && (!contact || contact.client_id !== ticket.client_id || contact.is_inactive === true)) return null;
    if (contact) {
      // Native contact visibility applies even when this email requester has no
      // portal login. A fallback location cannot bypass a contact's board scope.
      let visibility;
      try { visibility = await getClientContactVisibilityContext(trx, resource.tenant, contact.contact_name_id, { lock: true }); }
      catch (error) {
        if (error instanceof Error && [VISIBILITY_GROUP_MISSING_ERROR, VISIBILITY_GROUP_MISMATCH_ERROR].includes(error.message)) return null;
        throw error;
      }
      if (visibility.clientId !== ticket.client_id || (visibility.visibleBoardIds !== null && !visibility.visibleBoardIds.includes(ticket.board_id))) return null;
    }
    let recipient: CoManagedRequesterEmailRecipient, email: string;
    const contactEmail = address(contact?.email);
    if (contactEmail) {
      if (!validAddress(contactEmail)) return null;
      recipient = { kind: 'requester_contact', tenant: resource.tenant, clientId: ticket.client_id, contactId: contact.contact_name_id };
      email = contactEmail;
    } else {
      const locations = await owner.table('client_locations').where({ client_id: ticket.client_id, is_default: true, is_active: true })
        .orderBy('location_id').forShare().select('location_id', 'email');
      // Ambiguous defaults must be corrected rather than selecting a recipient
      // by incidental row order. Retain the selected location through delivery.
      if (locations.length !== 1 || !validAddress(address(locations[0].email))) return null;
      recipient = { kind: 'requester_location', tenant: resource.tenant, clientId: ticket.client_id, locationId: locations[0].location_id };
      email = address(locations[0].email);
    }
    if (expected && !sameRecipient(expected, recipient)) return null;
    const message = await readLockedTicketCommentNotification({ trx, actor: null, resource, redactedFields: [] }, commentId, ['requester']);
    if (!message || message.audience !== 'requester' || message.author?.kind !== 'user' || !message.author.id) return null;
    const comment = await owner.table('comments').where('comment_id', commentId).first('metadata');
    if (comment?.metadata?.closes_ticket === true) return null;
    if (message.author.tenant === resource.tenant) {
      const author = await owner.table('users').where('user_id', message.author.id).forShare().first('user_type', 'email', 'contact_id');
      if (author?.user_type !== 'internal' || (contact && author.contact_id === contact.contact_name_id) ||
          address(author.email).toLowerCase() === email.toLowerCase()) return null;
    } else if (!message.author.referenceId) return null;
    return deliver({ trx, recipient, resource, email }, { ...message, audience: 'requester' });
  });
}
