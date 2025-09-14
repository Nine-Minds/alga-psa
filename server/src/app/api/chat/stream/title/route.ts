import { NextRequest } from 'next/server';
// EE-only runtime import when available; CE returns 404

// This is needed for streaming responses
export const dynamic = 'force-dynamic';
// export const runtime = 'edge'; // Temporarily disabled

export async function POST(req: NextRequest) {
  // Not available in CE; EE app handles streaming.
  return new Response('Chat streaming is only available in Enterprise Edition', {
    status: 404,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}
