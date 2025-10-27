import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (process.env.EDITION !== 'enterprise') {
    return new Response(
      JSON.stringify({ error: 'Chat completions are only available in Enterprise Edition' }),
      {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  const { ChatCompletionsService } = await import('@product/chat/ee/entry');
  return ChatCompletionsService.handleExecute(req);
}
