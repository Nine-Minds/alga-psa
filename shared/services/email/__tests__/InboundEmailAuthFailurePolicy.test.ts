import { describe, expect, it } from 'vitest';
import {
  INBOUND_AUTH_FAILURE_PAUSE_THRESHOLD,
  classifyInboundAuthFailure,
} from '../InboundEmailAuthFailurePolicy';

/**
 * Sanitized error shape produced by MicrosoftGraphAdapter.toSanitizedGraphError
 * after a token-endpoint rejection (invalid_grant, incl. AADSTS50173).
 */
function msTokenEndpointError(error: string, errorDescription: string, status = 400) {
  const e: any = new Error(`Error in refreshAccessToken: Request failed with status code ${status} (code: ${status})`);
  e.status = status;
  e.code = String(status);
  e.responseBody = { error, error_description: errorDescription, error_codes: [50173] };
  return e;
}

/** Axios error shape thrown raw by the IMAP OAuth refresh path. */
function axiosTokenError(error: string, status = 400) {
  const e: any = new Error('Request failed with status code 400');
  e.response = { status, data: { error } };
  return e;
}

/** Gmail error shape produced by BaseEmailAdapter.handleError wrapping a gaxios error. */
function gmailHandleErrorError(body: Record<string, unknown>, status = 400) {
  const e: any = new Error('Error in refreshAccessToken: invalid_grant');
  e.status = status;
  e.code = status;
  e.responseBody = body;
  return e;
}

