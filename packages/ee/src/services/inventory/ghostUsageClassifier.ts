/**
 * CE stub for the ghost-usage ticket classifier (PRD §17.2).
 *
 * `@ee` resolves here in CE builds (and for server typechecking — see
 * server/tsconfig.json "CE-first" paths). The runner gates on isEnterprise
 * before calling, so this never executes in practice; it exists so both
 * editions compile against one surface. Keep the exported shapes identical to
 * ee/server/src/services/inventory/ghostUsageClassifier.ts.
 */

export interface GhostTicketClassifierInput {
  ticket_id: string;
  text: string;
}

export interface GhostTicketClassifierOutput {
  ticket_id: string;
  raw: string | null;
  model: string | null;
  error: string | null;
}

export interface GhostUsageTicketClassifier {
  classifyBatch(
    tenantId: string,
    inputs: GhostTicketClassifierInput[],
    opts?: { concurrency?: number },
  ): Promise<GhostTicketClassifierOutput[]>;
}

const stub: GhostUsageTicketClassifier = {
  async classifyBatch(_tenantId, inputs) {
    return inputs.map((input) => ({
      ticket_id: input.ticket_id,
      raw: null,
      model: null,
      error: 'AI ghost-usage classification requires Enterprise Edition',
    }));
  },
};

export function createGhostUsageClassifier(): GhostUsageTicketClassifier {
  return stub;
}
