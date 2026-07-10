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
    getSecret: vi.fn(async (name: string) => {
      if (name === 'OPENROUTER_API_KEY') {
        return 'test-openrouter-key';
      }
      return '';
    }),
    getSecretProviderInstance: vi.fn(async () => ({
      getAppSecret: vi.fn(async () => 'test-openrouter-key'),
    })),
  };
});

vi.mock('@alga-psa/users/actions', () => ({
  getCurrentUser: vi.fn(async () => null),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: vi.fn(async () => null),
  findUserById: vi.fn(async () => null),
}));

vi.mock('@alga-psa/assets/actions/assetActions', () => ({
  getAssetDetailBundle: vi.fn(),
}));

vi.mock('@alga-psa/assets/actions/assetActionErrors', () => ({
  isAssetActionError: vi.fn(() => false),
}));

vi.mock('@alga-psa/clients/actions', () => ({
  getClientById: vi.fn(),
  getContactByContactNameId: vi.fn(),
}));

vi.mock('@alga-psa/projects/actions/projectActions', () => ({
  getProject: vi.fn(),
}));

vi.mock('@alga-psa/tickets/actions/ticketActions', () => ({
  getTicketById: vi.fn(),
}));

vi.mock('@alga-psa/tickets/actions/comment-actions/commentActions', () => ({
  findCommentsByTicketId: vi.fn(),
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
