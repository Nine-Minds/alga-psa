import { describe, expect, it } from 'vitest';
import {
  classifyMicrosoftOAuthFailure,
  describeMicrosoftOAuthFailureForMailboxFlow,
  extractRedirectUriFromDescription,
  toSafeMicrosoftOAuthFailure,
} from '../microsoftOAuthErrors';

describe('classifyMicrosoftOAuthFailure', () => {
  it('classifies from error_codes', () => {
    expect(classifyMicrosoftOAuthFailure({ errorCodes: [50194] })).toBe('single_tenant_app');
    expect(classifyMicrosoftOAuthFailure({ errorCodes: ['700016'] })).toBe('app_not_in_directory');
    expect(classifyMicrosoftOAuthFailure({ errorCodes: [50020] })).toBe('user_wrong_directory');
    expect(classifyMicrosoftOAuthFailure({ errorCodes: [50011] })).toBe('redirect_uri_mismatch');
  });

  it('classifies from the description when codes are absent (redirect query param)', () => {
    expect(
      classifyMicrosoftOAuthFailure({ errorDescription: "AADSTS50194: Application 'x'(y) isn't configured as a multitenant application." })
    ).toBe('single_tenant_app');
  });

  it('returns null for unknown codes', () => {
    expect(classifyMicrosoftOAuthFailure({ errorCodes: [7000222], errorDescription: 'AADSTS7000222: expired' })).toBeNull();
    expect(classifyMicrosoftOAuthFailure({})).toBeNull();
  });

  it('extracts the redirect URI named in AADSTS50011', () => {
    expect(
      extractRedirectUriFromDescription("AADSTS50011: The redirect URI 'https://a.example/cb' specified in the request does not match")
    ).toBe('https://a.example/cb');
  });

  it('names the exact URI in the 50011 message', () => {
    expect(describeMicrosoftOAuthFailureForMailboxFlow('redirect_uri_mismatch', { redirectUri: 'https://a.example/cb' })).toContain(
      'https://a.example/cb'
    );
  });
});

describe('toSafeMicrosoftOAuthFailure', () => {
  it('never carries request config (client_secret) from an axios error', () => {
    const err: any = new Error('Request failed with status code 400');
    err.config = { data: 'client_id=a&client_secret=SUPERSECRET&code=c', url: 'https://x/token' };
    err.response = {
      status: 400,
      data: { error: 'invalid_request', error_codes: [50194], error_description: 'AADSTS50194: nope', trace_id: 't', correlation_id: 'c' },
    };
    const safe = toSafeMicrosoftOAuthFailure(err);
    expect(JSON.stringify(safe)).not.toContain('SUPERSECRET');
    expect(JSON.stringify(safe)).not.toContain('client_secret');
    expect(safe).toMatchObject({ status: 400, error: 'invalid_request', errorCodes: [50194], traceId: 't', correlationId: 'c' });
  });
});
