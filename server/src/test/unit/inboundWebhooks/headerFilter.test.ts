import { describe, expect, it } from 'vitest';

import { filterInboundWebhookHeaders } from '@/lib/inboundWebhooks/headerFilter';

describe('inbound webhook header filter', () => {
  it('T044: strips Cookie and Authorization before header persistence', () => {
    const filtered = filterInboundWebhookHeaders(
      new Headers({
        Authorization: 'Bearer secret-token',
        Cookie: 'session=secret',
        'Set-Cookie': 'session=secret',
        'Proxy-Authorization': 'Basic secret',
        'X-Api-Key': 'api-secret',
        'Content-Type': 'application/json',
        'X-Request-Id': 'request-1',
      }),
    );

    expect(filtered).toEqual({
      'content-type': 'application/json',
      'x-request-id': 'request-1',
    });
    expect(filtered).not.toHaveProperty('authorization');
    expect(filtered).not.toHaveProperty('cookie');
    expect(filtered).not.toHaveProperty('set-cookie');
    expect(filtered).not.toHaveProperty('proxy-authorization');
    expect(filtered).not.toHaveProperty('x-api-key');
  });
});
