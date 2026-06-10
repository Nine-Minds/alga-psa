export function withClientFilter(
  filters: Record<string, unknown> | undefined,
  clientId: string | undefined | null,
): Record<string, unknown> | undefined {
  if (!clientId) return filters;
  return { ...(filters ?? {}), client_id: clientId };
}
