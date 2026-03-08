import { handleTeamsBotActivityRequest } from '../../../../../lib/teams/bot/teamsBotHandler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  return handleTeamsBotActivityRequest(request);
}
