import { handleTeamsMessageExtensionRequest } from '../../../../../lib/teams/messageExtension/teamsMessageExtensionHandler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  return handleTeamsMessageExtensionRequest(request);
}
