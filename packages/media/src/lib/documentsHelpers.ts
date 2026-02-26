/**
 * Dynamic import wrappers for media package
 *
 * These use dynamic imports to avoid circular dependency:
 * media -> documents -> users -> media
 *
 * Dynamic imports break the synchronous dependency cycle while still
 * allowing the bundler to process and resolve the import paths.
 *
 * Note: StorageService imports from @alga-psa/storage (no cycle).
 * Document action imports still go through @alga-psa/documents (cycle-breaker).
 */

export async function getStorageServiceAsync() {
  const module = await import('@alga-psa/storage/StorageService');
  return (module as any).StorageService;
}

export async function getImageUrlInternalAsync(fileId: string): Promise<string | null> {
  const module = await import('@alga-psa/documents/actions');
  return (module as any).getImageUrlInternal(fileId);
}

export async function deleteDocumentAsync(documentId: string, userId?: string): Promise<{ success: boolean; error?: string }> {
  const module = await import('@alga-psa/documents/actions');
  return (module as any).deleteDocument(documentId, userId);
}

export async function getDocumentTypeIdAsync(mimeType: string): Promise<{ typeId: string; isShared: boolean }> {
  const module = await import('@alga-psa/documents/actions');
  return (module as any).getDocumentTypeId(mimeType);
}
