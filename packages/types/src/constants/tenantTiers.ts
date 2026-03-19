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
export const TENANT_TIERS = ['pro', 'premium'] as const;

/**
 * Valid tenant tier values.
 */
export type TenantTier = (typeof TENANT_TIERS)[number];

/**
 * Display labels for each tier.
 */
export const TIER_LABELS: Record<TenantTier, string> = {
  pro: 'Pro',
  premium: 'Premium',
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
  /** True if the plan was NULL, undefined, or invalid */
  isMisconfigured: boolean;
}

/**
 * Resolves a plan value to a tier.
 * - Valid tiers ('pro', 'premium') return as-is with isMisconfigured: false
 * - NULL, undefined, or invalid values return 'pro' with isMisconfigured: true
 *
 * @param plan - The plan value from the tenants table
 * @returns The resolved tier and whether it was misconfigured
 */
export function resolveTier(plan: string | null | undefined): ResolvedTier {
  if (isValidTier(plan)) {
    return { tier: plan, isMisconfigured: false };
  }
  return { tier: 'pro', isMisconfigured: true };
}
