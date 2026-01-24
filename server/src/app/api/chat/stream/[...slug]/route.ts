/* global process */
export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { isExperimentalFeatureEnabled } from '@alga-psa/tenancy/actions';

// export const runtime = 'edge'; // Temporarily disabled

export async function GET() {
  // Next.js may pass route params, but this endpoint doesn't use them.
  return new Response('Hello World', {
    headers: {
      'Content-Type': 'text/plain',
    },
  });
}

export async function POST(req: NextRequest) {
  if (process.env.EDITION !== 'enterprise') {
    return new Response('Chat streaming is only available in Enterprise Edition', {
      status: 404,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  const aiAssistantEnabled = await isExperimentalFeatureEnabled('aiAssistant');
  if (!aiAssistantEnabled) {
    return new Response(
      JSON.stringify({ error: 'AI Assistant is not enabled for this tenant' }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  // Delegate to EE business logic
  const { ChatStreamService } = await import('@product/chat/entry');
  return ChatStreamService.handleChatStream(req);
}
