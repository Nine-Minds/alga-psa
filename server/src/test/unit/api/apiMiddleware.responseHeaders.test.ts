import { describe, expect, it } from 'vitest';

import {
  TooManyRequestsError,
  createPaginatedResponse,
  createSuccessResponse,
  handleApiError,
} from '@/lib/api/middleware/apiMiddleware';
import { BundlePropagationConfirmationRequiredError } from '@alga-psa/tickets/lib/ticketBundlePropagation';

describe('apiMiddleware response headers', () => {
  it('merges ApiError.headers into error responses', async () => {
    const error = new TooManyRequestsError('Slow down', { remaining: 0 });
    error.headers = {
      'Retry-After': '60',
      'X-RateLimit-Remaining': '0',
    };

    const response = handleApiError(error);
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(body.error.code).toBe('RATE_LIMITED');
  });

  it('maps known application error codes to meaningful HTTP statuses', async () => {
    const response = handleApiError({
      name: 'AppError',
      code: 'QBO_SETUP_INCOMPLETE',
      message: 'Connect QuickBooks before syncing invoices',
      details: { realmId: 'realm-1' },
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toMatchObject({
      code: 'QBO_SETUP_INCOMPLETE',
      message: 'Connect QuickBooks before syncing invoices',
      details: { realmId: 'realm-1' },
    });
  });

  it('maps a bundle propagation confirmation error to 409 with the affected children', async () => {
    const error = new BundlePropagationConfirmationRequiredError({
      mode: 'sync_updates',
      masterTicketId: 'master-1',
      newStatusId: 'closed-1',
      crossesBoundary: 'close',
      affectedChildren: [
        { ticket_id: 'child-1', ticket_number: 'T-1', title: 'Child one', is_closed: false },
      ],
      unaffectedChildren: [
        { ticket_id: 'child-2', ticket_number: 'T-2', title: 'Child two', is_closed: true, reason: 'already_closed' },
      ],
    });

    const response = handleApiError(error);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.details.reason).toBe('bundle_propagation_confirmation_required');
    expect(body.error.details.crossesBoundary).toBe('close');
    expect(body.error.details.affectedChildren).toEqual([
      { ticket_id: 'child-1', ticket_number: 'T-1', title: 'Child one', is_closed: false },
    ]);
    expect(body.error.details.unaffectedChildren[0]).toMatchObject({ ticket_id: 'child-2', reason: 'already_closed' });
  });

  it('maps a JSON parse failure to 400, not the 500 fallback', async () => {
    // `await req.json()` on an empty or garbled body throws this; a bodyless
    // DELETE used to surface as 500 INTERNAL_ERROR (alga-2026-0002902).
    let parseError: unknown;
    try {
      JSON.parse('');
    } catch (error) {
      parseError = error;
    }

    const response = handleApiError(parseError);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Request body must be valid JSON',
    });
  });

  it('adds extra headers to success responses', () => {
    const response = createSuccessResponse(
      { ok: true },
      200,
      undefined,
      undefined,
      { 'X-RateLimit-Limit': '120' },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('X-RateLimit-Limit')).toBe('120');
  });

  it('derives success headers from request.context.rateLimit when a request is provided', () => {
    const response = createSuccessResponse(
      { ok: true },
      200,
      undefined,
      {
        context: {
          tenant: 'tenant-1',
          userId: 'user-1',
          rateLimit: {
            limit: 120,
            remaining: 119,
            resetAt: '2026-05-05T00:00:00.000Z',
          },
        },
      } as any,
    );

    expect(response.headers.get('X-RateLimit-Limit')).toBe('120');
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('119');
  });

  it('adds extra headers to paginated responses', () => {
    const response = createPaginatedResponse(
      [{ id: 1 }],
      1,
      1,
      25,
      undefined,
      undefined,
      { 'X-RateLimit-Remaining': '119' },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('119');
  });
});
