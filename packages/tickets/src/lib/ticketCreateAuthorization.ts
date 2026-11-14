import type { Knex } from 'knex';
import type { ITicket } from '@alga-psa/types';
import { assertRecordCreateAllowed } from '@alga-psa/authorization/recordCreateAuthorization';
import type { SubjectUserInput } from '@alga-psa/authorization/subject';
import { toTicketAuthorizationRecord } from '@alga-psa/authorization/ticketRecordAuthorization';

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
  await assertRecordCreateAllowed(trx, {
    tenant,
    user,
    resourceType: 'ticket',
    record: toTicketAuthorizationRecord({ ...candidate, entered_by: candidate.entered_by ?? user.user_id ?? undefined }),
  }, 'ticket');
}
