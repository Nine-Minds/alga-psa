import { syncCoManagedTicketAwaitingClientSla } from './ticketSla';
import { tenantDb } from '@alga-psa/db';
import { getClientContactVisibilityContext } from '@alga-psa/shared/lib/tickets/clientPortalVisibility.server';
import { VISIBILITY_GROUP_MISMATCH_ERROR, VISIBILITY_GROUP_MISSING_ERROR } from '@alga-psa/shared/lib/tickets/clientPortalVisibility';
import type { RequesterReplyAdmission } from '../../../shared/services/email/requesterReplyAdmission';
import { withCoManagedRequesterEmailReply } from './requesterReplyTokens';
import { CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';

/** Worker composition adapter. Only an authorization rejection is terminal;
 * database/writer failures propagate so the durable inbox can retry safely. */
export const admitCoManagedRequesterReply: RequesterReplyAdmission = async (trx, input, write) => {
  if (!trx?.isTransaction) throw new Error('Requester reply admission requires the owning inbox transaction');
  try {
    // Rejection can happen after a writer await (expiry/destination admission).
    // Roll back those writes to a savepoint before the inbox records quarantine.
    const result = await trx.transaction(savepoint => withCoManagedRequesterEmailReply(savepoint, input, async context => {
      const written = await write({
        kind: 'requester', audience: 'requester',
        ticketId: context.resource.id, parentCommentId: context.parentCommentId, clientId: context.recipient.clientId,
        contactId: context.recipient.kind === 'requester_contact' ? context.recipient.contactId : undefined,
        senderEmail: context.senderEmail,
        assertDestination: async destination => {
          if (!destination || destination.clientId !== context.recipient.clientId || !isCoManagedUuid(destination.boardId)) throw new CoManagedSharedWorkError();
          const owner = tenantDb(context.trx, context.resource.tenant);
          if (!await owner.table('boards').where('board_id', destination.boardId).forShare().first('board_id')) throw new CoManagedSharedWorkError();
          const source = await owner.table('tickets').where('ticket_id', context.resource.id).first('contact_name_id');
          if (source?.contact_name_id) {
            let visibility;
            try { visibility = await getClientContactVisibilityContext(context.trx, context.resource.tenant, source.contact_name_id, { lock: true }); }
            catch (error) {
              if (error instanceof Error && [VISIBILITY_GROUP_MISSING_ERROR, VISIBILITY_GROUP_MISMATCH_ERROR].includes(error.message)) throw new CoManagedSharedWorkError();
              throw error;
            }
            if (visibility.clientId !== destination.clientId || (visibility.visibleBoardIds !== null && !visibility.visibleBoardIds.includes(destination.boardId))) throw new CoManagedSharedWorkError();
          }
        },
      });
      await syncCoManagedTicketAwaitingClientSla(context.trx, context.resource.tenant, context.resource.id);
      return written;
    }));
    return { admitted: true, result };
  } catch (error) {
    if (error instanceof CoManagedSharedWorkError) return { admitted: false };
    throw error;
  }
};
