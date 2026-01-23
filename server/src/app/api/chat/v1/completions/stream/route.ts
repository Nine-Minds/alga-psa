import { env } from 'node:process';
import { NextRequest } from 'next/server';

import { isExperimentalFeatureEnabled } from '@alga-psa/tenancy/actions';

const isEnterpriseEdition =
  env.NEXT_PUBLIC_EDITION === 'enterprise' ||
  env.EDITION === 'enterprise' ||
  env.EDITION === 'ee';

export const dynamic = 'force-dynamic';

type IncomingChatMessage = {
  role: 'user' | 'assistant' | 'function';
  content?: string;
  reasoning?: string;
  name?: string;
  function_call?: {
    name: string;
    arguments: Record<string, unknown> | string;
  };
  tool_call_id?: string;
};

type RawCompletionChunk = {
  choices?: Array<{
    delta?: {
      content?: unknown;
    };
  }>;
};

type ChatCompletionsServiceLike = {
  createRawCompletionStream: (
    conversation: IncomingChatMessage[],
  ) => Promise<AsyncIterable<RawCompletionChunk>>;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid payload');
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function validateMessages(raw: unknown): IncomingChatMessage[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('Invalid messages payload');
  }

  return raw.map((item) => {
    const obj = asRecord(item);
    const role = obj.role;
    if (role !== 'user' && role !== 'assistant' && role !== 'function') {
      throw new Error('Invalid messages payload');
    }

    const message: IncomingChatMessage = { role };

    if (role === 'function') {
      message.name = readString(obj.name);
      message.content = readString(obj.content);
      message.tool_call_id = readString(obj.tool_call_id);

      if (!message.name) {
        throw new Error('Invalid messages payload');
      }

      return message;
    }

    message.content = readString(obj.content);
    message.reasoning = readString(obj.reasoning);

    if (obj.function_call) {
      const fn = asRecord(obj.function_call);
      const fnName = readString(fn.name);
      if (!fnName) {
        throw new Error('Invalid messages payload');
      }
      const fnArguments = fn.arguments;
      message.function_call = {
        name: fnName,
        arguments:
          typeof fnArguments === 'string'
            ? fnArguments
            : fnArguments && typeof fnArguments === 'object'
              ? (fnArguments as Record<string, unknown>)
              : {},
      };
      message.tool_call_id = readString(obj.tool_call_id);
    }

    return message;
  });
}

function encodeSseData(encoder: TextEncoder, payload: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let messages: IncomingChatMessage[];
  try {
    const bodyObj = asRecord(body);
    messages = validateMessages(bodyObj.messages);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid messages payload';
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
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

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      (async () => {
        const mod = (await import('@product/chat/entry')) as unknown as {
          ChatCompletionsService: ChatCompletionsServiceLike;
        };
        const completionStream = await mod.ChatCompletionsService.createRawCompletionStream(messages);

        for await (const chunk of completionStream) {
          if (req.signal.aborted) {
            break;
          }

          const token = chunk?.choices?.[0]?.delta?.content;
          if (typeof token === 'string' && token.length > 0) {
            controller.enqueue(encodeSseData(encoder, { content: token, done: false }));
          }
        }
      })()
        .catch((error) => {
          console.error('[chat completions stream] Streaming error', error);
        })
        .finally(() => {
          controller.close();
        });
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
