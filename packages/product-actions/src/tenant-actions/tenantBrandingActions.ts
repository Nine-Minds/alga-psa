'use server';

import { getConnection } from '@/lib/db/db';
import { getCurrentUser } from '@product/actions/user-actions/userActions';
import { revalidateTag } from 'next/cache';
import { generateBrandingStyles } from '@/lib/branding/generateBrandingStyles';

export interface TenantBranding {
  logoUrl: string;
  primaryColor: string;
  secondaryColor: string;
  clientName: string;
  computedStyles?: string; // Cached CSS styles
}

/**
 * Update tenant's branding settings
 */
export async function updateTenantBrandingAction(branding: TenantBranding) {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not found');
  }

  // Check if user has admin permissions
  if (user.user_type !== 'internal') {
    throw new Error('Only internal users can update tenant branding');
  }

  const knex = await getConnection(user.tenant);

  // Get existing settings
  const existingRecord = await knex('tenant_settings')
    .where({ tenant: user.tenant })
    .first();

  const existingSettings = existingRecord?.settings || {};

  // Precompute CSS styles for performance
  const computedStyles = generateBrandingStyles({
    logoUrl: branding.logoUrl,
    primaryColor: branding.primaryColor,
    secondaryColor: branding.secondaryColor,
    clientName: branding.clientName,
  });

  // Build updated settings with branding and computed styles
  const updatedSettings = {
    ...existingSettings,
    branding: {
      logoUrl: branding.logoUrl,
      primaryColor: branding.primaryColor,
      secondaryColor: branding.secondaryColor,
      clientName: branding.clientName,
      computedStyles, // Store precomputed CSS
    }
  };

  if (existingRecord) {
    await knex('tenant_settings')
      .where({ tenant: user.tenant })
      .update({
        settings: updatedSettings,
        updated_at: knex.fn.now()
      });
  } else {
    await knex('tenant_settings').insert({
      tenant: user.tenant,
      settings: updatedSettings,
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    });
  }

  // Invalidate cache for tenant branding and related portal config
  revalidateTag('tenant-branding');
  revalidateTag('tenant-portal-config');

  return { success: true };
}

/**
 * Get tenant's branding settings
 */
export async function getTenantBrandingAction(): Promise<TenantBranding | null> {
  const user = await getCurrentUser();
  if (!user) {
    return null;
  }

  const knex = await getConnection(user.tenant);

  const tenantSettings = await knex('tenant_settings')
    .where({ tenant: user.tenant })
    .first();

  if (!tenantSettings?.settings?.branding) {
    return null;
  }

  return tenantSettings.settings.branding;
}

/**
 * Get tenant's branding settings by tenant ID (for public access)
 */
export async function getTenantBrandingByIdAction(tenantId: string): Promise<TenantBranding | null> {
  const knex = await getConnection(tenantId);

  const tenantSettings = await knex('tenant_settings')
    .where({ tenant: tenantId })
    .first();

  if (!tenantSettings?.settings?.branding) {
    return null;
  }

  return tenantSettings.settings.branding;
}
