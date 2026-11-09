/**
 * Capability keys. Dependency-free on purpose: the edge middleware imports this
 * file, so it must not pull in `features`, `logger-universal` or any Node-only
 * module. The gate definitions that go with each key live in `./capability`
 * (`CAPABILITY_SEEDS`, typed `Record<CapabilityKey, …>`).
 *
 * Adding a capability = add its key here and its row in `CAPABILITY_SEEDS`.
 */
export const CAPABILITY_KEYS = ['co-managed', 'ticket-conversations'] as const;

export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

export function isCapabilityKey(value: unknown): value is CapabilityKey {
  return typeof value === 'string' && (CAPABILITY_KEYS as readonly string[]).includes(value);
}
