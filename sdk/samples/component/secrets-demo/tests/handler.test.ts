import { describe, expect, it } from 'vitest';
import { handler } from '../src/handler.js';
import { createMockHostBindings, ExecuteRequest } from '@alga/extension-runtime';

const baseRequest: ExecuteRequest = {
  context: {
    tenantId: 'tenant-123',
    extensionId: 'ext-abc',
    requestId: 'req-1',
    config: { region: 'us-east-1' },
  },
  http: {
    method: 'GET',
    url: '/demo',
    headers: [],
  },
};

describe('handler', () => {
  it('echoes secrets and config', async () => {
    const host = createMockHostBindings({
      secrets: {
        async get(key: string) {
          if (key === 'greeting') return 'hello from secret';
          throw new Error('unknown secret');
        },
        async list() {
          return ['greeting'];
        },
      },
    });

    const response = await handler(baseRequest, host);
    expect(response.status).toBe(200);
    const json = JSON.parse(new TextDecoder().decode(response.body ?? new Uint8Array()));
    expect(json.message).toBe('hello from secret');
    expect(json.config.region).toBe('us-east-1');
  });
});
