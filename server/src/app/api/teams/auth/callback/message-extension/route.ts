import { NextRequest } from 'next/server';
import { handleTeamsAuthCallback } from 'server/src/lib/teams/handleTeamsAuthCallback';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return handleTeamsAuthCallback(request, 'message_extension');
}
