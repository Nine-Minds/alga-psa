import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const notificationMocks = vi.hoisted(() => ({
  notifyAiGatewayEvent: vi.fn(),
}));

vi.mock('../../../../../ee/server/src/lib/aiGateway/notifications', () => ({
  AI_GATEWAY_EVENT_TYPES: [
    'low_balance_crossed',
    'entered_grace',
    'hard_stop',
    'auto_topup_succeeded',
    'auto_topup_failed',
    'auto_topup_disabled',
  ],
  notifyAiGatewayEvent: notificationMocks.notifyAiGatewayEvent,
}));

import { POST } from '../../../../../ee/server/src/app/api/webhooks/ai-gateway/route';

const WEBHOOK_URL = 'http://localhost/api/webhooks/ai-gateway';
const SECRET = 'events-webhook-secret';

function eventRequest(
  body: unknown,
  headers: Record<string, string> = { 'X-Alga-Webhook-Secret': SECRET },
): Request {
  return new Request(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

const hostedEvent = {
  eventId: 'evt-1',
  type: 'hard_stop',
  accountId: 'acct-1',
  tenantId: 'tenant-hosted',
  deploymentType: 'hosted',
  createdAt: '2026-07-20T00:00:00.000Z',
};

describe('AI gateway events webhook route', () => {
  beforeEach(() => {
    notificationMocks.notifyAiGatewayEvent.mockReset();
    notificationMocks.notifyAiGatewayEvent.mockResolvedValue(undefined);
    process.env.AI_GATEWAY_EVENTS_WEBHOOK_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.AI_GATEWAY_EVENTS_WEBHOOK_SECRET;
  });

  it('returns 503 when the shared secret is not configured', async () => {
    delete process.env.AI_GATEWAY_EVENTS_WEBHOOK_SECRET;

    const response = await POST(eventRequest(hostedEvent));

    expect(response.status).toBe(503);
    expect(notificationMocks.notifyAiGatewayEvent).not.toHaveBeenCalled();
  });

  it('rejects a missing or mismatched secret header', async () => {
    const missing = await POST(eventRequest(hostedEvent, {}));
    const wrong = await POST(
      eventRequest(hostedEvent, { 'X-Alga-Webhook-Secret': 'not-the-secret' }),
    );

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(notificationMocks.notifyAiGatewayEvent).not.toHaveBeenCalled();
  });

  it('rejects unknown event types and missing tenant ids', async () => {
    const unknownType = await POST(eventRequest({ ...hostedEvent, type: 'mystery' }));
    const missingTenant = await POST(eventRequest({ ...hostedEvent, tenantId: '  ' }));

    expect(unknownType.status).toBe(400);
    expect(missingTenant.status).toBe(400);
    expect(notificationMocks.notifyAiGatewayEvent).not.toHaveBeenCalled();
  });

  it('acknowledges appliance events without notifying', async () => {
    const response = await POST(
      eventRequest({ ...hostedEvent, deploymentType: 'appliance' }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, handled: false });
    expect(notificationMocks.notifyAiGatewayEvent).not.toHaveBeenCalled();
  });

  it('fans hosted events out to admin notifications', async () => {
    const response = await POST(eventRequest(hostedEvent));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, handled: true });
    expect(notificationMocks.notifyAiGatewayEvent).toHaveBeenCalledWith(
      'tenant-hosted',
      'hard_stop',
      'evt-1',
    );
  });

  it('reports a notification failure as a processing error', async () => {
    notificationMocks.notifyAiGatewayEvent.mockRejectedValue(new Error('db down'));

    const response = await POST(eventRequest(hostedEvent));

    expect(response.status).toBe(500);
  });
});
