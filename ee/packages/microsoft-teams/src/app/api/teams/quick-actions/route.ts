import { handleTeamsQuickActionRequest } from '../../../../lib/teams/quickActions/teamsQuickActionHandler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  return handleTeamsQuickActionRequest(request);
}
