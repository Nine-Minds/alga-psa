import { NextRequest } from 'next/server';
import { getCurrentUser } from '@alga-psa/user-composition/actions';

import { toAiCreditsError } from '../lib/aiGateway/errors';
import type { AiFeature } from '../lib/aiGateway/types';
import { parseAssistantContent } from '../utils/chatContent';
import { resolveChatProvider } from './chatProviderResolver';

interface StreamRequestBody {
  inputs: any[];
  options?: Record<string, unknown>;
  model?: string;
  meta?: {
    authorization?: string;
  };
}

export class ChatStreamService {
  private static streamResponse(content: string, type: 'text' | 'error'): Response {
    return new Response(`data: ${JSON.stringify({ content, type })}\n\n`, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }

  private static async handleStream(req: NextRequest, feature: AiFeature): Promise<Response> {
    const requestId = Math.random().toString(36).substring(7);

    try {
      const body = (await req.json()) as StreamRequestBody;
      const currentUser = await getCurrentUser();
      if (!currentUser?.tenant) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const provider = await resolveChatProvider(currentUser.tenant, feature);
      const completion = await provider.client.chat.completions.create({
        model: provider.model,
        messages: body.inputs,
        max_tokens: 4096,
        temperature: 1.0,
        top_p: 0.95,
        ...provider.requestOverrides.resolveTurnOverrides(),
      });
      const message = completion.choices?.[0]?.message;
      const parsed = parseAssistantContent(
        message?.content,
        (message as { reasoning?: string } | undefined)?.reasoning,
      );
      return this.streamResponse(parsed.display || parsed.raw, 'text');
    } catch (error) {
      const creditsError = toAiCreditsError(error);
      if (creditsError) {
        return new Response(JSON.stringify({
          type: 'ai_credits',
          reason: creditsError.reason,
        }), {
          status: 402,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      console.error(
        `[ChatStreamService][${requestId}] ${feature} stream error:`,
        errorMessage,
      );
      return this.streamResponse('An error occurred during streaming', 'error');
    }
  }

  static async handleChatStream(req: NextRequest): Promise<Response> {
    return this.handleStream(req, 'chat');
  }

  static async handleTitleStream(req: NextRequest): Promise<Response> {
    return this.handleStream(req, 'chat-title');
  }
}
