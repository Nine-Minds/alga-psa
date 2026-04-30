import { ApiOpenApiRegistry, zOpenApi } from '../registry';

export function registerChatRoutes(registry: ApiOpenApiRegistry) {
  const tag = 'Chat';

  const ChatMessage = registry.registerSchema(
    'ChatMessage',
    zOpenApi.object({
      role: zOpenApi.enum(['user', 'assistant']).describe('Role of the message author in the conversation.'),
      content: zOpenApi.string().describe('Message text sent to the chat model.'),
    }),
  );

  const ChatStreamRequest = registry.registerSchema(
    'ChatStreamRequest',
    zOpenApi.object({
      inputs: zOpenApi
        .array(ChatMessage)
        .min(1)
        .describe('Conversation messages in order. These are passed to the OpenRouter chat model.'),
      options: zOpenApi
        .record(zOpenApi.string(), zOpenApi.unknown())
        .optional()
        .describe('Optional model options. Currently declared by the internal interface but not consumed by the handler.'),
      model: zOpenApi
        .string()
        .optional()
        .describe('Optional model override. Currently ignored; the server uses OPENROUTER_CHAT_MODEL or minimax/minimax-m2.'),
      meta: zOpenApi
        .object({
          authorization: zOpenApi
            .string()
            .optional()
            .describe('Optional downstream authorization token. Currently declared but not consumed by the handler.'),
        })
        .optional()
        .describe('Optional metadata for legacy chat clients.'),
    }),
  );

  const ChatTitleStreamRequest = registry.registerSchema(
    'ChatTitleStreamRequest',
    zOpenApi.object({
      inputs: zOpenApi
        .array(ChatMessage)
        .min(1)
        .describe('Conversation messages used as context for generating a short chat title.'),
    }),
  );

  const ChatStreamEvent = registry.registerSchema(
    'ChatStreamEvent',
    zOpenApi.object({
      content: zOpenApi
        .string()
        .describe('SSE data payload content. Normal events contain generated text; terminal events may contain [DONE].'),
      type: zOpenApi
        .enum(['text', 'error'])
        .optional()
        .describe('Event type. text carries model output; error carries an in-stream error message.'),
    }),
  );

  const ChatStreamError = registry.registerSchema(
    'ChatStreamError',
    zOpenApi.object({
      error: zOpenApi.string().describe('Human-readable error message.'),
    }),
  );

  const ChatStreamSlugParams = registry.registerSchema(
    'ChatStreamSlugParams',
    zOpenApi.object({
      slug: zOpenApi
        .string()
        .describe('Catch-all chat stream path segment. The current handler accepts the value but does not use it.'),
    }),
  );

  registry.registerRoute({
    method: 'post',
    path: '/api/chat/stream/title',
    summary: 'Generate chat title stream',
    description:
      'Enterprise-only AI endpoint that generates a short title from conversation messages. Requires a valid Auth.js session and the aiAssistant experimental feature enabled for the tenant. The handler sends the messages to OpenRouter and returns Server-Sent Events; the implementation emits a generated title event and a completion event rather than a conventional JSON response.',
    tags: [tag],
    security: [{ SessionCookieAuth: [] }],
    request: {
      body: {
        schema: ChatTitleStreamRequest,
        description: 'Conversation messages to summarize into a title.',
      },
    },
    responses: {
      200: {
        description: 'SSE stream of title-generation events.',
        contentType: 'text/event-stream',
        schema: ChatStreamEvent,
      },
      403: {
        description: 'AI Assistant feature is not enabled for the tenant.',
        schema: ChatStreamError,
      },
      404: {
        description: 'Chat streaming is not available in this edition.',
        schema: zOpenApi.string().describe('Edition-gate error message.'),
      },
      500: {
        description: 'Malformed request, missing model credentials, or another internal streaming failure.',
        schema: ChatStreamError,
      },
    },
    extensions: {
      'x-edition-gated': 'enterprise',
      'x-feature-flag': 'aiAssistant',
      'x-streaming': 'sse',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/chat/stream/{slug}',
    summary: 'Get chat stream placeholder',
    description:
      'Placeholder GET handler for the chat stream catch-all route. The slug path segment is accepted by the Next.js route but is not inspected. The handler currently returns the plain text string "Hello World" and does not require authentication.',
    tags: [tag],
    security: [],
    request: {
      params: ChatStreamSlugParams,
    },
    responses: {
      200: {
        description: 'Plain text placeholder response.',
        contentType: 'text/plain',
        schema: zOpenApi.string().describe('Always returns Hello World.'),
      },
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/chat/stream/{slug}',
    summary: 'Stream AI chat response',
    description:
      'Enterprise-only AI chat endpoint that accepts conversation messages and returns an assistant response via Server-Sent Events. Requires a valid Auth.js session and the aiAssistant experimental feature enabled for the tenant. The slug path segment is accepted by the catch-all route but is not used by the implementation. API-key authentication is skipped for /api/chat; tenant context comes from the session.',
    tags: [tag],
    security: [{ SessionCookieAuth: [] }],
    request: {
      params: ChatStreamSlugParams,
      body: {
        schema: ChatStreamRequest,
        description: 'Conversation messages and optional legacy metadata for the chat model.',
      },
    },
    responses: {
      200: {
        description: 'SSE stream of chat response events. Each data frame contains content and type.',
        contentType: 'text/event-stream',
        schema: ChatStreamEvent,
      },
      403: {
        description: 'AI Assistant feature is not enabled for the tenant.',
        schema: ChatStreamError,
      },
      404: {
        description: 'Chat streaming is not available in this edition.',
        schema: zOpenApi.string().describe('Edition-gate error message.'),
      },
      500: {
        description: 'Malformed request, missing OpenRouter API key, or another internal streaming failure.',
        schema: ChatStreamError,
      },
    },
    extensions: {
      'x-edition-gated': 'enterprise',
      'x-feature-flag': 'aiAssistant',
      'x-streaming': 'sse',
    },
    edition: 'both',
  });
}
