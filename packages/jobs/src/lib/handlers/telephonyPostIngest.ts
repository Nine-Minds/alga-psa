export interface TelephonyIngestOutcomeLike {
  status: string;
  callRecordId?: string;
  matchStatus?: string;
  created?: boolean;
}

export interface TelephonyAutoTicketTailDeps {
  /** Per-tenant auto-ticket policy for the ingested call's provider. */
  getAutoCreateTickets: () => Promise<boolean>;
  /** Tenant default board + open status for a new ticket. */
  getTicketDefaults: () => Promise<{ boardId: string | null; statusId: string | null }>;
  /** Default priority for the resolved board. */
  getPriorityForBoard: (boardId: string) => Promise<string | null>;
}

/**
 * Auto-ticket tail shared by the Teams call-notification handler and the 3CX
 * canonical-call handler. Only a freshly ingested, confidently matched call may
 * mint a ticket, and only when the tenant asked for it — so the created/matched
 * guard runs before the policy is even fetched.
 */
export async function runTelephonyAutoTicketTail(
  tenantId: string,
  outcome: TelephonyIngestOutcomeLike,
  deps: TelephonyAutoTicketTailDeps,
): Promise<void> {
  if (!outcome.created || outcome.matchStatus !== 'matched' || !outcome.callRecordId) {
    return;
  }

  const autoCreateTickets = await deps.getAutoCreateTickets();
  if (!autoCreateTickets) {
    return;
  }

  const defaults = await deps.getTicketDefaults();
  const priorityId = defaults.boardId ? await deps.getPriorityForBoard(defaults.boardId) : null;

  const { autoCreateTicketForCall } = await import('@alga-psa/telephony');
  await autoCreateTicketForCall({
    tenantId,
    callRecordId: outcome.callRecordId,
    defaults: { boardId: defaults.boardId, statusId: defaults.statusId, priorityId },
  });
}
