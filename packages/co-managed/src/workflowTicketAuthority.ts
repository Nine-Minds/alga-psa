import { tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing/lifecycle';
import { authorizeCoManagedWorkRecord, CoManagedSharedWorkError, isCoManagedUuid, lockCoManagedRecipientIdentity } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';

/** Structural subset of the workflow runtime's ticket-mutation input (a package must not import `shared/`). */
export interface CoManagedWorkflowTicketMutationInput {
  operation?: 'read' | 'create' | 'update';
  assignment?: { assignedUserIds: string[]; teamIds: string[] };
  prospective?: { clientId: string; boardId: string; assignedUserIds: string[]; teamIds: string[] };
  tenant: string; ticketId?: string; workflowRunId: string; actorUserId: string; fields: string[]; readFields: string[]; predicateFields?: string[];
}

/** Committed email intents retain version/author authority after execution ends;
 * operational mutations additionally require the current execution lease.
 * The workflow author acts on the workspace's OWN ticket, so the decision is the
 * L1a locked home authorizer (customer-local), not the cross-tenant matrix. */
export async function retainCoManagedWorkflowTicketAuthority(trx: Knex.Transaction, input: CoManagedWorkflowTicketMutationInput, executing = true) {
  const operation = input.operation ?? 'update';
  if (![input.workflowRunId, input.actorUserId, ...(operation === 'create' ? [] : [input.ticketId])].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  if (operation !== 'read') await assertCoManagedOperationalWrite(trx, input.tenant);
  const owner = tenantDb(trx, input.tenant);
  // LEVERAGE: pattern executing-workflow-authority — ticket mutation adapters retain the actual run/version and current actor (conversation adapters land with L3).
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
  if (operation === 'create' && (!input.prospective || ![input.prospective.clientId, input.prospective.boardId].every(isCoManagedUuid))) throw new CoManagedSharedWorkError();
  const ticketQuery = () => owner.table('tickets').where('ticket_id', input.ticketId);
  const before = operation === 'create'
    ? { client_id: input.prospective!.clientId, board_id: input.prospective!.boardId, entered_by: input.actorUserId }
    : await (operation === 'read' ? ticketQuery().forShare() : ticketQuery().forUpdate()).first();
  if (!before) throw new CoManagedSharedWorkError();
  const fieldSources = (field: string): string[] => field.startsWith('attributes.')
    ? [field, field.slice('attributes.'.length)]
    : field === 'attributes' ? ['attributes', 'attributes.description', 'description', 'attributes.custom_fields', 'custom_fields', 'attributes.tags', 'tags', 'attributes.due_date', 'due_date', 'attributes.resolution_code', 'resolution_code', 'attributes.resolution_text', 'resolution_text']
    : field === 'assignment' ? ['assignment', 'assigned_to', 'assigned_team_id', 'ticket_resources']
    : field === 'status_id' ? ['status_id', 'status', 'statuses', 'is_closed', 'closed_at', 'closed_by', 'response_state']
    : field === 'contact_id' || field === 'contact_name_id' ? ['contact_id', 'contact_name_id', 'contact_name', 'requester', 'contact', 'contacts', 'contacts.contact_name_id']
    : field === 'entered_at' || field === 'created_at' ? ['entered_at', 'created_at']
    : field === 'description' ? ['description', 'attributes.description']
    : field === 'comments' ? ['comments', 'conversation', 'note', 'markdown_content']
    : field === 'attachments' ? ['attachments', 'documents', 'document_associations', 'file_id', 'storage_ref']
    : field === 'entity_links' ? ['entity_links', 'ticket_entity_links']
    : field === 'checklist' ? ['checklist', 'ticket_checklist_items', 'ticket_checklist_template_applications']
    : ['tags', 'custom_fields', 'due_date', 'resolution_code', 'resolution_text'].includes(field) ? [field, `attributes.${field}`] : [field];
  const fields = input.fields.flatMap(fieldSources);
  const assignment = operation === 'create' ? input.prospective : input.assignment;
  const explicitAssignedUserIds = [...(assignment?.assignedUserIds ?? [])];
  let redactedFields: string[] = [];
  const authorize = async (ticket: any, projectedAssignment?: { assignedUserIds: string[]; teamIds: string[] }) => {
    const record = { id: ticket.ticket_id, clientId: ticket.client_id, boardId: ticket.board_id, ownerUserId: ticket.entered_by,
      assignedUserIds: projectedAssignment?.assignedUserIds ?? (operation === 'create' ? explicitAssignedUserIds : ticket.assigned_to ? [ticket.assigned_to] : []),
      teamIds: projectedAssignment?.teamIds ?? (operation === 'create' ? input.prospective!.teamIds : ticket.assigned_team_id ? [ticket.assigned_team_id] : []) };
    const actions = operation === 'update' ? ['read', 'update'] : operation === 'create' ? ['create', 'read'] : ['read'];
    for (const action of actions as Array<'read' | 'update' | 'create'>) {
      const decision = await authorizeCoManagedWorkRecord(trx, actor, subject, 'ticket', action, record);
      redactedFields = [...new Set([...redactedFields, ...decision.redactedFields])];
      const sources = action === 'read'
        ? [...(operation === 'create' ? [] : fields), ...input.readFields.flatMap(fieldSources)]
        : fields;
      if (operation !== 'read' && isCoManagedReadFieldHidden(decision.redactedFields, sources.flatMap(field => [field, `tickets.${field}`]))) throw new CoManagedSharedWorkError();
      if (operation === 'read' && input.predicateFields?.length
        && isCoManagedReadFieldHidden(decision.redactedFields, input.predicateFields.flatMap(field => [...fieldSources(field), `tickets.${field}`, ...fieldSources(field).map(source => `tickets.${source}`)]))) {
        const error = new CoManagedSharedWorkError();
        (error as Error & { code: string }).code = 'WORKFLOW_TICKET_PREDICATE_FORBIDDEN';
        throw error;
      }
    }
  };
  // For team-backed creation, assignedUserIds currently contains only
  // additional users. Wait until the team manager is resolved so the first
  // identity passed to the scope evaluator is the persisted primary assignee.
  if (!(operation === 'create' && assignment?.teamIds.length)) await authorize(before);
  if (assignment?.teamIds.length) {
    // Team membership supplies the persisted primary assignee. Load it only
    // after the existing ticket has been authorized, then authorize the exact
    // persisted assignment projection (primary manager first, additional users after).
    const teamManagerIds: string[] = [];
    for (const teamId of assignment.teamIds) {
      const team = await owner.table('teams').where('team_id', teamId).forShare().first('manager_id');
      if (!team?.manager_id) throw new CoManagedSharedWorkError();
      teamManagerIds.push(team.manager_id);
    }
    const assignedUserIds = [...teamManagerIds, ...explicitAssignedUserIds];
    await authorize(before, { assignedUserIds, teamIds: assignment.teamIds });
  } else if (operation === 'update' && input.assignment) {
    await authorize(before, { assignedUserIds: explicitAssignedUserIds, teamIds: [] });
  }
  return { owner, before, actor, run, authorize, activeRun, redactedFields };
}
