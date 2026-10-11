'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withAuth, type AuthContext } from '@alga-psa/auth';
import { getCurrentUserPermissions } from '@alga-psa/user-composition/actions/userQueryActions';
import { permissionError, type ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import type { IUserWithRoles } from '@alga-psa/types';
import {
  DASHBOARD_WELCOME_SETTINGS_KEY,
  resolveDashboardWelcome,
  type DashboardWelcomeSettings,
} from '../../lib/dashboardWelcome';
import { updateTenantSettings } from './tenantSettingsActions';

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
  _user: IUserWithRoles,
  _ctx: AuthContext,
  useCompanyName: boolean
): Promise<void | ActionPermissionError> => {
  const permissions = await getCurrentUserPermissions();
  if (!permissions.includes('settings:update')) {
    return permissionError('Permission denied: Cannot update settings', 'msp/settings:errors.tenantSettings.permissions.update');
  }

  // The only field under this key, so replacing the object wholesale is the
  // merge the shallow settings update already performs.
  await updateTenantSettings({
    [DASHBOARD_WELCOME_SETTINGS_KEY]: { useCompanyName: useCompanyName === true },
  });
});
