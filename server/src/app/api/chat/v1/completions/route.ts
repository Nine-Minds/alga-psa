import { NextRequest } from 'next/server';
import { isExperimentalFeatureEnabled } from '@alga-psa/tenancy/actions';
import { ADD_ONS } from '@alga-psa/types';
import { AddOnAccessError, assertAddOnAccess } from '@/lib/tier-gating/assertAddOnAccess';
import { getSession } from '@alga-psa/auth';
import { assertTenantProductAccess, isProductAccessError, toProductAccessDeniedResponse } from '@/lib/productAccess';

const isEnterpriseEdition =
  process.env.NEXT_PUBLIC_EDITION === 'enterprise' ||
  process.env.EDITION === 'enterprise' ||
  process.env.EDITION === 'ee';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
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

  try {
    await assertAddOnAccess(ADD_ONS.AI_ASSISTANT);
  } catch (error) {
    if (error instanceof AddOnAccessError) {
      return new Response(
        JSON.stringify({ error: error.message }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    throw error;
  }

  const { ChatCompletionsService } = await import('@product/chat/entry');
  return ChatCompletionsService.handleRequest(req);
}
