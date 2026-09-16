/**
 * Where a tapped schedule reminder should land. Entries booked from a ticket
 * (directly, or through an interaction linked to the ticket) open the ticket
 * so the tech lands where the work is; everything else opens the schedule.
 */
export type ReminderData = {
  kind?: string;
  entryId?: string;
  workItemType?: string | null;
  workItemId?: string | null;
};

export type ReminderTarget = { kind: "ticket"; ticketId: string } | { kind: "schedule" };

export async function resolveReminderTarget(
  data: ReminderData,
  lookupInteractionTicket: (interactionId: string) => Promise<string | null>,
): Promise<ReminderTarget> {
  if (data.workItemType === "ticket" && data.workItemId) {
    return { kind: "ticket", ticketId: data.workItemId };
  }
  if (data.workItemType === "interaction" && data.workItemId) {
    try {
      const ticketId = await lookupInteractionTicket(data.workItemId);
      if (ticketId) return { kind: "ticket", ticketId };
    } catch {
      // Fall through to the schedule: the reminder must still open something.
    }
  }
  return { kind: "schedule" };
}
