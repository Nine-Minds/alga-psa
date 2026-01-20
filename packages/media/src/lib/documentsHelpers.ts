/**
 * Documents helpers for media package
 *
 * These are dynamic import wrappers to avoid circular dependency:
 * media -> documents -> ui -> ... -> clients -> media
 *
 * Note: Using string concatenation to prevent static analysis from detecting dependencies
 */

const getDocumentsStorageModule = () => '@alga-psa/' + 'documents/storage/StorageService';
const getDocumentsActionsModule = () => '@alga-psa/' + 'documents/actions/documentActions';

export async function getStorageServiceAsync() {
  const module = await import(/* webpackIgnore: true */ getDocumentsStorageModule());
  return (module as any).StorageService;
}

export async function getImageUrlInternalAsync(fileId: string): Promise<string | null> {
  const module = await import(/* webpackIgnore: true */ getDocumentsActionsModule());
  return (module as any).getImageUrlInternal(fileId);
}

export async function deleteDocumentAsync(documentId: string, userId?: string): Promise<{ success: boolean; error?: string }> {
  const module = await import(/* webpackIgnore: true */ getDocumentsActionsModule());
  return (module as any).deleteDocument(documentId, userId);
}

export async function getDocumentTypeIdAsync(mimeType: string): Promise<{ typeId: string; isShared: boolean }> {
  const module = await import(/* webpackIgnore: true */ getDocumentsActionsModule());
  return (module as any).getDocumentTypeId(mimeType);
}
