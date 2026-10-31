import type { Knex } from 'knex';

export interface WorkflowTicketMutationInput {
  tenant: string; ticketId: string; workflowRunId: string; actorUserId: string; fields: string[]; readFields: string[]; closeRulesAudited?: boolean;
}
export interface WorkflowTicketCloseEmailInput {
  operationKey: string;
  email?: { subject?: string; html?: string; text?: string };
}
export interface WorkflowTicketMutationEffects {
  deferRequesterCloseEmail?: (input: WorkflowTicketCloseEmailInput) => Promise<void>;
}
export type WorkflowTicketMutationAdapter = <T>(trx: Knex.Transaction, input: WorkflowTicketMutationInput, write: (effects: WorkflowTicketMutationEffects) => Promise<T>) => Promise<T>;
declare global { var __algaWorkflowTicketMutationAdapter: WorkflowTicketMutationAdapter | undefined; }
export function registerWorkflowTicketMutationAdapter(adapter: WorkflowTicketMutationAdapter): void { globalThis.__algaWorkflowTicketMutationAdapter = adapter; }
export function resetWorkflowTicketMutationAdapter(): void { globalThis.__algaWorkflowTicketMutationAdapter = undefined; }

/**
 * Composition supplies domain admission; shared runtime never imports its consumer.
 * No adapter registered ⇒ `write({})` directly: zero queries, no tenant probe.
 */
export async function withWorkflowTicketMutation<T>(trx: Knex.Transaction, input: WorkflowTicketMutationInput, write: (effects: WorkflowTicketMutationEffects) => Promise<T>): Promise<T> {
  if (!trx.isTransaction) throw new Error('Workflow ticket mutation requires its source transaction');
  const adapter = globalThis.__algaWorkflowTicketMutationAdapter;
  if (adapter) return adapter(trx, { ...input, fields: [...input.fields], readFields: [...input.readFields] }, write);
  return write({});
}
