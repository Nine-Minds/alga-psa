export function withClientFilter(
  filters: Record<string, unknown> | undefined,
  clientId: string | undefined | null,
): Record<string, unknown> | undefined {
  if (!clientId) return filters;
  return { ...(filters ?? {}), client_id: clientId };
}

export function withContactFilter(
  filters: Record<string, unknown> | undefined,
  contactId: string | undefined | null,
): Record<string, unknown> | undefined {
  if (!contactId) return filters;
  return { ...(filters ?? {}), contact_name_id: contactId };
}
