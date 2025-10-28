import OpenAI from 'openai';
import { NextRequest } from 'next/server';
import { v4 as uuid } from 'uuid';

import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import { getRegistry } from '../chat/registry/apiRegistry.indexer';
import {
  ChatApiRegistryEntry,
} from '../chat/registry/apiRegistry.schema';
import { TemporaryApiKeyService } from './temporaryApiKeyService';
import { getSecretProviderInstance } from '@alga-psa/shared/core/secretProvider';

const isEnterpriseEdition = () =>
  process.env.NEXT_PUBLIC_EDITION === 'enterprise' ||
  process.env.EDITION === 'enterprise' ||
  process.env.EDITION === 'ee';

const SEARCH_TOOL_NAME = 'search_api_registry';
const EXECUTE_TOOL_NAME = 'call_api_endpoint';
const MAX_TOOL_ITERATIONS = 6;

export type ChatCompletionMessage = {
  role: 'user' | 'assistant' | 'function';
  content?: string;
  name?: string;
  function_call?: {
    name: string;
    arguments: Record<string, unknown>;
  };
  tool_call_id?: string;
};

export interface FunctionMetadata {
  id: string;
  displayName: string;
  description?: string;
  rbacResource?: string;
  approvalRequired: boolean;
  playbooks?: string[];
  examples?: unknown[];
  arguments: Record<string, unknown>;
}

export interface FunctionCallInfo {
  name: string;
  arguments: Record<string, unknown>;
  toolCallId?: string;
  entryId?: string;
}

export interface FunctionProposedResponse {
  type: 'function_proposed';
  function: FunctionMetadata;
  assistantPreview: string;
  functionCall: FunctionCallInfo;
  nextMessages: ChatCompletionMessage[];
}

export interface AssistantMessageResponse {
  type: 'assistant_message';
  message: {
    role: 'assistant';
    content: string;
  };
  functionCall?: {
    name: string;
    arguments: Record<string, unknown>;
    result?: unknown;
  };
  nextMessages: ChatCompletionMessage[];
}

export interface ErrorResponse {
  type: 'error';
  error: string;
}

export type CompletionResponse =
  | FunctionProposedResponse
  | AssistantMessageResponse
  | ErrorResponse;

interface InitialCompletionParams {
  messages: ChatCompletionMessage[];
  chatId?: string | null;
  baseUrl: string;
  tenantId: string;
  userId: string;
}

interface ExecuteCompletionParams {
  messages: ChatCompletionMessage[];
  functionCall: FunctionCallInfo;
  chatId?: string | null;
  action: 'approve' | 'decline';
  baseUrl: string;
  tenantId: string;
  userId: string;
  cookieHeader?: string;
}

