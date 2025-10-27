'use server';

import { getCurrentUser } from '@product/actions/user-actions/userActions';
import { hasPermission, checkMultiplePermissions, PermissionCheck, PermissionResult } from '@server/lib/auth/rbac';
import logger from '@server/utils/logger'

export async function checkCurrentUserPermission(
  resource: string,
  action: string
): Promise<boolean> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      logger.warn(
        `checkCurrentUserPermission: User not found for resource "${resource}", action "${action}".`
      );
      return false;
    }

    const permissionGranted = await hasPermission(currentUser, resource, action);
    return permissionGranted;
  } catch (error) {
    logger.error(
      `Error checking permission for resource "${resource}", action "${action}":`,
      error
    );
    return false;
  }
}

// Check multiple permissions for the current user in a single operation

export async function checkCurrentUserPermissions(
  permissionChecks: PermissionCheck[]
): Promise<PermissionResult[]> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      logger.warn(
        `checkCurrentUserPermissions: User not found for batch permission check.`
      );
      return permissionChecks.map(check => ({
        resource: check.resource,
        action: check.action,
        granted: false
      }));
    }

    const results = await checkMultiplePermissions(currentUser, permissionChecks);
    return results;
  } catch (error) {
    logger.error(
      `Error checking batch permissions:`,
      error
    );
    return permissionChecks.map(check => ({
      resource: check.resource,
      action: check.action,
      granted: false
    }));
  }
}
