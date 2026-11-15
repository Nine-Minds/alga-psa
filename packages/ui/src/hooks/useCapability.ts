'use client';

import { useMemo } from 'react';
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
  return resolveCapabilityView(capability, bootstrap);
}

type Bootstrap = ReturnType<typeof useFeatureFlagBootstrap>;

function resolveCapabilityView(capability: CapabilityKey, bootstrap: Bootstrap): UseCapabilityResult {
  const state = resolveClientCapability({
    capability,
    bootstrap,
    // Literal access so Next inlines it; ignored in production builds.
    publicForceRaw: process.env.NEXT_PUBLIC_FORCE_CAPABILITIES,
    production: process.env.NODE_ENV === 'production',
  });
  return { enabled: state.enabled, admitted: state.admitted, resolved: state.resolved };
}

/** Exhaustive by type: adding a CapabilityKey fails to compile here until it is listed. */
const CAPABILITY_KEYS: Record<CapabilityKey, true> = { 'co-managed': true, 'co-managed-seat': true };

/**
 * The capabilities currently served (`enabled`, i.e. serves()): the `served` set every
 * `resolveUiSlots` mount passes. One derivation, the same one `useCapability` answers
 * from, so a slot can never be mounted on a verdict the hook would not give.
 */
export function useServedCapabilities(): ReadonlySet<CapabilityKey> {
  const bootstrap = useFeatureFlagBootstrap();
  return useMemo(
    () => new Set((Object.keys(CAPABILITY_KEYS) as CapabilityKey[]).filter((key) => resolveCapabilityView(key, bootstrap).enabled)),
    [bootstrap],
  );
}
