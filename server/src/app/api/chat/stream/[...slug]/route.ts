export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';

// export const runtime = 'edge'; // Temporarily disabled

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  return new Response('Hello World', {
    headers: {
      'Content-Type': 'text/plain',
    },
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  if (process.env.EDITION !== 'enterprise') {
    return new Response('Chat streaming is only available in Enterprise Edition', {
      status: 404,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  // Delegate to EE business logic
  const { ChatStreamService } = await import('@product/chat/entry');
  return ChatStreamService.handleChatStream(req);
}
