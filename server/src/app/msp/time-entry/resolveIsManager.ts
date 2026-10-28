import { getTeams, isTeamActionError } from '@alga-psa/teams/actions';

/**
 * Whether the signed-in user leads any team, which switches the time sheet into its
 * manager view.
 *
 * Reading teams needs `user_settings:read`, which technician-only users do not hold.
 * A refused or failed read therefore means "not a manager" — never a reason to stop
 * rendering the page (that bare return is what left technicians on a blank Time
 * Entry screen).
 */
export async function resolveIsManager(userId: string | null | undefined): Promise<boolean> {
  if (!userId) {
    return false;
  }

  try {
    const teamsData = await getTeams();
    if (isTeamActionError(teamsData)) {
      console.warn('[TimeTrackingPage] Cannot load teams for manager check; defaulting to non-manager', teamsData);
      return false;
    }
    return teamsData.some(team => team.manager_id === userId);
  } catch (error) {
    console.warn('[TimeTrackingPage] Failed to load teams for manager check; defaulting to non-manager', error);
    return false;
  }
}
