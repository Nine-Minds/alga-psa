/**
 * Add-on constants and utilities
 *
 * Add-ons are purchased independently of tier. A pro tenant can buy
 * add-ons to unlock premium-only features without upgrading their plan.
 *
 * The `tenant_addons` table stores active add-ons per tenant.
 * Each add-on has an addon_key, activation timestamp, optional expiration,
 * and flexible metadata (e.g. stripe_subscription_item_id for billing).
 *
 * When add-on values are defined, the runtime flow will be:
 *   1. Fetch active add-ons for tenant (from DB or session)
 *   2. Check access: tierHasFeature(tier, feature) || tenantHasAddOn(addons, addon)
 *   3. Gate UI and server actions accordingly
 */

/**
 * Available add-ons. Add new add-on keys here as they become available.
 *
 * Scaffolding: not yet integrated into access checks. The `tenant_addons`
 * table exists and `tenantHasAddOn()` is ready, but no runtime code reads
 * add-ons yet. When the first add-on is defined, wire it into TierContext
 * and assertTierAccess alongside the tier feature checks.
 */
export enum ADD_ONS {
  AI_ASSISTANT = 'ai_assistant',
}

/**
 * Type for add-on keys. Resolves to string literal union when enum has values, `never` when empty.
 */
export type AddOnKey = `${ADD_ONS}`;

/**
 * Display labels for supported add-ons.
 */
export const ADD_ON_LABELS: Record<ADD_ONS, string> = {
  [ADD_ONS.AI_ASSISTANT]: 'AI Assistant',
} as const;

/**
 * Marketing descriptions for supported add-ons.
 */
export const ADD_ON_DESCRIPTIONS: Record<ADD_ONS, string> = {
  [ADD_ONS.AI_ASSISTANT]:
    'Unlock AI chat, document assistance, sidebar help, and workflow AI tools for your team.',
} as const;

/**
 * Check if a tenant has a specific add-on active.
 *
 * @param addOns - Array of active add-on keys for the tenant
 * @param addOn - The add-on key to check
 * @returns True if the tenant has the add-on
 */
export function tenantHasAddOn(addOns: readonly string[], addOn: string): boolean {
  return addOns.includes(addOn);
}
