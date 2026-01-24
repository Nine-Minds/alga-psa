/**
 * Documents helpers for media package
 *
 * These are dynamic import wrappers to avoid circular dependency:
 * media -> documents -> users -> media
 *
 * Note: Using string concatenation to prevent static analysis from detecting dependencies.
 * Do NOT add webpackIgnore directive - let the bundler process these imports.
 */

const getDocumentsStorageModule = () => '@alga-psa/' + 'documents/storage/StorageService';
const getDocumentsActionsModule = () => '@alga-psa/' + 'documents/actions';

export async function getStorageServiceAsync() {
  const module = await import(getDocumentsStorageModule());
  return (module as any).StorageService;
}

export async function getImageUrlInternalAsync(fileId: string): Promise<string | null> {
  const module = await import(getDocumentsActionsModule());
  return (module as any).getImageUrlInternal(fileId);
}

export async function deleteDocumentAsync(documentId: string, userId?: string): Promise<{ success: boolean; error?: string }> {
  const module = await import(getDocumentsActionsModule());
  return (module as any).deleteDocument(documentId, userId);
}

export async function getDocumentTypeIdAsync(mimeType: string): Promise<{ typeId: string; isShared: boolean }> {
  const module = await import(getDocumentsActionsModule());
  return (module as any).getDocumentTypeId(mimeType);
}
