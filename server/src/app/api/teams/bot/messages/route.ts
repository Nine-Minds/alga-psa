import { NextRequest } from 'next/server';
import { handleTeamsBotActivityRequest } from 'server/src/lib/teams/bot/teamsBotHandler';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return handleTeamsBotActivityRequest(request);
}
