'use server';

import {
  checkAccountManagementPermission as authCheckAccountManagementPermission,
  getContactPortalPermissions as authGetContactPortalPermissions,
} from '@alga-psa/auth/actions';

export async function checkAccountManagementPermission() {
  return authCheckAccountManagementPermission();
}

export async function getContactPortalPermissions() {
  return authGetContactPortalPermissions();
}

