/**
 * "Visible" is not "assignable". A person the caller may SEE (the people projection: a seat technician sees the MSP
 * staff on its tickets, by name) is not necessarily a person the caller may ASSIGN work to (a seat technician may
 * assign only itself and the other live technicians of its client, `seatAssigneeAudience`).
 *
 * The server marks each person it returns with `assignable: false` when the caller may not assign to them, and
 * leaves the marker off for an unrestricted caller, so an ordinary MSP user's payload is unchanged. Display,
 * mentions and name lookups keep using the whole list; only the controls that choose an assignee use
 * `assignableAgentsOf`. The server-side check (`assertActorMayAssign`) remains the boundary.
 */
export interface AssignabilityMark {
  assignable?: boolean;
}

/** Mark each person `assignable: false` when `audience` (from `resolveSeatAssigneeAudience`) does not include them. */
export function markAssignableAgents<U extends { user_id: string }>(
  users: readonly U[],
  audience: readonly string[] | null,
): Array<U & AssignabilityMark> {
  if (!audience) return [...users];
  const allowed = new Set(audience);
  return users.map((user) => (allowed.has(user.user_id) ? user : { ...user, assignable: false }));
}

/** The people an assignee control may offer. */
export function assignableAgentsOf<U extends object>(users: readonly U[]): U[] {
  return users.filter((user) => (user as AssignabilityMark).assignable !== false);
}
