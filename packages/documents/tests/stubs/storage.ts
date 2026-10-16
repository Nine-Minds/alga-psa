/**
 * Load-only stub for `@alga-psa/storage` in documents jsdom component tests.
 *
 * The real storage package imports node builtins (node:fs, node:stream) that
 * cannot be bundled for jsdom. Component tests mock the document actions, so
 * the storage surface only needs to exist for the module graph to resolve.
 */

const asyncNoop = async (): Promise<undefined> => undefined;
const noop = (): undefined => undefined;

function methodProxy(): Record<string, unknown> {
  return new Proxy(
    {},
    {
      get: () => asyncNoop,
    },
  );
}

export const StorageService = methodProxy();
export const FileStoreModel = methodProxy();
export const StorageProviderFactory = methodProxy();

export const getStorageConfig = asyncNoop;
export const getProviderConfig = asyncNoop;
export const validateFileUpload = asyncNoop;
export const validateSystemArtifact = asyncNoop;
export const clearCachedStorageConfig = noop;

export default {
  StorageService,
  FileStoreModel,
  StorageProviderFactory,
  getStorageConfig,
  getProviderConfig,
  validateFileUpload,
  validateSystemArtifact,
  clearCachedStorageConfig,
};
