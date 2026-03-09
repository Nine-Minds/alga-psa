import { describe, expect, it, vi } from 'vitest';
import {
  formatAlgaApiError,
  normalizeSuccessResponse,
} from '../nodes/AlgaPsa/helpers';
import { buildAlgaApiRequestOptions } from '../nodes/AlgaPsa/transport';

describe('Transport and normalization helpers', () => {
  it('T004: request helper normalizes base URL and endpoint slashes', () => {
    const options = buildAlgaApiRequestOptions(
      {
        baseUrl: 'https://api.algapsa.test///',
        apiKey: 'secret-key',
      },
      'GET',
      'api/v1/tickets',
      { page: 1 },
    );

    expect(options.url).toBe('https://api.algapsa.test/api/v1/tickets');
    expect(options.qs).toEqual({ page: 1 });
  });

  it('T005: request helper injects x-api-key and does not log credential values', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const options = buildAlgaApiRequestOptions(
      {
        baseUrl: 'https://api.algapsa.test',
        apiKey: 'sensitive-key',
      },
      'POST',
      '/api/v1/tickets',
      undefined,
      { title: 'Example' },
    );

    expect(options.headers?.['x-api-key']).toBe('sensitive-key');
    expect(options.url).not.toContain('sensitive-key');
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('T025: response normalizer unwraps single-object data responses', () => {
    const normalized = normalizeSuccessResponse({ data: { ticket_id: 'abc', title: 'A' } });
    expect(normalized).toEqual({ ticket_id: 'abc', title: 'A' });
  });

  it('T026: response normalizer unwraps list data and preserves pagination metadata', () => {
    const normalized = normalizeSuccessResponse({
      data: [{ ticket_id: 'abc' }],
      pagination: { page: 1, total: 1 },
    });

    expect(normalized).toEqual({
      data: [{ ticket_id: 'abc' }],
      pagination: { page: 1, total: 1 },
    });
  });

  it('T027: maps 401 API response into actionable error shape', () => {
    const parsed = formatAlgaApiError({
      response: {
        status: 401,
        data: {
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid API key',
            details: { reason: 'missing key' },
          },
        },
      },
    });

    expect(parsed).toEqual({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Invalid API key',
      details: { reason: 'missing key' },
    });
  });

  it('T028: maps 403 API response into actionable error shape', () => {
    const parsed = formatAlgaApiError({
      response: {
        status: 403,
        data: {
          error: {
            code: 'FORBIDDEN',
            message: 'Permission denied',
            details: { permission: 'ticket:update' },
          },
        },
      },
    });

    expect(parsed.code).toBe('FORBIDDEN');
    expect(parsed.statusCode).toBe(403);
    expect(parsed.details).toEqual({ permission: 'ticket:update' });
  });

  it('T029: maps 404 API response into actionable error shape', () => {
    const parsed = formatAlgaApiError({
      response: {
        status: 404,
        data: {
          error: {
            code: 'NOT_FOUND',
            message: 'Ticket not found',
            details: { ticketId: 'missing-id' },
          },
        },
      },
    });

    expect(parsed.code).toBe('NOT_FOUND');
    expect(parsed.message).toBe('Ticket not found');
    expect(parsed.statusCode).toBe(404);
  });

  it('T030: maps 400 API response into actionable error shape', () => {
    const parsed = formatAlgaApiError({
      response: {
        status: 400,
        data: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Validation failed',
            details: [{ path: ['status_id'], message: 'Invalid UUID' }],
          },
        },
      },
    });

    expect(parsed.code).toBe('VALIDATION_ERROR');
    expect(parsed.message).toBe('Validation failed');
    expect(parsed.statusCode).toBe(400);
    expect(parsed.details).toEqual([{ path: ['status_id'], message: 'Invalid UUID' }]);
  });
});
