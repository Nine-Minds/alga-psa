import { handleTeamsAuthCallback } from '../../../../../../lib/teams/handleTeamsAuthCallback';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  return handleTeamsAuthCallback(request, 'message_extension');
}
