export interface RemoteAssetLimits {
  maxAssets: number;
  concurrency: number;
  maxTotalBytes: number;
  perAssetTimeoutMs: number;
}

export const DEFAULT_REMOTE_ASSET_LIMITS: RemoteAssetLimits = Object.freeze({
  maxAssets: 64,
  concurrency: 6,
  maxTotalBytes: 16 * 1024 * 1024,
  perAssetTimeoutMs: 5000,
});

export interface AssetBudget {
  admit(index: number): boolean;
  charge(bytes: number): boolean;
  readonly spentBytes: number;
  readonly admitted: number;
  readonly skipped: number;
}

export function validateRemoteAssetLimits(limits: Partial<RemoteAssetLimits> = {}): RemoteAssetLimits {
  const merged = { ...DEFAULT_REMOTE_ASSET_LIMITS, ...limits };
  for (const [name, value] of Object.entries(merged)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`Remote asset limit ${name} must be a positive safe integer`);
    }
  }
  return merged;
}

export function createAssetBudget(limits: Partial<RemoteAssetLimits> = {}): AssetBudget {
  const valid = validateRemoteAssetLimits(limits);
  let spentBytes = 0;
  let admitted = 0;
  let skipped = 0;
  return {
    admit(index) {
      if (!Number.isSafeInteger(index) || index < 0) throw new TypeError('Asset index must be a non-negative safe integer');
      if (index >= valid.maxAssets) {
        skipped += 1;
        return false;
      }
      admitted += 1;
      return true;
    },
    charge(bytes) {
      if (!Number.isSafeInteger(bytes) || bytes < 0) throw new TypeError('Asset byte charge must be a non-negative safe integer');
      if (bytes > valid.maxTotalBytes - spentBytes) return false;
      spentBytes += bytes;
      return true;
    },
    get spentBytes() { return spentBytes; },
    get admitted() { return admitted; },
    get skipped() { return skipped; },
  };
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError('Concurrency limit must be a positive safe integer');
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
