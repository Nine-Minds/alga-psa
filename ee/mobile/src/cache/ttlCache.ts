export type TtlCacheOptions = {
  defaultTtlMs: number;
};

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

export class TtlCache<T> {
  private readonly defaultTtlMs: number;
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(options: TtlCacheOptions) {
    this.defaultTtlMs = options.defaultTtlMs;
  }

  get(key: string): T | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlMs?: number): void {
    const ttl = ttlMs ?? this.defaultTtlMs;
    this.entries.set(key, { value, expiresAt: Date.now() + ttl });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}

