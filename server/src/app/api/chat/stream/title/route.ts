import { NextRequest } from 'next/server';

// This is needed for streaming responses
export const dynamic = 'force-dynamic';
// export const runtime = 'edge'; // Temporarily disabled

export async function POST(req: NextRequest) {
  if (process.env.EDITION !== 'enterprise') {
    return new Response('Chat streaming is only available in Enterprise Edition', {
      status: 404,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  // Delegate to EE business logic
  const { ChatStreamService } = await import('@product/chat/ee/entry');
  return ChatStreamService.handleTitleStream(req);
}
