export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { ChatStreamService } from '@ee/services/chatStreamService';

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
  const resolvedParams = await params;
  console.log('got here ', resolvedParams.slug);
  if (process.env.EDITION !== 'enterprise') {
    return new Response('Chat streaming is only available in Enterprise Edition', {
      status: 404,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  // The full path will be available in resolvedParams.slug as an array
  // For example, ['v1', 'chat', 'completions'] for /api/chat/stream/v1/chat/completions
  return await ChatStreamService.handleChatStream(req);
}
