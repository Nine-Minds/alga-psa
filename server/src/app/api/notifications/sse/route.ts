import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { options as authOptions } from 'server/src/app/api/auth/[...nextauth]/options';
import { NotificationSubscriber } from 'server/src/lib/notifications/subscriber';

export const runtime = 'nodejs'; // Required for streaming
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Authentication
    const session = await getServerSession(authOptions);
    if (!session?.user || !session.user.tenant) {
      return new Response('Unauthorized', { status: 401 });
    }

    // Create SSE response with proper headers
    const responseStream = new TransformStream();
    const writer = responseStream.writable.getWriter();
    const encoder = new TextEncoder();

    // Initialize response with SSE headers
    const response = new Response(responseStream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable Nginx buffering
      },
    });

    // Create subscription
    const subscriber = new NotificationSubscriber({
      userId: session.user.id,
      tenantId: session.user.tenant,
      writer,
      encoder,
    });

    // Handle client disconnect
    request.signal.addEventListener('abort', () => {
      subscriber.cleanup();
      writer.close();
    });

    // Start subscription
    await subscriber.start();

    return response;
  } catch (error) {
    console.error('SSE endpoint error:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}
