import type { Knex } from 'knex';
import { type ITicket, type IUserWithRoles } from '@alga-psa/types';
import { assertRecordCreateAllowed, resolverGovernedEvaluation } from '@alga-psa/authorization/recordCreateAuthorization';
import type { SubjectUserInput } from '@alga-psa/authorization/subject';
import { hasPermission } from '@alga-psa/authorization/rbac';
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
  candidate: Pick<Partial<ITicket>, 'client_id' | 'board_id' | 'contact_name_id' | 'assigned_to' | 'assigned_team_id' | 'entered_by'> & {
    /** Only a profile the caller supplied; one the server derives (inherited from an asset) is not passed here. */
    billing_profile_id?: string | null;
  },
): Promise<void> {
  const record = toTicketAuthorizationRecord({ ...candidate, entered_by: candidate.entered_by ?? user.user_id ?? undefined });
  // A contact must belong to the ticket's own client; for a scoped subject that is checked against the database.
  const billingProfileId = candidate.billing_profile_id || null;
  await assertRecordCreateAllowed(
    trx,
    { tenant, user, resourceType: 'ticket', record, references: ticketReferences(record, billingProfileId) },
    'ticket',
  );
  // A caller-supplied billing profile picks the invoice the ticket's charges land on: a seat technician holds no
  // billing permission, so it needs `billing:update` (its ownership is checked above as a client-owned reference).
  if (billingProfileId) {
    const governed = await resolverGovernedEvaluation(trx, { tenant, user, resourceType: 'ticket', action: 'create', record });
    if (governed && !(await hasPermission({ ...(user as IUserWithRoles), tenant }, 'billing', 'update', trx))) {
      throw new Error('Permission denied: Cannot set ticket billing profile');
    }
  }
}

/** What a ticket points at that must belong to the ticket's own client. */
function ticketReferences(record: { contactId?: string | null }, billingProfileId: string | null) {
  return [
    { table: 'contacts', idColumn: 'contact_name_id', clientColumn: 'client_id', id: record.contactId },
    { table: 'client_billing_profiles', idColumn: 'billing_profile_id', clientColumn: 'client_id', id: billingProfileId },
  ];
}

/**
 * The update counterpart of {@link assertTicketCreateAllowed}, for a write path whose own authorization judges the
 * stored row only: for a scoped subject (a co-managed seat technician), the stored ticket and the ticket as the write
 * leaves it must both be where the subject may work. Returns before any kernel evaluation, and adds no rule, for
 * every subject no built-in rule resolver governs.
 */
export async function assertTicketUpdateAllowed(
  trx: Knex.Transaction,
  tenant: string,
  user: SubjectUserInput,
  current: TicketRecordRow,
  proposed: TicketProposedPlacement,
): Promise<void> {
  const governed = await resolverGovernedEvaluation(trx, {
    tenant, user, resourceType: 'ticket', action: 'update', record: toTicketAuthorizationRecord(current as Partial<ITicket>),
  });
  if (!governed) return;
  await authorizeTicketRecordAccess({ trx, tenant, user: user as IUserWithRoles, ticketId: current.ticket_id, action: 'update', ticketRow: current, proposed });
}
