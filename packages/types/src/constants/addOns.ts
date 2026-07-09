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
 * Runtime flow:
 *   1. Fetch active add-ons for tenant (from DB or session)
 *   2. Check access with tenantHasAddOn(addons, addon)
 *   3. Gate UI and server actions accordingly
 *
 * Product entitlement (`tenants.product_code`) is independent of add-ons.
 * A product decision should not mutate or replace add-on checks.
 */

/**
 * Available add-ons. Add new add-on keys here as they become available.
 *
 * The `tenant_addons` table, session pipeline, TierContext.hasAddOn(), and
 * server-side add-on assertions use these keys as the entitlement contract.
 */
export enum ADD_ONS {
  AI_ASSISTANT = 'ai_assistant',
  TEAMS = 'teams',
  ENTERPRISE = 'enterprise',
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
  [ADD_ONS.TEAMS]: 'Teams',
  [ADD_ONS.ENTERPRISE]: 'Enterprise',
} as const;

/**
 * Marketing descriptions for supported add-ons.
 */
export const ADD_ON_DESCRIPTIONS: Record<ADD_ONS, string> = {
  [ADD_ONS.AI_ASSISTANT]:
    'Unlock AI chat, document assistance, sidebar help, and workflow AI tools for your team.',
  [ADD_ONS.TEAMS]:
    'Activate the Microsoft Teams integration, including the Teams tab, bot, message extension, quick actions, activity notifications, Teams meetings with calendar invites, and automatic recording and transcript capture.',
  [ADD_ONS.ENTERPRISE]:
    'Activate Microsoft Entra Sync for tenant discovery, client mapping, contact synchronization, field sync, and reconciliation workflows.',
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
