import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing';
import type { AuthorizationRecord } from '@alga-psa/authorization';
import { allowsContactSenderAttribution, allowsInternalSenderAttribution, type SenderAuthResults } from '@alga-psa/shared/lib/email/senderAuthVerification';
import { getClientContactVisibilityContext } from '@alga-psa/shared/lib/tickets/clientPortalVisibility.server';
import { VISIBILITY_GROUP_MISMATCH_ERROR, VISIBILITY_GROUP_MISSING_ERROR } from '@alga-psa/shared/lib/tickets/clientPortalVisibility';
import type { AdmittedEmailReply } from '@alga-psa/shared/services/email/qualifiedReplyAdmission';
import { conversationUuid, TicketConversationError } from '@alga-psa/shared/lib/tickets/namedConversations';
import { authorizeCoManagedWorkRecord, lockCoManagedRecipientIdentity } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';

const deny = (): never => { throw new TicketConversationError('CONVERSATION_FORBIDDEN'); };
const normalize = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : '';

/** Called only after named routing has retained the mailbox, accepted Send and
 * requester source. A reviewed recipient may correspond by email without an
 * application account. An address never supplies a privileged staff identity
 * without stronger MTA authentication and current owner resource permissions. */
export async function admitNamedRequesterReplyIdentity(trx: Knex.Transaction, input: {
  tenant: string; ticketId: string; parentCommentId: string; senderEmail: string;
  senderAuth: SenderAuthResults | null; envelope: { to: { email: string }[]; cc: { email: string }[] };
}): Promise<AdmittedEmailReply & { audience: 'requester' }> {
  if (!trx?.isTransaction || ![input.tenant, input.ticketId, input.parentCommentId].every(conversationUuid) ||
      (!allowsContactSenderAttribution(input.senderAuth) && !allowsInternalSenderAttribution(input.senderAuth))) return deny();
  const senderEmail = normalize(input.senderEmail);
  if (!senderEmail || ![...(input.envelope?.to ?? []), ...(input.envelope?.cc ?? [])].some(recipient => normalize(recipient.email) === senderEmail)) return deny();
  const owner = tenantDb(trx, input.tenant);
  await assertCoManagedOperationalWrite(trx, input.tenant);
  const ticket = await owner.table('tickets').where('ticket_id', input.ticketId).forUpdate().first();
  if (!ticket?.client_id || !await owner.table('clients').where('client_id', ticket.client_id)
    .where(query => query.where('is_inactive', false).orWhereNull('is_inactive')).forShare().first()) return deny();
  const assertContactBoard = async (contactId: string, boardId: string) => {
    const contact = await owner.table('contacts').where({ contact_name_id: contactId, client_id: ticket.client_id })
      .where(query => query.where('is_inactive', false).orWhereNull('is_inactive')).forShare().first();
    if (!contact) return deny();
    let visibility;
    try { visibility = await getClientContactVisibilityContext(trx, input.tenant, contactId, { lock: true }); }
    catch (error) {
      if (error instanceof Error && [VISIBILITY_GROUP_MISMATCH_ERROR, VISIBILITY_GROUP_MISSING_ERROR].includes(error.message)) return deny();
      throw error;
    }
    if (visibility.clientId !== ticket.client_id || (visibility.visibleBoardIds !== null && !visibility.visibleBoardIds.includes(boardId))) return deny();
  };
  const users = await owner.table('users').where('user_type', 'internal').whereRaw('lower(trim(email)) = ?', [senderEmail]).forShare().select('user_id');
  if (users.length > 1) return deny();
  let userId: string | undefined, contactId: string | undefined;
  let assertTechnicianDestination: ((boardId: string, create: boolean) => Promise<void>) | undefined;
  if (users.length) {
    if (!allowsInternalSenderAttribution(input.senderAuth)) return deny();
    userId = users[0].user_id;
    const actor = { tenant: input.tenant, userId: userId! };
    const subject = await lockCoManagedRecipientIdentity(trx, actor);
    assertTechnicianDestination = async (boardId, create) => {
      // LEVERAGE: pattern customer-ticket-policy-record — named requester mail uses the owner projection for current writes and follow-up creation.
      const record: AuthorizationRecord = { id: ticket.ticket_id, clientId: ticket.client_id, boardId,
        ownerUserId: create ? actor.userId : ticket.entered_by, assignedUserIds: create ? [] : ticket.assigned_to ? [ticket.assigned_to] : [],
        teamIds: create ? [] : ticket.assigned_team_id ? [ticket.assigned_team_id] : [] };
      for (const action of create ? ['create'] as const : ['read', 'update'] as const) {
        const decision = await authorizeCoManagedWorkRecord(trx, actor, subject, 'ticket', action, record);
        if (isCoManagedReadFieldHidden(decision.redactedFields, ['conversation', 'comments', 'comment_threads', 'note', 'markdown_content',
          'thread_id', 'parent_comment_id', 'collaboration_audience', 'response_state', 'tickets.response_state'])) return deny();
      }
    };
    await assertTechnicianDestination(ticket.board_id, false);
  } else {
    if (!allowsContactSenderAttribution(input.senderAuth)) return deny();
    // Do not silently attribute a foreign, inactive or ambiguous contact to the
    // ticket's primary requester. Unknown explicitly addressed people retain
    // external authorship and acquire neither a contact nor portal capability.
    const aliases = await owner.table('contact_additional_email_addresses').where('normalized_email_address', senderEmail).forShare().select('contact_name_id');
    const contacts = await owner.table('contacts').where(query => query.whereRaw('lower(trim(email)) = ?', [senderEmail])
      .orWhereIn('contact_name_id', aliases.map(row => row.contact_name_id))).forShare().select('contact_name_id', 'client_id', 'is_inactive');
    if (contacts.length > 1 || (contacts.length && (contacts[0].client_id !== ticket.client_id || contacts[0].is_inactive))) return deny();
    contactId = contacts[0]?.contact_name_id;
    if (contactId) await assertContactBoard(contactId, ticket.board_id);
    if (ticket.contact_name_id && ticket.contact_name_id !== contactId) await assertContactBoard(ticket.contact_name_id, ticket.board_id);
  }
  const assertDestination = async (destination: { clientId: string; boardId: string }) => {
    await assertCoManagedOperationalWrite(trx, input.tenant);
    if (!destination || destination.clientId !== ticket.client_id || !conversationUuid(destination.boardId) ||
        !await owner.table('boards').where('board_id', destination.boardId).forShare().first()) return deny();
    if (assertTechnicianDestination) await assertTechnicianDestination(destination.boardId, true);
    else {
      if (contactId) await assertContactBoard(contactId, destination.boardId);
      if (ticket.contact_name_id && ticket.contact_name_id !== contactId) await assertContactBoard(ticket.contact_name_id, destination.boardId);
    }
  };
  const base = { audience: 'requester' as const, ticketId: input.ticketId, parentCommentId: input.parentCommentId,
    clientId: ticket.client_id, senderEmail, assertDestination };
  return userId ? { ...base, kind: 'customer_technician', userId } : { ...base, kind: 'requester', ...(contactId ? { contactId } : {}) };
}
