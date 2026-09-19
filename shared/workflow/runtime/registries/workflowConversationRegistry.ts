import type { InboundConversationEventRetainer } from '../../../services/email/inboundConversationEvents';

export type WorkflowConversationEventRetainer = (
  trx: Parameters<InboundConversationEventRetainer>[0],
  input: Parameters<InboundConversationEventRetainer>[1] & { workflowRunId?: string; actorUserId?: string; ticketAction?: 'create' | 'update' },
  publish: Parameters<InboundConversationEventRetainer>[2],
) => Promise<boolean>;

declare global {
  var __algaWorkflowConversationRetainer: WorkflowConversationEventRetainer | undefined;
}

/** Composition roots provide domain authority without a shared -> co-managed cycle. */
export function registerWorkflowConversationRetainer(retainer: WorkflowConversationEventRetainer): void {
  globalThis.__algaWorkflowConversationRetainer = retainer;
}
export function getWorkflowConversationRetainer(): WorkflowConversationEventRetainer | undefined {
  return globalThis.__algaWorkflowConversationRetainer;
}
export function resetWorkflowConversationRetainer(): void {
  globalThis.__algaWorkflowConversationRetainer = undefined;
}
