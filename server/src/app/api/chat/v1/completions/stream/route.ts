import { env } from 'node:process';
import { NextRequest } from 'next/server';

import { isExperimentalFeatureEnabled } from '@alga-psa/tenancy/actions';
import { getSession } from '@alga-psa/auth';
import { assertTenantProductAccess } from '@/lib/productAccess';

const isEnterpriseEdition =
  env.NEXT_PUBLIC_EDITION === 'enterprise' ||
  env.EDITION === 'enterprise' ||
  env.EDITION === 'ee';

export const dynamic = 'force-dynamic';

type IncomingChatMessage = {
  role: 'user' | 'assistant' | 'function';
  content?: string;
  reasoning?: string;
  reasoning_content?: string;
  name?: string;
  function_call?: {
    name: string;
    arguments: Record<string, unknown> | string;
  };
  tool_call_id?: string;
};

type IncomingUiContext = {
  pathname: string;
  screen: {
    key: string;
    label: string;
  };
  record?: {
    type: 'ticket' | 'project' | 'client' | 'contact' | 'asset';
    id: string;
  };
};

type IncomingMention = {
  type: 'ticket' | 'client' | 'contact' | 'project' | 'asset' | 'user';
  id: string;
};

type RawCompletionChunk = {
  type?: unknown;
  delta?: unknown;
  content?: unknown;
  done?: unknown;
  [key: string]: unknown;
};

type ChatCompletionsServiceLike = {
  createStructuredCompletionStream: (
    conversation: IncomingChatMessage[],
    options?: { signal?: AbortSignal; uiContext?: IncomingUiContext; mentions?: IncomingMention[] },
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

function readOptionalStringField(record: Record<string, unknown>, key: string): string | undefined {
  if (!(key in record) || record[key] === undefined) {
    return undefined;
  }
  if (typeof record[key] !== 'string') {
    throw new Error('Invalid messages payload');
  }
  return record[key] as string;
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
      message.name = readOptionalStringField(obj, 'name');
      message.content = readOptionalStringField(obj, 'content');
      message.tool_call_id = readOptionalStringField(obj, 'tool_call_id');

      if (!message.name) {
        throw new Error('Invalid messages payload');
      }

      return message;
    }

    message.content = readOptionalStringField(obj, 'content');
    message.reasoning = readOptionalStringField(obj, 'reasoning');
    message.reasoning_content = readOptionalStringField(obj, 'reasoning_content');
    if (!message.reasoning_content && message.reasoning) {
      message.reasoning_content = message.reasoning;
    }

    if (obj.function_call !== undefined) {
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
      message.tool_call_id = readOptionalStringField(obj, 'tool_call_id');
    }

    return message;
  });
}

function validateUiContext(raw: unknown): IncomingUiContext | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }

  const obj = asRecord(raw);
  const pathname = readOptionalStringField(obj, 'pathname');
  if (!pathname) {
    throw new Error('Invalid uiContext payload');
  }

  const screen = asRecord(obj.screen);
  const key = readOptionalStringField(screen, 'key');
  const label = readOptionalStringField(screen, 'label');
  if (!key || !label) {
    throw new Error('Invalid uiContext payload');
  }

  let record:
    | {
        type: 'ticket' | 'project' | 'client' | 'contact' | 'asset';
        id: string;
      }
    | undefined;

  if (obj.record !== undefined) {
    const recordObj = asRecord(obj.record);
    const type = readOptionalStringField(recordObj, 'type');
    const id = readOptionalStringField(recordObj, 'id');
    if (
      !id ||
      (type !== 'ticket' &&
        type !== 'project' &&
        type !== 'client' &&
        type !== 'contact' &&
        type !== 'asset')
    ) {
      throw new Error('Invalid uiContext payload');
    }
    record = { type, id };
  }

  return {
    pathname,
    screen: { key, label },
    ...(record ? { record } : {}),
  };
}

const VALID_MENTION_TYPES = new Set(['ticket', 'client', 'contact', 'project', 'asset', 'user']);
const MAX_MENTIONS = 10;

function validateMentions(raw: unknown): IncomingMention[] {
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    return [];
  }

  const mentions: IncomingMention[] = [];
  for (const item of raw.slice(0, MAX_MENTIONS)) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const type = typeof obj.type === 'string' ? obj.type : '';
    const id = typeof obj.id === 'string' ? obj.id : '';
    if (VALID_MENTION_TYPES.has(type) && id.length > 0) {
      mentions.push({ type: type as IncomingMention['type'], id });
    }
  }
  return mentions;
}

