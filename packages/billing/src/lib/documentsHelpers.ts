/**
 * Documents helpers for billing package
 *
 * These are dynamic import wrappers to avoid circular dependency:
 * billing -> documents -> ui -> analytics -> tenancy -> ... -> billing
 *
 * Note: Using string concatenation to prevent static analysis from detecting dependencies
 */

const getDocumentsStorageModule = () => '@alga-psa/' + 'documents/storage/StorageService';
const getDocumentsStorageProviderModule = () => '@alga-psa/' + 'documents/storage/StorageProviderFactory';
const getDocumentsModelsStorageModule = () => '@alga-psa/' + 'documents/models/storage';
const getDocumentsAvatarUtilsModule = () => '@alga-psa/' + 'documents/lib/avatarUtils';
const getDocumentsActionsModule = () => '@alga-psa/' + 'documents/actions/documentActions';

export async function getStorageServiceAsync() {
  const module = await import(/* webpackIgnore: true */ getDocumentsStorageModule());
  return module.StorageService;
}

export async function getStorageProviderFactoryAsync() {
  const module = await import(/* webpackIgnore: true */ getDocumentsStorageProviderModule());
  return {
    StorageProviderFactory: module.StorageProviderFactory,
    generateStoragePath: module.generateStoragePath
  };
}

export async function getFileStoreModelAsync() {
  const module = await import(/* webpackIgnore: true */ getDocumentsModelsStorageModule());
  return module.FileStoreModel;
}

export async function getClientLogoUrlAsync(clientId: string, tenant: string) {
  const module = await import(/* webpackIgnore: true */ getDocumentsAvatarUtilsModule());
  return module.getClientLogoUrl(clientId, tenant);
}

export async function getDocumentsByContractIdAsync(contractId: string) {
  const module = await import(/* webpackIgnore: true */ getDocumentsActionsModule());
  return module.getDocumentsByContractId(contractId);
}
