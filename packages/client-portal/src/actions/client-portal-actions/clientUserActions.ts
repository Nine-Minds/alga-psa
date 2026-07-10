'use server';

import { createTenantKnex, getTenantSlugForTenant, tenantDb } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { hashPassword } from '@alga-psa/core/encryption';
import { revalidatePath } from 'next/cache';
// Note: getUserClientId removed - was unused and caused nested withAuth issues
import { uploadEntityImage, deleteEntityImage } from '@alga-psa/storage';
import { hasPermission, withAuth, type AuthContext } from '@alga-psa/auth';
import { getRoles, assignRoleToUser, removeRoleFromUser, getUserRoles } from '@alga-psa/auth/actions/policyActions';
import {
  createPortalUserInDB,
  getClientPortalRoles as getClientPortalRolesFromDB,
  CreatePortalUserInput
} from '@shared/models/userModel';
import { IUser, IRole } from '@shared/interfaces/user.interfaces';
import type { IUserWithRoles } from '@alga-psa/types';

export type ClientUserActionError =
  | { readonly actionError: string }
  | { readonly permissionError: string };

function clientUserActionErrorFrom(error: unknown): ClientUserActionError | null {
  if (error && typeof error === 'object') {
    const candidate = error as { actionError?: unknown; permissionError?: unknown };
    if (typeof candidate.permissionError === 'string') {
      return { permissionError: candidate.permissionError };
    }
    if (typeof candidate.actionError === 'string') {
      return { actionError: candidate.actionError };
    }
  }

  if (!(error instanceof Error)) {
    const dbError = error as { code?: string; constraint?: string; column?: string };
    if (dbError?.code === '23505') {
      return { actionError: 'A client user with this email already exists.' };
    }
    if (dbError?.code === '23503') {
      return { actionError: 'The selected contact or role is no longer valid. Please refresh and try again.' };
    }
    if (dbError?.code === '23502') {
      return { actionError: `Missing required client user field${dbError.column ? `: ${dbError.column}` : ''}.` };
    }
    if (dbError?.code === '22P02') {
      return { actionError: 'Invalid client user data provided. Please refresh and try again.' };
    }
    return null;
  }

  if (error.message.includes('Permission denied')) {
    return { permissionError: error.message };
  }
  if (error.message === 'User not found') {
    return { actionError: 'Client user not found. It may have been deleted. Please refresh and try again.' };
  }
  if (error.message === 'Contact not found') {
    return { actionError: 'Contact not found. It may have been deleted. Please refresh and try again.' };
  }

  const dbError = error as Error & { code?: string; constraint?: string; column?: string };
  if (dbError.code === '23505') {
    return { actionError: 'A client user with this email already exists.' };
  }
  if (dbError.code === '23503') {
    return { actionError: 'The selected contact or role is no longer valid. Please refresh and try again.' };
  }
  if (dbError.code === '23502') {
    return { actionError: `Missing required client user field${dbError.column ? `: ${dbError.column}` : ''}.` };
  }
  if (dbError.code === '22P02') {
    return { actionError: 'Invalid client user data provided. Please refresh and try again.' };
  }

  return null;
}

function clientUserActionErrorMessage(error: unknown, fallback: string): string {
  const mappedError = clientUserActionErrorFrom(error);
  if (mappedError) {
    return 'permissionError' in mappedError
      ? mappedError.permissionError
      : mappedError.actionError;
  }

  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (message === 'Contact not found') {
    return message;
  }

  return fallback;
}

/**
 * Get available client portal roles
 */
export const getClientPortalRoles = withAuth(async (_user: IUserWithRoles, { tenant }: AuthContext): Promise<IRole[]> => {
  try {
    const { knex } = await createTenantKnex();
    return await getClientPortalRolesFromDB(knex, tenant);
  } catch (error) {
    console.error('Error fetching client portal roles:', error);
    return [];
  }
});

/**
 * Assign a role to a client user
 */
