/**
 * Pool coverage: which pool absorbs a service on a line.
 *
 * Pure rule, no I/O. Explicit membership wins; otherwise the line's catch-all
 * pool absorbs the service iff the line configures it ("covers all line
 * services", never "anything this client bills"). This is the rule the time
 * entry write path applies (`resolveBucketForLine`); the parity suite asserts
 * the two agree on live fixtures.
 */

import type { PoolDefinition } from "./types";

export function resolvePoolForService(
  pools: readonly PoolDefinition[],
  configuredServiceIds: ReadonlySet<string>,
  serviceId: string,
): PoolDefinition | null {
  const member = pools.find((pool) => pool.memberServiceIds.includes(serviceId));
  if (member) return member;
  const catchAll = pools.find((pool) => pool.coversAllServices);
  if (catchAll && configuredServiceIds.has(serviceId)) return catchAll;
  return null;
}

/** Every service the line's pools absorb, given the line's configured services. */
export function coveredServiceIds(
  pools: readonly PoolDefinition[],
  configuredServiceIds: readonly string[],
): string[] {
  const configured = new Set(configuredServiceIds);
  const candidates = new Set<string>(configuredServiceIds);
  for (const pool of pools) {
    for (const serviceId of pool.memberServiceIds) candidates.add(serviceId);
  }
  return Array.from(candidates)
    .filter((serviceId) => resolvePoolForService(pools, configured, serviceId))
    .sort();
}
