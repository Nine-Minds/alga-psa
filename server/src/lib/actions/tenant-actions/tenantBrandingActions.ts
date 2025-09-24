'use server';

import { getConnection } from '@/lib/db/db';
import { getCurrentUser } from '../user-actions/userActions';
import { revalidateTag } from 'next/cache';

export interface TenantBranding {
  logoUrl: string;
  primaryColor: string;
  secondaryColor: string;
  companyName: string;
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

  // Build updated settings with branding
  const updatedSettings = {
    ...existingSettings,
    branding: {
      logoUrl: branding.logoUrl,
      primaryColor: branding.primaryColor,
      secondaryColor: branding.secondaryColor,
      companyName: branding.companyName,
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

  // Invalidate cache for tenant branding
  revalidateTag('tenant-branding');

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