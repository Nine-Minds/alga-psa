type PreviewCompileCacheEntry = {
  wasmBinary: Buffer;
  compileCommand: string;
};

const PREVIEW_COMPILE_CACHE_LIMIT = 32;
const previewCompileCache = new Map<string, PreviewCompileCacheEntry>();

export const getCachedPreviewCompileArtifact = (cacheKey: string): PreviewCompileCacheEntry | null => {
  const existing = previewCompileCache.get(cacheKey);
  if (!existing) {
    return null;
  }

  // Maintain LRU ordering by reinserting hits.
  previewCompileCache.delete(cacheKey);
  previewCompileCache.set(cacheKey, existing);
  return existing;
};

export const setCachedPreviewCompileArtifact = (cacheKey: string, value: PreviewCompileCacheEntry) => {
  previewCompileCache.set(cacheKey, value);
  while (previewCompileCache.size > PREVIEW_COMPILE_CACHE_LIMIT) {
    const oldestKey = previewCompileCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    previewCompileCache.delete(oldestKey);
  }
};

export const __previewCompileCacheTestUtils = {
  clear: () => previewCompileCache.clear(),
  size: () => previewCompileCache.size,
  get: (key: string) => previewCompileCache.get(key) ?? null,
  set: (key: string, value: PreviewCompileCacheEntry) => setCachedPreviewCompileArtifact(key, value),
};
