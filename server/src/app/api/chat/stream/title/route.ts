/* global process */
import { NextRequest } from 'next/server';
import { isExperimentalFeatureEnabled } from '@alga-psa/tenancy/actions';
import { getSession } from '@alga-psa/auth';
import { assertTenantProductAccess, isProductAccessError, toProductAccessDeniedResponse } from '@/lib/productAccess';

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

  const session = await getSession();
  const tenantId = session?.user?.tenant;
  if (!tenantId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    await assertTenantProductAccess({
      tenantId,
      capability: 'ai_chat',
      allowedProducts: ['psa'],
    });
  } catch (error) {
    if (isProductAccessError(error)) {
      return toProductAccessDeniedResponse(error);
    }
    throw error;
  }

  // Delegate to EE business logic
  const { ChatStreamService } = await import('@product/chat/entry');
  return ChatStreamService.handleTitleStream(req);
}