export async function assignClientUserRole(userId: string, roleId: string): Promise<void | ClientUserActionError> {
  try {
    const result = await assignRoleToUser(userId, roleId);
    if (result && typeof result === 'object' && ('permissionError' in result || 'actionError' in result)) {
      return result;
    }
  } catch (error) {
    const expected = clientUserActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error assigning role to client user:', error);
    throw error;
  }
}

/**
 * Remove a role from a client user
 */
export async function removeClientUserRole(userId: string, roleId: string): Promise<void | ClientUserActionError> {
  try {
    const result = await removeRoleFromUser(userId, roleId);
    if (result && typeof result === 'object' && ('permissionError' in result || 'actionError' in result)) {
      return result;
    }
  } catch (error) {
    const expected = clientUserActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error removing role from client user:', error);
    throw error;
  }
}

/**
 * Get roles for a specific client user
 */
export async function getClientUserRoles(userId: string): Promise<IRole[]> {
  try {
    return await getUserRoles(userId);
  } catch (error) {
    console.error('Error getting client user roles:', error);
    return [];
  }
}

/**
 * Authorize management of a client-portal user and confirm the target is a
 * `client` user inside the caller's scope. Returns nothing on success, throws
 * otherwise.
 *
 * - MSP (internal) staff need the standard `user:update` permission.
 * - Client-portal callers must be a client admin (`is_client_admin`) acting on
 *   a user that belongs to their own client company.
 *
 * The `user_type: 'client'` lookup is critical: without it these flows could be
 * pointed at MSP staff accounts (cross-portal account takeover).
 */
async function assertCanManageClientUser(
  user: IUserWithRoles,
  tenant: string,
  knex: Knex | Knex.Transaction,
  targetUserId: string
): Promise<void> {
  const scopedDb = tenantDb(knex, tenant);

  const targetUser = await scopedDb.table('users')
    .where({ user_id: targetUserId, user_type: 'client' })
    .select('contact_id')
    .first();

  if (!targetUser) {
    throw new Error('User not found');
  }

  // MSP staff: gate on the standard user-management permission.
  if (user.user_type !== 'client') {
    const canUpdate = await hasPermission(user, 'user', 'update', knex);
    if (!canUpdate) {
      throw new Error('Permission denied: Cannot manage client users');
    }
    return;
  }

  // Client-portal caller: must be a client admin managing a user in their own company.
  if (!user.contact_id) {
    throw new Error('Permission denied: Client portal admin access is required');
  }

  const [actorContact, targetContact] = await Promise.all([
    scopedDb.table('contacts')
      .where({ contact_name_id: user.contact_id })
      .select('client_id', 'is_client_admin')
      .first(),
    targetUser.contact_id
      ? scopedDb.table('contacts')
          .where({ contact_name_id: targetUser.contact_id })
          .select('client_id')
          .first()
      : Promise.resolve(undefined),
  ]);

  if (!actorContact?.is_client_admin || !actorContact.client_id) {
    throw new Error('Permission denied: Client portal admin access is required');
  }

  if (!targetContact?.client_id || targetContact.client_id !== actorContact.client_id) {
    throw new Error('Permission denied: Cannot manage users for another client');
  }
}

/**
 * Update a client user
 */
export const updateClientUser = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  userId: string,
  userData: Partial<IUser>
): Promise<IUser | null | ClientUserActionError> => {
  try {
    const { knex } = await createTenantKnex();

    const [updatedUser] = await withTransaction(knex, async (trx: Knex.Transaction) => {
      await assertCanManageClientUser(user, tenant, trx, userId);

      // Allowlist of self-service profile fields. Never allow privileged columns
      // (user_type, tenant, hashed_password, roles, username, ...) via this path.
      const allowedUpdates: Partial<IUser> = {};
      for (const field of ['first_name', 'last_name', 'email', 'is_inactive'] as const) {
        if (Object.prototype.hasOwnProperty.call(userData, field)) {
          (allowedUpdates as Record<string, unknown>)[field] = (userData as Record<string, unknown>)[field];
        }
      }

      return await tenantDb(trx, tenant).table('users')
        .where({ user_id: userId, user_type: 'client' })
        .update({
          ...allowedUpdates,
          updated_at: new Date().toISOString()
        })
        .returning('*');
    });

    return (updatedUser as IUser | undefined) || { actionError: 'Client user not found' };
  } catch (error) {
    if (error instanceof Error && error.message === 'User not found') {
      return null;
    }
    const expected = clientUserActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('Error updating client user:', error);
    throw error;
  }
});

