import { afterEach, describe, expect, it, vi } from 'vitest';

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
    expect(payload.error.details).toMatchObject({ table: 'contracts', column: 'created_by' });
  });

  it('keeps schema diagnostics out of production responses while logging column context', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = handleApiError({
        name: 'error', message: 'column "created_by" of relation "contracts" does not exist',
        code: '42703',
      });
      const payload = await response.json();
      expect(response.status).toBe(500);
      expect(payload.error.details).toBeUndefined();
      expect(JSON.stringify(payload)).not.toMatch(/created_by|contracts/);
      expect(errorLog).toHaveBeenCalledWith('Undefined database column (42703):', expect.objectContaining({
        table: 'contracts', column: 'created_by',
      }));
    } finally {
      errorLog.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});
