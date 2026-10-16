import { tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing/lifecycle';
import type { WorkflowTicketMutationInput } from '../../../shared/workflow/runtime/registries/workflowTicketMutationRegistry';
import { authorizeCoManagedWorkRecord, CoManagedSharedWorkError, isCoManagedUuid, lockCoManagedRecipientIdentity } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';

/** Committed email intents retain version/author authority after execution ends;
 * operational mutations additionally require the current execution lease. */
export async function retainCoManagedWorkflowTicketAuthority(trx: Knex.Transaction, input: WorkflowTicketMutationInput, executing = true) {
  if (![input.workflowRunId, input.ticketId, input.actorUserId].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  await assertCoManagedOperationalWrite(trx, input.tenant);
  const owner = tenantDb(trx, input.tenant);
  // LEVERAGE: pattern executing-workflow-authority — conversation and ticket mutation adapters retain the actual run/version and current actor.
  const runQuery = () => owner.table('workflow_runs').where('run_id', input.workflowRunId);
  const activeRun = () => runQuery().whereRaw("upper(status) = 'RUNNING'")
    .where(q => q.whereNull('lease_expires_at').orWhere('lease_expires_at', '>', trx.raw('clock_timestamp()')));
  const run = await (executing ? activeRun() : runQuery()).forShare().first();
  if (!run || (!executing && ['CANCELED', 'CANCELLED'].includes(String(run.status).toUpperCase()))) throw new CoManagedSharedWorkError();
  const definition = await owner.table('workflow_definitions').where('workflow_id', run.workflow_id).forShare().first('created_by');
  const version = await owner.table('workflow_definition_versions').where({ workflow_id: run.workflow_id, version: run.workflow_version }).forShare().first('published_by');
  const actor = { tenant: input.tenant, userId: version?.published_by ?? definition?.created_by };
  if (!definition || !version || actor.userId !== input.actorUserId) throw new CoManagedSharedWorkError();
  const subject = await lockCoManagedRecipientIdentity(trx, actor);
  const before = await owner.table('tickets').where('ticket_id', input.ticketId).forUpdate().first();
  if (!before) throw new CoManagedSharedWorkError();
  const fields = input.fields.flatMap(field => field === 'assignment' ? ['assignment', 'assigned_to', 'assigned_team_id', 'ticket_resources']
    : field === 'status_id' ? ['status_id', 'status', 'statuses', 'is_closed', 'closed_at', 'closed_by', 'response_state']
    : ['tags', 'custom_fields', 'due_date', 'resolution_code', 'resolution_text'].includes(field) ? [field, `attributes.${field}`] : [field]);
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
  return { owner, before, actor, run, authorize, activeRun };
}