function encodeSseData(encoder: TextEncoder, payload: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

type StreamControllerState = {
  closed: boolean;
  doneSent: boolean;
};

function isInvalidStateError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ERR_INVALID_STATE'
  );
}

function tryEnqueue(
  controller: ReadableStreamDefaultController<Uint8Array>,
  controllerState: StreamControllerState,
  chunk: Uint8Array,
) {
  if (controllerState.closed) {
    return;
  }
  try {
    controller.enqueue(chunk);
  } catch (error) {
    controllerState.closed = true;
    if (!isInvalidStateError(error)) {
      console.error('[chat completions stream] Failed to enqueue SSE chunk', error);
    }
  }
}

function tryClose(
  controller: ReadableStreamDefaultController<Uint8Array>,
  controllerState: StreamControllerState,
) {
  if (controllerState.closed) {
    return;
  }
  try {
    controller.close();
  } catch (error) {
    if (!isInvalidStateError(error)) {
      console.error('[chat completions stream] Failed to close SSE controller', error);
    }
  } finally {
    controllerState.closed = true;
  }
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
  let uiContext: IncomingUiContext | undefined;
  let mentions: IncomingMention[];
  try {
    const bodyObj = asRecord(body);
    messages = validateMessages(bodyObj.messages);
    uiContext = validateUiContext(bodyObj.uiContext);
    mentions = validateMentions(bodyObj.mentions);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid payload';
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

  const session = await getSession();
  const tenantId = session?.user?.tenant;
  if (!tenantId) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  await assertTenantProductAccess({
    tenantId,
    capability: 'ai_chat',
    allowedProducts: ['psa'],
  });

  const encoder = new TextEncoder();
  const controllerState: StreamControllerState = {
    closed: false,
    doneSent: false,
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      (async () => {
        const mod = (await import('@product/chat/entry')) as unknown as {
          ChatCompletionsService: ChatCompletionsServiceLike;
        };
        const completionStream = await mod.ChatCompletionsService.createStructuredCompletionStream(
          messages,
          { signal: req.signal, uiContext, mentions: mentions.length > 0 ? mentions : undefined },
        );

        for await (const event of completionStream) {
          if (req.signal.aborted) {
            break;
          }

          const eventType = typeof event?.type === 'string' ? event.type : undefined;
          if (eventType === 'content_delta') {
            const token = typeof event.delta === 'string' ? event.delta : '';
            if (token.length > 0) {
              tryEnqueue(
                controller,
                controllerState,
                encodeSseData(encoder, {
                  type: 'content_delta',
                  delta: token,
                  content: token,
                  done: false,
                }),
              );
            }
            continue;
          }

          if (eventType === 'reasoning_delta') {
            const token = typeof event.delta === 'string' ? event.delta : '';
            if (token.length > 0) {
              tryEnqueue(
                controller,
                controllerState,
                encodeSseData(encoder, {
                  type: 'reasoning_delta',
                  delta: token,
                }),
              );
            }
            continue;
          }

          if (eventType === 'function_proposed') {
            tryEnqueue(controller, controllerState, encodeSseData(encoder, event));
            continue;
          }

          if (eventType === 'done') {
            controllerState.doneSent = true;
            tryEnqueue(
              controller,
              controllerState,
              encodeSseData(encoder, { type: 'done', content: '', done: true }),
            );
            continue;
          }
        }

        if (!req.signal.aborted && !controllerState.doneSent) {
          tryEnqueue(
            controller,
            controllerState,
            encodeSseData(encoder, { type: 'done', content: '', done: true }),
          );
        }
      })()
        .catch((error) => {
          console.error('[chat completions stream] Streaming error', {
            error,
            requestAborted: req.signal.aborted,
            controllerClosed: controllerState.closed,
            doneSent: controllerState.doneSent,
          });
        })
        .finally(() => {
          tryClose(controller, controllerState);
        });
    },
    cancel() {
      // The response body can be cancelled by the client before the background task finishes.
      // Mark it closed so background cleanup/enqueue paths become no-ops.
      controllerState.closed = true;
      return undefined;
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
