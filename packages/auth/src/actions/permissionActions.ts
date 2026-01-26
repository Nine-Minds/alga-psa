'use server';

import { hasPermission, checkMultiplePermissions, PermissionCheck, PermissionResult } from '../lib/rbac';
import logger from '@alga-psa/core/logger'
import { withOptionalAuth } from '../lib/withAuth';

export const checkCurrentUserPermission = withOptionalAuth(async (
  currentUser,
  _ctx,
  resource: string,
  action: string
): Promise<boolean> => {
  try {
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
});

// Check multiple permissions for the current user in a single operation

export const checkCurrentUserPermissions = withOptionalAuth(async (
  currentUser,
  _ctx,
  permissionChecks: PermissionCheck[]
): Promise<PermissionResult[]> => {
  try {
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
});
