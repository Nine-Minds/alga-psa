import { describe, expect, it } from 'vitest';
import { AppError } from '@alga-psa/core';

import { XeroClientService } from '../xeroClientService';
import { QboClientService } from '../../qbo/qboClientService';

const SENTINELS = {
  accessToken: 'SENTINEL-ACCESS-TOKEN-9f8e7d6c5b4a39281706f5e4d3c2b1a0aabbccdd',
  refreshToken: 'SENTINEL-REFRESH-TOKEN-0a1b2c3d4e5f60718293a4b5c6d7e8f9deadbeef',
  clientSecret: 'SENTINEL-CLIENT-SECRET-abcdef0123456789abcdef0123456789cafebabe',
  authHeader: 'Bearer SENTINEL-AUTH-HEADER-fedcba9876543210fedcba9876543210feedface',
  customerName: 'SENTINEL Customer Acme Ltd',
  invoiceDetail: 'SENTINEL Invoice INV-4242 for 12 widgets'
};

function expectNoSentinels(serialized: string): void {
  for (const sentinel of Object.values(SENTINELS)) {
    expect(serialized).not.toContain(sentinel);
  }
}

function serializeAppError(error: AppError): string {
  return JSON.stringify({ code: error.code, message: error.message, details: error.details });
}

function makeAxiosError(data: unknown, status = 400, headers: Record<string, string> = {}) {
  return {
    isAxiosError: true,
    message: `Request failed with status code ${status}`,
    config: {
      headers: { Authorization: SENTINELS.authHeader },
      data: `refresh_token=${SENTINELS.refreshToken}&client_secret=${SENTINELS.clientSecret}`
    },
    response: { status, headers, data }
  };
}

describe('Xero error normalization redaction', () => {
  const normalize = (error: unknown, payloads?: unknown) =>
    (Object.create(XeroClientService.prototype) as any).normalizeError(error, payloads) as AppError;

  it('keeps validation messages but never the raw provider elements', () => {
    const error = makeAxiosError(
      {
        Elements: [
          {
            Invoice: {
              InvoiceNumber: 'INV-4242',
              Contact: { Name: SENTINELS.customerName },
              LineItems: [{ Description: SENTINELS.invoiceDetail }]
            },
            ValidationErrors: [{ Message: 'Account code is required' }]
          }
        ]
      },
      400,
      { 'xero-correlation-id': 'xero-corr-1' }
    );

    const appError = normalize(error);
    const serialized = serializeAppError(appError);

    expect(appError.code).toBe('XERO_VALIDATION_ERROR');
    expect((appError.details as any).correlationId).toBe('xero-corr-1');
    expect(serialized).toContain('Account code is required');
    expectNoSentinels(serialized);
    expect((appError.details as any).errors[0].raw).toBeUndefined();
  });

  it('reduces generic API errors to allowlisted fields', () => {
    const error = makeAxiosError(
      {
        Type: 'InternalError',
        Message: 'An error occurred',
        access_token: SENTINELS.accessToken,
        body: SENTINELS.invoiceDetail
      },
      500,
      { 'xero-correlation-id': 'xero-corr-2' }
    );

    const appError = normalize(error);
    const serialized = serializeAppError(appError);

    expect(appError.code).toBe('XERO_API_ERROR');
    expect((appError.details as any).status).toBe(500);
    expect((appError.details as any).correlationId).toBe('xero-corr-2');
    expectNoSentinels(serialized);
    expect((appError.details as any).raw).toBeUndefined();
  });

  it('handles token-exchange failures without retaining the response body', () => {
    const error = makeAxiosError({
      error: 'invalid_grant',
      error_description: 'Refresh token revoked',
      refresh_token: SENTINELS.refreshToken
    });

    const appError = normalize(error);
    const serialized = serializeAppError(appError);
    expect((appError.details as any).providerErrorCode).toBe('invalid_grant');
    expectNoSentinels(serialized);
  });

  it('is deterministic for malformed payloads', () => {
    for (const weird of [null, 'boom', 42, { unexpected: true }, makeAxiosError(undefined, 502)]) {
      const appError = normalize(weird);
      expect(appError).toBeInstanceOf(AppError);
      expectNoSentinels(serializeAppError(appError));
    }
  });
});

describe('QBO error mapping redaction', () => {
  const mapQboError = (payload: unknown, intuitTid?: string, status?: number) =>
    (Object.create(QboClientService.prototype) as any).mapQboError(
      payload,
      'createInvoice',
      'Invoice',
      intuitTid,
      status
    ) as AppError;

  it('keeps the stable code and correlation ID but not the response body', () => {
    const appError = mapQboError(
      {
        Fault: {
          Error: [
            {
              code: '6240',
              Message: 'Duplicate Name Exists Error',
              Detail: `Customer ${SENTINELS.customerName} already exists`
            }
          ]
        },
        time: '2026-08-30',
        leak: SENTINELS.accessToken
      },
      'tid-777',
      400
    );

    const serialized = serializeAppError(appError);
    expect(appError.code).toBe('QBO_DUPLICATE_NAME');
    expect((appError.details as any).providerErrorCode).toBe('6240');
    expect((appError.details as any).intuitTid).toBe('tid-777');
    expect((appError.details as any).status).toBe(400);
    expect((appError.details as any).originalError).toBeUndefined();
    expectNoSentinels(serialized);
  });

  it('sanitizes provider messages that embed customer data alongside auth material', () => {
    const appError = mapQboError({
      Fault: {
        Error: [
          {
            code: '2010',
            Message: `Invalid field: ${SENTINELS.authHeader}`,
            Detail: SENTINELS.invoiceDetail
          }
        ]
      }
    });

    expect(appError.code).toBe('QBO_VALIDATION_ERROR');
    expect(serializeAppError(appError)).not.toContain(SENTINELS.authHeader);
    expect((appError.details as any).originalError).toBeUndefined();
  });
});
