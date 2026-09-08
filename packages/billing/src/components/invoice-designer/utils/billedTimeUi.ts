/** Billed-time collections offered by the v1.6 designer UI. Does not affect rendering. */
export function isBilledTimeCollection(path: string): boolean {
  return /^(timeEntries|ticketGroups|ticketPresentationRows)(?:\.|\[|$)/.test(path);
}
