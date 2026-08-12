import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BotConnectorRequestError,
  sendBotActivity,
  updateBotActivity,
} from '../teamsBotConnector';

/**
 * The connector caches its access token, so an expiry between the cache check
 * and the request is normal traffic, not a failure. It is replayed here — the
 * one place every caller goes through (bot replies, DM notifications, the
 * proactive welcome card, the diagnostics test send) — so no caller has to
 * know about it, and none can forget.
 */

const SERVICE_URL = 'https://smba.trafficmanager.net/amer/';
const TOKEN_URL = 'https://login.microsoftonline.com/bot-tenant-1/oauth2/v2.0/token';

let fetchMock: ReturnType<typeof vi.fn>;

function tokenResponse(token: string): Response {
  return new Response(JSON.stringify({ access_token: token, expires_in: 3600 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function activityResponse(status: number, body = '{}'): Response {
  return new Response(body, { status, statusText: status === 401 ? 'Unauthorized' : 'Error' });
}

/** URLs of the activity POST/PUTs only, in order. */
function activityCalls(): Array<{ url: string; init: RequestInit }> {
  return fetchMock.mock.calls
    .map(([url, init]) => ({ url: String(url), init: (init ?? {}) as RequestInit }))
    .filter((call) => call.url !== TOKEN_URL);
}

function bearerTokens(): string[] {
  return activityCalls().map(
    (call) => String((call.init.headers as Record<string, string>).Authorization)
  );
}

beforeEach(() => {
  // Each test gets a fresh module registry so the connector's cached token
  // never leaks between cases.
  vi.resetModules();
  vi.stubEnv('TEAMS_BOT_APP_ID', 'bot-app-1');
  vi.stubEnv('TEAMS_BOT_APP_TENANT_ID', 'bot-tenant-1');
  vi.stubEnv('TEAMS_BOT_APP_PASSWORD', 'bot-secret-1');
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function loadConnector(): Promise<typeof import('../teamsBotConnector')> {
  return import('../teamsBotConnector');
}

describe('bot connector expired-token replay', () => {
  it('retries a 401 send once with a freshly minted token', async () => {
    const connector = await loadConnector();
    fetchMock
      .mockResolvedValueOnce(tokenResponse('stale-token'))
      .mockResolvedValueOnce(activityResponse(401))
      .mockResolvedValueOnce(tokenResponse('fresh-token'))
      .mockResolvedValueOnce(activityResponse(200));

    await expect(
      connector.sendBotActivity({
        serviceUrl: SERVICE_URL,
        conversationId: 'conversation-1',
        activity: { type: 'message', text: 'hello' },
      })
    ).resolves.toEqual({ status: 'sent' });

    expect(bearerTokens()).toEqual(['Bearer stale-token', 'Bearer fresh-token']);
    // Same activity, byte for byte — a replay, not a downgrade.
    expect(activityCalls()[0].init.body).toBe(activityCalls()[1].init.body);
  });

  it('surfaces a second 401 instead of retrying forever', async () => {
    const connector = await loadConnector();
    fetchMock
      .mockResolvedValueOnce(tokenResponse('stale-token'))
      .mockResolvedValueOnce(activityResponse(401))
      .mockResolvedValueOnce(tokenResponse('fresh-token'))
      .mockResolvedValueOnce(activityResponse(401));

    await expect(
      connector.sendBotActivity({
        serviceUrl: SERVICE_URL,
        conversationId: 'conversation-1',
        activity: { type: 'message', text: 'hello' },
      })
    ).rejects.toMatchObject({ name: 'BotConnectorRequestError', status: 401 });

    expect(activityCalls()).toHaveLength(2);
  });

  it('surfaces a card rejection that follows the replay, so callers can fall back', async () => {
    const connector = await loadConnector();
    fetchMock
      .mockResolvedValueOnce(tokenResponse('stale-token'))
      .mockResolvedValueOnce(activityResponse(401))
      .mockResolvedValueOnce(tokenResponse('fresh-token'))
      .mockResolvedValueOnce(activityResponse(415, 'adaptive rejected'));

    await expect(
      connector.sendBotActivity({
        serviceUrl: SERVICE_URL,
        conversationId: 'conversation-1',
        activity: { type: 'message', text: 'hello' },
      })
    ).rejects.toMatchObject({ status: 415 });
  });

  it('does not retry a non-401 failure', async () => {
    const connector = await loadConnector();
    fetchMock
      .mockResolvedValueOnce(tokenResponse('token-1'))
      .mockResolvedValueOnce(activityResponse(403, 'nope'));

    await expect(
      connector.sendBotActivity({
        serviceUrl: SERVICE_URL,
        conversationId: 'conversation-1',
        activity: { type: 'message', text: 'hello' },
      })
    ).rejects.toMatchObject({ status: 403 });

    expect(activityCalls()).toHaveLength(1);
  });

  it('replays an in-place card update too', async () => {
    const connector = await loadConnector();
    fetchMock
      .mockResolvedValueOnce(tokenResponse('stale-token'))
      .mockResolvedValueOnce(activityResponse(401))
      .mockResolvedValueOnce(tokenResponse('fresh-token'))
      .mockResolvedValueOnce(activityResponse(200));

    await expect(
      connector.updateBotActivity({
        serviceUrl: SERVICE_URL,
        conversationId: 'conversation-1',
        activityId: 'card-activity-1',
        activity: { type: 'message', text: 'updated' },
      })
    ).resolves.toEqual({ status: 'sent' });

    const calls = activityCalls();
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.init.method === 'PUT')).toBe(true);
    expect(calls[0].url).toContain('/v3/conversations/conversation-1/activities/card-activity-1');
  });

  it('keeps the untrusted-serviceUrl guard ahead of any send', async () => {
    const connector = await loadConnector();

    await expect(
      connector.sendBotActivity({
        serviceUrl: 'http://attacker.example.com',
        conversationId: 'conversation-1',
        activity: { type: 'message', text: 'hello' },
      })
    ).resolves.toEqual({ status: 'skipped', reason: 'untrusted_service_url' });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('module exports', () => {
  it('exposes the typed connector error the callers classify on', () => {
    expect(new BotConnectorRequestError('boom', 429).status).toBe(429);
    expect(typeof sendBotActivity).toBe('function');
    expect(typeof updateBotActivity).toBe('function');
  });
});
