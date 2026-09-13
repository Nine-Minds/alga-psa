import { describe, it, expect } from 'vitest';
import {
  classifyGraphFailure,
  extractGraphIds,
  mapInboundRecommendations,
  mapOutboundRecommendations,
  toDiagnosticsErrorMeta,
} from '../microsoftGraphDiagnostics';

describe('extractGraphIds', () => {
  it('reads request ids case-insensitively', () => {
    expect(extractGraphIds({ 'request-id': 'r1', 'client-request-id': 'c1' })).toEqual({
      requestId: 'r1',
      clientRequestId: 'c1',
    });
    expect(extractGraphIds({ 'request-id': 'r2' })).toEqual({ requestId: 'r2', clientRequestId: undefined });
    expect(extractGraphIds(undefined)).toEqual({ requestId: undefined, clientRequestId: undefined });
  });
});

describe('classifyGraphFailure', () => {
  it('preserves status, code, body and request ids from an axios-style error', () => {
    const failure = classifyGraphFailure({
      response: {
        status: 403,
        headers: { 'request-id': 'req-9', 'client-request-id': 'cli-9' },
        data: { error: { code: 'ErrorSendAsDenied', message: 'Denied' } },
      },
    });
    expect(failure).toMatchObject({
      status: 403,
      code: 'ErrorSendAsDenied',
      message: 'Denied',
      requestId: 'req-9',
      clientRequestId: 'cli-9',
    });
    expect(failure.responseBody).toEqual({ error: { code: 'ErrorSendAsDenied', message: 'Denied' } });
  });

  it('preserves already-sanitized top-level status/code', () => {
    const failure = classifyGraphFailure({ status: '401', code: 'InvalidAuthenticationToken', message: 'expired' });
    expect(failure.status).toBe('401');
    expect(failure.code).toBe('InvalidAuthenticationToken');
    expect(failure.message).toBe('expired');
  });

  it('handles string throws', () => {
    const failure = classifyGraphFailure('network down');
    expect(failure.message).toBe('network down');
    expect(failure.status).toBeUndefined();
  });

  it('maps to diagnostics error metadata without dropping ids', () => {
    const meta = toDiagnosticsErrorMeta(
      classifyGraphFailure({
        response: { status: 500, headers: { 'request-id': 'r' }, data: { error: { message: 'oops' } } },
      }),
    );
    expect(meta).toEqual({ message: 'oops', status: 500, code: '500', requestId: 'r', clientRequestId: undefined, responseBody: { error: { message: 'oops' } } });
  });
});

describe('recommendation composition', () => {
  it('keeps inbound read/folder advice for missing scopes and 403', () => {
    const missing = mapInboundRecommendations({ message: '', missingScopes: ['Mail.Read'] });
    expect(missing[0]).toContain('Mail.Read and Mail.Read.Shared');

    const forbidden = mapInboundRecommendations({ status: 403, message: '' });
    expect(forbidden[0]).toContain('delegated access to the target mailbox/folder');
  });

  it('never leaks Mail.Read/folder remediation into outbound advice', () => {
    const text = mapOutboundRecommendations({ status: 403, message: '', sharedMailbox: true }).join(' ');
    expect(text).not.toMatch(/Mail\.Read|folder/i);
    expect(text).toContain('Mail.Send');
    expect(text).toContain('Exchange Send As');
    expect(text).toContain('does not identify the missing permission');
  });

  it('adds shared-mailbox Send As advice only when shared', () => {
    const shared = mapOutboundRecommendations({ status: undefined, message: '', sharedMailbox: true });
    expect(shared.some((r) => r.includes('Exchange Send As'))).toBe(true);
    const self = mapOutboundRecommendations({ status: undefined, message: '' });
    expect(self.some((r) => r.includes('Exchange Send As'))).toBe(false);
  });
});