describe('InboundEmailAuthFailurePolicy', () => {
  it('exports a fixed, testable threshold', () => {
    expect(INBOUND_AUTH_FAILURE_PAUSE_THRESHOLD).toBe(3);
  });

  describe('Microsoft allowlist', () => {
    it('classifies token-endpoint invalid_grant (AADSTS50173 revoked grant)', () => {
      const result = classifyInboundAuthFailure({
        providerType: 'microsoft',
        error: msTokenEndpointError(
          'invalid_grant',
          'AADSTS50173: The provided grant has expired or was revoked.'
        ),
      });
      expect(result).toEqual({ kind: 'unrecoverable_auth', code: 'microsoft:invalid_grant' });
    });

    it('classifies token-endpoint invalid_client at status 401', () => {
      const result = classifyInboundAuthFailure({
        providerType: 'microsoft',
        error: msTokenEndpointError('invalid_client', 'AADSTS7000215: invalid client secret', 401),
      });
      expect(result).toEqual({ kind: 'unrecoverable_auth', code: 'microsoft:invalid_client' });
    });

    it('classifies AADSTS50173 even when the error field is missing', () => {
      const e = msTokenEndpointError('invalid_grant', 'AADSTS50173: expired grant');
      delete (e.responseBody as any).error;
      const result = classifyInboundAuthFailure({ providerType: 'microsoft', error: e });
      expect(result).toEqual({
        kind: 'unrecoverable_auth',
        code: 'microsoft:invalid_grant:aadsts50173',
      });
    });

    it('does NOT classify Graph permission errors (403 ErrorAccessDenied)', () => {
      const e: any = new Error('Error in downloadMessageSource: Access is denied (code: ErrorAccessDenied)');
      e.status = 403;
      e.code = 'ErrorAccessDenied';
      e.responseBody = { error: { code: 'ErrorAccessDenied', message: 'Access is denied.' } };
      expect(classifyInboundAuthFailure({ providerType: 'microsoft', error: e })).toEqual({
        kind: 'not_unrecoverable',
      });
    });

    it('does NOT classify Graph 404 ResourceNotFound', () => {
      const e: any = new Error('Error in downloadMessageSource: ResourceNotFound');
      e.status = 404;
      e.code = 'ResourceNotFound';
      e.responseBody = { error: { code: 'ResourceNotFound' } };
      expect(classifyInboundAuthFailure({ providerType: 'microsoft', error: e })).toEqual({
        kind: 'not_unrecoverable',
      });
    });

    it('does NOT classify webhook validation failures', () => {
      const e: any = new Error('Subscription validation request failed');
      e.code = 'ValidationError';
      e.responseBody = { error: { code: 'ValidationError' } };
      expect(classifyInboundAuthFailure({ providerType: 'microsoft', error: e })).toEqual({
        kind: 'not_unrecoverable',
      });
    });
  });

  describe('Google allowlist', () => {
    it('classifies invalid_grant and preserves error_subtype as the safe code', () => {
      const result = classifyInboundAuthFailure({
        providerType: 'google',
        error: gmailHandleErrorError({
          error: 'invalid_grant',
          error_description: 'Token has been expired or revoked.',
        }),
      });
      expect(result).toEqual({ kind: 'unrecoverable_auth', code: 'google:invalid_grant' });
    });

    it('preserves error_subtype such as invalid_rapt', () => {
      const result = classifyInboundAuthFailure({
        providerType: 'google',
        error: gmailHandleErrorError({
          error: 'invalid_grant',
          error_subtype: 'invalid_rapt',
        }),
      });
      expect(result).toEqual({
        kind: 'unrecoverable_auth',
        code: 'google:invalid_grant:invalid_rapt',
      });
    });

    it('does NOT classify API-level auth errors (error is an object, not a token error string)', () => {
      const result = classifyInboundAuthFailure({
        providerType: 'google',
        error: gmailHandleErrorError({
          error: { code: 401, message: 'Invalid Credentials', errors: [{ reason: 'authError' }] },
        }, 401),
      });
      expect(result).toEqual({ kind: 'not_unrecoverable' });
    });

    it('does NOT classify quota-exceeded (rateLimitExceeded) even at the token endpoint', () => {
      const result = classifyInboundAuthFailure({
        providerType: 'google',
        error: gmailHandleErrorError({ error: 'rate_limit_exceeded' }, 429),
      });
      expect(result).toEqual({ kind: 'not_unrecoverable' });
    });
  });

  describe('IMAP allowlist', () => {
    it('classifies explicit imapflow authenticationFailed flag', () => {
      const e: any = new Error('Authentication failed');
      e.authenticationFailed = true;
      expect(classifyInboundAuthFailure({ providerType: 'imap', error: e })).toEqual({
        kind: 'unrecoverable_auth',
        code: 'imap:authentication_failed',
      });
    });

    it('classifies serverResponseCode AUTHENTICATIONFAILED', () => {
      const e: any = new Error('AUTHENTICATIONFAILED');
      e.serverResponseCode = 'AUTHENTICATIONFAILED';
      expect(classifyInboundAuthFailure({ providerType: 'imap', error: e })).toEqual({
        kind: 'unrecoverable_auth',
        code: 'imap:authentication_failed',
      });
    });

    it('classifies NO + invalid credentials response', () => {
      const e: any = new Error('NO');
      e.responseStatus = 'NO';
      e.responseText = 'INVALID CREDENTIALS';
      expect(classifyInboundAuthFailure({ providerType: 'imap', error: e })).toEqual({
        kind: 'unrecoverable_auth',
        code: 'imap:authentication_failed',
      });
    });

    it('classifies OAuth token-endpoint invalid_grant from the raw axios error', () => {
      const result = classifyInboundAuthFailure({
        providerType: 'imap',
        error: axiosTokenError('invalid_grant'),
      });
      expect(result).toEqual({ kind: 'unrecoverable_auth', code: 'imap:invalid_grant' });
    });

    it('classifies OAuth token-endpoint invalid_client', () => {
      const result = classifyInboundAuthFailure({
        providerType: 'imap',
        error: axiosTokenError('invalid_client', 401),
      });
      expect(result).toEqual({ kind: 'unrecoverable_auth', code: 'imap:invalid_client' });
    });

    it('does NOT classify generic connection failures', () => {
      const e: any = new Error('connect ECONNREFUSED 203.0.113.7:993');
      e.code = 'ECONNREFUSED';
      expect(classifyInboundAuthFailure({ providerType: 'imap', error: e })).toEqual({
        kind: 'not_unrecoverable',
      });
    });
  });

  describe('transient shapes never count', () => {
    const transientErrors: Array<[string, any]> = [
      ['throttling 429', { status: 429, code: '429', responseBody: { error: { code: '429' } } }],
      ['server error 503', { status: 503, code: '503', responseBody: { error: { code: '503' } } }],
      ['axios timeout', { code: 'ECONNABORTED', message: 'timeout of 30000ms exceeded' }],
      ['dns failure', { code: 'ENOTFOUND' }],
      ['socket hangup', { code: 'ECONNRESET' }],
      ['mime parse timeout', new Error('timeout:microsoft_mime_parse:30000')],
      ['plain message with 401 substring', new Error('Request failed with status code 401')],
      ['plain message with auth substring', new Error('authorization header problem')],
      ['downstream processing failure', new Error('ticket processing exploded')],
    ];

    for (const providerType of ['microsoft', 'google', 'imap'] as const) {
      it.each(transientErrors)('does not classify %s for %s', (_label, error) => {
        expect(classifyInboundAuthFailure({ providerType, error })).toEqual({
          kind: 'not_unrecoverable',
        });
      });
    }

    it('classifies nothing for missing errors', () => {
      expect(classifyInboundAuthFailure({ providerType: 'microsoft', error: undefined })).toEqual({
        kind: 'not_unrecoverable',
      });
    });
  });

  it('sanitizes unsafe code content out of reason codes', () => {
    const e: any = new Error('x');
    e.responseBody = { error: 'Invalid_Grant <script>alert(1)</script>' };
    const result = classifyInboundAuthFailure({ providerType: 'microsoft', error: e });
    // The allowlist is exact-match lowercase, so a decorated variant must not
    // classify at all — codes only ever come from the fixed allowlist.
    expect(result).toEqual({ kind: 'not_unrecoverable' });
  });
});
