export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
// EE-only runtime import when available; CE returns 404

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

  // Not available in CE; EE app handles streaming.
  return new Response('Chat streaming is only available in Enterprise Edition', {
    status: 404,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}
