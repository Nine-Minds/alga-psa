import { NextRequest } from 'next/server';
import { HuggingFaceChatModel } from '../models/HuggingFaceChatModel';
import { OpenRouterChatModel } from '../models/OpenRouterChatModel';
import { getSecretProviderInstance } from '@alga-psa/shared/core/secretProvider';

interface StreamRequestBody {
  inputs: any[];
  options?: Record<string, unknown>;
  model?: string;
  meta?: {
    authorization?: string;
  };
}

export class ChatStreamService {
  private static getHuggingFaceModel() {
    return new HuggingFaceChatModel();
  }

  private static async getOpenRouterModel() {
    const secretProvider = await getSecretProviderInstance();
    const apiKey =
      (await secretProvider.getAppSecret('OPENROUTER_API_KEY')) ||
      process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      console.error('[ChatStreamService] Missing OpenRouter API key');
      throw new Error('OpenRouter API key is not configured');
    }
    return new OpenRouterChatModel(apiKey);
  }

  static async handleChatStream(req: NextRequest) {
    const requestId = Math.random().toString(36).substring(7);

    try {
      const body = (await req.json()) as StreamRequestBody;
      const transformStream = new TransformStream({
        transform: (chunk, controller) => {
          if (chunk.content === '[DONE]') {
            controller.terminate();
          } else {
            controller.enqueue(`data: ${JSON.stringify(chunk)}\n\n`);
          }
        },
      });

      const writer = transformStream.writable.getWriter();
      let isStreamComplete = false;

      const onTokenReceived = (token: string) => {
        if (token === '[DONE]') {
          isStreamComplete = true;
          writer.close();
          return;
        }

        writer.write({
          content: token,
          type: 'text',
        });
      };

      (async () => {
        try {
          if (body.model === 'openrouter') {
            const model = await this.getOpenRouterModel();
            const response = await model.sendMessage(body.inputs);
            writer.write({
              content: response.text,
              type: response.error ? 'error' : 'text',
            });
            isStreamComplete = true;
            writer.close();
          } else {
            const model = this.getHuggingFaceModel();
            await model.streamMessage(body.inputs, onTokenReceived, {
              ...body.options,
              auth_token: body.meta?.authorization,
            });

            if (!isStreamComplete) {
              isStreamComplete = true;
              writer.write({ content: '[DONE]' });
              writer.close();
            }
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error occurred';
          console.error(
            `[ChatStreamService][${requestId}] Stream processing error:`,
            errorMessage,
          );
          writer.write({
            content: "An error occurred during streaming",
            type: 'error',
          });
          if (!isStreamComplete) {
            writer.close();
          }
        }
      })();

      return new Response(transformStream.readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      console.error(
        `[ChatStreamService][${requestId}] Fatal error:`,
        errorMessage,
      );
      return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }
  }

  static async handleTitleStream(req: NextRequest) {
    const requestId = Math.random().toString(36).substring(7);
    try {
      const body = (await req.json()) as StreamRequestBody;
      const model = this.getHuggingFaceModel();

      const transformStream = new TransformStream({
        transform: (chunk, controller) => {
          if (chunk.content === '[DONE]') {
            controller.terminate();
          } else {
            controller.enqueue(`data: ${JSON.stringify(chunk)}\n\n`);
          }
        },
      });

      const writer = transformStream.writable.getWriter();
      const onTokenReceived = (token: string) => {
        if (token === '[DONE]') {
          writer.close();
          return;
        }
        writer.write({
          content: token,
          type: 'text',
        });
      };

      (async () => {
        try {
          await model.streamMessage(body.inputs, onTokenReceived, {
            ...body.options,
            auth_token: body.meta?.authorization,
          });
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error occurred';
          console.error(
            `[ChatStreamService][${requestId}] Title stream error:`,
            errorMessage,
          );
          writer.write({
            content: "An error occurred during streaming",
            type: 'error',
          });
          writer.close();
        }
      })();

      return new Response(transformStream.readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      console.error(
        `[ChatStreamService][${requestId}] Fatal error in title stream:`,
        errorMessage,
      );
      return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }
  }
}
