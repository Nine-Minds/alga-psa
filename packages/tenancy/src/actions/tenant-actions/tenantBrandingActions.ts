'use server';

import { getConnection, tenantDb } from '@alga-psa/db';
import { revalidateTag } from 'next/cache';
import { generateBrandingStyles } from '../../lib/generateBrandingStyles';
import { withAuth, withOptionalAuth, type AuthContext } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';
import type { Knex } from 'knex';

export type PortalHeroGradient = 'primary-shades' | 'primary-secondary';
export type PortalSidebarStyle = 'default' | 'primary' | 'secondary' | 'custom';

export interface TenantBranding {
  logoUrl: string;
  /**
   * Optional logo for dark surfaces (portal side panel, dark-themed auth
   * pages). Absent means every surface keeps using `logoUrl`.
   */
  logoDarkUrl?: string;
  primaryColor: string;
  secondaryColor: string;
  clientName: string;
  /**
   * Controls the client dashboard welcome gradient. Missing values retain the
   * original primary-500 -> primary-700 behavior for existing tenants.
   */
  portalHeroGradient?: PortalHeroGradient;
  /**
   * Tints the client portal side panel with the primary/secondary palette, or
   * with `portalSidebarColor` when set to 'custom'. Missing or 'default' keeps
   * the stock slate side panel.
   */
  portalSidebarStyle?: PortalSidebarStyle;
  /** Arbitrary side panel tint, used only when portalSidebarStyle is 'custom'. */
  portalSidebarColor?: string;
  /**
   * When true the client portal drops these brand accents and wears the
   * organization theme instead. Missing/false keeps the portal branding in
   * charge, which is what every existing tenant configured.
   */
  portalFollowsTheme?: boolean;
  supportEmail?: string;
  supportPhone?: string;
  computedStyles?: string; // Cached CSS styles
}

const tenantSettingsQuery = (knex: Knex, tenant: string) =>
  tenantDb(knex, tenant).table('tenant_settings');

/**
 * Update tenant's branding settings
 */
export const updateTenantBrandingAction = withAuth(async (user: IUserWithRoles, { tenant }: AuthContext, branding: TenantBranding) => {
  // Check if user has admin permissions
  if (user.user_type !== 'internal') {
    throw new Error('Only internal users can update tenant branding');
  }

  const knex = await getConnection(tenant);

  // Get existing settings
  const existingRecord = await tenantSettingsQuery(knex, tenant)
    .first();

  const existingSettings = existingRecord?.settings || {};

  // Carry forward optional fields the caller didn't send so an older client or
  // another settings tab can never wipe them.
  const logoDarkUrl = branding.logoDarkUrl ?? existingSettings.branding?.logoDarkUrl;
  const portalSidebarStyle = branding.portalSidebarStyle ?? existingSettings.branding?.portalSidebarStyle;
  const portalSidebarColor = branding.portalSidebarColor ?? existingSettings.branding?.portalSidebarColor;
  const portalFollowsTheme = branding.portalFollowsTheme ?? existingSettings.branding?.portalFollowsTheme;

  // Precompute CSS styles for performance
  const computedStyles = generateBrandingStyles({
    logoUrl: branding.logoUrl,
    primaryColor: branding.primaryColor,
    secondaryColor: branding.secondaryColor,
    clientName: branding.clientName,
    portalSidebarStyle,
    portalSidebarColor,
    portalFollowsTheme,
  });

  // Build updated settings with branding and computed styles.
  // supportEmail/supportPhone live at the top level of `settings` because
  // that's what appointmentHelpers.getTenantSettings reads (contactEmail/Phone fallbacks).
  const updatedSettings = {
    ...existingSettings,
    supportEmail: branding.supportEmail ?? existingSettings.supportEmail ?? '',
    supportPhone: branding.supportPhone ?? existingSettings.supportPhone ?? '',
    branding: {
      logoUrl: branding.logoUrl,
      logoDarkUrl,
      primaryColor: branding.primaryColor,
      secondaryColor: branding.secondaryColor,
      clientName: branding.clientName,
      portalHeroGradient: branding.portalHeroGradient,
      portalSidebarStyle,
      portalSidebarColor,
      portalFollowsTheme,
      computedStyles, // Store precomputed CSS
    }
  };

  if (existingRecord) {
    await tenantSettingsQuery(knex, tenant)
      .update({
        settings: updatedSettings,
        updated_at: knex.fn.now()
      });
  } else {
    await tenantSettingsQuery(knex, tenant).insert({
      tenant,
      settings: updatedSettings,
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    });
  }

  // Invalidate cache for tenant branding and related portal config
  revalidateTag('tenant-branding', 'max');
  revalidateTag('tenant-portal-config', 'max');

  return { success: true };
});

/**
 * Get tenant's branding settings
 */
export const getTenantBrandingAction = withOptionalAuth(async (user: IUserWithRoles | null, ctx: AuthContext | null): Promise<TenantBranding | null> => {
  if (!user || !ctx) {
    return null;
  }

  const { tenant } = ctx;
  const knex = await getConnection(tenant);

  const tenantSettings = await tenantSettingsQuery(knex, tenant)
    .first();

  if (!tenantSettings?.settings?.branding) {
    return null;
  }

  return {
    ...tenantSettings.settings.branding,
    supportEmail: tenantSettings.settings.supportEmail ?? '',
    supportPhone: tenantSettings.settings.supportPhone ?? '',
  };
});

/**
 * Get tenant's branding settings by tenant ID (for public access)
 */
export async function getTenantBrandingByIdAction(tenantId: string): Promise<TenantBranding | null> {
  const knex = await getConnection(tenantId);

  const tenantSettings = await tenantSettingsQuery(knex, tenantId)
    .first();

  if (!tenantSettings?.settings?.branding) {
    return null;
  }

  return {
    ...tenantSettings.settings.branding,
    supportEmail: tenantSettings.settings.supportEmail ?? '',
    supportPhone: tenantSettings.settings.supportPhone ?? '',
  };
}
