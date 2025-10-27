import OpenAI from 'openai';
import { NextRequest } from 'next/server';
import { v4 as uuid } from 'uuid';

import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import { getRegistry } from '../chat/registry/apiRegistry.indexer';
import {
  ChatApiRegistryEntry,
  ChatApiParameter,
} from '../chat/registry/apiRegistry.schema';
import { TemporaryApiKeyService } from './temporaryApiKeyService';
import { getSecretProviderInstance } from '@alga-psa/shared/core/secretProvider';

export type ChatCompletionMessage = {
  role: 'user' | 'assistant' | 'function';
  content?: string;
  name?: string;
  function_call?: {
    name: string;
    arguments: Record<string, unknown>;
  };
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
}

export class ChatCompletionsService {
  static async handleRequest(req: NextRequest): Promise<Response> {
    if (process.env.EDITION !== 'enterprise') {
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
      const message = error instanceof Error ? error.message : 'Internal Server Error';
      const status = message === 'Invalid messages payload' ? 400 : 500;
      return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  static async handleExecute(req: NextRequest): Promise<Response> {
    if (process.env.EDITION !== 'enterprise') {
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
        },
        chatId,
        action,
        baseUrl: req.nextUrl.origin,
        tenantId: user.tenant,
        userId: user.user_id,
      });

      return new Response(JSON.stringify(result), {
        status: result.type === 'error' ? 400 : 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('[ChatCompletionsService] Execute error', error);
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
    const { messages, chatId, baseUrl, tenantId, userId } = params;

    const client = await this.getOpenRouterClient();
    const registry = getRegistry();

    const openAiMessages = this.buildOpenAiMessages(messages);

    const completion = await client.chat.completions.create({
      model: 'anthropic/claude-3.5-sonnet',
      messages: openAiMessages,
      functions: registry.map((entry) => this.buildFunctionDefinition(entry)),
      function_call: 'auto',
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
    const functionCall = choice.message?.function_call;

    if (choice.finish_reason === 'function_call' && functionCall?.name) {
      const entry = registry.find((item) => item.id === functionCall.name);
      if (!entry) {
        return {
          type: 'error',
          error: `Function ${functionCall.name} is not available.`,
        };
      }

      const parsedArgs = this.ensureArguments(functionCall.arguments);

      const assistantMessage: ChatCompletionMessage = {
        role: 'assistant',
        content: content || undefined,
        function_call: {
          name: functionCall.name,
          arguments: parsedArgs,
        },
      };

      const nextMessages: ChatCompletionMessage[] = [...messages, assistantMessage];

      const metadata = this.buildFunctionMetadata(entry, parsedArgs);

      return {
        type: 'function_proposed',
        function: metadata,
        assistantPreview: content ?? '',
        functionCall: {
          name: functionCall.name,
          arguments: parsedArgs,
        },
        nextMessages,
      };
    }

    const assistantMessage: ChatCompletionMessage = {
      role: 'assistant',
      content,
    };

    const nextMessages: ChatCompletionMessage[] = [...messages, assistantMessage];

    return {
      type: 'assistant_message',
      message: {
        role: 'assistant',
        content,
      },
      nextMessages,
    };
  }

  private static async executeAfterApproval(params: ExecuteCompletionParams): Promise<CompletionResponse> {
    const { messages, functionCall, action, baseUrl, tenantId, userId, chatId } = params;

    const registry = getRegistry();
    const entry = registry.find((item) => item.id === functionCall.name);
    if (!entry) {
      return {
        type: 'error',
        error: `Function ${functionCall.name} is not available.`,
      };
    }

    const client = await this.getOpenRouterClient();

    let resultPayload: unknown = { status: 'skipped', reason: 'User declined to execute the function.' };

    if (action === 'approve') {
      resultPayload = await this.executeFunctionCall({
        entry,
        args: functionCall.arguments,
        baseUrl,
        tenantId,
        userId,
        chatId,
      });
    }

    const functionMessage: ChatCompletionMessage = {
      role: 'function',
      name: functionCall.name,
      content: JSON.stringify(resultPayload),
    };

    const openAiMessages = this.buildOpenAiMessages([...messages, functionMessage]);

    const completion = await client.chat.completions.create({
      model: 'anthropic/claude-3.5-sonnet',
      messages: openAiMessages,
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
    const assistantMessage: ChatCompletionMessage = {
      role: 'assistant',
      content,
    };

    const nextMessages: ChatCompletionMessage[] = [...messages, functionMessage, assistantMessage];

    return {
      type: 'assistant_message',
      message: {
        role: 'assistant',
        content,
      },
      functionCall: {
        name: functionCall.name,
        arguments: functionCall.arguments,
        result: resultPayload,
      },
      nextMessages,
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
          role: 'function' as const,
          name: message.name ?? 'function',
          content: message.content ?? '',
        };
      }

      return {
        role: message.role,
        content: message.content ?? null,
        function_call: message.function_call
          ? {
              name: message.function_call.name,
              arguments: JSON.stringify(message.function_call.arguments ?? {}),
            }
          : undefined,
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

  private static buildFunctionDefinition(entry: ChatApiRegistryEntry) {
    return {
      name: entry.id,
      description: entry.description ?? entry.displayName,
      parameters: this.buildParameterSchema(entry),
    };
  }

  private static buildParameterSchema(entry: ChatApiRegistryEntry) {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    const addParameter = (param: ChatApiParameter) => {
      if (!param.name) {
        return;
      }

      properties[param.name] = param.schema ?? { type: 'string' };
      if (param.required) {
        required.push(param.name);
      }
    };

    entry.parameters.forEach(addParameter);

    if (entry.requestBodySchema) {
      properties.body = entry.requestBodySchema;
      required.push('body');
    }

    return {
      type: 'object',
      properties,
      required: Array.from(new Set(required)),
    };
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

  private static async executeFunctionCall(params: {
    entry: ChatApiRegistryEntry;
    args: Record<string, unknown>;
    baseUrl: string;
    tenantId: string;
    userId: string;
    chatId: string | null;
  }) {
    const { entry, args, baseUrl, tenantId, userId, chatId } = params;

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

    const queryParams: Record<string, unknown> = {};
    const headers: Record<string, string> = {
      'x-api-key': apiKey,
      'x-tenant-id': tenantId,
    };

    const body = args.body;

    for (const param of entry.parameters) {
      const value = args[param.name];
      if (value === undefined || value === null) {
        continue;
      }

      if (param.in === 'path') {
        path = path.replace(`{${param.name}}`, encodeURIComponent(String(value)));
      } else if (param.in === 'query') {
        queryParams[param.name] = value;
      } else if (param.in === 'header') {
        headers[param.name] = String(value);
      }
    }

    const url = new URL(path, baseUrl);
    Object.entries(queryParams).forEach(([key, value]) => {
      url.searchParams.set(key, String(value));
    });

    const init: RequestInit = {
      method,
      headers,
    };

    if (method !== 'GET' && method !== 'DELETE' && body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
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
      baseURL: 'https://openrouter.io/api/v1',
    });
  }
}
