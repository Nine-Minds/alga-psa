/**
 * Test-only hatches for the capability gate. Not a package export and not
 * importable from production code (the capability entry-point contract fails
 * on any non-test import of `@alga-psa/core/capability/testing`).
 *
 * The gate registry lives on `globalThis` under this key (see
 * `packages/core/src/lib/capability.ts`), so in a shared test process it
 * outlives a single test file.
 */

const REGISTRY_KEY = Symbol.for('alga.core.capabilityRegistry');

type RegistryHost = typeof globalThis & {
  [REGISTRY_KEY]?: { cache: Map<string, unknown> };
};

/** Drop every cached decision; registered resolvers stay. */
export function clearCapabilityCache(): void {
  (globalThis as RegistryHost)[REGISTRY_KEY]?.cache.clear();
}

/**
 * Drop every registered resolver and cached decision; the next gate call
 * restores the built-in gate definitions.
 */
export function resetCapabilityRegistry(): void {
  delete (globalThis as RegistryHost)[REGISTRY_KEY];
}
