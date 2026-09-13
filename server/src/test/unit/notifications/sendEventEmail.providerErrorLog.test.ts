import { describe, it, expect } from 'vitest';
import { EmailProviderError } from '@alga-psa/types';
import { extractProviderErrorLogFields } from '../../../lib/notifications/sendEventEmail';

describe('extractProviderErrorLogFields', () => {
  it('extracts errorCode, metadata.status and metadata.requestId from EmailProviderError', () => {
    const error = new EmailProviderError(
      'SMTP send failed',
      'smtp-1',
      'smtp',
      false,
      'EAUTH',
      { status: 535, requestId: 'req-abc', definitelyNotSent: true },
    );
    expect(extractProviderErrorLogFields(error)).toEqual({
      errorCode: 'EAUTH',
      status: 535,
      requestId: 'req-abc',
    });
  });

  it('coerces a numeric-string status and ignores non-numeric status', () => {
    expect(extractProviderErrorLogFields({ errorCode: 'E', metadata: { status: '403' } }).status).toBe(403);
    expect(extractProviderErrorLogFields({ errorCode: 'E', metadata: { status: 'n/a' } }).status).toBeUndefined();
  });

  it('handles ordinary Errors and non-Error throws without throwing', () => {
    expect(extractProviderErrorLogFields(new Error('plain'))).toEqual({
      errorCode: undefined,
      status: undefined,
      requestId: undefined,
    });
    expect(extractProviderErrorLogFields('boom')).toEqual({
      errorCode: undefined,
      status: undefined,
      requestId: undefined,
    });
    expect(extractProviderErrorLogFields(undefined)).toEqual({
      errorCode: undefined,
      status: undefined,
      requestId: undefined,
    });
  });

  it('does not surface unrelated metadata fields', () => {
    const fields = extractProviderErrorLogFields({
      errorCode: 'E',
      metadata: { status: 500, requestId: 'r', rawBody: 'sensitive', token: 'secret' },
    });
    expect(fields).toEqual({ errorCode: 'E', status: 500, requestId: 'r' });
    expect(JSON.stringify(fields)).not.toContain('sensitive');
    expect(JSON.stringify(fields)).not.toContain('secret');
  });
});
