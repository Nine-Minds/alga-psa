export function isStorageApiEnabled(): boolean {
  const flag = process.env.EXT_STORAGE_API_ENABLED;
  if (!flag) return false;
  return flag.toLowerCase() === 'true';
}

export function assertStorageApiEnabled(): void {
  if (!isStorageApiEnabled()) {
    throw new Error('Extension storage API is disabled via EXT_STORAGE_API_ENABLED');
  }
}
