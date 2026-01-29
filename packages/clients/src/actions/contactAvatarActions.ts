'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { revalidatePath } from 'next/cache';
import { uploadEntityImage, deleteEntityImage } from '@alga-psa/documents';
import { withAuth, type AuthContext } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';

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

  // Permission check
  let canModify = false;
  if (currentUser.user_type === 'client') {
    if (currentUser.contact_id === contactId) {
      canModify = true;
    } else {
      const userContact = await withTransaction(knex, async (trx: Knex.Transaction) => {
        return await trx('contacts')
          .where({
            contact_name_id: contactId,
            tenant
          })
          .first();
      });

      if (userContact) {
        const contactUser = await withTransaction(knex, async (trx: Knex.Transaction) => {
          return await trx('users')
            .where({
              contact_id: contactId,
              user_id: currentUser.user_id,
              tenant
            })
            .first();
        });

        if (contactUser) {
          canModify = true;
        }
      }
    }
  } else if (currentUser.user_type === 'internal') {
    canModify = true;
  }

  if (!canModify) {
    return { success: false, message: 'You do not have permission to modify this contact\'s avatar' };
  }

  const file = formData.get('avatar') as File;
  if (!file) {
    return { success: false, message: 'No avatar file provided' };
  }

  const contact = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('contacts')
      .where({ contact_name_id: contactId, tenant })
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

  // Permission check
  let canDelete = false;
  if (currentUser.user_type === 'client') {
    if (currentUser.contact_id === contactId) {
      canDelete = true;
    } else {
      const userContact = await withTransaction(knex, async (trx: Knex.Transaction) => {
        return await trx('contacts')
          .where({
            contact_name_id: contactId,
            tenant
          })
          .first();
      });

      if (userContact) {
        const contactUser = await withTransaction(knex, async (trx: Knex.Transaction) => {
          return await trx('users')
            .where({
              contact_id: contactId,
              user_id: currentUser.user_id,
              tenant
            })
            .first();
        });

        if (contactUser) {
          canDelete = true;
        }
      }
    }
  } else if (currentUser.user_type === 'internal') {
    canDelete = true;
  }

  if (!canDelete) {
    return { success: false, message: 'You do not have permission to delete this contact\'s avatar' };
  }

  const contact = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('contacts')
      .where({ contact_name_id: contactId, tenant })
      .first();
  });
  if (!contact) {
    return { success: false, message: 'Contact not found' };
  }

  try {
    await deleteEntityImage('contact', contactId, tenant);

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
