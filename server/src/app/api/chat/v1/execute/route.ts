import { NextRequest } from 'next/server';

const isEnterpriseEdition =
  process.env.NEXT_PUBLIC_EDITION === 'enterprise' ||
  process.env.EDITION === 'enterprise' ||
  process.env.EDITION === 'ee';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!isEnterpriseEdition) {
    return new Response(
      JSON.stringify({ error: 'Chat completions are only available in Enterprise Edition' }),
      {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  const { ChatCompletionsService } = await import('@product/chat/entry');
  return ChatCompletionsService.handleExecute(req);
}
