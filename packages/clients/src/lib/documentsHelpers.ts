/**
 * Documents helpers for clients package
 *
 * These are dynamic import wrappers to avoid circular dependency:
 * clients -> documents -> ... -> clients
 */

export async function getClientLogoUrlAsync(clientId: string, tenant: string): Promise<string | null> {
  const module = await import('@alga-psa/documents/lib/avatarUtils');
  return module.getClientLogoUrl(clientId, tenant);
}

export async function getClientLogoUrlsBatchAsync(clientIds: string[], tenant: string): Promise<Map<string, string | null>> {
  const module = await import('@alga-psa/documents/lib/avatarUtils');
  return module.getClientLogoUrlsBatch(clientIds, tenant);
}

export async function getContactAvatarUrlAsync(contactId: string, tenant: string): Promise<string | null> {
  const module = await import('@alga-psa/documents/lib/avatarUtils');
  return module.getContactAvatarUrl(contactId, tenant);
}

export async function getContactAvatarUrlsBatchAsync(contactIds: string[], tenant: string): Promise<Map<string, string | null>> {
  const module = await import('@alga-psa/documents/lib/avatarUtils');
  return module.getContactAvatarUrlsBatch(contactIds, tenant);
}
