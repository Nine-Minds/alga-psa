import crypto from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { POST as requestReactivation } from '../../../../../packages/ee/src/app/api/billing/request-reactivation/route';

function signedRequest(body: Record<string, unknown>, payload: string): Request {
  const timestamp = Date.now().toString();
  const signature = crypto
    .createHmac('sha256', 'shared-secret')
    .update(`${payload}:${timestamp}`)
    .digest('hex');

  return new Request('https://alga.example.test/api/billing/request-reactivation', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Signature': signature,
      'X-Timestamp': timestamp,
    },
    body: JSON.stringify(body),
  });
}

describe('reactivation license count request contract', () => {
  it('accepts a request whose signature authenticates the five-license count', async () => {
    process.env.ALGA_WEBHOOK_SECRET = 'shared-secret';

    const response = await requestReactivation(signedRequest(
      { email: 'owner@example.com', licenseCount: 5 },
      'owner@example.com:5',
    ) as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
  });

  it.each([undefined, 0, -1, 1.5, 1001])(
    'rejects invalid requested license count %s',
    async (licenseCount) => {
      process.env.ALGA_WEBHOOK_SECRET = 'shared-secret';

      const response = await requestReactivation(signedRequest(
        { email: 'owner@example.com', licenseCount },
        `owner@example.com:${licenseCount}`,
      ) as never);

      expect(response.status).toBe(400);
    },
  );

  it('rejects the old signature that does not authenticate the license count', async () => {
    process.env.ALGA_WEBHOOK_SECRET = 'shared-secret';

    const response = await requestReactivation(signedRequest(
      { email: 'owner@example.com', licenseCount: 5 },
      'owner@example.com',
    ) as never);

    expect(response.status).toBe(401);
  });
});
