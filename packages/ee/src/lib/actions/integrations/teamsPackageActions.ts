import type { TeamsAppPackageStatusResponse } from '@alga-psa/integrations/actions/integrations/teamsContracts';

export async function getTeamsAppPackageStatusImpl(
  _user: unknown,
  _context: { tenant: string }
): Promise<TeamsAppPackageStatusResponse> {
  return {
    success: false,
    error: 'Microsoft Teams integration is only available in Enterprise Edition.',
  };
}
