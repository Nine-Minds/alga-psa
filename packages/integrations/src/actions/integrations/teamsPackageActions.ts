'use server';

import { withAuth } from '@alga-psa/auth/withAuth';
import { getTeamsAvailability } from '../../lib/teamsAvailability';
import type { TeamsAppPackageStatusResponse } from './teamsContracts';

let eeTeamsPackageActionsPromise:
  | Promise<{
      getTeamsAppPackageStatusImpl?: (
        user: unknown,
        ctx: { tenant: string }
      ) => Promise<TeamsAppPackageStatusResponse>;
    }>
  | null = null;

async function loadEeTeamsPackageActions() {
  if (!eeTeamsPackageActionsPromise) {
    eeTeamsPackageActionsPromise = import('@alga-psa/ee-microsoft-teams/actions');
  }

  return eeTeamsPackageActionsPromise;
}

export const getTeamsAppPackageStatus = withAuth(async (
  user,
  { tenant }
): Promise<TeamsAppPackageStatusResponse> => {
  const availability = await getTeamsAvailability({
    tenantId: tenant,
    userId: (user as any)?.user_id,
  });
  if (!availability.enabled) {
    return { success: false, error: availability.message };
  }

  const ee = await loadEeTeamsPackageActions();
  if (!ee?.getTeamsAppPackageStatusImpl) {
    return { success: false, error: 'Failed to load Teams app package actions' };
  }

  return ee.getTeamsAppPackageStatusImpl(user, { tenant });
});
