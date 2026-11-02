export interface AuthorizedTicketChangeCandidate {
  ticket_id: string;
  board_id?: string | null;
  updated_by?: string | null;
  updated_by_user_id?: string | null;
  activityActors?: Array<string | null>;
  listActivityActors?: Array<string | null>;
  latestActivityAt?: string | null;
}

/** Aggregate an already visibility-filtered recovery window without returning ticket identifiers. */
export function countAuthorizedTicketChanges<T extends AuthorizedTicketChangeCandidate>(input: {
  candidates: readonly T[];
  matchingTicketIds: ReadonlySet<string>;
  loadedTicketIds: ReadonlySet<string>;
  currentUserId: string;
  since?: number;
}): { newCount: number; updatedCount: number; boards: Record<string, number>; boardLatestAt: Record<string, string> } {
  const seen = new Set<string>();
  let newCount = 0;
  let updatedCount = 0;
  const boards: Record<string, number> = {};
  const boardLatestAt: Record<string, string> = {};
  for (const ticket of input.candidates) {
    const onlyOwnActivity = ticket.activityActors
      ? ticket.activityActors.length > 0 && ticket.activityActors.every(actor => actor === input.currentUserId)
      : ticket.updated_by === input.currentUserId || ticket.updated_by_user_id === input.currentUserId;
    if (!ticket.ticket_id || seen.has(ticket.ticket_id) || onlyOwnActivity) continue;
    seen.add(ticket.ticket_id);
    const inListWindow = input.since === undefined || Boolean(ticket.latestActivityAt && Date.parse(ticket.latestActivityAt) > input.since);
    const listActors = ticket.listActivityActors ?? ticket.activityActors;
    const hasOtherListActivity = !listActors || listActors.some(actor => actor !== input.currentUserId);
    if (inListWindow && hasOtherListActivity && input.loadedTicketIds.has(ticket.ticket_id)) updatedCount += 1;
    else if (inListWindow && hasOtherListActivity && input.matchingTicketIds.has(ticket.ticket_id)) newCount += 1;
    if (ticket.board_id) {
      boards[ticket.board_id] = (boards[ticket.board_id] ?? 0) + 1;
      if (ticket.latestActivityAt && (!boardLatestAt[ticket.board_id] || ticket.latestActivityAt > boardLatestAt[ticket.board_id])) {
        boardLatestAt[ticket.board_id] = ticket.latestActivityAt;
      }
    }
  }
  return { newCount, updatedCount, boards, boardLatestAt };
}
