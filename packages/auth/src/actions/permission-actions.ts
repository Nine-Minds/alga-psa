'use server';

import { getCurrentUser } from '@alga-psa/users/actions';
import { hasPermission } from '../lib/rbac';

export async function getContactPortalPermissions() {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return {
        canInvite: false,
        canUpdateRoles: false,
        canRead: false
      };
    }

    const [canInvite, canUpdateClient, canUpdateUser, canRead] = await Promise.all([
      hasPermission(currentUser, 'user', 'invite'),
      hasPermission(currentUser, 'client', 'update'),
      hasPermission(currentUser, 'user', 'update'),
      hasPermission(currentUser, 'client', 'read')
    ]);

    return {
      canInvite,
      canUpdateRoles: canUpdateClient || canUpdateUser,
      canRead
    };
  } catch (error) {
    console.error('Error fetching permissions:', error);
    return {
      canInvite: false,
      canUpdateRoles: false,
      canRead: false
    };
  }
}

export async function checkAccountManagementPermission() {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return false;
    }

    return await hasPermission(currentUser, 'account_management', 'read');
  } catch (error) {
    console.error('Error checking account management permission:', error);
    return false;
  }
}
