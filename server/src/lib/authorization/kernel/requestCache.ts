import type { AuthorizationRequestCache } from './contracts';

export class RequestLocalAuthorizationCache implements AuthorizationRequestCache {
  private readonly values = new Map<string, unknown>();

  async getOrLoad<T>(key: string, loader: () => Promise<T>): Promise<T> {
    if (this.values.has(key)) {
      return this.values.get(key) as T;
    }

    const value = await loader();
    this.values.set(key, value);
    return value;
  }

  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  set<T>(key: string, value: T): void {
    this.values.set(key, value);
  }
}

export function getRequestCache(cache?: AuthorizationRequestCache): AuthorizationRequestCache {
  return cache ?? new RequestLocalAuthorizationCache();
}
