import { describe, expect, it, vi } from 'vitest';

import { TacticalRmmClient } from '@alga-psa/integrations/lib/rmm/tacticalrmm/tacticalApiClient';

function axios401(): any {
  const err: any = new Error('Unauthorized');
  err.response = { status: 401 };
  return err;
}

describe('TacticalRmmClient Knox 401 retry guard', () => {
  it('retries at most once per request to avoid infinite loops', async () => {
    const refreshKnoxToken = vi.fn(async () => 'token_refreshed');
    const onKnoxTokenRefreshed = vi.fn(async (_t: string) => undefined);

    const client = new TacticalRmmClient({
      baseUrl: 'https://tactical.example',
      authMode: 'knox',
      knoxToken: 'token_initial',
      refreshKnoxToken,
      onKnoxTokenRefreshed,
    });

    const headersSeen: string[] = [];
    (client as any).ax.request = vi.fn(async (args: any) => {
      headersSeen.push(String(args?.headers?.Authorization || ''));
      throw axios401();
    });

    await expect(
      client.request({ method: 'GET', path: '/api/beta/v1/client/' })
    ).rejects.toThrow();

    // One refresh attempt max (even though both attempts 401).
    expect(refreshKnoxToken).toHaveBeenCalledTimes(1);
    expect(onKnoxTokenRefreshed).toHaveBeenCalledTimes(1);

    // Initial attempt uses initial token; retry uses refreshed token.
    expect(headersSeen).toEqual(['Token token_initial', 'Token token_refreshed']);
    expect((client as any).ax.request).toHaveBeenCalledTimes(2);
  });
});

