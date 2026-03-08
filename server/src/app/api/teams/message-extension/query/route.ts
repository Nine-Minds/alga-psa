import { handleTeamsMessageExtensionRequest } from 'server/src/lib/teams/messageExtension/teamsMessageExtensionHandler';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return handleTeamsMessageExtensionRequest(request);
}
