'use server';

import { hasPermission } from '../lib/rbac';
import { withOptionalAuth } from '../lib/withAuth';

export const getContactPortalPermissions = withOptionalAuth(async (currentUser, _ctx) => {
  try {
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
});

export const checkAccountManagementPermission = withOptionalAuth(async (currentUser, _ctx) => {
  try {
    if (!currentUser) {
      return false;
    }

    return await hasPermission(currentUser, 'account_management', 'read');
  } catch (error) {
    console.error('Error checking account management permission:', error);
    return false;
  }
});
