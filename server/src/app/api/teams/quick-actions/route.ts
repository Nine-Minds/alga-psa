import { handleTeamsQuickActionRequest } from 'server/src/lib/teams/quickActions/teamsQuickActionHandler';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return handleTeamsQuickActionRequest(request);
}
