/**
 * Test stub for the `redis` package.
 *
 * Some modules under test (notably hocuspocus/TicketUpdatesExtension.js, which
 * lives at the repo root and is loaded as raw ESM outside Vite's transform
 * scope) import `createClient` directly. For those modules per-test
 * `vi.mock('redis')` does not intercept the import, so the real client tries to
 * open a live Redis connection and hangs the unit suite until timeout.
 *
 * Aliasing `redis` to this stub gives a no-op, never-connecting client by
 * default. Tests that need specific Redis behavior still override it with their
 * own `vi.mock('redis')` / `vi.doMock('redis')`, which take precedence over the
 * alias.
 */

type Handler = (...args: unknown[]) => unknown;

class StubRedisClient {
  private handlers = new Map<string, Handler[]>();

  on(event: string, handler: Handler): this {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return this;
  }

  once(event: string, handler: Handler): this {
    return this.on(event, handler);
  }

  off(event: string, handler: Handler): this {
    const list = this.handlers.get(event) ?? [];
    this.handlers.set(
      event,
      list.filter((h) => h !== handler)
    );
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(...args);
    }
  }

  async connect(): Promise<this> {
    return this;
  }

  async disconnect(): Promise<void> {}

  async quit(): Promise<void> {}

  async subscribe(): Promise<void> {}

  async pSubscribe(): Promise<void> {}

  async unsubscribe(): Promise<void> {}

  async pUnsubscribe(): Promise<void> {}

  async publish(): Promise<number> {
    return 0;
  }

  async get(): Promise<string | null> {
    return null;
  }

  async set(): Promise<string> {
    return 'OK';
  }

  duplicate(): StubRedisClient {
    return new StubRedisClient();
  }
}

export function createClient(): StubRedisClient {
  return new StubRedisClient();
}

export function createCluster(): StubRedisClient {
  return new StubRedisClient();
}

export default { createClient, createCluster };
