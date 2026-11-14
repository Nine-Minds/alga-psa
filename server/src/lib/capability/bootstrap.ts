import { cache } from 'react';
import { evaluateFeatureFlag } from '@alga-psa/core/features';
import {
  capabilityAdmitBootstrapKey,
  capabilityFeatureFlag,
  capabilityServedBootstrapKey,
  evaluateCapability,
  type CapabilityKey,
} from '@alga-psa/core/capability';

export type CapabilityBootstrap = Record<string, boolean>;

const CAPABILITIES: readonly CapabilityKey[] = ['co-managed', 'co-managed-seat'];

/**
 * Server-evaluated values for `PostHogProvider initialFeatureFlags`.
 *
 * - The rollout flag itself (`release-v2-0-feature`), evaluated tenant-only, so
 *   its existing consumer (the projects Timeline) renders from the server value
 *   even when posthog-js is blocked. Unavailable evaluations are omitted so
 *   that consumer can still resolve the flag through posthog-js.
 * - `capability:<key>` (served) and `capability:<key>:admit` (admitted), which
 *   `useCapability` reads. The browser never decides a capability itself.
 *
 * Deduplicated per request with React `cache`. Anonymous requests get `{}`.
 */
export const resolveCapabilityBootstrap = cache(async (tenantId: string | null): Promise<CapabilityBootstrap> => {
  if (!tenantId) return {};
  const out: CapabilityBootstrap = {};

  const flagKeys = new Set(CAPABILITIES.map(capabilityFeatureFlag));
  await Promise.all(
    [...flagKeys].map(async (flag) => {
      try {
        const evaluation = await evaluateFeatureFlag(flag, { tenantId });
        if (evaluation.status === 'evaluated') out[flag] = evaluation.enabled;
      } catch (error) {
        console.error(`capability bootstrap: flag ${flag} unavailable`, error);
      }
    }),
  );

  await Promise.all(
    CAPABILITIES.map(async (capability) => {
      try {
        const decision = await evaluateCapability(capability, tenantId);
        out[capabilityServedBootstrapKey(capability)] = decision.served;
        out[capabilityAdmitBootstrapKey(capability)] = decision.admitted;
      } catch (error) {
        // The root layout must never fail because of a capability; omit the key
        // and the browser fails closed (resolved: false).
        console.error(`capability bootstrap: ${capability} unavailable`, error);
      }
    }),
  );

  return out;
});
