'use server';

import {
  getRoles as getRolesImpl,
  assignRoleToUser as assignRoleToUserImpl,
  removeRoleFromUser as removeRoleFromUserImpl,
} from '@alga-psa/auth/actions/policyActions';

export async function getRoles() {
  return getRolesImpl();
}

export async function assignRoleToUser(userId: string, roleId: string) {
  return assignRoleToUserImpl(userId, roleId);
}

export async function removeRoleFromUser(userId: string, roleId: string) {
  return removeRoleFromUserImpl(userId, roleId);
}
