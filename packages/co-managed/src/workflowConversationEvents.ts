import { tenantDb } from '@alga-psa/db';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing/lifecycle';
import type { WorkflowConversationEventRetainer } from '../../../shared/workflow/runtime/registries/workflowConversationRegistry';
import { hasCoManagedConversationOwnership, retainCoManagedNativeCommentEvent } from './nativeConversationEvents';
import { authorizeCoManagedWorkRecord, CoManagedSharedWorkError, isCoManagedUuid, lockCoManagedRecipientIdentity } from './sharedWorkIdentity';
import { coManagedConversationBodySources } from './conversationPolicy';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';

/** Trusted runtime composition supplies the executing run, never a request's
 * claimed author. The exact published version determines current home authority. */
export const retainCoManagedWorkflowCommentEvent: WorkflowConversationEventRetainer = async (trx, input, publish) => {
  if (!await hasCoManagedConversationOwnership(trx, input.tenant)) return false;
  if (input.ticketAction !== undefined && !['create', 'update'].includes(input.ticketAction)) throw new CoManagedSharedWorkError();
  if (!isCoManagedUuid(input.workflowRunId)) throw new CoManagedSharedWorkError();
  await assertCoManagedOperationalWrite(trx, input.tenant);
  const owner = tenantDb(trx, input.tenant);
  // LEVERAGE: pattern executing-workflow-authority — ticket mutation admission uses the same retained run/version and actor.
  const activeRun = () => owner.table('workflow_runs').where('run_id', input.workflowRunId)
    .whereRaw("upper(status) = 'RUNNING'").where(query => query.whereNull('lease_expires_at').orWhere('lease_expires_at', '>', trx.raw('clock_timestamp()')));
  const run = await activeRun().forShare().first();
  if (!run) throw new CoManagedSharedWorkError();
  const definition = await owner.table('workflow_definitions').where('workflow_id', run.workflow_id).forShare().first('created_by');
  const version = await owner.table('workflow_definition_versions').where({ workflow_id: run.workflow_id, version: run.workflow_version }).forShare().first('published_by');
  const actor = { tenant: input.tenant, userId: version?.published_by ?? definition?.created_by };
  if (!definition || !version || !isCoManagedUuid(actor.userId) || (input.actorUserId !== undefined && input.actorUserId !== actor.userId)) throw new CoManagedSharedWorkError();
  const subject = await lockCoManagedRecipientIdentity(trx, actor);
  const ticket = await owner.table('tickets').where('ticket_id', input.ticketId).forUpdate().first();
  if (!ticket) throw new CoManagedSharedWorkError();
  // LEVERAGE: pattern customer-ticket-policy-record — workflow authorship uses the actual customer record, with the executing version's current actor.
  const record = { id: ticket.ticket_id, clientId: ticket.client_id, boardId: ticket.board_id, ownerUserId: ticket.entered_by,
    assignedUserIds: ticket.assigned_to ? [ticket.assigned_to] : [], teamIds: ticket.assigned_team_id ? [ticket.assigned_team_id] : [] };
  for (const action of ['read', input.ticketAction ?? 'update'] as const) {
    const decision = await authorizeCoManagedWorkRecord(trx, actor, subject, 'ticket', action, record);
    if (isCoManagedReadFieldHidden(decision.redactedFields, [...coManagedConversationBodySources, 'comments', 'comment_threads', 'comment_id', 'response_state'])) throw new CoManagedSharedWorkError();
  }
  const source = await owner.table('comments').where({ comment_id: input.commentId, ticket_id: input.ticketId }).forShare().first();
  if (!source || source.actor_reference_id || (source.author_type === 'internal' && source.user_id && source.user_id !== actor.userId)) throw new CoManagedSharedWorkError();
  if (source.author_type === 'client') {
    const contact = source.contact_id ? await owner.table('contacts').where({ contact_name_id: source.contact_id, client_id: ticket.client_id, is_inactive: false }).forShare().first() : null;
    if (!contact) throw new CoManagedSharedWorkError();
    if (source.user_id && !await owner.table('users').where({ user_id: source.user_id, user_type: 'client', contact_id: source.contact_id, is_inactive: false }).forShare().first()) throw new CoManagedSharedWorkError();
  }
  const retained = await retainCoManagedNativeCommentEvent(trx, { ...input, publication: { kind: 'event', eventType: 'TICKET_COMMENT_ADDED',
    payload: { ...input.payload, userId: actor.userId }, ...(input.channel ? { channel: input.channel } : {}) } }, async (event, eventId) => {
    await publish({ eventType: event.eventType, payload: event.payload, channel: event.channel }, eventId);
  });
  await assertCoManagedOperationalWrite(trx, input.tenant);
  if (!await activeRun().first('run_id')) throw new CoManagedSharedWorkError();
  return retained;
};
