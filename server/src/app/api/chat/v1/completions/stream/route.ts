import { env } from 'node:process';
import { NextRequest } from 'next/server';

import { isExperimentalFeatureEnabled } from '@alga-psa/tenancy/actions';

const isEnterpriseEdition =
  env.NEXT_PUBLIC_EDITION === 'enterprise' ||
  env.EDITION === 'enterprise' ||
  env.EDITION === 'ee';

export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest) {
  void _req;
  if (!isEnterpriseEdition) {
    return new Response(
      JSON.stringify({ error: 'Chat completions are only available in Enterprise Edition' }),
      {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      },
    );
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

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(': ok\n\n'));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
