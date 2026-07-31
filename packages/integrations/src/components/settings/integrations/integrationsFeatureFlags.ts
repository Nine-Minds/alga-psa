/**
 * PostHog flag keys used by the integrations settings surface.
 *
 * Kept as named constants rather than inline strings so the eventual cleanup is
 * a grep for one identifier rather than for a quoted string that may or may not
 * be the same one.
 */

/**
 * Shows the Identity category on Settings › Integrations.
 *
 * Deliberately narrow: it gates the tab and nothing else. The Entra route
 * (/msp/settings/integrations/entra) stays reachable by URL, and the API is
 * untouched — access there is still EE edition + ENTRA_SYNC tier + RBAC, which
 * is what the retired entra-integration-ui flag left behind when it was removed
 * in b4803b7a57.
 *
 * Off unless PostHog says otherwise, including when PostHog cannot be reached:
 * a rollout control that fails open is not a rollout control. Set
 * NEXT_PUBLIC_DISABLE_FEATURE_FLAGS=true for local work.
 */
export const ENTRA_SYNC_FEATURE_FLAG = 'entra-sync-feature';
