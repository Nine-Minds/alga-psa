import { describe, expect, it, vi } from 'vitest';
import { POST } from '../../../../../../../ee/server/src/app/api/teams/bot/messages/route';

const { handleTeamsBotActivityRequestMock } = vi.hoisted(() => ({
  handleTeamsBotActivityRequestMock: vi.fn(),
}));

vi.mock('../../../../../../../ee/server/src/lib/teams/bot/teamsBotHandler', () => ({
  handleTeamsBotActivityRequest: handleTeamsBotActivityRequestMock,
}));

describe('POST /api/teams/bot/messages', () => {
  it('T253: exposes a Teams bot webhook route that delegates activity handling to the shared bot handler', async () => {
    handleTeamsBotActivityRequestMock.mockResolvedValue(
      new Response(JSON.stringify({ type: 'message', text: 'ok' }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      })
    );

    const request = new Request('https://example.test/api/teams/bot/messages', {
      method: 'POST',
      body: JSON.stringify({ type: 'message', text: 'help' }),
    }) as any;

    const response = await POST(request);

    expect(handleTeamsBotActivityRequestMock).toHaveBeenCalledWith(request);
    expect(response.status).toBe(200);
  });
});
