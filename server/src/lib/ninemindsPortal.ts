/**
 * The Nine Minds client portal.
 *
 * Self-host / on-prem installs are Nine Minds customers and manage billing /
 * purchase licensing through this portal (itself an Alga PSA instance), not the
 * in-app Stripe pages. The UI routes the "Account" entry and the in-app
 * purchase routes here on-prem. Overridable via NEXT_PUBLIC_NINEMINDS_PORTAL_URL.
 */
export const NINEMINDS_PORTAL_URL =
  process.env.NEXT_PUBLIC_NINEMINDS_PORTAL_URL || 'https://portal.nineminds.com';
