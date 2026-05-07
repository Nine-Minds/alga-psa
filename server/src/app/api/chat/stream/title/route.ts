/* global process */
import { NextRequest } from 'next/server';
import { isExperimentalFeatureEnabled } from '@alga-psa/tenancy/actions';
import { assertPsaChatProductAccess } from '../../productAccess';

// This is needed for streaming responses
export const dynamic = 'force-dynamic';
// export const runtime = 'edge'; // Temporarily disabled

export async function POST(req: NextRequest) {
  const productAccessResponse = await assertPsaChatProductAccess();
  if (productAccessResponse) {
    return productAccessResponse;
  }

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
  return ChatStreamService.handleTitleStream(req);
}
