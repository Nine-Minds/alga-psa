import { describe, expect, it, vi } from 'vitest';
import { POST } from '../../../../../../../ee/server/src/app/api/teams/message-extension/query/route';

const { handleTeamsMessageExtensionRequestMock } = vi.hoisted(() => ({
  handleTeamsMessageExtensionRequestMock: vi.fn(),
}));

vi.mock('../../../../../../../ee/server/src/lib/teams/messageExtension/teamsMessageExtensionHandler', () => ({
  handleTeamsMessageExtensionRequest: handleTeamsMessageExtensionRequestMock,
}));

describe('POST /api/teams/message-extension/query', () => {
  it('T309: exposes a Teams message-extension route that delegates query handling to the shared message-extension handler', async () => {
    handleTeamsMessageExtensionRequestMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          composeExtension: {
            type: 'result',
            attachments: [],
          },
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
    );

    const request = new Request('https://example.test/api/teams/message-extension/query', {
      method: 'POST',
      body: JSON.stringify({
        type: 'invoke',
        name: 'composeExtension/query',
      }),
    }) as any;

    const response = await POST(request);

    expect(handleTeamsMessageExtensionRequestMock).toHaveBeenCalledWith(request);
    expect(response.status).toBe(200);
  });

  it('T129/T130: routes message-action submissions through the same EE-owned message-extension handler boundary', async () => {
    handleTeamsMessageExtensionRequestMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          task: {
            type: 'message',
            value: 'handled',
          },
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
    );

    const request = new Request('https://example.test/api/teams/message-extension/query', {
      method: 'POST',
      body: JSON.stringify({
        type: 'invoke',
        name: 'composeExtension/submitAction',
      }),
    }) as any;

    const response = await POST(request);

    expect(handleTeamsMessageExtensionRequestMock).toHaveBeenCalledWith(request);
    expect(response.status).toBe(200);
  });

  it('T310: preserves recoverable invalid-request responses from the shared message-extension handler', async () => {
    handleTeamsMessageExtensionRequestMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'invalid_json',
          message: 'The Teams message extension request body must be valid JSON.',
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
    );

    const request = new Request('https://example.test/api/teams/message-extension/query', {
      method: 'POST',
      body: 'not-json',
    }) as any;

    const response = await POST(request);
    const payload = await response.json();

    expect(handleTeamsMessageExtensionRequestMock).toHaveBeenCalledWith(request);
    expect(response.status).toBe(400);
    expect(payload).toEqual({
      error: 'invalid_json',
      message: 'The Teams message extension request body must be valid JSON.',
    });
  });
});
