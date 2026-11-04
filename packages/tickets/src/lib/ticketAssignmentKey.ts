/**
 * Key describing a ticket's SAVED assignment (primary assignee + additional agents).
 * Hosts pass it to the "My group" control so it can reconcile when assignment changes.
 * Always build it from saved props, never from unsaved form edits.
 */
export function buildTicketAssignmentKey(
  assignedTo: string | null | undefined,
  additionalUserIds: ReadonlyArray<string | null | undefined> | null | undefined
): string {
  return [
    assignedTo ?? '',
    (additionalUserIds ?? []).filter((id): id is string => Boolean(id)).sort().join(','),
  ].join('|');
}
