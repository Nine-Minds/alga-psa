/**
 * Shared-work seam: the one place native code asks "does an app-layer provider own this call?".
 *
 * A native package (scheduling, clients, documents, the API layer) creates a named seam, calls
 * `delegate(tenant, call)` at the top of an action, and falls through to its own body when the
 * answer is `{ handled: false }`. A provider (co-managed) registers itself once at server boot;
 * native packages never import it.
 *
 * COST MODEL for a plain PSA tenant:
 *   - nothing registered (flag off, package failed to resolve) => `{ handled: false }` synchronously,
 *     no import, no SQL;
 *   - something registered => one cached `serves('co-managed', tenant)` verdict
 *     (@alga-psa/core capability gate: forced value, else a 30s participation cache). A
 *     non-participating tenant is answered from that cache with zero statements in steady state.
 *
 * The provider is never constructed or called for a tenant the gate does not serve, so providers
 * do not need their own per-call participation probe.
 *
 * The registry lives on globalThis because Next bundles a module more than once.
 */
export type SharedWorkMiss = { handled: false };

export interface SharedWorkSeam<P> {
  /** Register the provider factory. Duplicate registration of a seam throws. */
  register(factory: () => P | Promise<P>): void;
  /** Run `call` with the provider when it serves `tenant`; otherwise `{ handled: false }`. */
  delegate<R extends { handled: boolean }>(tenant: string, call: (provider: P) => Promise<R>): Promise<R | SharedWorkMiss>;
  /** The provider for a served tenant, or null. For callers that need several verbs. */
  resolve(tenant: string): Promise<P | null>;
  hasProvider(): boolean;
  /** Test seam only. */
  reset(): void;
}

interface Slot<P> { factory: () => P | Promise<P>; instance?: Promise<P> }

export function sharedWorkSeam<P>(name: string, capability: 'co-managed' = 'co-managed'): SharedWorkSeam<P> {
  const key = Symbol.for(`alga.sharedWorkSeam.${name}`);
  const host = globalThis as unknown as Record<symbol, Slot<P> | undefined>;

  async function resolve(tenant: string): Promise<P | null> {
    const slot = host[key];
    if (!slot) return null;
    const { serves } = await import('@alga-psa/core/capability');
    if (!(await serves(capability, tenant)).served) return null;
    slot.instance ??= Promise.resolve(slot.factory());
    return slot.instance;
  }

  return {
    register(factory) {
      if (host[key]) throw new Error(`A shared-work provider is already registered for '${name}'`);
      host[key] = { factory };
    },
    async delegate(tenant, call) {
      const provider = await resolve(tenant);
      return provider ? call(provider) : { handled: false };
    },
    resolve,
    hasProvider: () => host[key] !== undefined,
    reset() { delete host[key]; },
  };
}
