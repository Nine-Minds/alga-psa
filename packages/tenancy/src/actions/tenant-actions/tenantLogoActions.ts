'use server';

import { uploadEntityImage, deleteEntityImage, EntityType } from '@alga-psa/media';
import { getConnection } from '@alga-psa/db';
import { getCurrentUser } from '@alga-psa/users/actions';

/**
 * Upload a logo for the tenant
 */
export async function uploadTenantLogo(tenantId: string, formData: FormData) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'User not found' };
    }

    // Check if user has admin permissions
    if (user.user_type !== 'internal') {
      return { success: false, error: 'Only internal users can update tenant logo' };
    }

    const file = formData.get('logo') as File;
    if (!file) {
      return { success: false, error: 'No file provided' };
    }

    // Upload the logo using EntityImageService
    const result = await uploadEntityImage(
      'tenant' as EntityType,
      tenantId,
      file,
      user.user_id,
      user.tenant,
      'tenant_logo',
      true // isLogoUpload
    );

    if (result.success) {
      // Update tenant settings with logo URL
      const knex = await getConnection(user.tenant);

      const existingRecord = await knex('tenant_settings')
        .where({ tenant: user.tenant })
        .first();

      const existingSettings = existingRecord?.settings || {};
      const updatedSettings = {
        ...existingSettings,
        branding: {
          ...(existingSettings.branding || {}),
          logoUrl: result.imageUrl || '',
          // Keep existing colors
          primaryColor: existingSettings.branding?.primaryColor,
          secondaryColor: existingSettings.branding?.secondaryColor,
          clientName: existingSettings.branding?.clientName,
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
}

/**
 * Delete the tenant logo
 */
export async function deleteTenantLogo(tenantId: string) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { success: false, error: 'User not found' };
    }

    // Check if user has admin permissions
    if (user.user_type !== 'internal') {
      return { success: false, error: 'Only internal users can delete tenant logo' };
    }

    // Delete the logo using EntityImageService
    const result = await deleteEntityImage(
      'tenant' as EntityType,
      tenantId,
      user.user_id,
      user.tenant
    );

    if (result.success) {
      // Update tenant settings to remove logo URL
      const knex = await getConnection(user.tenant);

      const existingRecord = await knex('tenant_settings')
        .where({ tenant: user.tenant })
        .first();

      if (existingRecord) {
        const existingSettings = existingRecord.settings || {};
        const updatedSettings = {
          ...existingSettings,
          branding: {
            ...(existingSettings.branding || {}),
            logoUrl: '',
            // Keep existing colors
            primaryColor: existingSettings.branding?.primaryColor,
            secondaryColor: existingSettings.branding?.secondaryColor,
            clientName: existingSettings.branding?.clientName,
          }
        };

        await knex('tenant_settings')
          .where({ tenant: user.tenant })
          .update({
            settings: updatedSettings,
            updated_at: knex.fn.now()
          });
      }

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
}
