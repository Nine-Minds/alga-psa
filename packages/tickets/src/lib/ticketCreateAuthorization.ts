import type { Knex } from 'knex';
import { isClientUserType, type ITicket, type IUserWithRoles } from '@alga-psa/types';
import { assertRecordCreateAllowed } from '@alga-psa/authorization/recordCreateAuthorization';
import type { SubjectUserInput } from '@alga-psa/authorization/subject';
import { authorizeTicketRecordAccess, toTicketAuthorizationRecord, type TicketProposedPlacement, type TicketRecordRow } from '@alga-psa/authorization/ticketRecordAuthorization';

/**
 * The create gate shared by every MSP ticket create path: the candidate ticket (client, board, contact,
 * assignee, owner) is judged by the same rules that govern reading it (kernel `create` action). Throws
 * `Permission denied: Cannot create ticket` when the subject's scope does not include it.
 */
export async function assertTicketCreateAllowed(
  trx: Knex.Transaction,
  tenant: string,
  user: SubjectUserInput,
  candidate: Pick<Partial<ITicket>, 'client_id' | 'board_id' | 'contact_name_id' | 'assigned_to' | 'assigned_team_id' | 'entered_by'>,
): Promise<void> {
  const record = toTicketAuthorizationRecord({ ...candidate, entered_by: candidate.entered_by ?? user.user_id ?? undefined });
  // A contact must belong to the ticket's own client; for a scoped subject that is checked against the database.
  await assertRecordCreateAllowed(trx, { tenant, user, resourceType: 'ticket', record, references: ticketReferences(record) }, 'ticket');
}

/** What a ticket points at that must belong to the ticket's own client. */
function ticketReferences(record: { contactId?: string | null }) {
  return [{ table: 'contacts', idColumn: 'contact_name_id', clientColumn: 'client_id', id: record.contactId }];
}

/**
 * The update counterpart of {@link assertTicketCreateAllowed}, for a write path that does not already pass through
 * `authorizeTicketRecordAccess`: the ticket as the write leaves it must stay where a scoped subject (a co-managed
 * seat technician) may work, as well as the ticket as it is stored. A no-op for everyone no built-in rule resolver governs.
 */
export async function assertTicketUpdateAllowed(
  trx: Knex.Transaction,
  tenant: string,
  user: SubjectUserInput,
  current: TicketRecordRow,
  proposed: TicketProposedPlacement,
): Promise<void> {
  // Only an internal principal can be a scoped subject; a portal principal is judged by its own visibility rules elsewhere.
  if (isClientUserType(user.user_type)) return;
  await authorizeTicketRecordAccess({ trx, tenant, user: user as IUserWithRoles, ticketId: current.ticket_id, action: 'update', ticketRow: current, proposed });
}
