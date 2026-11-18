import { afterEach, beforeAll, vi } from 'vitest';
import { EVENT_BUS_REGISTRY_KEY } from '../eventBusRegistry';

/**
 * Budget for the one cold load of the event bus module graph per test file.
 * Locally it takes about a second. On a CI runner shared with other Nx test
 * targets it has taken more than ten, which is longer than a whole test is
 * allowed.
 */
const MODULE_GRAPH_WARMUP_TIMEOUT_MS = 60_000;

type RegisteredEventBus = { close(): Promise<void> };
type EventBusRegistry = { [EVENT_BUS_REGISTRY_KEY]?: RegisteredEventBus };

/**
 * Removes the process-wide event bus left behind by a test that never reached
 * `close()`, for example because it timed out or an assertion threw first.
 *
 * The bus is registered on `globalThis`, so `vi.resetModules()` does not drop
 * it. Without this, the next test's `getEventBus()` returns the stale bus,
 * which still holds the previous test's mocked Redis client. That test then
 * fails for a reason that has nothing to do with what it checks.
 *
 * The close is started but not awaited: it stops the stale consumer loop, and
 * it must not depend on timers that a test may have faked.
 */
export function discardRegisteredEventBus(): void {
  const registry = globalThis as typeof globalThis & EventBusRegistry;
  const stale = registry[EVENT_BUS_REGISTRY_KEY];
  if (!stale) return;
  delete registry[EVENT_BUS_REGISTRY_KEY];
  void stale.close().catch(() => undefined);
}

/**
 * Hooks for test files that mock `redis` (or the logger) with `vi.doMock` and
 * then load the event bus fresh in every test with `await import('./index')`.
 *
 * - Before the file's tests, it loads the module graph once so the transform
 *   cost is paid under its own budget. Later imports, after
 *   `vi.resetModules()`, only re-run the modules, which takes milliseconds.
 *   Otherwise the first test of each file pays for the cold load inside its
 *   own timeout.
 * - After each test, it discards any bus the test left registered and resets
 *   the module registry, so every test starts with a fresh bus bound to its
 *   own mocks.
 *
 * Call it once at the top of the `describe` block.
 */
export function useIsolatedEventBusModules(): void {
  beforeAll(async () => {
    await import('../index');
    vi.resetModules();
  }, MODULE_GRAPH_WARMUP_TIMEOUT_MS);

  afterEach(() => {
    discardRegisteredEventBus();
    vi.resetModules();
  });
}
