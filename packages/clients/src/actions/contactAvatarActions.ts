'use server';

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { revalidatePath } from 'next/cache';
import { uploadEntityImage, deleteEntityImage } from '@alga-psa/storage';
import { withAuth, type AuthContext } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';
import { hasMspPermission } from '../lib/authHelpers';

async function canManageContactAvatar(
  currentUser: IUserWithRoles,
  tenant: string,
  contactId: string,
  knex: Knex
): Promise<boolean> {
  if (currentUser.user_type === 'internal') {
    return hasMspPermission(currentUser, 'contact', 'update', knex);
  }

  if (currentUser.user_type !== 'client') {
    return false;
  }

  if (currentUser.contact_id === contactId) {
    return true;
  }

  const linkedUser = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await tenantDb(trx, tenant).table('users')
      .select('user_id')
      .where({
        contact_id: contactId,
        user_id: currentUser.user_id,
      })
      .first();
  });

  return !!linkedUser;
}

/**
 * Upload a contact avatar image
 *
 * Allows an authenticated client user to upload an avatar for their own linked contact record,
 * or an MSP user with appropriate permissions to manage contact avatars.
 */
export const uploadContactAvatar = withAuth(async (
  currentUser: IUserWithRoles,
  { tenant }: AuthContext,
  contactId: string,
  formData: FormData
): Promise<{ success: boolean; message?: string; imageUrl?: string | null }> => {
  const { knex } = await createTenantKnex();

  if (!await canManageContactAvatar(currentUser, tenant, contactId, knex)) {
    return { success: false, message: 'You do not have permission to modify this contact\'s avatar' };
  }

  const file = formData.get('avatar') as File;
  if (!file) {
    return { success: false, message: 'No avatar file provided' };
  }

  const contact = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await tenantDb(trx, tenant).table('contacts')
      .where({ contact_name_id: contactId })
      .first();
  });
  if (!contact) {
    return { success: false, message: 'Contact not found' };
  }

  try {
    const uploadResult = await uploadEntityImage(
      'contact',
      contactId,
      file,
      currentUser.user_id,
      tenant,
      'contact_avatar',
      true
    );

    if (!uploadResult.success) {
      return { success: false, message: uploadResult.message || 'Failed to upload contact avatar' };
    }

    revalidatePath(`/contacts/${contactId}`);
    revalidatePath('/contacts');
    revalidatePath('/client/profile');

    return { success: true, imageUrl: uploadResult.imageUrl };
  } catch (error) {
    console.error('[contactAvatarActions] Failed to upload contact avatar:', error);
    const message = error instanceof Error ? error.message : 'Failed to upload contact avatar';
    return { success: false, message };
  }
});

/**
 * Delete a contact's avatar
 */
export const deleteContactAvatar = withAuth(async (
  currentUser: IUserWithRoles,
  { tenant }: AuthContext,
  contactId: string
): Promise<{ success: boolean; message?: string }> => {
  const { knex } = await createTenantKnex();

  if (!await canManageContactAvatar(currentUser, tenant, contactId, knex)) {
    return { success: false, message: 'You do not have permission to delete this contact\'s avatar' };
  }

  const contact = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await tenantDb(trx, tenant).table('contacts')
      .where({ contact_name_id: contactId })
      .first();
  });
  if (!contact) {
    return { success: false, message: 'Contact not found' };
  }

  try {
    await deleteEntityImage('contact', contactId, currentUser.user_id, tenant);

    revalidatePath(`/contacts/${contactId}`);
    revalidatePath('/contacts');
    revalidatePath('/client/profile');

    return { success: true };
  } catch (error) {
    console.error('[contactAvatarActions] Failed to delete contact avatar:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete contact avatar';
    return { success: false, message };
  }
});
