import type { Knex } from 'knex';

/** What a workflow-originated conversation event carries to a retainer. */
export interface WorkflowConversationEventInput {
  tenant: string;
  ticketId: string;
  commentId?: string;
  eventType: string;
  payload: Record<string, unknown>;
  workflowRunId?: string;
  actorUserId?: string;
  ticketAction?: 'create' | 'update';
}

/** Re-publishes a retained event once its owner has decided what to do with it. */
export type WorkflowConversationEventPublish = (event: { eventType: string; payload: Record<string, unknown> }) => Promise<void>;

/** Resolve `true` when the event was retained in `trx` and native publication must be skipped. */
export type WorkflowConversationEventRetainer = (
  trx: Knex.Transaction,
  input: WorkflowConversationEventInput,
  publish: WorkflowConversationEventPublish,
) => Promise<boolean>;

declare global {
  var __algaWorkflowConversationRetainer: WorkflowConversationEventRetainer | undefined;
}

/** Composition roots provide domain authority without a shared -> domain cycle. */
export function registerWorkflowConversationRetainer(retainer: WorkflowConversationEventRetainer): void {
  globalThis.__algaWorkflowConversationRetainer = retainer;
}
/** No retainer registered ⇒ `undefined`, with no queries. */
export function getWorkflowConversationRetainer(): WorkflowConversationEventRetainer | undefined {
  return globalThis.__algaWorkflowConversationRetainer;
}
export function resetWorkflowConversationRetainer(): void {
  globalThis.__algaWorkflowConversationRetainer = undefined;
}
