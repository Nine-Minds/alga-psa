import OpenAI from 'openai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createCompletionMock = vi.hoisted(() => vi.fn());
const getCurrentUserMock = vi.hoisted(() => vi.fn());
const resolveChatProviderMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: getCurrentUserMock,
}));

vi.mock('@ee/services/chatProviderResolver', () => ({
  resolveChatProvider: resolveChatProviderMock,
}));

describe('ChatStreamService gateway attribution', () => {
  beforeEach(() => {
    createCompletionMock.mockReset();
    getCurrentUserMock.mockReset();
    resolveChatProviderMock.mockReset();
    getCurrentUserMock.mockResolvedValue({ tenant: 'tenant-chat' });
    resolveChatProviderMock.mockResolvedValue({
      providerId: 'gateway',
      model: 'gateway/model',
      client: {
        chat: {
          completions: {
            create: createCompletionMock,
          },
        },
      },
      requestOverrides: {
        resolveTurnOverrides: () => ({}),
      },
    });
    createCompletionMock.mockResolvedValue({
      choices: [{ message: { content: 'A useful title' } }],
    });
  });

  it('resolves the title flow with the chat-title feature', async () => {
    const { ChatStreamService } = await import('@ee/services/chatStreamService');
    const request = {
      json: vi.fn().mockResolvedValue({
        inputs: [{ role: 'user', content: 'Name this conversation' }],
      }),
    };

    const response = await ChatStreamService.handleTitleStream(request as never);

    expect(response.status).toBe(200);
    expect(resolveChatProviderMock).toHaveBeenCalledWith('tenant-chat', 'chat-title');
    await expect(response.text()).resolves.toContain('A useful title');
  });

  it('returns the structured credits response for an OpenAI SDK 402', async () => {
    createCompletionMock.mockRejectedValue(new OpenAI.APIError(
      402,
      { code: 'out_of_credits' },
      undefined,
      {},
    ));
    const { ChatStreamService } = await import('@ee/services/chatStreamService');
    const request = {
      json: vi.fn().mockResolvedValue({
        inputs: [{ role: 'user', content: 'Hello' }],
      }),
    };

    const response = await ChatStreamService.handleChatStream(request as never);

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toEqual({
      type: 'ai_credits',
      reason: 'out_of_credits',
    });
  });
});
