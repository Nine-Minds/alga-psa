import { describe, expect, it, vi } from 'vitest';
import { POST } from '../../../../../../ee/server/src/app/api/teams/quick-actions/route';

const { handleTeamsQuickActionRequestMock } = vi.hoisted(() => ({
  handleTeamsQuickActionRequestMock: vi.fn(),
}));

vi.mock('../../../../../../ee/server/src/lib/teams/quickActions/teamsQuickActionHandler', () => ({
  handleTeamsQuickActionRequest: handleTeamsQuickActionRequestMock,
}));

describe('POST /api/teams/quick-actions', () => {
  it('T393: exposes a Teams quick-action route that delegates to the shared quick-action handler', async () => {
    handleTeamsQuickActionRequestMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          task: {
            type: 'message',
            value: 'ok',
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

    const request = new Request('https://example.test/api/teams/quick-actions', {
      method: 'POST',
      body: JSON.stringify({
        type: 'invoke',
        name: 'task/fetch',
      }),
    }) as any;

    const response = await POST(request);

    expect(handleTeamsQuickActionRequestMock).toHaveBeenCalledWith(request);
    expect(response.status).toBe(200);
  });

  it('T394: preserves recoverable invalid-request responses from the shared quick-action handler', async () => {
    handleTeamsQuickActionRequestMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'invalid_json',
          message: 'The Teams quick-action request body must be valid JSON.',
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
    );

    const request = new Request('https://example.test/api/teams/quick-actions', {
      method: 'POST',
      body: 'not-json',
    }) as any;

    const response = await POST(request);
    const payload = await response.json();

    expect(handleTeamsQuickActionRequestMock).toHaveBeenCalledWith(request);
    expect(response.status).toBe(400);
    expect(payload).toEqual({
      error: 'invalid_json',
      message: 'The Teams quick-action request body must be valid JSON.',
    });
  });
});
