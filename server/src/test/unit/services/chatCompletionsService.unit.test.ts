import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const openAiCreateSpy = vi.hoisted(() => vi.fn());
const getSecretMock = vi.hoisted(() => vi.fn());
const getCurrentUserMock = vi.hoisted(() => vi.fn());
const getRegistryMock = vi.hoisted(() => vi.fn());
const getTicketByIdMock = vi.hoisted(() => vi.fn());
const getProjectMock = vi.hoisted(() => vi.fn());
const getClientByIdMock = vi.hoisted(() => vi.fn());
const getContactByContactNameIdMock = vi.hoisted(() => vi.fn());
const getAssetDetailBundleMock = vi.hoisted(() => vi.fn());
const secretState = vi.hoisted(() => ({ values: {} as Record<string, string | undefined> }));
const googleAccessTokenState = vi.hoisted(() => ({ token: 'adc-token' as string | undefined }));

vi.mock('openai', () => {
  class OpenAI {
    chat = {
      completions: {
        create: openAiCreateSpy,
      },
    };

    constructor(_config: unknown) {}
  }

  return { default: OpenAI };
});

vi.mock('@alga-psa/core/secrets', async () => {
  const actual = await vi.importActual<any>('@alga-psa/core/secrets');
  return {
    ...actual,
    getSecret: getSecretMock,
  };
});

vi.mock('@alga-psa/users/actions', () => ({
  getCurrentUser: getCurrentUserMock,
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: getCurrentUserMock,
}));

vi.mock('@ee/chat/registry/apiRegistry.indexer', () => ({
  getRegistry: getRegistryMock,
}));

vi.mock('@alga-psa/tickets/actions/ticketActions', () => ({
  getTicketById: getTicketByIdMock,
}));

vi.mock('@alga-psa/projects/actions/projectActions', () => ({
  getProject: getProjectMock,
}));

vi.mock('@alga-psa/clients/actions', () => ({
  getClientById: getClientByIdMock,
  getContactByContactNameId: getContactByContactNameIdMock,
}));

vi.mock('@alga-psa/assets/actions/assetActions', () => ({
  getAssetDetailBundle: getAssetDetailBundleMock,
}));

vi.mock('google-auth-library', () => ({
  GoogleAuth: class {
    constructor(_config: unknown) {}

    async getClient() {
      return {
        getAccessToken: async () =>
          googleAccessTokenState.token
            ? { token: googleAccessTokenState.token }
            : null,
      };
    }
  },
}));

const MANAGED_ENV_KEYS = [
  'AI_CHAT_PROVIDER',
  'OPENROUTER_API_KEY',
  'OPENROUTER_CHAT_MODEL',
  'VERTEX_PROJECT_ID',
  'VERTEX_LOCATION',
  'VERTEX_CHAT_MODEL',
  'VERTEX_OPENAPI_BASE_URL',
  'EDITION',
  'NEXT_PUBLIC_EDITION',
] as const;

const ORIGINAL_ENV: Record<string, string | undefined> = Object.fromEntries(
  MANAGED_ENV_KEYS.map((key) => [key, process.env[key]]),
);

const registryEntry = {
  id: 'tickets.list',
  method: 'get' as const,
  path: '/api/v1/tickets',
  displayName: 'List tickets',
  summary: 'List tickets',
  description: 'Lists tickets from the PSA',
  tags: ['tickets'],
  rbacResource: 'tickets:list',
  approvalRequired: true,
  parameters: [],
  playbooks: ['Lookup context'],
  examples: [],
};

const resetManagedEnv = () => {
  for (const key of MANAGED_ENV_KEYS) {
    const originalValue = ORIGINAL_ENV[key];
    if (originalValue === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalValue;
    }
  }
};

const setSecrets = (values: Record<string, string | undefined>) => {
  secretState.values = values;
};

const buildCompletion = (message: Record<string, unknown>) => ({
  id: 'chatcmpl-test',
  choices: [
    {
      index: 0,
      finish_reason: 'stop',
      message,
    },
  ],
});

const buildChunkStream = (chunks: Array<Record<string, unknown>>) => ({
  async *[Symbol.asyncIterator]() {
    for (const chunk of chunks) {
      yield chunk;
    }
  },
});

const buildRateLimitError = (retryAfter?: string) => {
  const error = new Error('Rate limited') as Error & {
    status?: number;
    headers?: Record<string, string>;
  };
  error.status = 429;
  if (retryAfter !== undefined) {
    error.headers = { 'retry-after': retryAfter };
  }
  return error;
};

