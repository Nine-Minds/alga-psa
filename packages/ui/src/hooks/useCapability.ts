'use client';

import { resolveClientCapability, type CapabilityKey } from '@alga-psa/core/capability';
import { useFeatureFlagBootstrap } from '../capability/bootstrapContext';

export interface UseCapabilityResult {
  /** serves(): existing state may be shown/mounted. */
  enabled: boolean;
  /** admits(): start CTAs may be shown. */
  admitted: boolean;
  /** False when nothing answered (not bootstrapped, not forced): closed, but unknown. */
  resolved: boolean;
}

/**
 * Client view of a release capability. Reads ONLY the server bootstrap (plus a
 * dev/CI-only build-time force); it never imports posthog-js, never subscribes
 * to flag updates and never re-evaluates, so the answer cannot drift from the
 * server's. Co-managed UI must use this, never raw
 * `useFeatureFlag('release-v2-0-feature')`.
 */
export function useCapability(capability: CapabilityKey): UseCapabilityResult {
  const bootstrap = useFeatureFlagBootstrap();
  const state = resolveClientCapability({
    capability,
    bootstrap,
    // Literal access so Next inlines it; ignored in production builds.
    publicForceRaw: process.env.NEXT_PUBLIC_FORCE_CAPABILITIES,
    production: process.env.NODE_ENV === 'production',
  });
  return { enabled: state.enabled, admitted: state.admitted, resolved: state.resolved };
}