/**
 * Reset client user password
 */
export const resetClientUserPassword = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  userId: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    const { knex } = await createTenantKnex();

    const hashedPassword = await hashPassword(newPassword);

    await withTransaction(knex, async (trx: Knex.Transaction) => {
      await assertCanManageClientUser(user, tenant, trx, userId);

      await tenantDb(trx, tenant).table('users')
        .where({ user_id: userId, user_type: 'client' })
        .update({
          hashed_password: hashedPassword,
          updated_at: new Date().toISOString()
        });
    });

    return { success: true };
  } catch (error) {
    console.error('Error resetting client user password:', error);
    return {
      success: false,
      error: clientUserActionErrorMessage(error, 'Failed to reset client user password')
    };
  }
});

/**
 * Get client user by ID
 */
export const getClientUserById = withAuth(async (
  _user: IUserWithRoles,
  { tenant }: AuthContext,
  userId: string
): Promise<IUser | null> => {
  try {
    const { knex } = await createTenantKnex();

    const user = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await tenantDb(trx, tenant).table('users')
      .where({ user_id: userId, user_type: 'client' })
      .first();
    });

    return (user as IUser | undefined) || null;
  } catch (error) {
    console.error('Error getting client user:', error);
    throw error;
  }
});

/**
 * Create a client user
 */
export const createClientUser = withAuth(async (
  currentUser: IUserWithRoles,
  { tenant }: AuthContext,
  {
    email,
    password,
    contactId,
    clientId,
    firstName,
    lastName,
    roleId
  }: {
    email: string;
    password: string;
    contactId: string;
    clientId: string;
    firstName?: string;
    lastName?: string;
    roleId?: string;
  }
): Promise<{ success: boolean; error?: string }> => {
  try {
    const { knex } = await createTenantKnex();

    const allowed = await hasPermission(currentUser, 'user', 'create', knex);
    if (!allowed) {
      return { success: false, error: 'Permission denied: Cannot create client user' };
    }

    // Use the shared model to create the portal user
    const input: CreatePortalUserInput = {
      email,
      password,
      contactId,
      clientId,
      tenantId: tenant,
      firstName,
      lastName,
      roleId
    };

    const result = await createPortalUserInDB(knex, input);

    // Revalidate paths after successful creation
    if (result.success) {
      revalidatePath('/client/settings/users');
      revalidatePath('/contacts');
    }

    return {
      success: result.success,
      error: result.error
    };
  } catch (error) {
    console.error('Error creating client user:', error);
    return {
      success: false,
      error: clientUserActionErrorMessage(error, 'Failed to create client user')
    };
  }
});


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
    // For client users, we need to check if they're trying to modify their own contact's avatar
    // This can happen in two ways:
    // 1. The contactId matches their contact_id (direct match)
    // 2. They're trying to modify a contact that's associated with their user account
    if (currentUser.contact_id === contactId) {
      canModify = true;
    } else {
      // Check if this contact is associated with the current user
      const userContact = await withTransaction(knex, async (trx: Knex.Transaction) => {
        return await tenantDb(trx, tenant).table('contacts')
          .where({
            contact_name_id: contactId,
          })
          .first();
      });
      
      if (userContact) {
        // Check if there's a user with this contact_id
        const contactUser = await withTransaction(knex, async (trx: Knex.Transaction) => {
          return await tenantDb(trx, tenant).table('users')
            .where({
              contact_id: contactId,
              user_id: currentUser.user_id,
            })
            .first();
        });
        
        if (contactUser) {
          canModify = true;
        }
      }
    }
  } else if (currentUser.user_type === 'internal') {
    // MSP (internal) users can modify any contact's avatar by default
    console.log(`[uploadContactAvatar] Internal user ${currentUser.user_id} granted permission to modify contact avatar`);
    canModify = true;
  }

  if (!canModify) {
    return { success: false, message: 'You do not have permission to modify this contact\'s avatar' };
  }

  const file = formData.get('avatar') as File;
  if (!file) {
    return { success: false, message: 'No avatar file provided' };
  }

  // Verify contact exists
  const contact = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await tenantDb(trx, tenant).table('contacts')
      .where({ contact_name_id: contactId })
      .first();
  });
  if (!contact) {
    return { success: false, message: 'Contact not found' };
  }

  try {
    // Call the generic entity image upload service
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

    // Invalidate cache for relevant paths
    revalidatePath(`/contacts/${contactId}`);
    revalidatePath('/contacts');
    revalidatePath('/client/profile');

    // Generate the URL for the newly uploaded avatar
    return { success: true, imageUrl: uploadResult.imageUrl };
  } catch (error) {
    console.error('[ClientUserActions] Failed to upload contact avatar:', {
      operation: 'uploadContactAvatar',
      contactId,
      userId: currentUser.user_id,
      tenant,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      errorStack: error instanceof Error ? error.stack : undefined,
      errorName: error instanceof Error ? error.name : undefined
    });
    const message = clientUserActionErrorMessage(error, 'Failed to upload contact avatar');
    return { success: false, message };
  }
});

