import { describe, expect, it, vi } from 'vitest';
import {
  buildContactCreatePayload,
  buildContactListQuery,
  buildContactUpdatePayload,
  formatAlgaApiError,
  normalizeSuccessResponse,
  parseContactEmailAddresses,
  parseContactPhoneNumbers,
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

  it('T011: contact create payload builder maps full_name and omits absent optional fields', () => {
    const payload = buildContactCreatePayload({
      fullName: 'Ada Lovelace',
      additionalFields: {},
    });

    expect(payload).toEqual({ full_name: 'Ada Lovelace' });
  });

  it('T012: contact create payload builder includes scalar optional fields when present', () => {
    const payload = buildContactCreatePayload({
      fullName: 'Ada Lovelace',
      additionalFields: {
        email: 'ada@example.com',
        client_id: '00000000-0000-0000-0000-000000000001',
        role: 'CTO',
        notes: 'Primary automation contact',
        is_inactive: true,
      },
    });

    expect(payload).toEqual({
      full_name: 'Ada Lovelace',
      email: 'ada@example.com',
      client_id: '00000000-0000-0000-0000-000000000001',
      role: 'CTO',
      notes: 'Primary automation contact',
      is_inactive: true,
    });
  });

  it('T013: contact update payload builder includes only provided update fields', () => {
    const payload = buildContactUpdatePayload({
      full_name: 'Updated Contact',
      email: '',
      client_id: '00000000-0000-0000-0000-000000000002',
      notes: 'Updated via n8n',
    });

    expect(payload).toEqual({
      full_name: 'Updated Contact',
      client_id: '00000000-0000-0000-0000-000000000002',
      notes: 'Updated via n8n',
    });
  });

  it('contact payload builders accept primary email metadata and additional email rows', () => {
    const createPayload = buildContactCreatePayload({
      fullName: 'Ada Lovelace',
      additionalFields: {
        email: 'ada@example.com',
        primary_email_canonical_type: 'billing',
        additional_email_addresses: JSON.stringify([
          {
            email_address: 'ada.personal@example.com',
            canonical_type: 'personal',
            display_order: 0,
          },
        ]),
      },
    });

    expect(createPayload).toEqual({
      full_name: 'Ada Lovelace',
      email: 'ada@example.com',
      primary_email_canonical_type: 'billing',
      additional_email_addresses: [
        {
          email_address: 'ada.personal@example.com',
          canonical_type: 'personal',
          display_order: 0,
        },
      ],
    });

    const updatePayload = buildContactUpdatePayload({
      primary_email_custom_type: 'Escalations',
      additional_email_addresses: JSON.stringify([
        {
          contact_additional_email_address_id: '00000000-0000-0000-0000-000000000010',
          email_address: 'ada.billing@example.com',
          custom_type: 'Billing Alias',
          display_order: 1,
        },
      ]),
    });

    expect(updatePayload).toEqual({
      primary_email_custom_type: 'Escalations',
      additional_email_addresses: [
        {
          contact_additional_email_address_id: '00000000-0000-0000-0000-000000000010',
          email_address: 'ada.billing@example.com',
          custom_type: 'Billing Alias',
          display_order: 1,
        },
      ],
    });
  });

  it('T014: contact list query builder serializes pagination and core filters correctly', () => {
    const query = buildContactListQuery({
      page: 3,
      limit: 50,
      filters: {
        client_id: '00000000-0000-0000-0000-000000000003',
        search_term: 'ada',
        is_inactive: false,
      },
    });

    expect(query).toEqual({
      page: 3,
      limit: 50,
      client_id: '00000000-0000-0000-0000-000000000003',
      search_term: 'ada',
      is_inactive: false,
    });
  });

  it('T015: phone_numbers parser accepts a valid JSON array of contact phone-number objects', () => {
    const parsed = parseContactPhoneNumbers(
      JSON.stringify([
        {
          phone_number: '+1-206-555-0100',
          canonical_type: 'mobile',
          is_default: true,
          display_order: 0,
        },
      ]),
    );

    expect(parsed).toEqual([
      {
        phone_number: '+1-206-555-0100',
        canonical_type: 'mobile',
        is_default: true,
        display_order: 0,
      },
    ]);
  });

  it('T016: phone_numbers parser rejects malformed JSON before any request is sent', () => {
    expect(() => parseContactPhoneNumbers('[{')).toThrow('phone_numbers must be valid JSON');
  });

  it('T017: phone_numbers parser rejects non-array JSON values before any request is sent', () => {
    expect(() => parseContactPhoneNumbers('{"phone_number":"+1-206-555-0100"}')).toThrow(
      'phone_numbers must be a JSON array',
    );
  });

  it('T018: phone_numbers parser rejects array entries that are missing phone_number', () => {
    expect(() =>
      parseContactPhoneNumbers(
        JSON.stringify([
          {
            canonical_type: 'mobile',
          },
        ]),
      ),
    ).toThrow('phone_numbers[0].phone_number is required');
  });

  it('parseContactEmailAddresses accepts JSON arrays of labeled additional email rows', () => {
    const parsed = parseContactEmailAddresses(
      JSON.stringify([
        {
          email_address: 'ada.personal@example.com',
          canonical_type: 'personal',
          display_order: 0,
        },
      ]),
    );

    expect(parsed).toEqual([
      {
        email_address: 'ada.personal@example.com',
        canonical_type: 'personal',
        display_order: 0,
      },
    ]);
  });
});
