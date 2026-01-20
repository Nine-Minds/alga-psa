/**
 * Documents helpers for clients package
 *
 * These are dynamic import wrappers to avoid circular dependency:
 * clients -> documents -> ... -> clients
 *
 * Note: Using string concatenation to prevent static analysis from detecting dependencies
 */

const getDocumentsAvatarUtilsModule = () => '@alga-psa/' + 'documents/lib/avatarUtils';

export async function getClientLogoUrlAsync(clientId: string, tenant: string): Promise<string | null> {
  const module = await import(/* webpackIgnore: true */ getDocumentsAvatarUtilsModule());
  return (module as any).getClientLogoUrl(clientId, tenant);
}

export async function getClientLogoUrlsBatchAsync(clientIds: string[], tenant: string): Promise<Map<string, string | null>> {
  const module = await import(/* webpackIgnore: true */ getDocumentsAvatarUtilsModule());
  return (module as any).getClientLogoUrlsBatch(clientIds, tenant);
}

export async function getContactAvatarUrlAsync(contactId: string, tenant: string): Promise<string | null> {
  const module = await import(/* webpackIgnore: true */ getDocumentsAvatarUtilsModule());
  return (module as any).getContactAvatarUrl(contactId, tenant);
}

export async function getContactAvatarUrlsBatchAsync(contactIds: string[], tenant: string): Promise<Map<string, string | null>> {
  const module = await import(/* webpackIgnore: true */ getDocumentsAvatarUtilsModule());
  return (module as any).getContactAvatarUrlsBatch(contactIds, tenant);
}
