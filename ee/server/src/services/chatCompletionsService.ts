import OpenAI from 'openai';
import { NextRequest } from 'next/server';
import { v4 as uuid } from 'uuid';

import { getAssetDetailBundle } from '@alga-psa/assets/actions/assetActions';
import { getClientById, getContactByContactNameId } from '@alga-psa/clients/actions';
import { getProject } from '@alga-psa/projects/actions/projectActions';
import { getTicketById } from '@alga-psa/tickets/actions/ticketActions';
import { findCommentsByTicketId } from '@alga-psa/tickets/actions/comment-actions';
import { getCurrentUser, findUserById } from '@alga-psa/user-composition/actions';
import { getRegistry } from '../chat/registry/apiRegistry.indexer';
import {
  ChatApiRegistryEntry,
} from '../chat/registry/apiRegistry.schema';
import { searchRegistryEntries, type RegistrySearchResult } from '../chat/registry/search';
import { TemporaryApiKeyService } from './temporaryApiKeyService';
import { parseAssistantContent, ParsedAssistantContent } from '../utils/chatContent';
import { reprovisionExtension } from '../lib/actions/extensionDomainActions';
import {
  resolveChatProvider,
  type ChatProviderId,
  type ResolvedChatProvider,
} from './chatProviderResolver';

const isEnterpriseEdition = () =>
  process.env.NEXT_PUBLIC_EDITION === 'enterprise' ||
  process.env.EDITION === 'enterprise' ||
  process.env.EDITION === 'ee';

const EMPTY_RESPONSE_ERROR = 'EMPTY_MODEL_RESPONSE';
const NO_MODEL_CHOICES_ERROR = 'NO_MODEL_CHOICES';
const MAX_MODEL_RETRIES = 2;
const MAX_RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_BASE_DELAY_MS = 500;
const RATE_LIMIT_MAX_DELAY_MS = 5000;
const MIN_RATE_LIMIT_DELAY_MS = 100;
const SEARCH_TOOL_NAME = 'search_api_registry';
const EXECUTE_TOOL_NAME = 'call_api_endpoint';
const FINISH_TOOL_NAME = 'finish_response';
const MAX_TOOL_ITERATIONS = 6;
const MAX_TOOL_RESULT_CHARS = 12000;
const TOOL_RESULT_PREVIEW_ITEMS = 3;
const TOOL_RESULT_PREVIEW_KEYS = 12;
const TOOL_RESULT_PREVIEW_DEPTH = 3;
const INVALID_TOOL_ARGUMENTS_PREVIEW_CHARS = 400;

export type ChatCompletionMessage = {
  role: 'user' | 'assistant' | 'function';
  content?: string;
  reasoning?: string;
  reasoning_content?: string;
  name?: string;
  function_call?: {
    name: string;
    arguments: Record<string, unknown>;
  };
  tool_call_id?: string;
};

type ChatUiContextRecord = {
  type: 'ticket' | 'project' | 'client' | 'contact' | 'asset';
  id: string;
};

type ChatUiContext = {
  pathname: string;
  screen: {
    key: string;
    label: string;
  };
  record?: ChatUiContextRecord;
};

type ChatMention = {
  type: 'ticket' | 'client' | 'contact' | 'project' | 'asset' | 'user';
  id: string;
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
  assistantReasoning?: string;
  functionCall: FunctionCallInfo;
  nextMessages: ChatCompletionMessage[];
  modelMessages: ChatCompletionMessage[];
}

export interface AssistantMessageResponse {
  type: 'assistant_message';
  message: {
    role: 'assistant';
    content: string;
    reasoning?: string;
    reasoning_content?: string;
  };
  functionCall?: {
    name: string;
    arguments: Record<string, unknown>;
    result?: unknown;
    toolCallId?: string;
    toolResultTruncated?: boolean;
  };
  nextMessages: ChatCompletionMessage[];
  modelMessages: ChatCompletionMessage[];
}

export interface ErrorResponse {
  type: 'error';
  error: string;
}

export type CompletionResponse =
  | FunctionProposedResponse
  | AssistantMessageResponse
  | ErrorResponse;

export type ChatCompletionStreamEvent =
  | {
      type: 'content_delta';
      delta: string;
    }
  | {
      type: 'reasoning_delta';
      delta: string;
    }
  | ({
      type: 'function_proposed';
    } & FunctionProposedResponse)
  | {
      type: 'done';
    };

interface InitialCompletionParams {
  messages: ChatCompletionMessage[];
  chatId?: string | null;
  baseUrl: string;
  tenantId: string;
  userId: string;
  uiContext?: ChatUiContext;
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
  uiContext?: ChatUiContext;
}

type ParsedToolArgumentsResult =
  | {
      ok: true;
      value: Record<string, unknown>;
    }
  | {
      ok: false;
      message: string;
    };

type FinishResponsePayload =
  | {
      ok: true;
      value: {
        message: string;
        reasoning?: string;
      };
    }
  | {
      ok: false;
      error: string;
    };

type ToolArgumentParseContext = {
  source: 'stream' | 'non_stream';
  functionName?: string;
  toolCallId?: string;
};

type StreamedToolCallState = {
  id?: string;
  name?: string;
  argumentsText: string;
};

export class ChatCompletionsService {
  private static isDebugLoggingEnabled(): boolean {
    const value = (process.env.CHAT_AGENT_DEBUG ?? '').trim().toLowerCase();
    return value === '1' || value === 'true' || value === 'yes' || value === 'on';
  }

