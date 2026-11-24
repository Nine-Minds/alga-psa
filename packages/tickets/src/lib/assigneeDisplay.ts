/**
 * The label for a ticket's saved assignee when the picker cannot resolve it from
 * its selectable users — for example a co-managed customer's own assignee, whose
 * name is disclosed but whose identity is not, or a user no longer offered for
 * assignment. Returns null when the picker can name the assignee itself or there
 * is nothing to show, so the caller keeps its own "Not assigned" placeholder.
 *
 * Only the saved value is described: once the user has chosen a different
 * assignee (including "Not assigned") the stored name no longer applies.
 */
export function unresolvedAssigneeLabel(input: {
  savedAssigneeId: string | null | undefined;
  savedAssigneeName: string | null | undefined;
  currentValue: string | null | undefined;
  selectableUserIds: readonly string[];
}): string | null {
  const name = input.savedAssigneeName?.trim();
  if (!name) return null;
  const saved = input.savedAssigneeId || null;
  const current = input.currentValue || null;
  if (current !== saved) return null;
  if (saved && input.selectableUserIds.includes(saved)) return null;
  return name;
}

/**
 * The saved assignee's name for display. The ticket row's own name when it carries one; otherwise the name of
 * that person in the people the caller may SEE. The assignee control offers only the people the caller may
 * ASSIGN (`assignableAgentsOf`), so a visible but non-assignable assignee (an MSP staffer on a seat technician's
 * ticket) is named from the visible list, never shown as "Not assigned".
 */
export function savedAssigneeName(
  savedAssigneeId: string | null | undefined,
  rowName: string | null | undefined,
  visiblePeople: ReadonlyArray<{ user_id: string; first_name?: string | null; last_name?: string | null }>,
): string | null {
  if (rowName?.trim()) return rowName;
  if (!savedAssigneeId) return null;
  const person = visiblePeople.find((candidate) => candidate.user_id === savedAssigneeId);
  const name = person ? `${person.first_name ?? ''} ${person.last_name ?? ''}`.trim() : '';
  return name || null;
}
