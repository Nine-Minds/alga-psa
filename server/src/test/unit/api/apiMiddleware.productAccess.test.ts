import { describe, expect, it } from 'vitest';

import { handleApiError } from '../../../lib/api/middleware/apiMiddleware';

describe('api middleware product access error mapping', () => {
  it('maps PRODUCT_ACCESS_DENIED with status to HTTP 403', async () => {
    const response = handleApiError({
      name: 'ProductAccessError',
      message: 'Denied by product',
      code: 'PRODUCT_ACCESS_DENIED',
      status: 403,
      details: { capability: 'ai_chat' },
    });

    const payload = await response.json();
    expect(response.status).toBe(403);
    expect(payload.error).toMatchObject({
      code: 'PRODUCT_ACCESS_DENIED',
      message: 'Denied by product',
    });
  });

  it('maps PRODUCT_ACCESS_DENIED with statusCode to HTTP 403', async () => {
    const response = handleApiError({
      name: 'ProductAccessError',
      message: 'Denied by product',
      code: 'PRODUCT_ACCESS_DENIED',
      statusCode: 403,
      details: { capability: 'ai_chat' },
    });

    const payload = await response.json();
    expect(response.status).toBe(403);
    expect(payload.error).toMatchObject({
      code: 'PRODUCT_ACCESS_DENIED',
      message: 'Denied by product',
    });
  });
});