export class ChatCompletionsService {
  static async handleRequest(req: NextRequest): Promise<Response> {
    if (!isEnterpriseEdition()) {
      return new Response(
        JSON.stringify({ error: 'Chat completions are only available in Enterprise Edition' }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    const user = await getCurrentUser();
    if (!user || !user.user_id || !user.tenant) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
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

    try {
      const messages = this.validateMessages((body as any)?.messages);
      const chatId = (body as any)?.chatId ?? null;

      const result = await this.initialCompletion({
        messages,
        chatId,
        baseUrl: req.nextUrl.origin,
        tenantId: user.tenant,
        userId: user.user_id,
      });

      return new Response(JSON.stringify(result), {
        status: result.type === 'error' ? 400 : 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('[ChatCompletionsService] Request error', error);
      if ((error as any)?.error) {
        console.error(
          '[ChatCompletionsService] Provider response',
          JSON.stringify((error as any).error, null, 2),
        );
      }
      const message = error instanceof Error ? error.message : 'Internal Server Error';
      const status = message === 'Invalid messages payload' ? 400 : 500;
      return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  static async handleExecute(req: NextRequest): Promise<Response> {
    if (!isEnterpriseEdition()) {
      return new Response(
        JSON.stringify({ error: 'Chat completions are only available in Enterprise Edition' }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    const user = await getCurrentUser();
    if (!user || !user.user_id || !user.tenant) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
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

    try {
      const messages = this.validateMessages((body as any)?.messages);
      const functionCall = (body as any)?.functionCall;
      const action = ((body as any)?.action ?? 'approve') as 'approve' | 'decline';
      const chatId = (body as any)?.chatId ?? null;

      if (!functionCall || typeof functionCall.name !== 'string') {
        throw new Error('Missing function call information');
      }

      const result = await this.executeAfterApproval({
        messages,
        functionCall: {
          name: functionCall.name,
          arguments: this.ensureArguments(functionCall.arguments),
          toolCallId: typeof functionCall.toolCallId === 'string' ? functionCall.toolCallId : undefined,
          entryId: typeof functionCall.entryId === 'string' ? functionCall.entryId : undefined,
        },
        chatId,
        action,
        baseUrl: req.nextUrl.origin,
        tenantId: user.tenant,
        userId: user.user_id,
        cookieHeader: req.headers.get('cookie') ?? undefined,
      });

      return new Response(JSON.stringify(result), {
        status: result.type === 'error' ? 400 : 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('[ChatCompletionsService] Execute error', error);
      if ((error as any)?.error) {
        console.error(
          '[ChatCompletionsService] Provider response',
          JSON.stringify((error as any).error, null, 2),
        );
      }
      const message = error instanceof Error ? error.message : 'Internal Server Error';
      const status =
        message === 'Missing function call information' || message === 'Invalid messages payload'
          ? 400
          : 500;
      return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  private static async initialCompletion(params: InitialCompletionParams): Promise<CompletionResponse> {
    return this.processModelInteraction({
      messages: params.messages,
      chatId: params.chatId ?? null,
      baseUrl: params.baseUrl,
      tenantId: params.tenantId,
      userId: params.userId,
    });
  }

  private static async executeAfterApproval(params: ExecuteCompletionParams): Promise<CompletionResponse> {
    const { messages, functionCall, action, baseUrl, tenantId, userId, chatId, cookieHeader } = params;

    const entry = this.resolveRegistryEntry(
      functionCall.entryId ?? functionCall.arguments?.entryId ?? functionCall.name,
      functionCall.arguments,
    );
    if (!entry) {
      return {
        type: 'error',
        error: `Function ${functionCall.name} is not available.`,
      };
    }

    const preparedArgs = { ...functionCall.arguments };
    this.populatePathParameters(entry, preparedArgs);
    console.info('[ChatCompletionsService] executeAfterApproval args', entry.id, preparedArgs);

    let resultPayload: unknown = { status: 'skipped', reason: 'User declined to execute the function.' };

    if (action === 'approve') {
      resultPayload = await this.executeFunctionCall({
        entry,
        args: preparedArgs,
        baseUrl,
        tenantId,
        userId,
        chatId,
        cookieHeader,
      });
    }

    const toolCallId = functionCall.toolCallId ?? uuid();

    const functionMessage: ChatCompletionMessage = {
      role: 'function',
      name: EXECUTE_TOOL_NAME,
      content: JSON.stringify(resultPayload),
      tool_call_id: toolCallId,
    };

    const response = await this.processModelInteraction({
      messages: [...messages, functionMessage],
      chatId,
      baseUrl,
      tenantId,
      userId,
    });

    if (response.type === 'assistant_message') {
      response.functionCall = {
        name: EXECUTE_TOOL_NAME,
        arguments: preparedArgs,
        result: resultPayload,
        toolCallId,
      };
    }

    return response;
  }

  private static buildToolDefinitions() {
    return [
      {
        type: 'function' as const,
        function: {
          name: SEARCH_TOOL_NAME,
          description:
            'Search the enterprise API catalog for relevant endpoints. Use this before calling an endpoint to find the most appropriate entry.',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Natural language description of what you want to do (e.g., "list active service categories").',
              },
              limit: {
                type: 'integer',
                minimum: 1,
                maximum: 25,
                description: 'Maximum number of results to return (default 5).',
              },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: EXECUTE_TOOL_NAME,
          description:
            'Invoke a documented API endpoint by its registry identifier. Include any path, query, header, or body parameters required by that endpoint.',
          parameters: {
            type: 'object',
            properties: {
              entryId: {
                type: 'string',
                description:
                  'Registry identifier for the endpoint, for example "serviceCategories.list". Always provide this.',
              },
              method: {
                type: 'string',
                description: 'HTTP method to use when invoking the endpoint (defaults to the documented method).',
                enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
              },
              path: {
                type: 'object',
                description: 'Values for path parameters, keyed by parameter name.',
                additionalProperties: true,
              },
              query: {
                type: 'object',
                description: 'Values for query string parameters.',
                additionalProperties: true,
              },
              headers: {
                type: 'object',
                description: 'Additional headers required by the endpoint.',
                additionalProperties: true,
              },
              body: {
                description: 'JSON payload for POST/PUT/PATCH requests.',
                oneOf: [
                  {
                    type: 'object',
                    description: 'Structured JSON object payload.',
                    additionalProperties: true,
                  },
                  {
                    type: 'array',
                    description: 'Array payload (e.g., bulk operations).',
                    items: {},
                  },
                  {
                    type: 'string',
                    description: 'Raw string payload.',
                  },
                  {
                    type: 'number',
                    description: 'Numeric payload.',
                  },
                  {
                    type: 'boolean',
                    description: 'Boolean payload.',
                  },
                  {
                    type: 'null',
                    description: 'Explicit null payload.',
                  },
                ],
              },
            },
            required: ['entryId'],
            additionalProperties: true,
          },
        },
      },
    ];
  }

  private static resolveRegistryEntry(
    entryId: unknown,
    args?: Record<string, unknown>,
  ): ChatApiRegistryEntry | null {
    let identifier = typeof entryId === 'string' ? entryId : '';
    if (!identifier && typeof args?.entryId === 'string') {
      identifier = args.entryId;
    }
    const registry = getRegistry();
    const normalizedId = identifier.replace(/-/g, '_');
    const method = typeof args?.method === 'string' ? args.method.toLowerCase() : undefined;
    const path = typeof args?.path === 'string' ? args.path : undefined;

    return (
      registry.find((item) => item.id === identifier) ??
      registry.find((item) => this.toToolName(item.id) === identifier) ??
      registry.find((item) => item.id === normalizedId) ??
      registry.find((item) => this.toToolName(item.id) === normalizedId) ??
      (method && path
        ? registry.find(
            (item) => item.method.toLowerCase() === method && item.path === path,
          )
        : null) ??
      null
    );
  }

  private static searchRegistry(query: unknown, limitValue: unknown) {
    const text = typeof query === 'string' ? query.trim() : '';
    if (!text) {
      return [];
    }

    const limit = Math.max(1, Math.min(typeof limitValue === 'number' ? limitValue : parseInt(String(limitValue ?? ''), 10) || 5, 25));
    const terms = text.toLowerCase().split(/\s+/).filter(Boolean);
    const registry = getRegistry();

    const scored = registry
      .map((entry, index) => {
        const haystack = [
          entry.displayName,
          entry.description,
          entry.path,
          entry.tags?.join(' '),
          entry.id,
        ]
          .join(' ')
          .toLowerCase();
        const score =
          terms.reduce((acc, term) => (haystack.includes(term) ? acc + 2 : acc), 0) +
          (entry.playbooks?.length ?? 0) +
          Math.max(0, 3 - index * 0.1);
        return { entry, score };
      })
      .sort((a, b) => b.score - a.score);

    const top = scored.slice(0, limit).map(({ entry }) => ({
      id: entry.id,
      displayName: entry.displayName,
      description: entry.description,
      method: entry.method.toUpperCase(),
      path: entry.path,
      approvalRequired: entry.approvalRequired,
      tags: entry.tags ?? [],
    }));

    return top;
  }

  private static async processModelInteraction(params: {
    messages: ChatCompletionMessage[];
    chatId: string | null;
    baseUrl: string;
    tenantId: string;
    userId: string;
  }): Promise<CompletionResponse> {
    const { messages, chatId, baseUrl, tenantId, userId } = params;
    const client = await this.getOpenRouterClient();
    let conversation = this.normalizeConversationHistory(messages);

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
      const completion = await client.chat.completions.create({
        model: process.env.OPENROUTER_CHAT_MODEL ?? 'openai/gpt-4o-mini',
        messages: this.buildOpenAiMessages(conversation),
        tools: this.buildToolDefinitions(),
        tool_choice: 'auto',
        temperature: 0.2,
      });

      const choice = completion.choices[0];
      if (!choice) {
        return {
          type: 'error',
          error: 'The model returned no choices.',
        };
      }

      const content = this.extractContent(choice);
      const toolCalls = choice.message?.tool_calls ?? [];

      if (toolCalls.length > 0) {
        const toolCall = toolCalls[0];
        const functionName = toolCall.function?.name;
        const parsedArgs = this.ensureArguments(toolCall.function?.arguments);
        const toolCallId = toolCall.id ?? uuid();

        if (!functionName) {
          return {
            type: 'error',
            error: 'The assistant attempted to call an unknown function.',
          };
        }

        const assistantMessage: ChatCompletionMessage = {
          role: 'assistant',
          content: content || undefined,
          function_call: {
            name: functionName,
            arguments: parsedArgs,
          },
          tool_call_id: toolCallId,
        };

        conversation = [...conversation, assistantMessage];

        if (functionName === SEARCH_TOOL_NAME) {
          const results = this.searchRegistry(parsedArgs.query, parsedArgs.limit);
          const functionMessage: ChatCompletionMessage = {
            role: 'function',
            name: SEARCH_TOOL_NAME,
            content: JSON.stringify({ results }),
            tool_call_id: toolCallId,
          };
          conversation = [...conversation, functionMessage];
          continue;
        }

        if (functionName === EXECUTE_TOOL_NAME) {
          const entry = this.resolveRegistryEntry(
            parsedArgs.entryId ?? parsedArgs.id ?? parsedArgs.name,
            parsedArgs,
          );
          if (!entry) {
            return {
              type: 'error',
              error: `Function ${parsedArgs.entryId ?? functionName} is not available.`,
            };
          }

          const preparedArgs = { ...parsedArgs };
          this.populatePathParameters(entry, preparedArgs);
          assistantMessage.function_call!.arguments = preparedArgs;
          const metadata = this.buildFunctionMetadata(entry, preparedArgs);
          return {
            type: 'function_proposed',
            function: metadata,
            assistantPreview: content ?? '',
            functionCall: {
              name: functionName,
              arguments: preparedArgs,
              toolCallId,
              entryId: entry.id,
            },
            nextMessages: conversation,
          };
        }

        return {
          type: 'error',
          error: `Function ${functionName} is not available.`,
        };
      }

      const assistantMessage: ChatCompletionMessage = {
        role: 'assistant',
        content,
      };

      const nextMessages = [...conversation, assistantMessage];

      return {
        type: 'assistant_message',
        message: {
          role: 'assistant',
          content,
        },
        nextMessages,
      };
    }

    return {
      type: 'error',
      error: 'The assistant produced too many tool invocations without completing the task.',
    };
  }

  private static validateMessages(raw: unknown): ChatCompletionMessage[] {
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new Error('Invalid messages payload');
    }

    return raw.map((item) => {
      if (!item || typeof item !== 'object') {
        throw new Error('Invalid messages payload');
      }

      const role = (item as any).role;
      if (role !== 'user' && role !== 'assistant' && role !== 'function') {
        throw new Error('Invalid messages payload');
      }

      const message: ChatCompletionMessage = {
        role,
      };

      if (role === 'function') {
        message.name = typeof (item as any).name === 'string' ? (item as any).name : undefined;
        message.content = typeof (item as any).content === 'string' ? (item as any).content : undefined;
        message.tool_call_id =
          typeof (item as any).tool_call_id === 'string' ? (item as any).tool_call_id : undefined;
        if (!message.name) {
          throw new Error('Invalid messages payload');
        }
        return message;
      }

      if ((item as any).content && typeof (item as any).content === 'string') {
        message.content = (item as any).content;
      }

      if ((item as any).function_call) {
        const fn = (item as any).function_call;
        if (typeof fn.name !== 'string') {
          throw new Error('Invalid messages payload');
        }
        message.function_call = {
          name: fn.name,
          arguments: this.ensureArguments(fn.arguments),
        };
        message.tool_call_id =
          typeof (item as any).tool_call_id === 'string' ? (item as any).tool_call_id : undefined;
      }

      return message;
    });
  }

  private static ensureArguments(args: unknown): Record<string, unknown> {
    if (!args) {
      return {};
    }

    if (typeof args === 'string') {
      try {
        return JSON.parse(args);
      } catch (error) {
        console.error('[ChatCompletionsService] Failed to parse arguments string', error);
        return {};
      }
    }

    if (typeof args === 'object') {
      return args as Record<string, unknown>;
    }

    return {};
  }

  private static normalizeConversationHistory(messages: ChatCompletionMessage[]): ChatCompletionMessage[] {
    const history = messages.map((message) => ({
      ...message,
      function_call: message.function_call
        ? {
            name: message.function_call.name,
            arguments: message.function_call.arguments,
          }
        : undefined,
    }));

    const pendingCalls = new Map<string, number>();
    const pendingOrder: string[] = [];

    const removeFromOrder = (id: string) => {
      const orderIndex = pendingOrder.indexOf(id);
      if (orderIndex !== -1) {
        pendingOrder.splice(orderIndex, 1);
      }
    };

    history.forEach((message, index) => {
      if (message.role === 'assistant' && message.function_call) {
        let toolCallId = message.tool_call_id;
        if (!toolCallId) {
          toolCallId = this.toToolName(`${message.function_call.name}_${index}`);
          message.tool_call_id = toolCallId;
        }
        pendingCalls.set(toolCallId, index);
        pendingOrder.push(toolCallId);
      } else if (message.role === 'function') {
        let toolCallId = message.tool_call_id;
        if (toolCallId) {
          if (pendingCalls.has(toolCallId)) {
            pendingCalls.delete(toolCallId);
          }
          removeFromOrder(toolCallId);
        } else if (pendingOrder.length > 0) {
          const matchedId = pendingOrder.shift()!;
          const assistantIndex = pendingCalls.get(matchedId);
          if (assistantIndex !== undefined) {
            pendingCalls.delete(matchedId);
            toolCallId = matchedId;
            message.tool_call_id = toolCallId;
          }
        } else if (message.name) {
          message.tool_call_id = this.toToolName(`${message.name}_${index}`);
        }
      }
    });

    for (const [toolCallId, assistantIndex] of pendingCalls.entries()) {
      const assistantMessage = history[assistantIndex];
      if (assistantMessage) {
        delete assistantMessage.function_call;
        delete assistantMessage.tool_call_id;
      }
    }

    return history.filter((message) => {
      if (message.role === 'function' && !message.tool_call_id) {
        return false;
      }
      return true;
    });
  }

  private static buildOpenAiMessages(messages: ChatCompletionMessage[]) {
    const systemPrompt = {
      role: 'system' as const,
      content:
        'You are Alga, an assistant that helps users manage PSA workflows. ' +
        'Always consult the enterprise API registry before executing actions so you understand every required parameter. ' +
        'When the registry or endpoint descriptions mention prerequisite data (such as IDs for boards, clients, categories, priorities, or other related resources), proactively call the appropriate lookup endpoints to gather that information instead of asking the user. ' +
        'For ticket-creation calls, first use search_api_registry to locate the list endpoints you need, gather current data (e.g. call GET /api/v1/tickets to sample board_id/status_id/priority_id combinations and GET /api/v1/clients to confirm client_id), and do not proceed until you have concrete UUIDs for board_id, client_id, status_id, and priority_id collected from prior API responses. ' +
        'Clearly explain the plan before each tool call, execute the necessary lookup calls to satisfy all requirements, then call the target endpoint once the inputs are ready. ' +
        'Use the documented request schemas exactly as written—populate *_id fields with the UUIDs you retrieved (never human-friendly names), and skip optional fields when you do not have authoritative values. ' +
        'After a function result is provided, summarize the outcome for the user and outline any follow-up you will handle automatically.',
    };

    const converted = messages.map((message) => {
      if (message.role === 'function') {
        return {
          role: 'tool' as const,
          tool_call_id: message.tool_call_id ?? message.name ?? uuid(),
          content: message.content ?? '',
        };
      }

      if (message.role === 'assistant' && message.function_call) {
        return {
          role: 'assistant' as const,
          content: message.content ?? '',
          tool_calls: [
            {
              id: message.tool_call_id ?? uuid(),
              type: 'function' as const,
              function: {
                name: message.function_call.name,
                arguments: JSON.stringify(message.function_call.arguments ?? {}),
              },
            },
          ],
        };
      }

      return {
        role: message.role,
        content: message.content ?? '',
      };
    });

    return [systemPrompt, ...converted];
  }

  private static extractContent(choice: OpenAI.Chat.Completions.ChatCompletion.Choice) {
    const message = choice?.message;
    if (!message) {
      return '';
    }

    const content = message.content;
    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (typeof part === 'string') {
            return part;
          }
          if (typeof part === 'object' && part !== null && 'text' in part) {
            return (part as { text?: string }).text ?? '';
          }
          return '';
        })
        .join('');
    }

    return '';
  }

  private static buildFunctionMetadata(entry: ChatApiRegistryEntry, args: Record<string, unknown>): FunctionMetadata {
    return {
      id: entry.id,
      displayName: entry.displayName,
      description: entry.description,
      rbacResource: entry.rbacResource,
      approvalRequired: entry.approvalRequired,
      playbooks: entry.playbooks,
      examples: entry.examples,
      arguments: args,
    };
  }

  private static toToolName(id: string): string {
    return id.replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  private static async executeFunctionCall(params: {
    entry: ChatApiRegistryEntry;
    args: Record<string, unknown>;
    baseUrl: string;
    tenantId: string;
    userId: string;
    chatId: string | null;
    cookieHeader?: string;
  }) {
    const { entry, args, baseUrl, tenantId, userId, chatId, cookieHeader } = params;

    const functionCallId = uuid();
    const approvalId = uuid();

    const tempKey = await TemporaryApiKeyService.issueForAiSession({
      tenantId,
      userId,
      issuedByUserId: userId,
      chatId: chatId ?? 'unknown-chat',
      functionCallId,
      approvalId,
      extraMetadata: {
        function_id: entry.id,
        arguments: args,
      },
    });

    try {
      const { url, init } = this.buildFetchRequest(entry, args, baseUrl, tempKey.apiKey, tenantId);
      if (!tempKey.apiKey && cookieHeader) {
        init.headers = {
          ...init.headers,
          cookie: cookieHeader,
        };
      }
      const requestStarted = Date.now();
      const requestHeadersForLog = this.sanitizeHeadersForLogging(init.headers);
      const requestMethodForLog = init.method ?? entry.method.toUpperCase();
      console.info('[ChatCompletionsService] API request', {
        entryId: entry.id,
        method: requestMethodForLog,
        url,
        hasBody: init.body !== undefined && init.body !== null,
        headers: requestHeadersForLog,
        args,
      });
      const response = await fetch(url, init);
      const durationMs = Date.now() - requestStarted;
      console.info('[ChatCompletionsService] API response', {
        entryId: entry.id,
        method: requestMethodForLog,
        url,
        status: response.status,
        ok: response.ok,
        durationMs,
        contentType: response.headers.get('content-type') ?? undefined,
      });
      const text = await response.text();
      let data: unknown = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }

      await TemporaryApiKeyService.revoke(tenantId, tempKey.apiKeyId, 'consumed');

      return {
        status: response.status,
        ok: response.ok,
        data,
      };
    } catch (error) {
      await TemporaryApiKeyService.revoke(tenantId, tempKey.apiKeyId, 'error', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private static buildFetchRequest(
    entry: ChatApiRegistryEntry,
    args: Record<string, unknown>,
    baseUrl: string,
    apiKey: string,
    tenantId: string,
  ) {
    const requestedMethod =
      typeof args.method === 'string' ? args.method.toUpperCase() : undefined;
    const method = requestedMethod ?? entry.method.toUpperCase();
    let path = entry.path;

    const pathParamsInput = this.normalizeRecord(
      args.path ?? args.pathParams ?? (this.normalizeRecord(args.parameters)?.path ?? {}),
    );
    const queryInput = this.normalizeRecord(args.query ?? (this.normalizeRecord(args.parameters)?.query ?? {}));
    const headerInput = this.normalizeRecord(args.headers ?? (this.normalizeRecord(args.parameters)?.headers ?? {}));
    const genericParameters = this.normalizeRecord(args.parameters);

    const headers: Record<string, string> = {
      'x-tenant-id': tenantId,
    };

    if (apiKey) {
      headers['x-api-key'] = apiKey;
    }

    const queryParams: Record<string, unknown> = { ...queryInput };

    const directArgs = this.normalizeRecord(args);
    delete directArgs.body;
    delete directArgs.path;
    delete directArgs.pathParams;
    delete directArgs.query;
    delete directArgs.headers;
    delete directArgs.parameters;
    delete directArgs.entryId;
    delete directArgs.method;

    for (const param of entry.parameters) {
      let value: unknown;
      if (param.in === 'path') {
        value =
          pathParamsInput[param.name] ??
          genericParameters[param.name] ??
          directArgs[param.name];
        if (value !== undefined && value !== null) {
          const encoded = encodeURIComponent(String(value));
          path = path.replace(`{${param.name}}`, encoded);
          pathParamsInput[param.name] = value;
          directArgs[param.name] = value;
        }
      } else if (param.in === 'query') {
        value =
          queryInput[param.name] ??
          genericParameters[param.name] ??
          directArgs[param.name];
        if (value !== undefined && value !== null) {
          queryParams[param.name] = value;
        }
      } else if (param.in === 'header') {
        value =
          headerInput[param.name] ??
          genericParameters[param.name] ??
          directArgs[param.name];
        if (value !== undefined && value !== null) {
          headers[param.name] = String(value);
        }
      } else if (param.in === 'cookie') {
        // no-op: cookies handled separately
      } else {
        // leave other parameter types untouched for now
      }
    }

    // Replace any remaining templated segments using the best available sources
    path = path.replace(/\{([^}]+)\}/g, (match, group) => {
      const candidate =
        pathParamsInput[group] ??
        genericParameters[group] ??
        directArgs[group] ??
        (typeof args[group] !== 'object' ? args[group] : undefined);
      if (candidate === undefined || candidate === null) {
        return match;
      }
      return encodeURIComponent(String(candidate));
    });

    // Include any additional headers/query params provided explicitly
    Object.entries(headerInput).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        headers[key] = String(value);
      }
    });

    const url = new URL(path, baseUrl);
    Object.entries(queryParams).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    });

    const init: RequestInit = {
      method,
      headers,
    };

    const bodyValue =
      args.body ??
      args.data ??
      args.payload ??
      genericParameters.body ??
      undefined;

    if (bodyValue !== undefined && method !== 'GET' && method !== 'DELETE') {
      headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
      init.body =
        typeof bodyValue === 'string'
          ? bodyValue
          : JSON.stringify(bodyValue);
    }

    return { url: url.toString(), init };
  }

  private static sanitizeHeadersForLogging(headers?: HeadersInit) {
    const redacted: Record<string, string> = {};
    if (!headers) {
      return redacted;
    }

    if (headers instanceof Headers) {
      headers.forEach((value, key) => {
        redacted[key] = this.shouldRedactHeader(key) ? 'REDACTED' : value;
      });
      return redacted;
    }

    if (Array.isArray(headers)) {
      for (const [key, value] of headers) {
        redacted[key] = this.shouldRedactHeader(key) ? 'REDACTED' : value;
      }
      return redacted;
    }

    Object.entries(headers as Record<string, string>).forEach(([key, value]) => {
      redacted[key] = this.shouldRedactHeader(key) ? 'REDACTED' : value;
    });
    return redacted;
  }

  private static shouldRedactHeader(headerName: string) {
    return /^(authorization|cookie|x-api-key|x-openai-api-key|proxy-authorization)$/i.test(headerName);
  }

  private static async getOpenRouterClient() {
    const secretProvider = await getSecretProviderInstance();
    const apiKey =
      (await secretProvider.getAppSecret('OPENROUTER_API_KEY')) ||
      process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      throw new Error('OpenRouter API key is not configured');
    }

    return new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
    });
  }

  private static populatePathParameters(entry: ChatApiRegistryEntry, args: Record<string, unknown>) {
    if (!entry.parameters?.length) {
      return;
    }

    const pathParams = entry.parameters.filter((param) => param.in === 'path');
    if (pathParams.length === 0) {
      return;
    }

    const pathObject = this.normalizeRecord(args.path ?? args.pathParams ?? {});
    const genericParameters = this.normalizeRecord(args.parameters);
    const directArgs = this.normalizeRecord(args);

    for (const param of pathParams) {
      if (pathObject[param.name] !== undefined && pathObject[param.name] !== null) {
        continue;
      }

      const aliasCandidates: Array<unknown> = [
        directArgs[param.name],
        genericParameters[param.name],
      ];

      const snakeAlias = `${param.name}_id`;
      const camelAlias =
        param.name
          .split('_')
          .map((segment, index) =>
            index === 0 ? segment : segment.charAt(0).toUpperCase() + segment.slice(1),
          )
          .join('') + 'Id';

      aliasCandidates.push(directArgs[snakeAlias]);
      aliasCandidates.push(directArgs[camelAlias]);
      aliasCandidates.push(directArgs[`${param.name}Id`]);

      if (param.name === 'id') {
        aliasCandidates.push(directArgs['ticketId']);
        aliasCandidates.push(directArgs['ticket_id']);
      }

      const resolved = aliasCandidates.find(
        (candidate) => candidate !== undefined && candidate !== null,
      );

      if (resolved !== undefined) {
        pathObject[param.name] = resolved;
      }
    }

    if (Object.keys(pathObject).length > 0) {
      console.info('[ChatCompletionsService] populatePathParameters', entry.id, pathObject);
      args.path = pathObject;
    }
  }

  private static normalizeRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? { ...(value as Record<string, unknown>) }
      : {};
  }
}
