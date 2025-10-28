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

    const entry = this.resolveRegistryEntry(functionCall.entryId ?? functionCall.arguments?.entryId ?? functionCall.name);
    if (!entry) {
      return {
        type: 'error',
        error: `Function ${functionCall.name} is not available.`,
      };
    }

    let resultPayload: unknown = { status: 'skipped', reason: 'User declined to execute the function.' };

    if (action === 'approve') {
      resultPayload = await this.executeFunctionCall({
        entry,
        args: functionCall.arguments,
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
        arguments: functionCall.arguments,
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
                type: ['object', 'array', 'string', 'number', 'boolean', 'null'],
              },
            },
            required: ['entryId'],
            additionalProperties: true,
          },
        },
      },
    ];
  }

  private static resolveRegistryEntry(entryId: unknown): ChatApiRegistryEntry | null {
    if (typeof entryId !== 'string') {
      return null;
    }
    const registry = getRegistry();
    return (
      registry.find((item) => item.id === entryId) ??
      registry.find((item) => this.toToolName(item.id) === entryId) ??
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
    let conversation = messages;

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
          const entry = this.resolveRegistryEntry(parsedArgs.entryId ?? parsedArgs.id ?? parsedArgs.name);
          if (!entry) {
            return {
              type: 'error',
              error: `Function ${parsedArgs.entryId ?? functionName} is not available.`,
            };
          }

          const metadata = this.buildFunctionMetadata(entry, parsedArgs);
          return {
            type: 'function_proposed',
            function: metadata,
            assistantPreview: content ?? '',
            functionCall: {
              name: functionName,
              arguments: parsedArgs,
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

  private static buildOpenAiMessages(messages: ChatCompletionMessage[]) {
    const systemPrompt = {
      role: 'system' as const,
      content:
        'You are Alga, an assistant that helps users manage PSA workflows. ' +
        'When you propose calling a function, clearly explain what you plan to do. ' +
        'After the function result is provided, summarize the outcome for the user.',
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
      const response = await fetch(url, init);
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
    const method = entry.method.toUpperCase();
    let path = entry.path;

    const normalizeRecord = (value: unknown): Record<string, unknown> =>
      value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

    const pathParamsInput = normalizeRecord(
      args.path ?? args.pathParams ?? (normalizeRecord(args.parameters)?.path ?? {}),
    );
    const queryInput = normalizeRecord(args.query ?? (normalizeRecord(args.parameters)?.query ?? {}));
    const headerInput = normalizeRecord(args.headers ?? (normalizeRecord(args.parameters)?.headers ?? {}));
    const genericParameters = normalizeRecord(args.parameters);

    const headers: Record<string, string> = {
      'x-tenant-id': tenantId,
    };

    if (apiKey) {
      headers['x-api-key'] = apiKey;
    }

    const queryParams: Record<string, unknown> = { ...queryInput };

    const directArgs = normalizeRecord(args);
    delete directArgs.body;
    delete directArgs.path;
    delete directArgs.pathParams;
    delete directArgs.query;
    delete directArgs.headers;
    delete directArgs.parameters;
    delete directArgs.entryId;

    for (const param of entry.parameters) {
      let value: unknown;
      if (param.in === 'path') {
        value =
          pathParamsInput[param.name] ??
          genericParameters[param.name] ??
          directArgs[param.name];
        if (value !== undefined && value !== null) {
          path = path.replace(`{${param.name}}`, encodeURIComponent(String(value)));
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
}
