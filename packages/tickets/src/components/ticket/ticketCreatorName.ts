/**
 * Who opened a ticket. A local creator is a user row; a shared (co-managed) ticket's creator
 * arrives as an attributed display name. Null-safe either way: returns null when neither names anyone.
 */
export function ticketCreatorName(
  createdByUser: { first_name?: string | null; last_name?: string | null } | null | undefined,
  ticket: object,
): string | null {
  if (createdByUser) {
    return [createdByUser.first_name, createdByUser.last_name].map(part => part?.trim()).filter(Boolean).join(' ') || null;
  }
  return (typeof (ticket as { created_by_display_name?: unknown }).created_by_display_name === 'string'
    && ((ticket as { created_by_display_name: string }).created_by_display_name).trim()) || null;
}
