import { describe, expect, it } from 'vitest';
import {
  describeMicrosoftSetupError,
  sanitizeMicrosoftErrorDescription,
} from './microsoftEmailSetupError';

const CORRELATION = '0b9a1f4e-3c2d-4e5f-8a6b-7c8d9e0f1a2b';

describe('describeMicrosoftSetupError', () => {
  it.each([
    ['AADSTS50097', 'policy_blocked'],
    ['AADSTS53000', 'policy_blocked'],
    ['AADSTS53003', 'policy_blocked'],
    ['AADSTS90094', 'admin_required'],
    ['AADSTS90099', 'admin_required'],
    ['AADSTS65001', 'admin_required'],
    ['AADSTS50020', 'wrong_tenant'],
    ['AADSTS700016', 'app_not_found'],
  ])('maps %s to %s', (aadsts, expected) => {
    const result = describeMicrosoftSetupError({
      error: 'server_error',
      error_description: `${aadsts}: Something happened.`,
    });
    expect(result.errorCode).toBe(expected);
    expect(result.aadsts).toBe(aadsts.replace('AADSTS', ''));
  });

  it('maps interaction_required without an AADSTS code to policy_blocked', () => {
    expect(describeMicrosoftSetupError({ error: 'interaction_required' })).toMatchObject({
      errorCode: 'policy_blocked',
      aadsts: null,
    });
  });

  it('reads the AADSTS code from error_codes when the description has none', () => {
    expect(describeMicrosoftSetupError({ error: 'server_error', error_codes: '[90094]' })).toMatchObject({
      errorCode: 'admin_required',
      aadsts: '90094',
    });
  });

  it('prefers a specific AADSTS group over the generic error', () => {
    expect(
      describeMicrosoftSetupError({ error: 'access_denied', error_description: 'AADSTS65001: not consented' }).errorCode,
    ).toBe('admin_required');
  });

  it('maps access_denied to consent_denied', () => {
    expect(describeMicrosoftSetupError({ error: 'access_denied' }).errorCode).toBe('consent_denied');
  });

  it('falls back to microsoft_error for unknown codes, keeping the code and detail', () => {
    const result = describeMicrosoftSetupError({
      error: 'server_error',
      error_description: 'AADSTS999999: Something unexpected.',
    });
    expect(result.errorCode).toBe('microsoft_error');
    expect(result.aadsts).toBe('999999');
    expect(result.detail).toContain('Something unexpected.');
  });

  it('extracts the correlation ID from the query parameter', () => {
    expect(describeMicrosoftSetupError({ error: 'x', correlation_id: CORRELATION }).correlationId).toBe(CORRELATION);
  });

  it('extracts the correlation ID from the description boilerplate and strips it from detail', () => {
    const result = describeMicrosoftSetupError({
      error: 'x',
      error_description: `AADSTS53003: Blocked.\r\nTrace ID: abc\r\nCorrelation ID: ${CORRELATION}\r\nTimestamp: 2026-01-01`,
    });
    expect(result.correlationId).toBe(CORRELATION);
    expect(result.detail).toBe('AADSTS53003: Blocked.');
  });

  it('rejects a malformed correlation ID', () => {
    expect(describeMicrosoftSetupError({ error: 'x', correlation_id: '<script>alert(1)</script>' }).correlationId).toBeNull();
    expect(describeMicrosoftSetupError({ error: 'x', correlation_id: 'short' }).correlationId).toBeNull();
  });

  it('never leaks a redacted secret into detail', () => {
    const result = describeMicrosoftSetupError({
      error: 'x',
      error_description: 'failed for state=STATE.TOKEN.VALUE and code=AUTHCODE123',
      redact: ['STATE.TOKEN.VALUE', 'AUTHCODE123', null],
    });
    expect(result.detail).not.toContain('STATE.TOKEN.VALUE');
    expect(result.detail).not.toContain('AUTHCODE123');
  });

  it('does not carry a manual-setup hint for policy_blocked or admin_required', () => {
    for (const description of ['AADSTS53003: blocked', 'AADSTS90094: admin needed']) {
      const result = describeMicrosoftSetupError({ error: 'x', error_description: description });
      expect(['policy_blocked', 'admin_required']).toContain(result.errorCode);
      expect(JSON.stringify(result).toLowerCase()).not.toContain('manual');
    }
  });
});

describe('sanitizeMicrosoftErrorDescription', () => {
  it('collapses control characters and whitespace', () => {
    expect(sanitizeMicrosoftErrorDescription('line one\r\n\tline   two')).toBe('line one line two');
  });

  it('strips non-whitespace control characters and markup', () => {
    expect(sanitizeMicrosoftErrorDescription('bad\u0000\u001b[31m <b>bold</b><script>alert(1)</script> text')).toBe(
      'bad[31m boldalert(1) text',
    );
    expect(sanitizeMicrosoftErrorDescription('1 < 2 > 0')).toBe('1 0');
  });

  it('strips URLs', () => {
    expect(sanitizeMicrosoftErrorDescription('See https://evil.example/x?y=1 for more')).toBe('See for more');
  });

  it('caps the description at 300 characters', () => {
    const result = sanitizeMicrosoftErrorDescription('a'.repeat(1000))!;
    expect(result.length).toBeLessThanOrEqual(300);
    expect(result.endsWith('…')).toBe(true);
  });

  it('returns null for empty input', () => {
    expect(sanitizeMicrosoftErrorDescription('   ')).toBeNull();
    expect(sanitizeMicrosoftErrorDescription(null)).toBeNull();
  });
});