/**
 * Delete a contact's avatar
 *
 * Allows an authenticated client user to delete the avatar for their own linked contact record,
 * or an MSP user with appropriate permissions to manage contact avatars.
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
    // For client users, we need to check if they're trying to delete their own contact's avatar
    // This can happen in two ways:
    // 1. The contactId matches their contact_id (direct match)
    // 2. They're trying to delete a contact that's associated with their user account
    if (currentUser.contact_id === contactId) {
      canDelete = true;
    } else {
      // Check if this contact is associated with the current user
      const userContact = await withTransaction(knex, async (trx: Knex.Transaction) => {
        return await tenantDb(trx, tenant).table('contacts')
          .where({
            contact_name_id: contactId,
          })
          .first();
      });

      if (userContact) {
        // Check if there's a user with this contact_id
        const contactUser = await withTransaction(knex, async (trx: Knex.Transaction) => {
          return await tenantDb(trx, tenant).table('users')
            .where({
              contact_id: contactId,
              user_id: currentUser.user_id,
            })
            .first();
        });

        if (contactUser) {
          canDelete = true;
        }
      }
    }
  } else if (currentUser.user_type === 'internal') {
    // MSP (internal) users can delete any contact's avatar by default
    console.log(`[deleteContactAvatar] Internal user ${currentUser.user_id} granted permission to delete contact avatar`);
    canDelete = true;
  }

  if (!canDelete) {
    return { success: false, message: 'You do not have permission to delete this contact\'s avatar' };
  }

  // Verify contact exists
  const contact = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await tenantDb(trx, tenant).table('contacts')
      .where({ contact_name_id: contactId })
      .first();
  });
  if (!contact) {
    return { success: false, message: 'Contact not found' };
  }

  try {
    // Call the generic entity image delete service
    const deleteResult = await deleteEntityImage(
      'contact',
      contactId,
      currentUser.user_id,
      tenant
    );

    if (!deleteResult.success) {
      // The service function already logs errors, just return success: true if no image was found (as per original logic)
      // or if the deletion was successful. If it failed, the service returns success: false.
      // We return success: true here to match the original logic where finding no association was considered success.
      // The service handles the case where deletion fails internally.
      // Let's adjust slightly: if the service says success: false, we should probably return that.
      // If the service says success: true (meaning deleted or not found), we return success: true.
      // The original logic returned success: true if no association was found. deleteEntityImage returns success: true in that case too.
      // So, we just need to check if deleteResult.success is false.
       if (deleteResult.message && deleteResult.message.includes("No contact image found to delete")) {
         // If no image was found, it's considered a success in this context
         return { success: true };
       }
       // Otherwise, return the result from the service
       return { success: deleteResult.success, message: deleteResult.message };
    }

    // Invalidate cache for relevant paths
    revalidatePath(`/contacts/${contactId}`);
    revalidatePath('/contacts');
    revalidatePath('/client/profile');

    return { success: true };
  } catch (error) {
    console.error('[ClientUserActions] Failed to delete contact avatar:', {
      operation: 'deleteContactAvatar',
      contactId,
      userId: currentUser.user_id,
      tenant,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      errorStack: error instanceof Error ? error.stack : undefined,
      errorName: error instanceof Error ? error.name : undefined
    });
    const message = clientUserActionErrorMessage(error, 'Failed to delete contact avatar');
    return { success: false, message };
  }
});

/**
 * Get tenant slug for sign-out redirect URL.
 * Server action wrapper so client components don't import @alga-psa/db directly.
 */