describe('ChatCompletionsService (unit)', () => {
  beforeEach(() => {
    vi.resetModules();
    openAiCreateSpy.mockReset();
    getSecretMock.mockReset();
    getCurrentUserMock.mockReset();
    getRegistryMock.mockReset();
    getTicketByIdMock.mockReset();
    getProjectMock.mockReset();
    getClientByIdMock.mockReset();
    getContactByContactNameIdMock.mockReset();
    getAssetDetailBundleMock.mockReset();
    resetManagedEnv();
    secretState.values = {};
    googleAccessTokenState.token = 'adc-token';
    getSecretMock.mockImplementation(
      async (secretName: string, envVar: string, defaultValue: string = '') => {
        const providerValue = secretState.values[secretName];
        if (providerValue !== undefined && providerValue !== '') {
          return providerValue;
        }

        const envValue = envVar ? process.env[envVar] : undefined;
        if (envValue !== undefined) {
          return envValue;
        }

        return defaultValue;
      },
    );

    getRegistryMock.mockReturnValue([registryEntry]);
    getCurrentUserMock.mockResolvedValue({
      user_id: 'user-1',
      tenant: 'tenant-1',
      email: 'pat@example.com',
      first_name: 'Pat',
      last_name: 'Lee',
      username: 'pat',
      user_type: 'internal',
      is_inactive: false,
      roles: [],
    });
  });

  afterEach(() => {
    resetManagedEnv();
  });

  it('accepts assistant messages with string reasoning_content', async () => {
    const { ChatCompletionsService } = await import('@ee/services/chatCompletionsService');

    const messages = (ChatCompletionsService as any).validateMessages([
      {
        role: 'assistant',
        content: 'Hello',
        reasoning_content: 'plan this response',
      },
    ]);

    expect(messages[0]).toMatchObject({
      role: 'assistant',
      content: 'Hello',
      reasoning_content: 'plan this response',
      reasoning: 'plan this response',
    });
  });

  it('rejects invalid reasoning_content types', async () => {
    const { ChatCompletionsService } = await import('@ee/services/chatCompletionsService');

    expect(() =>
      (ChatCompletionsService as any).validateMessages([
        {
          role: 'assistant',
          content: 'Hello',
          reasoning_content: 123,
        },
      ]),
    ).toThrow('Invalid messages payload');
  });

  it('preserves reasoning_content values during conversation normalization', async () => {
    const { ChatCompletionsService } = await import('@ee/services/chatCompletionsService');

    const normalized = (ChatCompletionsService as any).normalizeConversationHistory([
      {
        role: 'assistant',
        content: 'I will call a tool',
        reasoning_content: 'check context first',
        function_call: { name: 'search_api_registry', arguments: { query: 'tickets' } },
        tool_call_id: 'call-1',
      },
      {
        role: 'function',
        name: 'search_api_registry',
        content: '{"results":[]}',
        tool_call_id: 'call-1',
      },
    ]);

    expect(normalized[0]).toMatchObject({
      role: 'assistant',
      reasoning_content: 'check context first',
    });
  });

  it('sanitizes client-facing assistant content without dropping reasoning_content', async () => {
    const { ChatCompletionsService } = await import('@ee/services/chatCompletionsService');

    const sanitized = (ChatCompletionsService as any).sanitizeMessagesForClient([
      {
        role: 'assistant',
        content: '<think>internal plan</think>\n\nPublic reply',
        reasoning_content: 'internal plan',
      },
    ]);

    expect(sanitized[0]).toMatchObject({
      role: 'assistant',
      content: 'Public reply',
      reasoning_content: 'internal plan',
    });
  });

  it('includes reasoning_content for assistant messages in Vertex payload conversion', async () => {
    const { ChatCompletionsService } = await import('@ee/services/chatCompletionsService');

    const converted = (ChatCompletionsService as any).buildOpenAiMessages(
      [
        {
          role: 'assistant',
          content: 'Plan complete',
          reasoning_content: 'step by step reasoning',
        },
        {
          role: 'assistant',
          content: 'Calling API now',
          reasoning_content: 'need this API call',
          function_call: {
            name: 'call_api_endpoint',
            arguments: { entryId: 'tickets.list' },
          },
          tool_call_id: 'call-vertex-1',
        },
      ],
      'vertex',
    );

    const assistantNoTool = converted[1] as Record<string, unknown>;
    const assistantWithTool = converted[2] as Record<string, unknown>;

    expect(assistantNoTool.reasoning_content).toBe('step by step reasoning');
    expect(assistantWithTool.reasoning_content).toBe('need this API call');
  });

  it('omits reasoning_content for OpenRouter payload conversion', async () => {
    const { ChatCompletionsService } = await import('@ee/services/chatCompletionsService');

    const converted = (ChatCompletionsService as any).buildOpenAiMessages(
      [
        {
          role: 'assistant',
          content: 'Plan complete',
          reasoning_content: 'step by step reasoning',
        },
      ],
      'openrouter',
    );

    const assistant = converted[1] as Record<string, unknown>;
    expect(assistant).not.toHaveProperty('reasoning_content');
  });

  it('includes document in-app content guidance in the system prompt', async () => {
    const { ChatCompletionsService } = await import('@ee/services/chatCompletionsService');

    const converted = (ChatCompletionsService as any).buildOpenAiMessages(
      [{ role: 'user', content: 'Read the ticket attachment' }],
      'openrouter',
    );

    const systemPrompt = converted[0] as Record<string, unknown>;
    expect(systemPrompt.role).toBe('system');
    expect(systemPrompt.content).toContain('GET /api/documents/{documentId}/content');
    expect(systemPrompt.content).toContain('null file_id');
  });

  it('builds prompt context with current user and resolved ticket details', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-09T17:50:00Z'));
    try {
      getTicketByIdMock.mockResolvedValue({
        ticket_id: 'ticket-123',
        ticket_number: 'T-123',
        title: 'Printer jam on floor 2',
      });

      const { ChatCompletionsService } = await import('@ee/services/chatCompletionsService');

      const promptContext = await (ChatCompletionsService as any).buildPromptContext({
        pathname: '/msp/tickets/ticket-123',
        screen: {
          key: 'tickets.detail',
          label: 'Ticket Details',
        },
        record: {
          type: 'ticket',
          id: 'ticket-123',
        },
      });

      expect(promptContext).toContain(
        'Current date/time: March 9, 2026 at 1:50 PM EDT | timezone: America/New_York',
      );
      expect(promptContext).toContain('Pat Lee');
      expect(promptContext).toContain('pat@example.com');
      expect(promptContext).toContain('Ticket Details');
      expect(promptContext).toContain('ticket');
      expect(promptContext).toContain('#T-123 - Printer jam on floor 2');
      expect(promptContext).toContain('treat phrases like "this ticket"');
    } finally {
      vi.useRealTimers();
    }
  });

  it('builds prompt context with explicit active project reference guidance', async () => {
    getProjectMock.mockResolvedValue({
      project_id: 'project-123',
      project_name: 'Emerald City Beautification',
    });

    const { ChatCompletionsService } = await import('@ee/services/chatCompletionsService');

    const promptContext = await (ChatCompletionsService as any).buildPromptContext({
      pathname: '/msp/projects/project-123',
      screen: {
        key: 'projects.detail',
        label: 'Project Details',
      },
      record: {
        type: 'project',
        id: 'project-123',
      },
    });

    expect(promptContext).toContain('Project Details');
    expect(promptContext).toContain('Emerald City Beautification');
    expect(promptContext).toContain('treat phrases like "this project"');
  });

  it('appends resolved app context to the system prompt when provided', async () => {
    const { ChatCompletionsService } = await import('@ee/services/chatCompletionsService');

    const converted = (ChatCompletionsService as any).buildOpenAiMessages(
      [{ role: 'user', content: 'Summarize this ticket' }],
      'openrouter',
      'Current app context:\n- Current screen: Ticket Details',
    );

    const systemPrompt = converted[0] as Record<string, unknown>;
    expect(systemPrompt.content).toContain('Current app context:');
    expect(systemPrompt.content).toContain('Current screen: Ticket Details');
  });

  it('rejects malformed uiContext payloads', async () => {
    const { ChatCompletionsService } = await import('@ee/services/chatCompletionsService');

    expect(() =>
      (ChatCompletionsService as any).validateUiContext({
        pathname: '/msp/tickets/ticket-123',
        screen: { key: 'tickets.detail' },
      }),
    ).toThrow('Invalid uiContext payload');
  });

  it('extracts reasoning from legacy <think> content when reasoning_content is absent', async () => {
    const { ChatCompletionsService } = await import('@ee/services/chatCompletionsService');

    const parsed = (ChatCompletionsService as any).extractContent({
      message: {
        content: '<think>Gather context first</think>Final answer',
      },
    });

    expect(parsed.reasoning).toBe('Gather context first');
    expect(parsed.display).toBe('Final answer');
  });

  it('prioritizes reasoning_content over legacy reasoning field when both are present', async () => {
    const { ChatCompletionsService } = await import('@ee/services/chatCompletionsService');

    const parsed = (ChatCompletionsService as any).extractContent({
      message: {
        content: 'Final answer',
        reasoning_content: [{ type: 'reasoning', text: 'primary reasoning' }],
        reasoning: [{ type: 'reasoning', text: 'fallback reasoning' }],
      },
    });

    expect(parsed.reasoning).toBe('primary reasoning');
  });

  it('falls back to reasoning field when reasoning_content is absent', async () => {
    const { ChatCompletionsService } = await import('@ee/services/chatCompletionsService');

    const parsed = (ChatCompletionsService as any).extractContent({
      message: {
        content: 'Final answer',
        reasoning: [{ type: 'reasoning', text: 'fallback reasoning' }],
      },
    });

    expect(parsed.reasoning).toBe('fallback reasoning');
  });

  it('streams a visible fallback message when execute tool proposal targets an unknown function entry', async () => {
    process.env.AI_CHAT_PROVIDER = 'openrouter';
    setSecrets({
      OPENROUTER_API_KEY: 'openrouter-key',
      OPENROUTER_CHAT_MODEL: 'openrouter/model',
    });

    openAiCreateSpy.mockResolvedValueOnce(
      buildChunkStream([
        {
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'tool-call-missing-entry',
                    type: 'function',
                    function: {
                      name: 'call_api_endpoint',
                      arguments: JSON.stringify({ entryId: 'missing.entry' }),
                    },
                  },
                ],
              },
            },
          ],
        },
      ]),
    );

    const { ChatCompletionsService } = await import('@ee/services/chatCompletionsService');

    const streamedEvents: Array<{ type: string; delta?: string }> = [];
    for await (const event of ChatCompletionsService.createStructuredCompletionStream([
      { role: 'user', content: 'Execute missing entry' },
    ])) {
      streamedEvents.push(event as { type: string; delta?: string });
    }

    expect(streamedEvents).toEqual([
      {
        type: 'content_delta',
        delta: 'I couldn\'t run "missing.entry" because that function is not available.',
      },
      { type: 'done' },
    ]);
  });

  it('retries streamed tool calls when the model emits invalid JSON arguments', async () => {
    process.env.AI_CHAT_PROVIDER = 'openrouter';
    setSecrets({
      OPENROUTER_API_KEY: 'openrouter-key',
      OPENROUTER_CHAT_MODEL: 'openrouter/model',
    });

    openAiCreateSpy
      .mockResolvedValueOnce(
        buildChunkStream([
          {
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'tool-call-invalid-json',
                      type: 'function',
                      function: {
                        name: 'call_api_endpoint',
                        arguments: '{"entryId":"tickets.list","query":{"status":"open"',
                      },
                    },
                  ],
                },
              },
            ],
          },
        ]),
      )
      .mockResolvedValueOnce(
        buildChunkStream([
          {
            choices: [
              {
                index: 0,
                delta: {
                  content: 'Recovered after retry.',
                },
              },
            ],
          },
        ]),
      );

    const { ChatCompletionsService } = await import('@ee/services/chatCompletionsService');

    const streamedEvents: Array<{ type: string; delta?: string }> = [];
    for await (const event of ChatCompletionsService.createStructuredCompletionStream([
      { role: 'user', content: 'Execute tickets list' },
    ])) {
      streamedEvents.push(event as { type: string; delta?: string });
    }

    expect(streamedEvents).toEqual(
      expect.arrayContaining([
        { type: 'content_delta', delta: 'Recovered after retry.' },
        { type: 'done' },
      ]),
    );
    expect(openAiCreateSpy).toHaveBeenCalledTimes(2);
    const retryRequest = openAiCreateSpy.mock.calls[1]?.[0] as Record<string, unknown>;
    const toolMessage = (retryRequest.messages as Array<Record<string, unknown>>).find(
      (message) => message.role === 'tool',
    );
    expect(toolMessage).toEqual(
      expect.objectContaining({
        content: expect.stringContaining(
          'Tool arguments were invalid JSON. Retry the same function call with a valid JSON object only.',
        ),
      }),
    );
  });

  it('logs raw tool arguments with stream context when JSON parsing fails', async () => {
    process.env.AI_CHAT_PROVIDER = 'openrouter';
    setSecrets({
      OPENROUTER_API_KEY: 'openrouter-key',
      OPENROUTER_CHAT_MODEL: 'openrouter/model',
    });

    openAiCreateSpy
      .mockResolvedValueOnce(
        buildChunkStream([
          {
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'tool-call-log-context',
                      type: 'function',
                      function: {
                        name: 'call_api_endpoint',
                        arguments: '{"entryId":"tickets.list","query":{"status":"open"',
                      },
                    },
                  ],
                },
              },
            ],
          },
        ]),
      )
      .mockResolvedValueOnce(
        buildChunkStream([
          {
            choices: [
              {
                index: 0,
                delta: {
                  content: 'Recovered.',
                },
              },
            ],
          },
        ]),
      );

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { ChatCompletionsService } = await import('@ee/services/chatCompletionsService');

    for await (const _event of ChatCompletionsService.createStructuredCompletionStream([
      { role: 'user', content: 'Execute tickets list' },
    ])) {
      // drain stream
    }

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[ChatCompletionsService] Failed to parse tool arguments',
      expect.objectContaining({
        source: 'stream',
        functionName: 'call_api_endpoint',
        toolCallId: 'tool-call-log-context',
        rawArguments: '{"entryId":"tickets.list","query":{"status":"open"',
        rawArgumentsLength: expect.any(Number),
      }),
      expect.any(SyntaxError),
    );
  });

  it('appends assistant reasoning_content during tool-call proposal turns', async () => {
    process.env.AI_CHAT_PROVIDER = 'openrouter';
    setSecrets({
      OPENROUTER_API_KEY: 'openrouter-key',
      OPENROUTER_CHAT_MODEL: 'openrouter/model',
    });

    openAiCreateSpy.mockResolvedValueOnce(
      buildCompletion({
        content: 'I will call the endpoint now.',
        reasoning_content: [
          { type: 'reasoning', text: 'Need to fetch ticket data before response.' },
        ],
        tool_calls: [
          {
            id: 'tool-call-1',
            type: 'function',
            function: {
              name: 'call_api_endpoint',
              arguments: JSON.stringify({ entryId: 'tickets.list' }),
            },
          },
        ],
      }),
    );

    const { ChatCompletionsService } = await import('@ee/services/chatCompletionsService');

    const result = await (ChatCompletionsService as any).processModelInteraction({
      messages: [{ role: 'user', content: 'List tickets' }],
      chatId: 'chat-1',
      baseUrl: 'https://example.invalid',
      tenantId: 'tenant-1',
      userId: 'user-1',
    });

    expect(result.type).toBe('function_proposed');
    expect(result.modelMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          reasoning_content: 'Need to fetch ticket data before response.',
        }),
      ]),
    );
  });

  it('retries non-stream tool calls when the model emits invalid JSON arguments', async () => {
    process.env.AI_CHAT_PROVIDER = 'openrouter';
    setSecrets({
      OPENROUTER_API_KEY: 'openrouter-key',
      OPENROUTER_CHAT_MODEL: 'openrouter/model',
    });

    openAiCreateSpy
      .mockResolvedValueOnce(
        buildCompletion({
          content: 'Preparing execution',
          tool_calls: [
            {
              id: 'tool-call-invalid-json-non-stream',
              type: 'function',
              function: {
                name: 'call_api_endpoint',
                arguments: '{"entryId":"tickets.list","query":{"status":"open"',
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        buildCompletion({
          content: 'Recovered after retry.',
        }),
      );

    const { ChatCompletionsService } = await import('@ee/services/chatCompletionsService');

    const result = await (ChatCompletionsService as any).processModelInteraction({
      messages: [{ role: 'user', content: 'Execute tickets list' }],
      chatId: 'chat-1',
      baseUrl: 'https://example.invalid',
      tenantId: 'tenant-1',
      userId: 'user-1',
    });

    expect(result).toMatchObject({
      type: 'assistant_message',
      message: expect.objectContaining({ content: 'Recovered after retry.' }),
    });
    expect(openAiCreateSpy).toHaveBeenCalledTimes(2);
    const retryRequest = openAiCreateSpy.mock.calls[1]?.[0] as Record<string, unknown>;
    const toolMessage = (retryRequest.messages as Array<Record<string, unknown>>).find(
      (message) => message.role === 'tool',
    );
    expect(toolMessage).toEqual(
      expect.objectContaining({
        content: expect.stringContaining(
          'Tool arguments were invalid JSON. Retry the same function call with a valid JSON object only.',
        ),
      }),
    );
  });

  it('appends assistant reasoning_content on final non-tool responses', async () => {
    process.env.AI_CHAT_PROVIDER = 'openrouter';
    setSecrets({
      OPENROUTER_API_KEY: 'openrouter-key',
      OPENROUTER_CHAT_MODEL: 'openrouter/model',
    });

    openAiCreateSpy.mockResolvedValueOnce(
      buildCompletion({
        content: 'Done.',
        reasoning_content: [{ type: 'reasoning', text: 'Checked all records.' }],
      }),
    );

    const { ChatCompletionsService } = await import('@ee/services/chatCompletionsService');

    const result = await (ChatCompletionsService as any).processModelInteraction({
      messages: [{ role: 'user', content: 'Summarize' }],
      chatId: 'chat-1',
      baseUrl: 'https://example.invalid',
      tenantId: 'tenant-1',
      userId: 'user-1',
    });

    expect(result.type).toBe('assistant_message');
    expect(result.modelMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          reasoning_content: 'Checked all records.',
        }),
      ]),
    );
  });

  it('uses provider-resolved OpenRouter model/client for non-stream completions and keeps tool_choice:auto', async () => {
    process.env.AI_CHAT_PROVIDER = 'openrouter';
    setSecrets({
      OPENROUTER_API_KEY: 'openrouter-key',
      OPENROUTER_CHAT_MODEL: 'openrouter/custom-model',
    });

    openAiCreateSpy.mockResolvedValueOnce(
      buildCompletion({
        content: 'OpenRouter result',
      }),
    );

    const { ChatCompletionsService } = await import('@ee/services/chatCompletionsService');

    await (ChatCompletionsService as any).processModelInteraction({
      messages: [{ role: 'user', content: 'Hello' }],
      chatId: 'chat-1',
      baseUrl: 'https://example.invalid',
      tenantId: 'tenant-1',
      userId: 'user-1',
    });

    const request = openAiCreateSpy.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(request.model).toBe('openrouter/custom-model');
    expect(request.tool_choice).toBe('auto');
  });

  it('uses provider-resolved Vertex model/client for non-stream completions and omits tool_choice', async () => {
    process.env.AI_CHAT_PROVIDER = 'vertex';
    setSecrets({
      VERTEX_PROJECT_ID: 'proj-1',
      VERTEX_LOCATION: 'us-central1',
      VERTEX_CHAT_MODEL: 'glm-5-maas',
    });

    openAiCreateSpy.mockResolvedValueOnce(
      buildCompletion({
        content: 'Vertex result',
      }),
    );

    const { ChatCompletionsService } = await import('@ee/services/chatCompletionsService');

    await (ChatCompletionsService as any).processModelInteraction({
      messages: [{ role: 'user', content: 'Hello' }],
      chatId: 'chat-1',
      baseUrl: 'https://example.invalid',
      tenantId: 'tenant-1',
      userId: 'user-1',
    });

    const request = openAiCreateSpy.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(request.model).toBe('zai-org/glm-5-maas');
    expect(request.tool_choice).toBeUndefined();
  });

  it('returns function_proposed with nextMessages/modelMessages preserving reasoning context', async () => {
    process.env.AI_CHAT_PROVIDER = 'openrouter';
    setSecrets({
      OPENROUTER_API_KEY: 'openrouter-key',
      OPENROUTER_CHAT_MODEL: 'openrouter/model',
    });

    openAiCreateSpy.mockResolvedValueOnce(
      buildCompletion({
        content: 'Preparing execution',
        reasoning_content: [{ type: 'reasoning', text: 'Need to execute endpoint now' }],
        tool_calls: [
          {
            id: 'tool-call-2',
            type: 'function',
            function: {
              name: 'call_api_endpoint',
              arguments: JSON.stringify({ entryId: 'tickets.list' }),
            },
          },
        ],
      }),
    );

    const { ChatCompletionsService } = await import('@ee/services/chatCompletionsService');

    const result = await (ChatCompletionsService as any).processModelInteraction({
      messages: [{ role: 'user', content: 'Execute tickets list' }],
      chatId: 'chat-1',
      baseUrl: 'https://example.invalid',
      tenantId: 'tenant-1',
      userId: 'user-1',
    });

    expect(result.type).toBe('function_proposed');
    expect(result.nextMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          reasoning_content: 'Need to execute endpoint now',
        }),
      ]),
    );
    expect(result.modelMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          reasoning_content: 'Need to execute endpoint now',
        }),
      ]),
    );
  });

  it('execute-after-approval continuation replays preserved assistant context and tool result before follow-up completion', async () => {
    const { ChatCompletionsService } = await import('@ee/services/chatCompletionsService');

    const executeFunctionCallSpy = vi
      .spyOn(ChatCompletionsService as any, 'executeFunctionCall')
      .mockResolvedValue({ status: 200, ok: true, data: { id: 'result-1' } });
    const processModelInteractionSpy = vi
      .spyOn(ChatCompletionsService as any, 'processModelInteraction')
      .mockResolvedValue({
        type: 'assistant_message',
        message: { role: 'assistant', content: 'Execution complete' },
        nextMessages: [],
        modelMessages: [],
      });

    const response = await (ChatCompletionsService as any).executeAfterApproval({
      messages: [
        { role: 'user', content: 'Run endpoint' },
        {
          role: 'assistant',
          content: 'Plan',
          reasoning_content: 'Preserved reasoning',
          function_call: {
            name: 'call_api_endpoint',
            arguments: { entryId: 'tickets.list' },
          },
          tool_call_id: 'tool-call-stable',
        },
      ],
      functionCall: {
        name: 'call_api_endpoint',
        arguments: { entryId: 'tickets.list' },
        toolCallId: 'tool-call-stable',
        entryId: 'tickets.list',
      },
      action: 'approve',
      baseUrl: 'https://example.invalid',
      tenantId: 'tenant-1',
      userId: 'user-1',
      chatId: 'chat-1',
    });

    expect(executeFunctionCallSpy).toHaveBeenCalledTimes(1);
    expect(processModelInteractionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'assistant',
            reasoning_content: 'Preserved reasoning',
          }),
          expect.objectContaining({
            role: 'function',
            name: 'call_api_endpoint',
            tool_call_id: 'tool-call-stable',
          }),
        ]),
      }),
    );
    expect(response).toMatchObject({
      type: 'assistant_message',
      functionCall: expect.objectContaining({
        toolCallId: 'tool-call-stable',
      }),
    });
  });

  it('summarizes oversized tool results before replaying them into the follow-up completion', async () => {
    const { ChatCompletionsService } = await import('@ee/services/chatCompletionsService');

    vi.spyOn(ChatCompletionsService as any, 'executeFunctionCall').mockResolvedValue({
      status: 200,
      ok: true,
      data: Array.from({ length: 10 }, (_, index) => ({
        entry_id: `entry-${index}`,
        notes: 'x'.repeat(4000),
      })),
    });
    const processModelInteractionSpy = vi
      .spyOn(ChatCompletionsService as any, 'processModelInteraction')
      .mockResolvedValue({
        type: 'assistant_message',
        message: { role: 'assistant', content: 'Execution complete' },
        nextMessages: [],
        modelMessages: [],
      });

    const response = await (ChatCompletionsService as any).executeAfterApproval({
      messages: [{ role: 'user', content: 'Run endpoint' }],
      functionCall: {
        name: 'call_api_endpoint',
        arguments: { entryId: 'tickets.list' },
        toolCallId: 'tool-call-large-result',
        entryId: 'tickets.list',
      },
      action: 'approve',
      baseUrl: 'https://example.invalid',
      tenantId: 'tenant-1',
      userId: 'user-1',
      chatId: 'chat-1',
    });

    expect(processModelInteractionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'function',
            tool_call_id: 'tool-call-large-result',
            content: expect.stringContaining('"truncated":true'),
          }),
        ]),
      }),
    );

    const functionMessage = (processModelInteractionSpy.mock.calls[0]?.[0]?.messages ?? []).find(
      (message: { role?: string }) => message.role === 'function',
    ) as { content?: string } | undefined;
    expect(functionMessage?.content?.length ?? 0).toBeLessThanOrEqual(12000 + 200);
    expect(response).toMatchObject({
      type: 'assistant_message',
      functionCall: expect.objectContaining({
        toolCallId: 'tool-call-large-result',
        toolResultTruncated: true,
      }),
    });
  });

  it('retries non-stream completion requests on 429 with backoff', async () => {
    process.env.AI_CHAT_PROVIDER = 'openrouter';
    setSecrets({
      OPENROUTER_API_KEY: 'openrouter-key',
      OPENROUTER_CHAT_MODEL: 'openrouter/model',
    });

    openAiCreateSpy
      .mockRejectedValueOnce(buildRateLimitError())
      .mockResolvedValueOnce(
        buildCompletion({
          content: 'Recovered after rate limit.',
        }),
      );

    const { ChatCompletionsService } = await import('@ee/services/chatCompletionsService');
    const sleepSpy = vi
      .spyOn(ChatCompletionsService as any, 'sleep')
      .mockResolvedValue(undefined);

    const result = await (ChatCompletionsService as any).processModelInteraction({
      messages: [{ role: 'user', content: 'Hello' }],
      chatId: 'chat-1',
      baseUrl: 'https://example.invalid',
      tenantId: 'tenant-1',
      userId: 'user-1',
    });

    expect(result).toMatchObject({
      type: 'assistant_message',
      message: expect.objectContaining({ content: 'Recovered after rate limit.' }),
    });
    expect(openAiCreateSpy).toHaveBeenCalledTimes(2);
    expect(sleepSpy).toHaveBeenCalledWith(500);
    sleepSpy.mockRestore();
  });

  it('retries streaming requests on 429 and honors Retry-After header', async () => {
    process.env.AI_CHAT_PROVIDER = 'openrouter';
    setSecrets({
      OPENROUTER_API_KEY: 'openrouter-key',
      OPENROUTER_CHAT_MODEL: 'openrouter/model',
    });

    openAiCreateSpy
      .mockRejectedValueOnce(buildRateLimitError('1'))
      .mockResolvedValueOnce(
        buildChunkStream([
          {
            choices: [
              {
                index: 0,
                delta: {
                  content: 'Recovered stream response',
                },
              },
            ],
          },
        ]),
      );

    const { ChatCompletionsService } = await import('@ee/services/chatCompletionsService');
    const sleepSpy = vi
      .spyOn(ChatCompletionsService as any, 'sleep')
      .mockResolvedValue(undefined);

    const events: Array<{ type: string; delta?: string }> = [];
    for await (const event of ChatCompletionsService.createStructuredCompletionStream([
      { role: 'user', content: 'Hello' },
    ])) {
      events.push(event as { type: string; delta?: string });
    }

    expect(events).toEqual(
      expect.arrayContaining([
        { type: 'content_delta', delta: 'Recovered stream response' },
        { type: 'done' },
      ]),
    );
    expect(openAiCreateSpy).toHaveBeenCalledTimes(2);
    expect(sleepSpy).toHaveBeenCalledWith(1000);
    sleepSpy.mockRestore();
  });

  it('prefers http first for internal https tool calls', async () => {
    const { ChatCompletionsService } = await import('@ee/services/chatCompletionsService');

    expect(
      (ChatCompletionsService as any).shouldTryHttpFirst(
        'https://sebastian.msp.svc.cluster.local:3000/api/v1/tickets',
        'https://sebastian.msp.svc.cluster.local:3000',
      ),
    ).toBe(true);
    expect(
      (ChatCompletionsService as any).toHttpUrl(
        'https://sebastian.msp.svc.cluster.local:3000/api/v1/tickets',
      ),
    ).toBe('http://sebastian.msp.svc.cluster.local:3000/api/v1/tickets');
  });

  it('does not prefer http first for non-matching hosts', async () => {
    const { ChatCompletionsService } = await import('@ee/services/chatCompletionsService');

    expect(
      (ChatCompletionsService as any).shouldTryHttpFirst(
        'https://external.example.com/api/v1/tickets',
        'https://sebastian.msp.svc.cluster.local:3000',
      ),
    ).toBe(false);
  });

  it('rejects unresolved templated path segments before issuing a tool request', async () => {
    const { ChatCompletionsService } = await import('@ee/services/chatCompletionsService');

    expect(() =>
      (ChatCompletionsService as any).buildFetchRequest(
        {
          ...registryEntry,
          id: 'projects.task.get',
          method: 'get',
          path: '/api/v1/projects/tasks/{taskId}',
          parameters: [],
        },
        {},
        'https://example.invalid',
        'api-key',
        'tenant-1',
      ),
    ).toThrow('Unresolved path parameters for projects.task.get: taskId');
  });

  it('falls back to https when http-first tool call fails', async () => {
    const { ChatCompletionsService } = await import('@ee/services/chatCompletionsService');
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
      .mockResolvedValueOnce(
        new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );

    const response = await (ChatCompletionsService as any).fetchWithProtocolFallback(
      'https://sebastian.msp.svc.cluster.local:3000/api/v1/tickets',
      { method: 'GET' },
      'https://sebastian.msp.svc.cluster.local:3000',
    );

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      'http://sebastian.msp.svc.cluster.local:3000/api/v1/tickets',
    );
    expect(fetchSpy.mock.calls[1]?.[0]).toBe(
      'https://sebastian.msp.svc.cluster.local:3000/api/v1/tickets',
    );
    fetchSpy.mockRestore();
  });

  it('decline execution path skips endpoint call and keeps conversation usable', async () => {
    const { ChatCompletionsService } = await import('@ee/services/chatCompletionsService');

    const executeFunctionCallSpy = vi.spyOn(ChatCompletionsService as any, 'executeFunctionCall');
    const processModelInteractionSpy = vi
      .spyOn(ChatCompletionsService as any, 'processModelInteraction')
      .mockResolvedValue({
        type: 'assistant_message',
        message: { role: 'assistant', content: 'Declined. We can continue.' },
        nextMessages: [],
        modelMessages: [],
      });

    const response = await (ChatCompletionsService as any).executeAfterApproval({
      messages: [{ role: 'user', content: 'Run endpoint' }],
      functionCall: {
        name: 'call_api_endpoint',
        arguments: { entryId: 'tickets.list' },
        toolCallId: 'tool-call-decline',
        entryId: 'tickets.list',
      },
      action: 'decline',
      baseUrl: 'https://example.invalid',
      tenantId: 'tenant-1',
      userId: 'user-1',
      chatId: 'chat-1',
    });

    expect(executeFunctionCallSpy).not.toHaveBeenCalled();
    expect(processModelInteractionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'function',
            content: expect.stringContaining('User declined'),
          }),
        ]),
      }),
    );
    expect(response).toMatchObject({
      type: 'assistant_message',
      message: expect.objectContaining({ content: 'Declined. We can continue.' }),
    });
  });

  it('handleExecute returns 400 when function call data is missing', async () => {
    process.env.EDITION = 'ee';
    getCurrentUserMock.mockResolvedValue({ user_id: 'user-1', tenant: 'tenant-1' });

    const { ChatCompletionsService } = await import('@ee/services/chatCompletionsService');

    const request = new NextRequest(
      new Request('https://example.invalid/api/chat/v1/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }),
      }),
    );

    const response = await ChatCompletionsService.handleExecute(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Missing function call information',
    });
  });

  it('keeps tool call identifiers stable between proposal and function-result replay', async () => {
    const { ChatCompletionsService } = await import('@ee/services/chatCompletionsService');

    vi.spyOn(ChatCompletionsService as any, 'executeFunctionCall').mockResolvedValue({
      status: 200,
      ok: true,
      data: { id: 'result-2' },
    });
    vi.spyOn(ChatCompletionsService as any, 'processModelInteraction').mockResolvedValue({
      type: 'assistant_message',
      message: { role: 'assistant', content: 'done' },
      nextMessages: [],
      modelMessages: [],
    });

    const response = await (ChatCompletionsService as any).executeAfterApproval({
      messages: [{ role: 'user', content: 'Run endpoint' }],
      functionCall: {
        name: 'call_api_endpoint',
        arguments: { entryId: 'tickets.list' },
        toolCallId: 'stable-id-123',
        entryId: 'tickets.list',
      },
      action: 'approve',
      baseUrl: 'https://example.invalid',
      tenantId: 'tenant-1',
      userId: 'user-1',
      chatId: 'chat-1',
    });

    expect(response).toMatchObject({
      type: 'assistant_message',
      functionCall: expect.objectContaining({
        toolCallId: 'stable-id-123',
      }),
    });
  });

  it('Vertex follow-up request after tool replay preserves assistant reasoning_content in outbound messages', async () => {
    process.env.AI_CHAT_PROVIDER = 'vertex';
    setSecrets({
      VERTEX_PROJECT_ID: 'proj-55',
      VERTEX_LOCATION: 'us-central1',
      VERTEX_CHAT_MODEL: 'glm-5-maas',
    });

    openAiCreateSpy.mockResolvedValueOnce(
      buildCompletion({
        content: 'Follow-up complete',
        reasoning_content: [{ type: 'reasoning', text: 'follow-up reasoning' }],
      }),
    );

    const { ChatCompletionsService } = await import('@ee/services/chatCompletionsService');

    vi.spyOn(ChatCompletionsService as any, 'executeFunctionCall').mockResolvedValue({
      status: 200,
      ok: true,
      data: { id: 'vertex-result' },
    });

    await (ChatCompletionsService as any).executeAfterApproval({
      messages: [
        { role: 'user', content: 'Do a thing' },
        {
          role: 'assistant',
          content: 'Plan text',
          reasoning_content: 'persist this reasoning',
          function_call: {
            name: 'call_api_endpoint',
            arguments: { entryId: 'tickets.list' },
          },
          tool_call_id: 'vertex-tool-call-1',
        },
      ],
      functionCall: {
        name: 'call_api_endpoint',
        arguments: { entryId: 'tickets.list' },
        toolCallId: 'vertex-tool-call-1',
        entryId: 'tickets.list',
      },
      action: 'approve',
      baseUrl: 'https://example.invalid',
      tenantId: 'tenant-1',
      userId: 'user-1',
      chatId: 'chat-1',
    });

    const request = openAiCreateSpy.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    const messages = (request.messages as Array<Record<string, unknown>>) ?? [];

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          reasoning_content: 'persist this reasoning',
        }),
      ]),
    );
  });
});
