'use server';

import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';
import logger from 'server/src/utils/logger.js'

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