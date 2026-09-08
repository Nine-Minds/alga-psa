import { auditCloseRulesBypassIfGated } from '@alga-psa/shared/lib/ticketCloseRules';
import { TICKET_ACTIVITY_ACTOR, TICKET_ACTIVITY_SOURCE } from '@alga-psa/shared/lib/ticketActivity';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing/lifecycle';
import type { WorkflowTicketMutationAdapter } from '../../../shared/workflow/runtime/registries/workflowTicketMutationRegistry';
import { hasCoManagedConversationOwnership } from './nativeConversationEvents';
import { CoManagedSharedWorkError } from './sharedWorkIdentity';
import { retainCoManagedWorkflowTicketAuthority } from './workflowTicketAuthority';
import { enqueueCoManagedWorkflowTicketEmail } from './workflowTicketEmails';
import { recordCoManagedTicketResolution, recordCoManagedTicketReopened, syncCoManagedTicketAwaitingClientSla } from './ticketSla';

/** The actual executing version supplies the customer actor. A workflow's
 * claimed user or guessed ticket ID cannot stand in for current authority. */
export const withCoManagedWorkflowTicketMutation: WorkflowTicketMutationAdapter = async (trx, input, write) => {
  if (!trx.isTransaction) throw new Error('Workflow ticket mutation requires its source transaction');
  if (!await hasCoManagedConversationOwnership(trx, input.tenant)) return write({});
  const { owner, before, actor, authorize, activeRun } = await retainCoManagedWorkflowTicketAuthority(trx, input);
  const previousStatus = await owner.table('statuses').where('status_id', before.status_id).forShare().first('is_closed');
  const result = await write({ deferRequesterCloseEmail: email => enqueueCoManagedWorkflowTicketEmail(trx, input, email) });
  const after = await owner.table('tickets').where('ticket_id', input.ticketId).first();
  if (!after) throw new CoManagedSharedWorkError();
  await authorize(after);
  const status = await owner.table('statuses').where('status_id', after.status_id).forShare().first('is_closed');
  if (status?.is_closed && !previousStatus?.is_closed) {
    if (!input.closeRulesAudited) await auditCloseRulesBypassIfGated(trx, input.tenant, input.ticketId, after.board_id, 'workflow',
      { actorType: TICKET_ACTIVITY_ACTOR.WORKFLOW, userId: actor.userId }, TICKET_ACTIVITY_SOURCE.WORKFLOW);
    await recordCoManagedTicketResolution(trx, input.tenant, input.ticketId);
  }
  else if (!status?.is_closed && previousStatus?.is_closed) await recordCoManagedTicketReopened(trx, input.tenant, input.ticketId);
  if (after.response_state !== before.response_state) await syncCoManagedTicketAwaitingClientSla(trx, input.tenant, input.ticketId);
  await assertCoManagedOperationalWrite(trx, input.tenant);
  if (!await activeRun().first('run_id')) throw new CoManagedSharedWorkError();
  return result;
};
