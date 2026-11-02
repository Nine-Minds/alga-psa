'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withAuth, hasPermission, type AuthContext } from '@alga-psa/auth';
import { permissionError, type ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { isLicensedUserType, type IUserWithRoles } from '@alga-psa/types';
import { actionError, type ActionMessageError } from '@alga-psa/ui/lib/errorHandling';
import { mergeTenantSettingsJson } from '../../server/tenantSettingsStore';
import {
  DASHBOARD_WELCOME_SETTINGS_KEY,
  resolveDashboardWelcome,
  type DashboardWelcomeSettings,
} from '../../lib/dashboardWelcome';

/**
 * Deliberately not part of the theme action: the theme is Enterprise-only and
 * saved behind an "Apply to everyone" draft, while this one flag is written
 * from both the Appearance and the General tab the moment it is switched.
 */
export const getDashboardWelcomeSettingsAction = withAuth(async (
  _user: IUserWithRoles,
  { tenant }: AuthContext
): Promise<DashboardWelcomeSettings> => {
  const { knex } = await createTenantKnex(tenant);
  return resolveDashboardWelcome(knex, tenant);
});

export const setDashboardWelcomeUseCompanyNameAction = withAuth(async (
  user: IUserWithRoles,
  { tenant }: AuthContext,
  useCompanyName: boolean
): Promise<void | ActionPermissionError | ActionMessageError> => {
  if (!isLicensedUserType(user.user_type) || !(await hasPermission(user, 'settings', 'update'))) {
    return permissionError('Permission denied: Cannot update settings', 'msp/settings:errors.tenantSettings.permissions.update');
  }
  if (typeof useCompanyName !== 'boolean') return actionError('Invalid dashboard welcome setting.');

  // The only field under this key, so replacing the object wholesale is the
  // merge the shallow settings update already performs.
  await mergeTenantSettingsJson(tenant, {
    [DASHBOARD_WELCOME_SETTINGS_KEY]: { useCompanyName },
  });
});
