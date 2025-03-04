import { NextRequest } from 'next/server';
import { ChatStreamService } from 'ee/server/src/services/chatStreamService';

export const dynamic = 'force-dynamic';
export const runtime = 'edge';

export async function GET(
  req: NextRequest,
  { params }: { params: { slug: string[] } }
) {
  return new Response('Hello World', {
    headers: {
      'Content-Type': 'text/plain',
    },
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string[] } }
) {
    console.log('got here ', params.slug);
  if (process.env.EDITION !== 'enterprise') {
    return new Response('Chat streaming is only available in Enterprise Edition', {
      status: 404,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  // The full path will be available in params.slug as an array
  // For example, ['v1', 'chat', 'completions'] for /api/chat/stream/v1/chat/completions
  return await ChatStreamService.handleChatStream(req);
}
