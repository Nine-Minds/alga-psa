/**
 * The capability probe URLs, generated from the capability registry. The edge
 * middleware exempts exactly these paths from the x-api-key check (the probe
 * authenticates the session in-route), so this is the ONE place a probe path is
 * written: adding a key to `CAPABILITY_KEYS` exempts its probe, and nothing else
 * under `/api/v1/capabilities` is ever exempted.
 *
 * Edge-safe: imports only the dependency-free key list.
 */
import { CAPABILITY_KEYS, type CapabilityKey } from '@alga-psa/core/capability/keys';

export const CAPABILITY_PROBE_ROOT = '/api/v1/capabilities';

export function capabilityProbePath(key: CapabilityKey): string {
  return `${CAPABILITY_PROBE_ROOT}/${key}`;
}

/** Exact-match exemptions: each probe with and without a trailing slash. */
export const CAPABILITY_PROBE_PATHS: readonly string[] = CAPABILITY_KEYS.flatMap((key) => [
  capabilityProbePath(key),
  `${capabilityProbePath(key)}/`,
]);
