import jwt from 'jsonwebtoken';
import OpenAI from 'openai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { toAiCreditsError } from '../../../../../../ee/server/src/lib/aiGateway/errors';
import { AiCreditsError } from '../../../../../../ee/server/src/lib/aiGateway/types';

const fetchMock = vi.fn<typeof fetch>();

const accountSummary = {
  subscriptionStatus: 'active' as const,
  includedBalanceCredits: 900,
  topupBalanceCredits: 100,
  graceLimitCredits: 100,
  totalBalanceCredits: 1000,
  lowBalance: false,
  cycleStartedAt: '2026-07-20T00:00:00.000Z',
  autoTopup: {
    enabled: false,
    thresholdCredits: null,
    packPriceId: null,
  },
  consentStatus: 'granted' as const,
};

describe('AI gateway client', () => {
  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    process.env.AI_GATEWAY_URL = 'https://gateway.example.test/';
    process.env.AI_GATEWAY_SERVICE_SECRET = 'gateway-test-secret';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.AI_GATEWAY_URL;
    delete process.env.AI_GATEWAY_SERVICE_SECRET;
  });

  it('exports only the frozen client surface', async () => {
    const client = await import('../../../../../../ee/server/src/lib/aiGateway/client');
    expect(Object.keys(client).sort()).toEqual([
      'aiGatewayFetchAccount',
      'aiGatewayFetchUsage',
      'aiGatewaySetAutoTopup',
      'mintGatewayToken',
    ]);
  });

  it('mints a unique five-minute HS256 token carrying tenant_id', async () => {
    const { mintGatewayToken } = await import('../../../../../../ee/server/src/lib/aiGateway/client');
    const first = mintGatewayToken('tenant-123');
    const second = mintGatewayToken('tenant-123');
    const decoded = jwt.verify(first, 'gateway-test-secret', {
      algorithms: ['HS256'],
    }) as jwt.JwtPayload;

    expect(decoded.tenant_id).toBe('tenant-123');
    expect(decoded.exp).toBeDefined();
    expect(decoded.iat).toBeDefined();
    expect(decoded.exp! - decoded.iat!).toBe(300);
    expect(decoded.jti).toBeTypeOf('string');
    expect(second).not.toBe(first);
  });

  it('fetches the account with a bearer tenant token', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(accountSummary), { status: 200 }));
    const { aiGatewayFetchAccount } = await import('../../../../../../ee/server/src/lib/aiGateway/client');

    await expect(aiGatewayFetchAccount('tenant-account')).resolves.toEqual(accountSummary);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://gateway.example.test/v1/account',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/json',
          Authorization: expect.stringMatching(/^Bearer /),
        }),
      }),
    );
  });

  it('serializes usage filters and posts auto-top-up settings', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ events: [], nextCursor: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(accountSummary), { status: 200 }));
    const { aiGatewayFetchUsage, aiGatewaySetAutoTopup } = await import('../../../../../../ee/server/src/lib/aiGateway/client');

    await aiGatewayFetchUsage('tenant-usage', {
      from: '2026-07-01T00:00:00.000Z',
      feature: 'chat-title',
      cursor: 'next page',
      limit: 25,
    });
    await aiGatewaySetAutoTopup('tenant-usage', {
      enabled: true,
      thresholdCredits: 50,
      packPriceId: 'price_pack',
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://gateway.example.test/v1/account/usage?from=2026-07-01T00%3A00%3A00.000Z&feature=chat-title&cursor=next+page&limit=25',
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://gateway.example.test/v1/account/auto-topup',
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({
        enabled: true,
        thresholdCredits: 50,
        packPriceId: 'price_pack',
      }),
      headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
    });
  });

  it('maps a gateway HTTP 402 body to AiCreditsError', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'out_of_credits' },
    }), { status: 402 }));
    const { aiGatewayFetchAccount } = await import('../../../../../../ee/server/src/lib/aiGateway/client');

    await expect(aiGatewayFetchAccount('tenant-empty')).rejects.toMatchObject({
      name: 'AiCreditsError',
      reason: 'out_of_credits',
    });
  });

  it('normalizes an OpenAI APIError raised for a gateway 402', () => {
    const sdkError = new OpenAI.APIError(
      402,
      { code: 'no_subscription' },
      undefined,
      {},
    );

    const creditsError = toAiCreditsError(sdkError);
    expect(creditsError).toBeInstanceOf(AiCreditsError);
    expect(creditsError?.reason).toBe('no_subscription');
  });
});
