import { describe, expect, it, vi } from 'vitest';

const openAiCreateSpy = vi.fn();

function createEmptyAsyncIterable() {
  return {
    async *[Symbol.asyncIterator]() {
      // no-op
    },
  };
}

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
    getSecret: actual.getSecret,
    getSecretProviderInstance: vi.fn(async () => ({
      getAppSecret: vi.fn(async () => 'test-openrouter-key'),
    })),
  };
});

vi.mock('@alga-psa/users/actions', () => ({
  getCurrentUser: vi.fn(async () => null),
}));

describe('ChatCompletionsService (streaming)', () => {
  it('passes stream: true to OpenRouter OpenAI client', async () => {
    openAiCreateSpy.mockResolvedValueOnce(createEmptyAsyncIterable());

    const { ChatCompletionsService } = await import('@ee/services/chatCompletionsService');

    await ChatCompletionsService.createRawCompletionStream([
      { role: 'user', content: 'Hello' },
    ]);

    expect(openAiCreateSpy).toHaveBeenCalledTimes(1);
    const [request] = openAiCreateSpy.mock.calls[0] ?? [];
    expect(request).toEqual(expect.objectContaining({ stream: true }));
  });
});