export const getSignOutTenantSlug = withAuth(async (
  _user: IUserWithRoles,
  { tenant }: AuthContext
): Promise<string | null> => {
  try {
    return await getTenantSlugForTenant(tenant);
  } catch (error) {
    console.error('Error getting tenant slug for sign out:', error);
    return null;
  }
});

/**
 * Check client portal permissions for navigation
 * Returns permissions for billing, user management, client settings, and account
 */
export const checkClientPortalPermissions = withAuth(async (
  currentUser: IUserWithRoles,
  { tenant }: AuthContext
): Promise<{
  hasBillingAccess: boolean;
  hasUserManagementAccess: boolean;
  hasClientSettingsAccess: boolean;
  hasAccountAccess: boolean;
  hasVisibilityGroupAccess: boolean;
  isLicenseDistributor: boolean;
}> => {
  try {
    const { knex } = await createTenantKnex();

    // Check if this is a hosted tenant (has Stripe customer record)
    const scopedDb = tenantDb(knex, tenant);

    const isHosted = await scopedDb.table('stripe_customers')
      .first()
      .then(result => !!result)
      .catch(() => false);

    // Check permissions using the hasPermission function from rbac
    const [hasBilling, hasUser, hasClient, hasSettings] = await Promise.all([
      hasPermission(currentUser, 'billing', 'read'),
      hasPermission(currentUser, 'user', 'read'),
      hasPermission(currentUser, 'client', 'read'),
      hasPermission(currentUser, 'settings', 'read')
    ]);

    let hasVisibilityGroupAccess = false;
    if (currentUser.user_type === 'client' && currentUser.contact_id) {
      const actorContact = await scopedDb.table('contacts')
        .where({
          contact_name_id: currentUser.contact_id
        })
        .select('is_client_admin')
        .first();
      hasVisibilityGroupAccess = !!actorContact?.is_client_admin;
    }

    // Appliance-license distribution is Enterprise-only; resolved via the
    // @enterprise seam (no-op stub on CE), so no licensing logic ships in CE.
    const { isLicenseDistributionTenant } = await import('@enterprise/lib/license/distributionTenant');

    return {
      hasBillingAccess: hasBilling,
      hasUserManagementAccess: hasUser,
      hasClientSettingsAccess: hasClient,
      // Account access requires both hosted tenant and settings permission
      hasAccountAccess: isHosted && hasSettings,
      hasVisibilityGroupAccess,
      // Only the Nine Minds distribution tenant (with distribution enabled) sees
      // the appliance-license surface.
      isLicenseDistributor: isLicenseDistributionTenant(tenant)
    };
  } catch (error) {
    console.error('Error checking client portal permissions:', error);
    return {
      hasBillingAccess: false,
      hasUserManagementAccess: false,
      hasClientSettingsAccess: false,
      hasAccountAccess: false,
      hasVisibilityGroupAccess: false,
      isLicenseDistributor: false
    };
  }
});