  private static previewText(value: string | null | undefined, maxLength = 240): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    return trimmed.length <= maxLength ? trimmed : `${trimmed.slice(0, maxLength)}…`;
  }

  private static summarizeConversation(messages: ChatCompletionMessage[]) {
    const lastUserMessage = [...messages]
      .reverse()
      .find((message) => message.role === 'user' && typeof message.content === 'string');

    return {
      messageCount: messages.length,
      lastUserMessage: this.previewText(lastUserMessage?.content),
    };
  }

  private static summarizeRegistryResults(results: RegistrySearchResult[]) {
    return results.slice(0, 5).map(({ entry, score, matchedFields }) => ({
      id: entry.id,
      displayName: entry.displayName,
      method: entry.method.toUpperCase(),
      path: entry.path,
      score: Number(score.toFixed(2)),
      matchedFields,
    }));
  }

  private static logDebug(event: string, payload?: Record<string, unknown>) {
    if (!this.isDebugLoggingEnabled()) {
      return;
    }

    console.info(`[ChatCompletionsService] ${event}`, payload ?? {});
  }

  private static logWarn(event: string, payload?: Record<string, unknown>) {
    console.warn(`[ChatCompletionsService] ${event}`, payload ?? {});
  }

  static async createRawCompletionStream(
    conversation: ChatCompletionMessage[],
  ): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
    const provider = await resolveChatProvider();
    return this.generateStreamingCompletion(provider, conversation);
  }

  static async *createStructuredCompletionStream(
    messages: ChatCompletionMessage[],
    options: { signal?: AbortSignal; uiContext?: ChatUiContext; mentions?: ChatMention[] } = {},
  ): AsyncGenerator<ChatCompletionStreamEvent> {
    const provider = await resolveChatProvider();
    let conversation = this.normalizeConversationHistory(messages);
    const promptContext = await this.buildPromptContext(options.uiContext, options.mentions);

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
      if (options.signal?.aborted) {
        return;
      }

      const completionStream = await this.generateStreamingCompletion(
        provider,
        conversation,
        promptContext,
      );
      const streamedToolCalls = new Map<number, StreamedToolCallState>();
      let streamedContent = '';
      let streamedReasoning = '';

      for await (const chunk of completionStream) {
        if (options.signal?.aborted) {
          return;
        }

        const choice = chunk?.choices?.[0] as
          | OpenAI.Chat.Completions.ChatCompletionChunk.Choice
          | undefined;
        const delta = choice?.delta as Record<string, unknown> | undefined;
        if (!delta) {
          continue;
        }

        const reasoningDelta = this.readReasoningDelta(delta);
        if (reasoningDelta) {
          streamedReasoning += reasoningDelta;
          yield {
            type: 'reasoning_delta',
            delta: reasoningDelta,
          };
        }

        const contentDelta = this.readContentDelta(delta);
        if (contentDelta) {
          streamedContent += contentDelta;
        }

        this.mergeStreamedToolCalls(streamedToolCalls, delta.tool_calls);
      }

      const parsedContent = parseAssistantContent(streamedContent, streamedReasoning);
      const toolCalls = this.materializeStreamedToolCalls(streamedToolCalls);

      if (toolCalls.length > 1) {
        this.logWarn('stream_retry_multiple_tool_calls', {
          iteration,
          toolNames: toolCalls.map((toolCall) => toolCall.function?.name ?? 'unknown'),
          ...this.summarizeConversation(conversation),
        });
        conversation = this.appendToolContractRetryMessage(
          conversation,
          parsedContent,
          'The previous response called multiple functions. Retry with exactly one function call.',
        );
        continue;
      }

      if (toolCalls.length > 0) {
        const toolCall = toolCalls[0];
        const functionName = toolCall.function?.name;
        const toolCallId = toolCall.id ?? uuid();

        if (!functionName) {
          this.logWarn('stream_missing_tool_name', {
            iteration,
            ...this.summarizeConversation(conversation),
          });
          yield { type: 'done' };
          return;
        }

        const parsedArgsResult = this.parseToolArguments(toolCall.function?.arguments, {
          source: 'stream',
          functionName,
          toolCallId,
        });
        const parsedArgs = parsedArgsResult.ok ? parsedArgsResult.value : {};
        const assistantMessage = this.buildAssistantToolCallMessage(
          functionName,
          parsedContent,
          parsedArgs,
          toolCallId,
        );

        if (parsedArgsResult.ok === false) {
          const parseErrorMessage = parsedArgsResult.message;
          this.logWarn('stream_retry_invalid_tool_arguments', {
            iteration,
            functionName,
            toolCallId,
            error: parseErrorMessage,
          });
          conversation = [
            ...conversation,
            assistantMessage,
            {
              role: 'function',
              name: functionName,
              content: JSON.stringify({ error: parseErrorMessage }),
              tool_call_id: toolCallId,
            },
          ];
          continue;
        }

        if (functionName === SEARCH_TOOL_NAME) {
          this.logDebug('stream_tool_search_registry', {
            iteration,
            functionName,
            query: typeof parsedArgs.query === 'string' ? parsedArgs.query : undefined,
            limit: parsedArgs.limit,
          });
          const results = this.searchRegistry(parsedArgs.query, parsedArgs.limit);
          conversation = [
            ...conversation,
            assistantMessage,
            {
              role: 'function',
              name: SEARCH_TOOL_NAME,
              content: JSON.stringify({ results }),
              tool_call_id: toolCallId,
            },
          ];
          continue;
        }

        if (functionName === EXECUTE_TOOL_NAME) {
          conversation = [...conversation, assistantMessage];
          this.logDebug('stream_tool_execute_requested', {
            iteration,
            requestedEntryId:
              typeof (parsedArgs.entryId ?? parsedArgs.id ?? parsedArgs.name) === 'string'
                ? (parsedArgs.entryId ?? parsedArgs.id ?? parsedArgs.name)
                : undefined,
            method: typeof parsedArgs.method === 'string' ? parsedArgs.method : undefined,
            path: typeof parsedArgs.path === 'string' ? parsedArgs.path : undefined,
          });
          const entry = this.resolveRegistryEntry(
            parsedArgs.entryId ?? parsedArgs.id ?? parsedArgs.name,
            parsedArgs,
          );
          if (!entry) {
            this.logWarn('stream_tool_execute_entry_unavailable', {
              iteration,
              requestedEntryId:
                typeof (parsedArgs.entryId ?? parsedArgs.id ?? parsedArgs.name) === 'string'
                  ? (parsedArgs.entryId ?? parsedArgs.id ?? parsedArgs.name)
                  : undefined,
            });
            yield {
              type: 'content_delta',
              delta: this.buildUnavailableFunctionMessage(
                functionName,
                parsedArgs.entryId ?? parsedArgs.id ?? parsedArgs.name,
              ),
            };
            yield { type: 'done' };
            return;
          }

          const preparedArgs = { ...parsedArgs };
          this.populatePathParameters(entry, preparedArgs);
          assistantMessage.function_call!.arguments = preparedArgs;
          this.logDebug('stream_tool_execute_resolved', {
            iteration,
            entryId: entry.id,
            method: entry.method.toUpperCase(),
            path: entry.path,
          });
          const metadata = this.buildFunctionMetadata(entry, preparedArgs);
          const assistantPreview = this.buildFunctionPreview(parsedContent, entry);
          yield {
            type: 'function_proposed',
            function: metadata,
            assistantPreview,
            assistantReasoning: parsedContent.reasoning,
            functionCall: {
              name: functionName,
              arguments: preparedArgs,
              toolCallId,
              entryId: entry.id,
            },
            nextMessages: this.sanitizeMessagesForClient(conversation),
            modelMessages: conversation,
          };
          yield { type: 'done' };
          return;
        }

        if (functionName === FINISH_TOOL_NAME) {
          const finishPayload = this.parseFinishResponsePayload(parsedArgs);
          if (finishPayload.ok === false) {
            this.logWarn('stream_retry_invalid_finish_response', {
              iteration,
              toolCallId,
              error: finishPayload.error,
            });
            conversation = [
              ...conversation,
              assistantMessage,
              {
                role: 'function',
                name: FINISH_TOOL_NAME,
                content: JSON.stringify({ error: finishPayload.error }),
                tool_call_id: toolCallId,
              },
            ];
            continue;
          }

          const finalAssistantMessage = this.buildFinalAssistantMessage(
            finishPayload.value.message,
            finishPayload.value.reasoning ?? parsedContent.reasoning,
          );
          conversation = [...conversation, finalAssistantMessage];

          if (finalAssistantMessage.content) {
            yield {
              type: 'content_delta',
              delta: finalAssistantMessage.content,
            };
          }
          yield { type: 'done' };
          return;
        }

        this.logWarn('stream_unknown_tool_name', {
          iteration,
          functionName,
        });
        yield {
          type: 'content_delta',
          delta: this.buildUnavailableFunctionMessage(functionName),
        };
        yield { type: 'done' };
        return;
      }

      if (!this.hasMeaningfulContent(parsedContent)) {
        this.logWarn('stream_retry_no_meaningful_content', {
          iteration,
          contentPreview: this.previewText(parsedContent.raw),
          reasoningPreview: this.previewText(parsedContent.reasoning),
          ...this.summarizeConversation(conversation),
        });
        continue;
      }

      this.logWarn('stream_retry_plain_text_instead_of_tool', {
        iteration,
        contentPreview: this.previewText(parsedContent.raw),
        reasoningPreview: this.previewText(parsedContent.reasoning),
      });
      conversation = this.appendToolContractRetryMessage(conversation, parsedContent);
    }

    this.logWarn('stream_gave_up_after_max_iterations', {
      maxIterations: MAX_TOOL_ITERATIONS,
      ...this.summarizeConversation(conversation),
    });
    yield { type: 'done' };
  }

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
      const uiContext = this.validateUiContext((body as any)?.uiContext);

      const result = await this.initialCompletion({
        messages,
        chatId,
        baseUrl: req.nextUrl.origin,
        tenantId: user.tenant,
        userId: user.user_id,
        uiContext,
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
      const status =
        message === 'Invalid messages payload' || message === 'Invalid uiContext payload'
          ? 400
          : 500;
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
      const uiContext = this.validateUiContext((body as any)?.uiContext);

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
        uiContext,
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
        message === 'Missing function call information' ||
        message === 'Invalid messages payload' ||
        message === 'Invalid uiContext payload'
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
      uiContext: params.uiContext,
    });
  }

  private static async executeAfterApproval(params: ExecuteCompletionParams): Promise<CompletionResponse> {
    const {
      messages,
      functionCall,
      action,
      baseUrl,
      tenantId,
      userId,
      chatId: rawChatId,
      cookieHeader,
      uiContext,
    } = params;

    const chatId = rawChatId ?? null;

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
    // console.info('[ChatCompletionsService] executeAfterApproval args', entry.id, preparedArgs);

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

    const toolResultReplay = this.serializeToolResultForConversation(resultPayload);
    const functionMessage: ChatCompletionMessage = {
      role: 'function',
      name: EXECUTE_TOOL_NAME,
      content: toolResultReplay.content,
      tool_call_id: toolCallId,
    };

    const response = await this.processModelInteraction({
      messages: [...messages, functionMessage],
      chatId,
      baseUrl,
      tenantId,
      userId,
      uiContext,
    });

    if (response.type === 'assistant_message') {
      response.functionCall = {
        name: EXECUTE_TOOL_NAME,
        arguments: preparedArgs,
        result: resultPayload,
        toolCallId,
        toolResultTruncated: toolResultReplay.truncated,
      };
    }

    return response;
  }

  private static buildToolDefinitions(providerId: ChatProviderId) {
    const isVertex = providerId === 'vertex';

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
                description:
                  'Natural language description of what you want to do (e.g., "list active service categories" or "get ticket by id").',
              },
              limit: {
                type: isVertex ? 'number' : 'integer',
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
            'Invoke a documented API endpoint by its registry identifier. Include any path, query, header, or body parameters required by that endpoint. Prefer narrow list calls with limit/fields, then use detail endpoints when you have an ID. For large text fields, request byte windows with query parameters such as field_ranges[comment_text]=0-4095.',
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
                ...(isVertex ? {} : { enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] }),
              },
              path: {
                type: 'object',
                description: 'Values for path parameters, keyed by parameter name.',
                ...(isVertex ? {} : { additionalProperties: true }),
              },
              query: {
                type: 'object',
                description: 'Values for query string parameters.',
                ...(isVertex ? {} : { additionalProperties: true }),
              },
              headers: {
                type: 'object',
                description: 'Additional headers required by the endpoint.',
                ...(isVertex ? {} : { additionalProperties: true }),
              },
              body:
                isVertex
                  ? {
                      type: 'object',
                      description: 'JSON object payload for POST/PUT/PATCH requests.',
                    }
                  : {
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
            ...(isVertex ? {} : { additionalProperties: true }),
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: FINISH_TOOL_NAME,
          description:
            'Finish the current turn and provide the final user-visible response. Use this only when you are ready to answer the user without any further tool calls.',
          parameters: {
            type: 'object',
            properties: {
              message: {
                type: 'string',
                description: 'Final user-visible response for this turn.',
              },
              reasoning: {
                type: 'string',
                description:
                  'Optional concise reasoning summary to persist with the assistant response.',
              },
            },
            required: ['message'],
            ...(isVertex ? {} : { additionalProperties: false }),
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

    const resolved = (
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

    if (!resolved) {
      this.logWarn('registry_entry_not_found', {
        requestedEntryId: identifier || undefined,
        normalizedId: normalizedId || undefined,
        method,
        path,
      });
      return null;
    }

    this.logDebug('registry_entry_resolved', {
      requestedEntryId: identifier || undefined,
      resolvedEntryId: resolved.id,
      method: resolved.method.toUpperCase(),
      path: resolved.path,
    });

    return resolved;
  }

  private static searchRegistry(query: unknown, limitValue: unknown) {
    const text = typeof query === 'string' ? query.trim() : '';
    if (!text) {
      this.logWarn('registry_search_empty_query', {
        rawQueryType: typeof query,
      });
      return [];
    }

    const limit = Math.max(1, Math.min(typeof limitValue === 'number' ? limitValue : parseInt(String(limitValue ?? ''), 10) || 5, 25));
    const registry = getRegistry();
    const ranked = searchRegistryEntries(registry, text, limit);
    this.logDebug('registry_search', {
      query: text,
      limit,
      topResults: this.summarizeRegistryResults(ranked),
    });
    const top = ranked.map(({ entry }) => ({
      id: entry.id,
      displayName: entry.displayName,
      description: entry.description,
      method: entry.method.toUpperCase(),
      path: entry.path,
      approvalRequired: entry.approvalRequired,
      tags: entry.tags ?? [],
      parameters: entry.parameters ?? [],
      examples: entry.examples?.slice(0, 1) ?? [],
    }));

    return top;
  }

  private static buildAssistantToolCallMessage(
    functionName: string,
    parsedContent: ParsedAssistantContent,
    parsedArgs: Record<string, unknown>,
    toolCallId: string,
  ): ChatCompletionMessage {
    return {
      role: 'assistant',
      content: parsedContent.raw || undefined,
      reasoning: parsedContent.reasoning,
      reasoning_content: parsedContent.reasoning,
      function_call: {
        name: functionName,
        arguments: parsedArgs,
      },
      tool_call_id: toolCallId,
    };
  }

  private static buildFinalAssistantMessage(
    message: string,
    reasoning?: string,
  ): ChatCompletionMessage {
    const trimmedMessage = message.trim();
    const trimmedReasoning = reasoning?.trim();
    return {
      role: 'assistant',
      content: trimmedMessage,
      reasoning: trimmedReasoning || undefined,
      reasoning_content: trimmedReasoning || undefined,
    };
  }

  private static appendToolContractRetryMessage(
    conversation: ChatCompletionMessage[],
    parsedContent: ParsedAssistantContent,
    reason = 'The previous response was invalid because every assistant turn must be exactly one function call.',
  ): ChatCompletionMessage[] {
    const nextConversation = [...conversation];
    if (this.hasMeaningfulContent(parsedContent)) {
      nextConversation.push({
        role: 'assistant',
        content: parsedContent.raw || undefined,
        reasoning: parsedContent.reasoning,
        reasoning_content: parsedContent.reasoning,
      });
    }
    nextConversation.push({
      role: 'user',
      content:
        `${reason} Retry now with exactly one function call. ` +
        `Use ${SEARCH_TOOL_NAME} to look up registry entries, ${EXECUTE_TOOL_NAME} to propose an API call, or ${FINISH_TOOL_NAME} when you are ready to respond to the user. ` +
        `Do not send plain assistant text outside ${FINISH_TOOL_NAME}. Put the final user-visible reply in ${FINISH_TOOL_NAME}.message.`,
    });
    return nextConversation;
  }

  private static parseFinishResponsePayload(
    args: Record<string, unknown>,
  ): FinishResponsePayload {
    const message = typeof args.message === 'string' ? args.message.trim() : '';
    if (!message) {
      return {
        ok: false,
        error:
          'finish_response requires a non-empty "message" string. Retry the same function call with that property set.',
      };
    }

    const reasoning =
      typeof args.reasoning === 'string' && args.reasoning.trim().length > 0
        ? args.reasoning.trim()
        : undefined;

    return {
      ok: true,
      value: {
        message,
        reasoning,
      },
    };
  }

  private static async processModelInteraction(params: {
    messages: ChatCompletionMessage[];
    chatId: string | null;
    baseUrl: string;
    tenantId: string;
    userId: string;
    uiContext?: ChatUiContext;
  }): Promise<CompletionResponse> {
    const { messages, chatId, baseUrl, tenantId, userId, uiContext } = params;
    const provider = await resolveChatProvider();
    let conversation = this.normalizeConversationHistory(messages);
    const promptContext = await this.buildPromptContext(uiContext);

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
      let completion: OpenAI.Chat.Completions.ChatCompletion;
      let choice: OpenAI.Chat.Completions.ChatCompletion.Choice | undefined;
      let parsedContent: ParsedAssistantContent;
      let toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = [];

      try {
        ({ completion, choice, parsedContent, toolCalls } =
          await this.generateCompletionWithRetry(provider, conversation, promptContext));
      } catch (error) {
        if (error instanceof Error) {
          if (error.message === EMPTY_RESPONSE_ERROR) {
            return {
              type: 'error',
              error: 'The assistant did not return a response. Please try again.',
            };
          }
          if (error.message === NO_MODEL_CHOICES_ERROR) {
            return {
              type: 'error',
              error: 'The model returned no choices.',
            };
          }
        }
        throw error;
      }

      if (toolCalls.length > 1) {
        this.logWarn('retry_multiple_tool_calls', {
          iteration,
          toolNames: toolCalls.map((toolCall) => toolCall.function?.name ?? 'unknown'),
          ...this.summarizeConversation(conversation),
        });
        conversation = this.appendToolContractRetryMessage(
          conversation,
          parsedContent,
          'The previous response called multiple functions. Retry with exactly one function call.',
        );
        continue;
      }

      if (toolCalls.length > 0) {
        const toolCall = toolCalls[0];
        const functionName = toolCall.function?.name;
        const toolCallId = toolCall.id ?? uuid();

        if (!functionName) {
          this.logWarn('missing_tool_name', {
            iteration,
            ...this.summarizeConversation(conversation),
          });
          return {
            type: 'error',
            error: 'The assistant attempted to call an unknown function.',
          };
        }

        const parsedArgsResult = this.parseToolArguments(toolCall.function?.arguments, {
          source: 'non_stream',
          functionName,
          toolCallId,
        });
        const parsedArgs = parsedArgsResult.ok ? parsedArgsResult.value : {};
        const assistantMessage = this.buildAssistantToolCallMessage(
          functionName,
          parsedContent,
          parsedArgs,
          toolCallId,
        );

        if (parsedArgsResult.ok === false) {
          const parseErrorMessage = parsedArgsResult.message;
          this.logWarn('retry_invalid_tool_arguments', {
            iteration,
            functionName,
            toolCallId,
            error: parseErrorMessage,
          });
          const functionMessage: ChatCompletionMessage = {
            role: 'function',
            name: functionName,
            content: JSON.stringify({ error: parseErrorMessage }),
            tool_call_id: toolCallId,
          };
          conversation = [...conversation, assistantMessage, functionMessage];
          continue;
        }

        if (functionName === SEARCH_TOOL_NAME) {
          this.logDebug('tool_search_registry', {
            iteration,
            functionName,
            query: typeof parsedArgs.query === 'string' ? parsedArgs.query : undefined,
            limit: parsedArgs.limit,
          });
          const results = this.searchRegistry(parsedArgs.query, parsedArgs.limit);
          const functionMessage: ChatCompletionMessage = {
            role: 'function',
            name: SEARCH_TOOL_NAME,
            content: JSON.stringify({ results }),
            tool_call_id: toolCallId,
          };
          conversation = [...conversation, assistantMessage, functionMessage];
          continue;
        }

        if (functionName === EXECUTE_TOOL_NAME) {
          conversation = [...conversation, assistantMessage];
          this.logDebug('tool_execute_requested', {
            iteration,
            requestedEntryId:
              typeof (parsedArgs.entryId ?? parsedArgs.id ?? parsedArgs.name) === 'string'
                ? (parsedArgs.entryId ?? parsedArgs.id ?? parsedArgs.name)
                : undefined,
            method: typeof parsedArgs.method === 'string' ? parsedArgs.method : undefined,
            path: typeof parsedArgs.path === 'string' ? parsedArgs.path : undefined,
          });
          const entry = this.resolveRegistryEntry(
            parsedArgs.entryId ?? parsedArgs.id ?? parsedArgs.name,
            parsedArgs,
          );
          if (!entry) {
            this.logWarn('tool_execute_entry_unavailable', {
              iteration,
              requestedEntryId:
                typeof (parsedArgs.entryId ?? parsedArgs.id ?? parsedArgs.name) === 'string'
                  ? (parsedArgs.entryId ?? parsedArgs.id ?? parsedArgs.name)
                  : undefined,
            });
            return {
              type: 'error',
              error: `Function ${parsedArgs.entryId ?? functionName} is not available.`,
            };
          }

          const preparedArgs = { ...parsedArgs };
          this.populatePathParameters(entry, preparedArgs);
          assistantMessage.function_call!.arguments = preparedArgs;
          this.logDebug('tool_execute_resolved', {
            iteration,
            entryId: entry.id,
            method: entry.method.toUpperCase(),
            path: entry.path,
          });
          const metadata = this.buildFunctionMetadata(entry, preparedArgs);
          const assistantPreview = this.buildFunctionPreview(parsedContent, entry);
          return {
            type: 'function_proposed',
            function: metadata,
            assistantPreview,
            assistantReasoning: parsedContent.reasoning,
            functionCall: {
              name: functionName,
              arguments: preparedArgs,
              toolCallId,
              entryId: entry.id,
            },
            nextMessages: this.sanitizeMessagesForClient(conversation),
            modelMessages: conversation,
          };
        }

        if (functionName === FINISH_TOOL_NAME) {
          const finishPayload = this.parseFinishResponsePayload(parsedArgs);
          if (finishPayload.ok === false) {
            this.logWarn('retry_invalid_finish_response', {
              iteration,
              toolCallId,
              error: finishPayload.error,
            });
            conversation = [
              ...conversation,
              assistantMessage,
              {
                role: 'function',
                name: FINISH_TOOL_NAME,
                content: JSON.stringify({ error: finishPayload.error }),
                tool_call_id: toolCallId,
              },
            ];
            continue;
          }

          const finalAssistantMessage = this.buildFinalAssistantMessage(
            finishPayload.value.message,
            finishPayload.value.reasoning ?? parsedContent.reasoning,
          );
          const nextMessages = [...conversation, finalAssistantMessage];

          return {
            type: 'assistant_message',
            message: {
              role: 'assistant',
              content: finalAssistantMessage.content ?? '',
              reasoning: finalAssistantMessage.reasoning,
              reasoning_content: finalAssistantMessage.reasoning_content,
            },
            nextMessages: this.sanitizeMessagesForClient(nextMessages),
            modelMessages: nextMessages,
          };
        }

        this.logWarn('unknown_tool_name', {
          iteration,
          functionName,
        });
        return {
          type: 'error',
          error: `Function ${functionName} is not available.`,
        };
      }

      if (!this.hasMeaningfulContent(parsedContent)) {
        this.logWarn('retry_no_meaningful_content', {
          iteration,
          contentPreview: this.previewText(parsedContent.raw),
          reasoningPreview: this.previewText(parsedContent.reasoning),
          ...this.summarizeConversation(conversation),
        });
        continue;
      }

      this.logWarn('retry_plain_text_instead_of_tool', {
        iteration,
        contentPreview: this.previewText(parsedContent.raw),
        reasoningPreview: this.previewText(parsedContent.reasoning),
      });
      conversation = this.appendToolContractRetryMessage(conversation, parsedContent);
    }

    this.logWarn('gave_up_after_max_iterations', {
      maxIterations: MAX_TOOL_ITERATIONS,
      ...this.summarizeConversation(conversation),
    });
    return {
      type: 'error',
      error: 'The assistant produced too many invalid or incomplete tool turns without completing the task.',
    };
  }

  private static validateMessages(raw: unknown): ChatCompletionMessage[] {
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new Error('Invalid messages payload');
    }

    return raw.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error('Invalid messages payload');
      }

      const messageRecord = item as Record<string, unknown>;
      const role = messageRecord.role;
      if (role !== 'user' && role !== 'assistant' && role !== 'function') {
        throw new Error('Invalid messages payload');
      }

      const message: ChatCompletionMessage = {
        role,
      };

      if (role === 'function') {
        message.name = this.readOptionalStringField(messageRecord, 'name');
        message.content = this.readOptionalStringField(messageRecord, 'content');
        message.tool_call_id = this.readOptionalStringField(messageRecord, 'tool_call_id');
        if (!message.name) {
          throw new Error('Invalid messages payload');
        }
        return message;
      }

      message.content = this.readOptionalStringField(messageRecord, 'content');
      message.reasoning = this.readOptionalStringField(messageRecord, 'reasoning');
      message.reasoning_content = this.readOptionalStringField(
        messageRecord,
        'reasoning_content',
      );
      if (!message.reasoning_content && message.reasoning) {
        message.reasoning_content = message.reasoning;
      }
      if (!message.reasoning && message.reasoning_content) {
        message.reasoning = message.reasoning_content;
      }

      if (messageRecord.function_call !== undefined) {
        if (
          !messageRecord.function_call ||
          typeof messageRecord.function_call !== 'object' ||
          Array.isArray(messageRecord.function_call)
        ) {
          throw new Error('Invalid messages payload');
        }

        const fn = messageRecord.function_call as Record<string, unknown>;
        if (typeof fn.name !== 'string') {
          throw new Error('Invalid messages payload');
        }
        message.function_call = {
          name: fn.name,
          arguments: this.ensureArguments(fn.arguments),
        };
        message.tool_call_id = this.readOptionalStringField(messageRecord, 'tool_call_id');
      }

      return message;
    });
  }

  private static validateUiContext(raw: unknown): ChatUiContext | undefined {
    if (raw === undefined || raw === null) {
      return undefined;
    }

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('Invalid uiContext payload');
    }

    const record = raw as Record<string, unknown>;
    const pathname = this.readOptionalUiContextStringField(record, 'pathname');
    const screenRaw = record.screen;
    if (!pathname || !screenRaw || typeof screenRaw !== 'object' || Array.isArray(screenRaw)) {
      throw new Error('Invalid uiContext payload');
    }

    const screenRecord = screenRaw as Record<string, unknown>;
    const screenKey = this.readOptionalUiContextStringField(screenRecord, 'key');
    const screenLabel = this.readOptionalUiContextStringField(screenRecord, 'label');
    if (!screenKey || !screenLabel) {
      throw new Error('Invalid uiContext payload');
    }

    let uiContextRecord: ChatUiContextRecord | undefined;
    if (record.record !== undefined) {
      const recordRaw = record.record;
      if (!recordRaw || typeof recordRaw !== 'object' || Array.isArray(recordRaw)) {
        throw new Error('Invalid uiContext payload');
      }
      const recordValue = recordRaw as Record<string, unknown>;
      const type = this.readOptionalUiContextStringField(recordValue, 'type');
      const id = this.readOptionalUiContextStringField(recordValue, 'id');
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
      uiContextRecord = { type, id };
    }

    return {
      pathname,
      screen: {
        key: screenKey,
        label: screenLabel,
      },
      ...(uiContextRecord ? { record: uiContextRecord } : {}),
    };
  }

  private static readOptionalUiContextStringField(
    record: Record<string, unknown>,
    key: string,
  ): string | undefined {
    if (!(key in record) || record[key] === undefined) {
      return undefined;
    }
    if (typeof record[key] !== 'string') {
      throw new Error('Invalid uiContext payload');
    }
    const value = (record[key] as string).trim();
    return value.length > 0 ? value : undefined;
  }

  private static readOptionalStringField(
    record: Record<string, unknown>,
    key: string,
  ): string | undefined {
    if (!(key in record) || record[key] === undefined) {
      return undefined;
    }
    if (typeof record[key] !== 'string') {
      throw new Error('Invalid messages payload');
    }
    return record[key] as string;
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

  private static parseToolArguments(
    args: unknown,
    context: ToolArgumentParseContext,
  ): ParsedToolArgumentsResult {
    if (!args) {
      return {
        ok: true,
        value: {},
      };
    }

    if (typeof args === 'object' && !Array.isArray(args)) {
      return {
        ok: true,
        value: args as Record<string, unknown>,
      };
    }

    if (typeof args === 'string') {
      try {
        const parsed = JSON.parse(args);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          this.logToolArgumentParseFailure(
            context,
            args,
            'Tool arguments parsed successfully but were not a JSON object.',
          );
          return {
            ok: false,
            message:
              'Tool arguments must be a valid JSON object. Retry the same function call with a JSON object only.',
          };
        }
        return {
          ok: true,
          value: parsed as Record<string, unknown>,
        };
      } catch (error) {
        this.logToolArgumentParseFailure(
          context,
          args,
          error instanceof Error ? error.message : String(error),
          error,
        );
        const likelyTruncated =
          context.source === 'stream' && this.isLikelyTruncatedJsonObjectString(args);
        return {
          ok: false,
          message: likelyTruncated
            ? `Tool arguments appeared truncated during streaming and were not a complete JSON object. Retry the same function call with the full JSON object only. Raw arguments preview: ${JSON.stringify(
                args.slice(0, INVALID_TOOL_ARGUMENTS_PREVIEW_CHARS),
              )}`
            : `Tool arguments were invalid JSON. Retry the same function call with a valid JSON object only. Raw arguments preview: ${JSON.stringify(
                args.slice(0, INVALID_TOOL_ARGUMENTS_PREVIEW_CHARS),
              )}`,
        };
      }
    }

    return {
      ok: false,
      message:
        'Tool arguments must be a valid JSON object. Retry the same function call with a JSON object only.',
    };
  }

  private static isLikelyTruncatedJsonObjectString(args: string): boolean {
    const trimmed = args.trim();
    if (!trimmed.startsWith('{')) {
      return false;
    }

    let inString = false;
    let escaped = false;
    const stack: string[] = [];

    for (const char of trimmed) {
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === '\\') {
          escaped = true;
          continue;
        }
        if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === '{' || char === '[') {
        stack.push(char);
        continue;
      }

      if (char === '}' || char === ']') {
        const expected = char === '}' ? '{' : '[';
        const open = stack.pop();
        if (open !== expected) {
          return false;
        }
      }
    }

    if (inString || escaped || stack.length > 0) {
      return true;
    }

    return trimmed.endsWith(':') || trimmed.endsWith(',');
  }

  private static logToolArgumentParseFailure(
    context: ToolArgumentParseContext,
    rawArguments: unknown,
    failure: string,
    error?: unknown,
  ) {
    console.error(
      '[ChatCompletionsService] Failed to parse tool arguments',
      {
        source: context.source,
        functionName: context.functionName ?? null,
        toolCallId: context.toolCallId ?? null,
        rawArguments,
        rawArgumentsLength: typeof rawArguments === 'string' ? rawArguments.length : null,
        failure,
      },
      error,
    );
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

  private static formatUserFullName(user: Awaited<ReturnType<typeof getCurrentUser>>) {
    if (!user) {
      return null;
    }

    const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
    if (fullName.length > 0) {
      return fullName;
    }

    return user.username || user.email || user.user_id;
  }

  private static getCurrentDateTimeContext() {
    const now = new Date();
    const timezone = new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const formatted = new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timezone,
      timeZoneName: 'short',
    }).format(now);

    return {
      formatted,
      timezone,
    };
  }

  private static async resolveRecordDescription(
    record: ChatUiContextRecord | undefined,
  ): Promise<{ type: ChatUiContextRecord['type']; id: string; description: string } | null> {
    if (!record) {
      return null;
    }

    try {
      switch (record.type) {
        case 'ticket': {
          const ticket = await getTicketById(record.id);
          if (!ticket) {
            return null;
          }
          const description = [ticket.ticket_number ? `#${ticket.ticket_number}` : null, ticket.title]
            .filter(Boolean)
            .join(' - ');
          return {
            type: record.type,
            id: record.id,
            description: description || record.id,
          };
        }
        case 'project': {
          const project = await getProject(record.id);
          if (!project || !('project_name' in project)) {
            return null;
          }
          return {
            type: record.type,
            id: record.id,
            description: project.project_name || record.id,
          };
        }
        case 'client': {
          const client = await getClientById(record.id);
          if (!client) {
            return null;
          }
          return {
            type: record.type,
            id: record.id,
            description: client.client_name || record.id,
          };
        }
        case 'contact': {
          const contact = await getContactByContactNameId(record.id);
          if (!contact) {
            return null;
          }
          return {
            type: record.type,
            id: record.id,
            description: contact.full_name || record.id,
          };
        }
        case 'asset': {
          const bundle = await getAssetDetailBundle(record.id);
          if (!bundle.asset) {
            return null;
          }
          return {
            type: record.type,
            id: record.id,
            description: bundle.asset.name || record.id,
          };
        }
        default:
          return null;
      }
    } catch (error) {
      console.warn('[ChatCompletionsService] Failed to resolve uiContext record', {
        recordType: record.type,
        recordId: record.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private static async resolveMentionedEntities(
    mentions: ChatMention[],
  ): Promise<string[]> {
    const results = await Promise.allSettled(
      mentions.map(async (mention) => {
        switch (mention.type) {
          case 'ticket': {
            const [ticket, comments] = await Promise.all([
              getTicketById(mention.id),
              findCommentsByTicketId(mention.id).catch(() => []),
            ]);
            if (!ticket) return null;
            const t = ticket as any;
            const lines: string[] = [];
            lines.push(`[Ticket] #${ticket.ticket_number} - ${ticket.title || 'Untitled'}`);
            lines.push(`  ticket_id: ${ticket.ticket_id}`);
            lines.push(`  status: ${t.status_name || 'unknown'} (status_id: ${ticket.status_id})${t.is_closed ? ' [CLOSED]' : ''}`);
            lines.push(`  priority: ${t.priority_name || 'unknown'}${ticket.priority_id ? ` (priority_id: ${ticket.priority_id})` : ''}`);
            lines.push(`  board: ${t.board_name || 'unknown'} (board_id: ${ticket.board_id})`);
            lines.push(`  client: ${t.client_name || 'unknown'}${ticket.client_id ? ` (client_id: ${ticket.client_id})` : ''}`);
            lines.push(`  contact: ${t.contact_name || 'none'}${ticket.contact_name_id ? ` (contact_name_id: ${ticket.contact_name_id})` : ''}`);
            lines.push(`  assigned_to: ${t.assigned_to_name || 'unassigned'}${ticket.assigned_to ? ` (user_id: ${ticket.assigned_to})` : ''}`);
            lines.push(`  entered_by: ${ticket.entered_by}`);
            lines.push(`  entered_at: ${ticket.entered_at || 'unknown'}`);
            if (ticket.updated_at) lines.push(`  updated_at: ${ticket.updated_at}`);
            if (ticket.closed_at) lines.push(`  closed_at: ${ticket.closed_at}`);
            if (ticket.due_date) lines.push(`  due_date: ${ticket.due_date}`);
            if (ticket.estimated_hours) lines.push(`  estimated_hours: ${ticket.estimated_hours}`);
            if (ticket.category_id) lines.push(`  category_id: ${ticket.category_id}`);
            if (ticket.subcategory_id) lines.push(`  subcategory_id: ${ticket.subcategory_id}`);
            if (ticket.response_state) lines.push(`  response_state: ${ticket.response_state}`);
            if (ticket.url) lines.push(`  description/url: ${ticket.url}`);
            if (t.additionalAgents?.length) {
              lines.push(`  additional_agents: ${t.additionalAgents.map((a: any) => a.name || a.user_id).join(', ')}`);
            }
            if (ticket.tags?.length) {
              lines.push(`  tags: ${ticket.tags.map((tag: any) => tag.tag_text || tag.tag_name || tag).join(', ')}`);
            }
            // Comments
            if (comments && Array.isArray(comments) && comments.length > 0) {
              lines.push(`  comments (${comments.length} total):`);
              // Include most recent comments, limit to keep prompt reasonable
              const recentComments = comments.slice(-15);
              for (const c of recentComments) {
                const internal = c.is_internal ? ' [internal]' : '';
                const resolution = c.is_resolution ? ' [resolution]' : '';
                const author = c.author_type || 'unknown';
                const date = c.created_at || '';
                // Prefer markdown_content (clean text) over note (verbose BlockNote JSON)
                let noteText = c.markdown_content || '';
                if (!noteText || noteText === '[No content]' || noteText === '[No markdown content]') {
                  // Fall back to extracting text from BlockNote JSON in note
                  const raw = c.note || '';
                  if (raw.startsWith('[{') || raw.startsWith('[')) {
                    try {
                      const blocks = JSON.parse(raw);
                      noteText = blocks.map((b: any) => {
                        if (typeof b === 'string') return b;
                        const content = b.content;
                        if (!content) return '';
                        return content.map((ic: any) => ic.text || '').join('');
                      }).filter(Boolean).join('\n');
                    } catch {
                      noteText = raw.slice(0, 300);
                    }
                  } else {
                    noteText = raw;
                  }
                }
                // Truncate very long comments
                if (noteText.length > 500) {
                  noteText = noteText.slice(0, 500) + '...';
                }
                lines.push(`    [${date}] (${author}${internal}${resolution}): ${noteText}`);
              }
              if (comments.length > 15) {
                lines.push(`    ... and ${comments.length - 15} earlier comments`);
              }
            }
            return lines.join('\n');
          }
          case 'client': {
            const client = await getClientById(mention.id);
            if (!client) return null;
            const c = client as any;
            const lines: string[] = [];
            lines.push(`[Client] ${client.client_name}`);
            lines.push(`  client_id: ${client.client_id}`);
            lines.push(`  type: ${client.client_type || 'unknown'}`);
            lines.push(`  active: ${!client.is_inactive}`);
            if (c.location_email || client.email) lines.push(`  email: ${c.location_email || client.email}`);
            if (c.location_phone || client.phone_no) lines.push(`  phone: ${c.location_phone || client.phone_no}`);
            if (c.location_address || client.address) lines.push(`  address: ${c.location_address || client.address}`);
            if (client.city || client.state) lines.push(`  city/state: ${[client.city, client.state, client.zip].filter(Boolean).join(', ')}`);
            if (client.country) lines.push(`  country: ${client.country}`);
            if (c.account_manager_full_name) lines.push(`  account_manager: ${c.account_manager_full_name}${client.account_manager_id ? ` (user_id: ${client.account_manager_id})` : ''}`);
            if (client.payment_terms) lines.push(`  payment_terms: ${client.payment_terms}`);
            if (client.billing_cycle) lines.push(`  billing_cycle: ${client.billing_cycle}`);
            if (client.tax_region) lines.push(`  tax_region: ${client.tax_region}`);
            if (client.is_tax_exempt) lines.push(`  tax_exempt: true`);
            if (client.credit_balance) lines.push(`  credit_balance: ${client.credit_balance}`);
            if (client.notes) lines.push(`  notes: ${client.notes.slice(0, 300)}`);
            if (client.tags?.length) {
              lines.push(`  tags: ${client.tags.map((tag: any) => tag.tag_text || tag.tag_name || tag).join(', ')}`);
            }
            return lines.join('\n');
          }
          case 'contact': {
            const contact = await getContactByContactNameId(mention.id);
            if (!contact) return null;
            const lines: string[] = [];
            lines.push(`[Contact] ${contact.full_name}`);
            lines.push(`  contact_name_id: ${contact.contact_name_id}`);
            if (contact.email) lines.push(`  email: ${contact.email}`);
            if (contact.role) lines.push(`  role: ${contact.role}`);
            if (contact.client_id) lines.push(`  client_id: ${contact.client_id}`);
            if ((contact as any).client_name) lines.push(`  client: ${(contact as any).client_name}`);
            if (contact.phone_numbers?.length) {
              const defaultPhone = contact.phone_numbers.find((p) => p.is_default) || contact.phone_numbers[0];
              if (defaultPhone) lines.push(`  phone: ${defaultPhone.phone_number} (${defaultPhone.canonical_type || defaultPhone.custom_type || 'primary'})`);
            }
            if (contact.additional_email_addresses?.length) {
              lines.push(`  additional_emails: ${contact.additional_email_addresses.map((e) => e.email_address).join(', ')}`);
            }
            lines.push(`  active: ${!contact.is_inactive}`);
            if (contact.notes) lines.push(`  notes: ${contact.notes.slice(0, 300)}`);
            if (contact.tags?.length) {
              lines.push(`  tags: ${contact.tags.map((tag: any) => tag.tag_text || tag.tag_name || tag).join(', ')}`);
            }
            return lines.join('\n');
          }
          case 'project': {
            const project = await getProject(mention.id);
            if (!project || !('project_name' in project)) return null;
            const p = project as any;
            const lines: string[] = [];
            lines.push(`[Project] ${project.project_name}`);
            lines.push(`  project_id: ${project.project_id}`);
            lines.push(`  project_number: ${project.project_number || 'none'}`);
            lines.push(`  status: ${p.status_name || project.status || 'unknown'}${p.is_closed ? ' [CLOSED]' : ''}`);
            if (project.client_id) lines.push(`  client_id: ${project.client_id}`);
            if (p.client_name) lines.push(`  client: ${p.client_name}`);
            if (project.description) lines.push(`  description: ${project.description.slice(0, 500)}`);
            if (project.start_date) lines.push(`  start_date: ${project.start_date}`);
            if (project.end_date) lines.push(`  end_date: ${project.end_date}`);
            if (project.budgeted_hours) lines.push(`  budgeted_hours: ${project.budgeted_hours}`);
            if (project.wbs_code) lines.push(`  wbs_code: ${project.wbs_code}`);
            if (project.assigned_to) lines.push(`  assigned_to: ${project.assigned_to}`);
            if (p.contact_name) lines.push(`  contact: ${p.contact_name}${p.contact_name_id ? ` (contact_name_id: ${p.contact_name_id})` : ''}`);
            if (project.tags?.length) {
              lines.push(`  tags: ${project.tags.map((tag: any) => tag.tag_text || tag.tag_name || tag).join(', ')}`);
            }
            return lines.join('\n');
          }
          case 'asset': {
            const bundle = await getAssetDetailBundle(mention.id);
            if (!bundle.asset) return null;
            const asset = bundle.asset as any;
            const lines: string[] = [];
            lines.push(`[Asset] ${asset.name}${asset.asset_tag ? ` (${asset.asset_tag})` : ''}`);
            lines.push(`  asset_id: ${asset.asset_id}`);
            lines.push(`  type: ${asset.asset_type || 'unknown'}`);
            lines.push(`  status: ${asset.status || 'unknown'}`);
            if (asset.serial_number) lines.push(`  serial_number: ${asset.serial_number}`);
            if (asset.client_id) lines.push(`  client_id: ${asset.client_id}`);
            if (asset.client_name) lines.push(`  client: ${asset.client_name}`);
            if (asset.location) lines.push(`  location: ${asset.location}`);
            if (asset.manufacturer) lines.push(`  manufacturer: ${asset.manufacturer}`);
            if (asset.model) lines.push(`  model: ${asset.model}`);
            if (asset.purchase_date) lines.push(`  purchase_date: ${asset.purchase_date}`);
            if (asset.warranty_end_date) lines.push(`  warranty_end_date: ${asset.warranty_end_date}`);
            if (bundle.tickets?.length) {
              lines.push(`  linked_tickets (${bundle.tickets.length}): ${bundle.tickets.slice(0, 5).map((t: any) => `#${t.ticket_number || t.ticket_id}`).join(', ')}${bundle.tickets.length > 5 ? '...' : ''}`);
            }
            if (bundle.maintenanceReport) {
              const mr = bundle.maintenanceReport as any;
              if (mr.total_maintenance_count) lines.push(`  total_maintenance_records: ${mr.total_maintenance_count}`);
            }
            return lines.join('\n');
          }
          case 'user': {
            const u = await findUserById(mention.id);
            if (!u) return null;
            const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
            const lines: string[] = [];
            lines.push(`[User] ${fullName || u.username || u.email}`);
            lines.push(`  user_id: ${u.user_id}`);
            lines.push(`  email: ${u.email || 'unknown'}`);
            if (u.username) lines.push(`  username: ${u.username}`);
            if (u.phone) lines.push(`  phone: ${u.phone}`);
            if (u.user_type) lines.push(`  user_type: ${u.user_type}`);
            lines.push(`  active: ${!u.is_inactive}`);
            if (u.roles?.length) {
              lines.push(`  roles: ${u.roles.map((r) => r.role_name).join(', ')}`);
            }
            if (u.timezone) lines.push(`  timezone: ${u.timezone}`);
            if (u.reports_to) lines.push(`  reports_to: ${u.reports_to}`);
            return lines.join('\n');
          }
          default:
            return null;
        }
      }),
    );

    return results
      .filter((r): r is PromiseFulfilledResult<string | null> => r.status === 'fulfilled')
      .map((r) => r.value)
      .filter((v): v is string => v !== null);
  }

  private static async buildPromptContext(uiContext?: ChatUiContext, mentions?: ChatMention[]): Promise<string | null> {
    const user = await getCurrentUser();
    if (!user || !user.user_id) {
      return null;
    }

    const lines = ['Current app context:'];
    const { formatted, timezone } = this.getCurrentDateTimeContext();
    lines.push(`- Current date/time: ${formatted} | timezone: ${timezone}`);
    lines.push(
      `- Current user: ${this.formatUserFullName(user)} | email: ${user.email} | user_id: ${user.user_id}`,
    );

    if (uiContext?.screen?.label) {
      const pathValue = uiContext.pathname || 'unknown';
      lines.push(
        `- Current screen: ${uiContext.screen.label} | key: ${uiContext.screen.key} | pathname: ${pathValue}`,
      );
    }

    const record = await this.resolveRecordDescription(uiContext?.record);
    if (record) {
      lines.push(
        `- Active record: ${record.type} | id: ${record.id} | description: ${record.description}`,
      );
      lines.push(
        `- Reference resolution: treat phrases like "this ${record.type}" or "the current ${record.type}" as the active record above unless the user clearly says otherwise.`,
      );
    }

    if (mentions && mentions.length > 0) {
      const entityLines = await this.resolveMentionedEntities(mentions);
      if (entityLines.length > 0) {
        lines.push('');
        lines.push('IMPORTANT — The following entities were explicitly mentioned by the user via @mentions. Their full details have already been fetched and are provided below. DO NOT call any API endpoints to look up or re-fetch these entities. Use the data below directly in your response.');
        lines.push('');
        lines.push(...entityLines);
        lines.push('');
        lines.push('Rules for mentioned entities:');
        lines.push('- You ALREADY HAVE all the data for these entities above. DO NOT call List Contacts, List Clients, or any search/list endpoint to find them again.');
        lines.push('- The IDs provided (ticket_id, client_id, contact_name_id, project_id, asset_id, user_id) are real UUIDs. Use them directly if you need to perform actions (update, close, assign, etc.) via API calls.');
        lines.push('- Only re-fetch an entity if the user explicitly asks for "latest", "refreshed", or "updated" data.');
        lines.push('- For tickets with comments, consider the conversation history when answering questions about the ticket status, issues, or resolution.');
      }
    }

    return lines.join('\n');
  }

  private static buildOpenAiMessages(
    messages: ChatCompletionMessage[],
    providerId: ChatProviderId,
    promptContext?: string | null,
  ) {
    const systemPrompt = {
      role: 'system' as const,
      content:
        'You are Alga, an assistant that helps users manage PSA workflows. ' +
        `Every assistant turn must contain exactly one function call: ${SEARCH_TOOL_NAME}, ${EXECUTE_TOOL_NAME}, or ${FINISH_TOOL_NAME}. ` +
        `Do not return plain assistant text without a function call. When you are ready to answer the user, call ${FINISH_TOOL_NAME} and put the final user-visible reply in ${FINISH_TOOL_NAME}.message. ` +
        'Always consult the enterprise API registry before executing actions so you understand every required parameter. ' +
        'When the registry or endpoint descriptions mention prerequisite data (such as IDs for boards, clients, categories, priorities, or other related resources): for write operations (create, update, delete), proactively call the appropriate lookup endpoints to gather that information instead of asking the user; for read operations (list, get), call the endpoint directly and only look up prerequisite data if the user explicitly asks to filter by it. ' +
        'For ticket-creation calls, first use search_api_registry to locate the list endpoints you need, gather current data (e.g. call GET /api/v1/tickets to sample board_id/status_id/priority_id combinations and GET /api/v1/clients to confirm client_id), and do not proceed until you have concrete UUIDs for board_id, client_id, status_id, and priority_id collected from prior API responses. When sampling GET /api/v1/tickets, pick the first record with non-null board_id, status_id, and priority_id and reuse those UUIDs unless the user specifies different values. ' +
        'Never invent field names for a fields query parameter. Only send fields values that are explicitly documented in the registry description, parameters, or examples for that exact endpoint. If the registry does not enumerate exact field names, omit fields entirely. For GET /api/v1/tickets specifically, the only valid fields values are ticket_id, ticket_number, title, status_id, status_name, status_is_closed, priority_name, assigned_to_name, client_name, contact_name, updated_at, entered_at, closed_at, and mobile_list. Do not use aliases like id, subject, status, priority, client, created_at, or description. ' +
        'When you only need discovery data, prefer list endpoints with small limits and explicit fields instead of full payloads. Once you have a resource ID, prefer the detail endpoint over repeatedly expanding list responses. ' +
        'Some GET endpoints support field-scoped range retrieval for large text fields. When an endpoint description mentions field_ranges support or a response meta.truncated_fields map indicates truncation, continue fetching with query parameters like field_ranges[comment_text]=0-4095 or field=description_html&range=4096-8191. Treat those ranges as UTF-8 byte windows and use the returned meta.truncated_fields metadata to continue from the correct byte offsets. ' +
        'Clearly explain the plan before each tool call, execute the necessary lookup calls to satisfy all requirements, then call the target endpoint once the inputs are ready. ' +
        'Use the documented request schemas exactly as written—populate *_id fields with the UUIDs you retrieved (never human-friendly names), and skip optional fields when you do not have authoritative values. ' +
        'Never include properties that are not defined for the selected endpoint; if the user mentions data that cannot be expressed with the documented schema (for example a project name when the ticket create payload does not accept project_id), acknowledge it in the natural-language response but leave it out of the API request. ' +
        'When reading ticket comments, always pass content_format=markdown as a query parameter. This returns compact responses with only markdown_content (readable text) and metadata, instead of the large BlockNote JSON in comment_text. Never use field_ranges on comment_text — use content_format=markdown instead. ' +
        'When handling documents, do not assume null file_id means empty content; in-app documents may store content in document_block_content or document_content. Call GET /api/documents/{documentId}/content to retrieve readable content before concluding the document has no data. ' +
        'Do not create or modify unrelated master data (such as categories, boards, or projects) unless the user explicitly asks for that; prefer reusing existing records you just looked up. ' +
        'When users ask questions that could be answered by internal documentation (e.g. how-to questions, troubleshooting, process questions), proactively search the knowledge base using GET /api/v1/kb-articles with a relevant search query. If matching articles are found, read their content with GET /api/v1/kb-articles/{id}/content and use that information in your response. When creating KB articles from resolved tickets, use POST /api/v1/kb-articles/from-ticket/{ticketId} and then review the generated content. ' +
        'After a function result is provided, summarize the outcome for the user and outline any follow-up you will handle automatically.' +
        (promptContext ? `\n\n${promptContext}` : ''),
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
        const assistantMessage: Record<string, unknown> = {
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
        if (
          providerId === 'vertex' &&
          typeof message.reasoning_content === 'string' &&
          message.reasoning_content.trim().length > 0
        ) {
          assistantMessage.reasoning_content = message.reasoning_content;
        }
        return assistantMessage;
      }

      if (message.role === 'assistant') {
        const assistantMessage: Record<string, unknown> = {
          role: message.role,
          content: message.content ?? '',
        };
        if (
          providerId === 'vertex' &&
          typeof message.reasoning_content === 'string' &&
          message.reasoning_content.trim().length > 0
        ) {
          assistantMessage.reasoning_content = message.reasoning_content;
        }
        return assistantMessage;
      }

      return {
        role: message.role,
        content: message.content ?? '',
      };
    });

    return [systemPrompt, ...converted];
  }

  private static readReasoningDelta(delta: Record<string, unknown>): string {
    const parsed = parseAssistantContent(
      '',
      delta.reasoning_content ?? delta.reasoning,
    );
    return parsed.reasoning ?? '';
  }

  private static readContentDelta(delta: Record<string, unknown>): string {
    const content = delta.content;
    if (typeof content === 'string') {
      return content;
    }
    if (content === undefined || content === null) {
      return '';
    }
    return parseAssistantContent(content, undefined).display;
  }

  private static mergeStreamedToolCalls(
    streamedToolCalls: Map<number, StreamedToolCallState>,
    toolCallsDelta: unknown,
  ) {
    if (!Array.isArray(toolCallsDelta)) {
      return;
    }

    toolCallsDelta.forEach((candidate, fallbackIndex) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        return;
      }
      const toolCall = candidate as Record<string, unknown>;
      const index = typeof toolCall.index === 'number' ? toolCall.index : fallbackIndex;
      const existing = streamedToolCalls.get(index) ?? {
        argumentsText: '',
      };

      if (typeof toolCall.id === 'string') {
        existing.id = toolCall.id;
      }

      if (
        toolCall.function &&
        typeof toolCall.function === 'object' &&
        !Array.isArray(toolCall.function)
      ) {
        const fn = toolCall.function as Record<string, unknown>;
        if (typeof fn.name === 'string') {
          existing.name = fn.name;
        }
        if (typeof fn.arguments === 'string') {
          existing.argumentsText += fn.arguments;
        }
      }

      streamedToolCalls.set(index, existing);
    });
  }

  private static materializeStreamedToolCalls(
    streamedToolCalls: Map<number, StreamedToolCallState>,
  ): OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] {
    return Array.from(streamedToolCalls.entries())
      .sort(([left], [right]) => left - right)
      .flatMap(([, entry]) => {
        if (!entry.name) {
          return [];
        }
        return [
          {
            id: entry.id ?? uuid(),
            type: 'function',
            function: {
              name: entry.name,
              arguments: entry.argumentsText || '{}',
            },
          } as OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
        ];
      });
  }

  private static extractContent(choice: OpenAI.Chat.Completions.ChatCompletion.Choice): ParsedAssistantContent {
    const message = choice?.message;
    if (!message) {
      return {
        raw: '',
        display: '',
        reasoning: undefined,
      };
    }

    return parseAssistantContent(
      message.content,
      (message as any)?.reasoning_content ?? (message as any)?.reasoning,
    );
  }

  private static buildCompletionCreateRequest(
    provider: ResolvedChatProvider,
    conversation: ChatCompletionMessage[],
    stream: boolean,
    promptContext?: string | null,
  ): Record<string, unknown> {
    const request: Record<string, unknown> = {
      model: provider.model,
      messages: this.buildOpenAiMessages(conversation, provider.providerId, promptContext),
      tools: this.buildToolDefinitions(provider.providerId),
      ...provider.requestOverrides.resolveTurnOverrides(),
      stream,
    };

    if (provider.providerId !== 'vertex') {
      request.tool_choice = 'auto';
    }

    // Vertex OpenAPI is stricter than OpenRouter; omit optional sampling params
    // unless we explicitly tune them for that provider.
    if (provider.providerId !== 'vertex') {
      request.temperature = 1.0;
      request.top_p = 0.95;
    }

    return request;
  }

  private static async sleep(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private static isRateLimitError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { status?: unknown }).status === 429
    );
  }

  private static readHeader(
    headers: unknown,
    headerName: string,
  ): string | undefined {
    if (!headers) {
      return undefined;
    }
    const normalizedName = headerName.toLowerCase();

    if (headers instanceof Headers) {
      return headers.get(headerName) ?? headers.get(normalizedName) ?? undefined;
    }

    if (
      typeof headers === 'object' &&
      headers !== null &&
      'get' in headers &&
      typeof (headers as { get?: unknown }).get === 'function'
    ) {
      const value = (headers as { get: (name: string) => unknown }).get(headerName)
        ?? (headers as { get: (name: string) => unknown }).get(normalizedName);
      return typeof value === 'string' ? value : undefined;
    }

    if (Array.isArray(headers)) {
      for (const item of headers) {
        if (!Array.isArray(item) || item.length < 2) {
          continue;
        }
        const [name, value] = item;
        if (
          typeof name === 'string' &&
          name.toLowerCase() === normalizedName &&
          typeof value === 'string'
        ) {
          return value;
        }
      }
      return undefined;
    }

    if (typeof headers === 'object' && headers !== null) {
      for (const [name, value] of Object.entries(headers as Record<string, unknown>)) {
        if (name.toLowerCase() !== normalizedName) {
          continue;
        }
        if (typeof value === 'string') {
          return value;
        }
        if (typeof value === 'number') {
          return String(value);
        }
      }
    }

    return undefined;
  }

  private static resolveRateLimitDelayMs(error: unknown, attempt: number): number {
    const headers =
      typeof error === 'object' && error !== null
        ? (error as { headers?: unknown }).headers
        : undefined;
    const retryAfterRaw = this.readHeader(headers, 'retry-after');
    if (retryAfterRaw) {
      const numericSeconds = Number(retryAfterRaw);
      if (Number.isFinite(numericSeconds) && numericSeconds >= 0) {
        return Math.max(MIN_RATE_LIMIT_DELAY_MS, Math.ceil(numericSeconds * 1000));
      }

      const retryAt = Date.parse(retryAfterRaw);
      if (Number.isFinite(retryAt)) {
        return Math.max(MIN_RATE_LIMIT_DELAY_MS, retryAt - Date.now());
      }
    }

    const exponential = Math.min(
      RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt,
      RATE_LIMIT_MAX_DELAY_MS,
    );
    return Math.max(MIN_RATE_LIMIT_DELAY_MS, exponential);
  }

  private static async createWithRateLimitRetry<T>(
    createRequest: () => Promise<T>,
    contextLabel: string,
  ): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await createRequest();
      } catch (error) {
        if (!this.isRateLimitError(error) || attempt >= MAX_RATE_LIMIT_RETRIES) {
          throw error;
        }

        const delayMs = this.resolveRateLimitDelayMs(error, attempt);
        console.warn(
          '[ChatCompletionsService] Received 429 from %s; retrying in %dms (attempt %d/%d).',
          contextLabel,
          delayMs,
          attempt + 1,
          MAX_RATE_LIMIT_RETRIES,
        );
        await this.sleep(delayMs);
      }
    }
  }

  private static async generateCompletionWithRetry(
    provider: ResolvedChatProvider,
    conversation: ChatCompletionMessage[],
    promptContext?: string | null,
  ) {
    for (let attempt = 0; attempt < MAX_MODEL_RETRIES; attempt += 1) {
      const request = this.buildCompletionCreateRequest(
        provider,
        conversation,
        false,
        promptContext,
      );
      const completion = await this.createWithRateLimitRetry(
        () => provider.client.chat.completions.create(request as any),
        `${provider.providerId} completion`,
      );

      const choice = completion.choices[0];
      if (!choice) {
        throw new Error(NO_MODEL_CHOICES_ERROR);
      }

      console.info(
        '[ChatCompletionsService] Raw completion (%s)\n%s',
        provider.providerId,
        JSON.stringify(
          {
            finishReason: choice.finish_reason,
            completion,
          },
          null,
          2,
        ),
      );

      const parsedContent = this.extractContent(choice);
      console.info('[ChatCompletionsService] Parsed content (%s)', provider.providerId, {
        raw: parsedContent.raw,
        display: parsedContent.display,
        reasoning: parsedContent.reasoning,
      });

      const toolCalls = choice.message?.tool_calls ?? [];
      const hasToolCalls = toolCalls.length > 0;
      const hasContent = this.hasMeaningfulContent(parsedContent);

      if (!hasToolCalls && !hasContent) {
        console.warn('[ChatCompletionsService] Empty model response, retrying', {
          attempt,
          completionId: completion.id,
        });
        if (attempt + 1 === MAX_MODEL_RETRIES) {
          throw new Error(EMPTY_RESPONSE_ERROR);
        }
        continue;
      }

      return { completion, choice, parsedContent, toolCalls };
    }

    throw new Error(EMPTY_RESPONSE_ERROR);
  }

  private static async generateStreamingCompletion(
    provider: ResolvedChatProvider,
    conversation: ChatCompletionMessage[],
    promptContext?: string | null,
  ): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
    const request = this.buildCompletionCreateRequest(
      provider,
      conversation,
      true,
      promptContext,
    );
    const stream = await this.createWithRateLimitRetry(
      () => provider.client.chat.completions.create(request as any),
      `${provider.providerId} stream`,
    );
    return stream as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
  }

  private static hasMeaningfulContent(content: ParsedAssistantContent): boolean {
    if (!content) {
      return false;
    }
    const display = (content.display ?? '').trim();
    const reasoning = (content.reasoning ?? '').trim();
    const rawWithoutThinking = (content.raw ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    return display.length > 0 || reasoning.length > 0 || rawWithoutThinking.length > 0;
  }

  private static buildUserFacingContent(parsed: ParsedAssistantContent): string {
    const raw = parsed.raw ?? '';
    const closingIndex = raw.lastIndexOf('</think>');
    if (closingIndex !== -1) {
      const trimmed = raw.slice(closingIndex + '</think>'.length).trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }

    const display = (parsed.display ?? '').trim();
    if (display.length > 0) {
      return display;
    }

    return raw.trim();
  }

  private static buildFunctionPreview(content: ParsedAssistantContent, entry: ChatApiRegistryEntry) {
    const trimmedDisplay = (content.display ?? '').trim();
    if (trimmedDisplay.length > 0) {
      if (trimmedDisplay.length <= 200) {
        return trimmedDisplay;
      }
      const firstNonEmptyLine = trimmedDisplay
        .split(/\n+/)
        .map((line) => line.trim())
        .find((line) => line.length > 0);
      if (firstNonEmptyLine && firstNonEmptyLine.length <= 160) {
        return firstNonEmptyLine;
      }
    }

    const trimmedReasoning = (content.reasoning ?? '')
      .split(/\n+/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    if (trimmedReasoning && trimmedReasoning.length <= 160) {
      return trimmedReasoning;
    }

    if (entry?.displayName) {
      return `I'd like to call ${entry.displayName}.`;
    }

    return 'I need to run an API call to continue.';
  }

  private static buildUnavailableFunctionMessage(functionName: string, entryId?: unknown): string {
    const target =
      typeof entryId === 'string' && entryId.trim().length > 0
        ? entryId.trim()
        : functionName;
    return `I couldn't run "${target}" because that function is not available.`;
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
      this.logDebug('api_tool_request', {
        entryId: entry.id,
        method: requestMethodForLog,
        url,
        hasBody: init.body !== undefined && init.body !== null,
        headers: requestHeadersForLog,
        args,
      });
      const response = await this.fetchWithProtocolFallback(url, init, baseUrl);
      const durationMs = Date.now() - requestStarted;

      const text = await response.text();
      this.logDebug('api_tool_response', {
        entryId: entry.id,
        method: requestMethodForLog,
        url,
        status: response.status,
        ok: response.ok,
        durationMs,
        contentType: response.headers.get('content-type') ?? undefined,
        bodyPreview: this.previewText(text, 1000),
      });
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

  private static async fetchWithProtocolFallback(
    url: string,
    init: RequestInit,
    baseUrl: string,
  ): Promise<Response> {
    if (!this.shouldTryHttpFirst(url, baseUrl)) {
      return fetch(url, init);
    }

    const httpUrl = this.toHttpUrl(url);
    try {
      return await fetch(httpUrl, init);
    } catch (error) {
      console.warn(
        '[ChatCompletionsService] HTTP-first API tool call failed; retrying with HTTPS.',
        {
          httpUrl,
          httpsUrl: url,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return fetch(url, init);
    }
  }

  private static shouldTryHttpFirst(
    requestUrl: string,
    baseUrl: string,
  ): boolean {
    if (!requestUrl.startsWith('https://')) {
      return false;
    }
    try {
      const request = new URL(requestUrl);
      const base = new URL(baseUrl);
      return request.host === base.host;
    } catch {
      return false;
    }
  }

  private static toHttpUrl(url: string): string {
    const parsed = new URL(url);
    parsed.protocol = 'http:';
    return parsed.toString();
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

    const unresolvedPathParams = Array.from(path.matchAll(/\{([^}]+)\}/g), (match) => match[1]).filter(
      (segment): segment is string => typeof segment === 'string' && segment.length > 0,
    );
    if (unresolvedPathParams.length > 0) {
      throw new Error(
        `Unresolved path parameters for ${entry.id}: ${unresolvedPathParams.join(', ')}`,
      );
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
      // console.info('[ChatCompletionsService] populatePathParameters', entry.id, pathObject);
      args.path = pathObject;
    }
  }

  private static normalizeRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? { ...(value as Record<string, unknown>) }
      : {};
  }

  private static serializeToolResultForConversation(resultPayload: unknown): {
    content: string;
    truncated: boolean;
  } {
    const raw = JSON.stringify(resultPayload ?? null);
    if (raw.length <= MAX_TOOL_RESULT_CHARS) {
      return { content: raw, truncated: false };
    }

    const summarized = {
      truncated: true,
      originalLength: raw.length,
      summary: this.summarizeToolResultValue(resultPayload, 0),
    };
    const summarizedJson = JSON.stringify(summarized);
    if (summarizedJson.length <= MAX_TOOL_RESULT_CHARS) {
      return { content: summarizedJson, truncated: true };
    }

    return {
      content: JSON.stringify({
        truncated: true,
        originalLength: raw.length,
        preview: raw.slice(0, MAX_TOOL_RESULT_CHARS),
      }),
      truncated: true,
    };
  }

  private static summarizeToolResultValue(value: unknown, depth: number): unknown {
    if (
      value === null ||
      value === undefined ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return value;
    }

    if (depth >= TOOL_RESULT_PREVIEW_DEPTH) {
      if (Array.isArray(value)) {
        return `[Array(${value.length})]`;
      }
      return '[Object]';
    }

    if (Array.isArray(value)) {
      return {
        type: 'array',
        count: value.length,
        items: value
          .slice(0, TOOL_RESULT_PREVIEW_ITEMS)
          .map((item) => this.summarizeToolResultValue(item, depth + 1)),
      };
    }

    if (typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>);
      const summary: Record<string, unknown> = {};
      for (const [key, child] of entries.slice(0, TOOL_RESULT_PREVIEW_KEYS)) {
        summary[key] = this.summarizeToolResultValue(child, depth + 1);
      }
      if (entries.length > TOOL_RESULT_PREVIEW_KEYS) {
        summary._truncatedKeys = entries.length - TOOL_RESULT_PREVIEW_KEYS;
      }
      return summary;
    }

    return String(value);
  }

  private static stripReasoningPrefix(content?: string): string | undefined {
    if (typeof content !== 'string') {
      return content;
    }

    const closingIndex = content.lastIndexOf('</think>');
    if (closingIndex !== -1) {
      const trimmed = content.slice(closingIndex + '</think>'.length).trim();
      return trimmed;
    }

    return content;
  }

  private static sanitizeMessagesForClient(messages: ChatCompletionMessage[]): ChatCompletionMessage[] {
    return messages.map((message) => {
      if (message.role !== 'assistant' || typeof message.content !== 'string') {
        return { ...message };
      }

      return {
        ...message,
        content: this.stripReasoningPrefix(message.content),
      };
    });
  }
}
