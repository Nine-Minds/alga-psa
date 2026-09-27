'use server';

import { uploadEntityImage, deleteEntityImage, recropEntityLogo, parseLogoCrop, type EntityLogoVariant, type EntityType, type LogoCropRect } from '@alga-psa/storage';
import { getConnection, tenantDb } from '@alga-psa/db';
import { withAuth, type AuthContext } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';
import type { Knex } from 'knex';

const tenantSettingsQuery = (knex: Knex, tenant: string) =>
  tenantDb(knex, tenant).table('tenant_settings');

/** Branding key each logo variant writes to inside settings.branding. */
const BRANDING_LOGO_KEYS: Record<EntityLogoVariant, string> = {
  default: 'logoUrl',
  dark: 'logoDarkUrl',
  wide: 'logoWideUrl',
  'wide-dark': 'logoWideDarkUrl',
  favicon: 'faviconUrl',
};

const brandingLogoKey = (variant: EntityLogoVariant) =>
  BRANDING_LOGO_KEYS[variant] ?? BRANDING_LOGO_KEYS.default;

/** The wordmark slot a square mark is cut from: light from wide, dark from wide-dark. */
const markSourceVariant = (variant: EntityLogoVariant): EntityLogoVariant =>
  variant === 'dark' ? 'wide-dark' : 'wide';

/** Writes one logo URL into settings.branding, creating the row if needed. */
async function writeBrandingLogoUrl(tenant: string, logoVariant: EntityLogoVariant, url: string) {
  const knex = await getConnection(tenant);
  const existingRecord = await tenantSettingsQuery(knex, tenant).first();
  const existingSettings = existingRecord?.settings || {};
  const updatedSettings = {
    ...existingSettings,
    branding: {
      ...(existingSettings.branding || {}),
      [brandingLogoKey(logoVariant)]: url,
      // Keep existing colors
      primaryColor: existingSettings.branding?.primaryColor,
      secondaryColor: existingSettings.branding?.secondaryColor,
      clientName: existingSettings.branding?.clientName,
    }
  };

  if (existingRecord) {
    await tenantSettingsQuery(knex, tenant)
      .update({ settings: updatedSettings, updated_at: knex.fn.now() });
  } else {
    await tenantSettingsQuery(knex, tenant).insert({
      tenant,
      settings: updatedSettings,
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    });
  }
}

/**
 * Upload a logo for the tenant
 */
export const uploadTenantLogo = withAuth(async (user: IUserWithRoles, { tenant }: AuthContext, tenantId: string, formData: FormData, logoVariant: EntityLogoVariant = 'default') => {
  try {
    // Check if user has admin permissions
    if (user.user_type !== 'internal') {
      return { success: false, error: 'Only internal users can update tenant logo' };
    }

    const file = formData.get('logo') as File;
    if (!file) {
      return { success: false, error: 'No file provided' };
    }

    // A wide image dropped into a square-mark slot arrives with the zone to
    // keep. Only the mark is stored: the wide slots stay whatever they were.
    let crop: LogoCropRect | null = null;
    if (logoVariant === 'default' || logoVariant === 'dark') {
      try {
        crop = parseLogoCrop(formData.get('crop'));
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Invalid logo crop' };
      }
    }

    // Upload the logo using EntityImageService
    const result = await uploadEntityImage(
      'tenant' as EntityType,
      tenantId,
      file,
      user.user_id,
      tenant,
      'tenant_logo',
      true, // isLogoUpload
      logoVariant,
      crop ? { crop } : {}
    );

    if (result.success) {
      await writeBrandingLogoUrl(tenant, logoVariant, result.imageUrl || '');

      return {
        success: true,
        message: 'Logo uploaded successfully',
        imageUrl: result.imageUrl
      };
    }

    return { success: false, error: 'Failed to upload logo' };
  } catch (error) {
    console.error('Error uploading tenant logo:', error);
    return { success: false, error: 'Failed to upload logo' };
  }
});

/**
 * Cut a new square mark from the stored wide logo (dark mark from the dark
 * wide logo), so the zone can be adjusted without re-uploading.
 */
export const recropTenantLogo = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  tenantId: string,
  logoVariant: EntityLogoVariant,
  crop: LogoCropRect,
) => {
  try {
    if (user.user_type !== 'internal') {
      return { success: false, error: 'Only internal users can update tenant logo' };
    }
    if (logoVariant !== 'default' && logoVariant !== 'dark') {
      return { success: false, error: 'Only the square marks can be cropped' };
    }

    let validCrop: LogoCropRect | null;
    try {
      validCrop = parseLogoCrop(crop);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Invalid logo crop' };
    }
    if (!validCrop) {
      return { success: false, error: 'No crop provided' };
    }

    const result = await recropEntityLogo('tenant' as EntityType, tenantId, user.user_id, tenant, {
      sourceVariant: markSourceVariant(logoVariant),
      targetVariant: logoVariant,
      crop: validCrop,
      contextName: 'tenant_logo',
    });

    if (!result.success) {
      return { success: false, error: result.message || 'Failed to update logo' };
    }

    await writeBrandingLogoUrl(tenant, logoVariant, result.imageUrl || '');

    return { success: true, message: 'Logo updated successfully', imageUrl: result.imageUrl };
  } catch (error) {
    console.error('Error recropping tenant logo:', error);
    return { success: false, error: 'Failed to update logo' };
  }
});

/**
 * Delete the tenant logo
 */
export const deleteTenantLogo = withAuth(async (user: IUserWithRoles, { tenant }: AuthContext, tenantId: string, logoVariant: EntityLogoVariant = 'default') => {
  try {
    // Check if user has admin permissions
    if (user.user_type !== 'internal') {
      return { success: false, error: 'Only internal users can delete tenant logo' };
    }

    // Delete the logo using EntityImageService
    const result = await deleteEntityImage(
      'tenant' as EntityType,
      tenantId,
      user.user_id,
      tenant,
      undefined,
      logoVariant
    );

    if (result.success) {
      await writeBrandingLogoUrl(tenant, logoVariant, '');

      return {
        success: true,
        message: 'Logo deleted successfully'
      };
    }

    return { success: false, error: 'Failed to delete logo' };
  } catch (error) {
    console.error('Error deleting tenant logo:', error);
    return { success: false, error: 'Failed to delete logo' };
  }
});
