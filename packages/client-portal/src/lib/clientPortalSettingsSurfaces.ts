/**
 * Single source of truth for which Client Settings surfaces a client portal user may see.
 *
 * Pure on purpose: no data access, no 'use server'. The sidebar, the settings page and the
 * server route guard all read this, so they cannot drift apart.
 * See docs/plans/2026-11-23-client-portal-hide-unpermitted-surfaces.md (alga-2026-0003226).
 */

export type ClientPortalSettingsTab =
  | 'account'
  | 'client-details'
  | 'user-management'
  | 'visibility-groups';

export interface ClientPortalSettingsPermissions {
  hasBillingAccess: boolean; // billing:read
  hasClientReadAccess: boolean; // client:read
  hasUserManagementAccess: boolean; // user:read
  hasVisibilityGroupAccess: boolean; // contacts.is_client_admin
}

export interface ClientPortalSettingsSurfaces {
  tabs: ClientPortalSettingsTab[];
  showPlanCard: boolean;
  showInvoicesCard: boolean;
  canOpenSettings: boolean;
}

export function resolveClientPortalSettingsSurfaces(
  p: ClientPortalSettingsPermissions,
): ClientPortalSettingsSurfaces {
  const showPlanCard = p.hasBillingAccess;
  const showInvoicesCard = p.hasBillingAccess;

  // Gated on billing:read only. Hosting (stripe_customers) is the MSP's own Stripe integration
  // and is unrelated to a client's view of its contract line and invoices.
  const canSeeAccountTab = p.hasBillingAccess;
  // Design decision: flipping Client Details to admin-only is a change to this one line
  // (use p.hasVisibilityGroupAccess instead of p.hasClientReadAccess).
  const canSeeClientDetailsTab = p.hasClientReadAccess;
  const canSeeUserManagementTab = p.hasUserManagementAccess;
  const canSeeVisibilityGroupsTab = p.hasVisibilityGroupAccess;

  // Canonical order.
  const tabs: ClientPortalSettingsTab[] = [];
  if (canSeeAccountTab) tabs.push('account');
  if (canSeeClientDetailsTab) tabs.push('client-details');
  if (canSeeUserManagementTab) tabs.push('user-management');
  if (canSeeVisibilityGroupsTab) tabs.push('visibility-groups');

  return { tabs, showPlanCard, showInvoicesCard, canOpenSettings: tabs.length > 0 };
}

/** The tab to show for a requested `?tab=` value: the request if permitted, else the first permitted tab. */
export function coerceClientPortalSettingsTab(
  requested: string | null | undefined,
  surfaces: ClientPortalSettingsSurfaces,
): ClientPortalSettingsTab | undefined {
  const wanted = requested?.toLowerCase();
  const match = surfaces.tabs.find((tab) => tab === wanted);
  return match ?? surfaces.tabs[0];
}
