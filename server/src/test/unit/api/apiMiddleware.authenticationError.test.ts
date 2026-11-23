import { describe, expect, it } from 'vitest';

import { AuthenticationError } from '@alga-psa/auth';
import { handleApiError } from '../../../lib/api/middleware/apiMiddleware';

describe('api middleware AuthenticationError mapping', () => {
  it('maps AuthenticationError to 401 UNAUTHORIZED', async () => {
    const response = handleApiError(new AuthenticationError());
    const payload = await response.json();
    expect(response.status).toBe(401);
    expect(payload.error.code).toBe('UNAUTHORIZED');
    expect(typeof payload.error.message).toBe('string');
  });

  it('matches by name, so a separate copy of the class also maps to 401', async () => {
    const error = new Error('No session');
    error.name = 'AuthenticationError';
    const response = handleApiError(error);
    const payload = await response.json();
    expect(response.status).toBe(401);
    expect(payload.error).toMatchObject({ code: 'UNAUTHORIZED', message: 'No session' });
  });

  it('keeps 500 for unrelated errors', async () => {
    const response = handleApiError(new Error('boom'));
    expect(response.status).toBe(500);
  });

  it('keeps explicit status handling ahead of the name check', async () => {
    const error: any = new Error('nope');
    error.name = 'AuthenticationError';
    error.statusCode = 403;
    expect(handleApiError(error).status).toBe(403);
  });
});
