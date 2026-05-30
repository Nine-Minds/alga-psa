import { NextRequest } from 'next/server';
import { isExperimentalFeatureEnabled } from '@alga-psa/tenancy/actions';
import { assertPsaChatProductAccess } from '../../productAccess';
import { eeRuntimeEnabledServer } from '@alga-psa/licensing';

const isEnterpriseEdition =
  process.env.NEXT_PUBLIC_EDITION === 'enterprise' ||
  process.env.EDITION === 'enterprise' ||
  process.env.EDITION === 'ee';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const productAccessResponse = await assertPsaChatProductAccess();
  if (productAccessResponse) {
    return productAccessResponse;
  }

  if (!isEnterpriseEdition || !(await eeRuntimeEnabledServer())) {
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

  const { ChatCompletionsService } = await import('@product/chat/entry');
  return ChatCompletionsService.handleExecute(req);
}
