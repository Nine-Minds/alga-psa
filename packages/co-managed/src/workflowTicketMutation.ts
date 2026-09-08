import { auditCloseRulesBypassIfGated } from '@alga-psa/shared/lib/ticketCloseRules';
import { TICKET_ACTIVITY_ACTOR, TICKET_ACTIVITY_SOURCE } from '@alga-psa/shared/lib/ticketActivity';
import { tenantDb } from '@alga-psa/db';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing/lifecycle';
import type { WorkflowTicketMutationAdapter } from '../../../shared/workflow/runtime/registries/workflowTicketMutationRegistry';
import { hasCoManagedConversationOwnership } from './nativeConversationEvents';
import { authorizeCoManagedWorkRecord, CoManagedSharedWorkError, isCoManagedUuid, lockCoManagedRecipientIdentity } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { recordCoManagedTicketResolution, recordCoManagedTicketReopened, syncCoManagedTicketAwaitingClientSla } from './ticketSla';

/** The actual executing version supplies the customer actor. A workflow's
 * claimed user or guessed ticket ID cannot stand in for current authority. */
export const withCoManagedWorkflowTicketMutation: WorkflowTicketMutationAdapter = async (trx, input, write) => {
  if (!trx.isTransaction) throw new Error('Workflow ticket mutation requires its source transaction');
  if (!await hasCoManagedConversationOwnership(trx, input.tenant)) return write();
  if (![input.workflowRunId, input.ticketId, input.actorUserId].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  await assertCoManagedOperationalWrite(trx, input.tenant);
  const owner = tenantDb(trx, input.tenant);
  // LEVERAGE: pattern executing-workflow-authority — conversation and ticket mutation adapters retain the actual run/version and current actor.
  const activeRun = () => owner.table('workflow_runs').where('run_id', input.workflowRunId).whereRaw("upper(status) = 'RUNNING'")
    .where(q => q.whereNull('lease_expires_at').orWhere('lease_expires_at', '>', trx.raw('clock_timestamp()')));
  const run = await activeRun().forShare().first();
  if (!run) throw new CoManagedSharedWorkError();
  const definition = await owner.table('workflow_definitions').where('workflow_id', run.workflow_id).forShare().first('created_by');
  const version = await owner.table('workflow_definition_versions').where({ workflow_id: run.workflow_id, version: run.workflow_version }).forShare().first('published_by');
  const actor = { tenant: input.tenant, userId: version?.published_by ?? definition?.created_by };
  if (!definition || !version || actor.userId !== input.actorUserId) throw new CoManagedSharedWorkError();
  const subject = await lockCoManagedRecipientIdentity(trx, actor);
  const before = await owner.table('tickets').where('ticket_id', input.ticketId).forUpdate().first();
  if (!before) throw new CoManagedSharedWorkError();
  const fields = input.fields.flatMap(field => field === 'assignment' ? ['assignment', 'assigned_to', 'assigned_team_id', 'ticket_resources']
    : field === 'status_id' ? ['status_id', 'status', 'statuses', 'is_closed', 'closed_at', 'closed_by', 'response_state']
    : ['tags', 'custom_fields', 'due_date'].includes(field) ? [field, `attributes.${field}`] : [field]);
  const authorize = async (ticket: any) => {
    const record = { id: ticket.ticket_id, clientId: ticket.client_id, boardId: ticket.board_id, ownerUserId: ticket.entered_by,
      assignedUserIds: ticket.assigned_to ? [ticket.assigned_to] : [], teamIds: ticket.assigned_team_id ? [ticket.assigned_team_id] : [] };
    for (const action of ['read', 'update'] as const) {
      const decision = await authorizeCoManagedWorkRecord(trx, actor, subject, 'ticket', action, record);
      const sources = action === 'read' ? [...fields, ...input.readFields] : fields;
      if (isCoManagedReadFieldHidden(decision.redactedFields, sources.flatMap(field => [field, `tickets.${field}`]))) throw new CoManagedSharedWorkError();
    }
  };
  await authorize(before);
  const previousStatus = await owner.table('statuses').where('status_id', before.status_id).forShare().first('is_closed');
  const result = await write();
  const after = await owner.table('tickets').where('ticket_id', input.ticketId).first();
  if (!after) throw new CoManagedSharedWorkError();
  await authorize(after);
  const status = await owner.table('statuses').where('status_id', after.status_id).forShare().first('is_closed');
  if (status?.is_closed && !previousStatus?.is_closed) {
    await auditCloseRulesBypassIfGated(trx, input.tenant, input.ticketId, after.board_id, 'workflow',
      { actorType: TICKET_ACTIVITY_ACTOR.WORKFLOW, userId: actor.userId }, TICKET_ACTIVITY_SOURCE.WORKFLOW);
    await recordCoManagedTicketResolution(trx, input.tenant, input.ticketId);
  }
  else if (!status?.is_closed && previousStatus?.is_closed) await recordCoManagedTicketReopened(trx, input.tenant, input.ticketId);
  if (after.response_state !== before.response_state) await syncCoManagedTicketAwaitingClientSla(trx, input.tenant, input.ticketId);
  await assertCoManagedOperationalWrite(trx, input.tenant);
  if (!await activeRun().first('run_id')) throw new CoManagedSharedWorkError();
  return result;
};
