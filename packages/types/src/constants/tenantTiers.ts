/**
 * Tenant tier constants and utilities
 *
 * The `plan` column on the `tenants` table is the single source of truth
 * for a tenant's tier. This module provides type-safe access to tier
 * values and utilities for resolving/validating tiers.
 */

/**
 * Tenant tiers as a const tuple.
 * Used to derive the TenantTier type.
 */
export const TENANT_TIERS = ['solo', 'pro', 'premium'] as const;

/**
 * Valid tenant tier values.
 */
export type TenantTier = (typeof TENANT_TIERS)[number];

/**
 * Display labels for each tier.
 */
export const TIER_LABELS: Record<TenantTier, string> = {
  solo: 'Solo',
  pro: 'Pro',
  premium: 'Premium',
} as const;

/**
 * Numeric rank for comparing tiers.
 * Higher rank means broader access.
 */
export const TIER_RANK: Record<TenantTier, number> = {
  solo: 0,
  pro: 1,
  premium: 2,
} as const;

/**
 * Type guard to check if a value is a valid TenantTier.
 */
export function isValidTier(value: unknown): value is TenantTier {
  return typeof value === 'string' && TENANT_TIERS.includes(value as TenantTier);
}

/**
 * Result of resolving a plan value to a tier.
 */
export interface ResolvedTier {
  /** The resolved tier (defaults to 'pro' if invalid/null) */
  tier: TenantTier;
  /** True if the plan was an invalid non-null string */
  isMisconfigured: boolean;
}

/**
 * Resolves a plan value to a tier.
 * - Valid tiers ('solo', 'pro', 'premium') return as-is with isMisconfigured: false
 * - NULL/undefined values default to 'pro' with isMisconfigured: false
 * - Invalid string values return 'pro' with isMisconfigured: true
 *
 * @param plan - The plan value from the tenants table
 * @returns The resolved tier and whether it was misconfigured
 */
export function resolveTier(plan: string | null | undefined): ResolvedTier {
  if (plan == null) {
    return { tier: 'pro', isMisconfigured: false };
  }

  if (isValidTier(plan)) {
    return { tier: plan, isMisconfigured: false };
  }

  return { tier: 'pro', isMisconfigured: true };
}

/**
 * Check whether a tier meets or exceeds a minimum tier requirement.
 *
 * @param tier - The tenant's current tier
 * @param minimum - The minimum tier required
 * @returns True if the tenant tier is at least the minimum tier
 */
export function tierAtLeast(tier: TenantTier, minimum: TenantTier): boolean {
  return TIER_RANK[tier] >= TIER_RANK[minimum];
}
