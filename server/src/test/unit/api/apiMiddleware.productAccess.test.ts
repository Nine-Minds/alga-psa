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

describe('api middleware undefined-column (42703) mapping', () => {
  it('maps a PostgreSQL 42703 to a sanitized public error, not INTERNAL_ERROR', async () => {
    const response = handleApiError({
      name: 'error',
      message: 'column "created_by" of relation "contracts" does not exist',
      code: '42703',
      detail: 'column "created_by" of relation "contracts" does not exist',
      table: 'contracts',
      column: 'created_by',
    });

    const payload = await response.json();
    expect(response.status).toBe(500);
    expect(payload.error).toMatchObject({
      code: 'INTERNAL_CONFIGURATION',
      message: 'The server is misconfigured for this operation. Please contact support.',
    });
    // Never leak relation/column identifiers into the public response.
    expect(JSON.stringify(payload)).not.toMatch(/created_by|contracts/);
    expect(payload.error.details).toBeUndefined();
  });
});
