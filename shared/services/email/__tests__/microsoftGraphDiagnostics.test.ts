import { describe, it, expect } from 'vitest';
import {
  classifyGraphFailure,
  classifySendPermissionDenial,
  extractGraphBodyCorrelationIds,
  extractGraphIds,
  mapInboundRecommendations,
  mapOutboundRecommendations,
  normalizeOutboundGraphFailure,
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

describe('extractGraphBodyCorrelationIds', () => {
  it('reads both ids from a native Graph error body', () => {
    expect(
      extractGraphBodyCorrelationIds({
        error: {
          code: 'ErrorSendAsDenied',
          message: 'Denied',
          innerError: {
            'request-id': 'body-req-1',
            'client-request-id': 'body-cli-1',
          },
        },
      }),
    ).toEqual({ requestId: 'body-req-1', clientRequestId: 'body-cli-1' });
  });

  it('handles a top-level innerError and trims values', () => {
    expect(
      extractGraphBodyCorrelationIds({ innerError: { 'request-id': '  body-req-2  ' } }),
    ).toEqual({ requestId: 'body-req-2', clientRequestId: undefined });
  });

  it('is safe for missing, malformed, or non-string innerError values', () => {
    expect(extractGraphBodyCorrelationIds(undefined)).toEqual({
      requestId: undefined,
      clientRequestId: undefined,
    });
    expect(extractGraphBodyCorrelationIds({})).toEqual({
      requestId: undefined,
      clientRequestId: undefined,
    });
    expect(extractGraphBodyCorrelationIds({ error: { innerError: null } })).toEqual({
      requestId: undefined,
      clientRequestId: undefined,
    });
    expect(
      extractGraphBodyCorrelationIds({
        error: { innerError: { 'request-id': 123, 'client-request-id': '   ' } },
      }),
    ).toEqual({ requestId: undefined, clientRequestId: undefined });
  });

  it('caps pathological id length', () => {
    const long = 'x'.repeat(1000);
    expect(
      extractGraphBodyCorrelationIds({ error: { innerError: { 'request-id': long } } }).requestId,
    ).toHaveLength(256);
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

describe('normalizeOutboundGraphFailure', () => {
  it('prefers a real provider code over the synthesized HTTP-status code', () => {
    const failure = normalizeOutboundGraphFailure({
      status: 403,
      responseBody: { error: { message: 'Forbidden' } },
      errorCode: 'ErrorSendAsDenied',
      requestId: 'top-req',
      clientRequestId: 'top-cli',
    });
    expect(failure).toMatchObject({
      status: 403,
      code: 'ErrorSendAsDenied',
      requestId: 'top-req',
      clientRequestId: 'top-cli',
    });
  });

  it('surfaces EmailProviderError errorCode and metadata status/request-id', () => {
    const failure = normalizeOutboundGraphFailure({
      message: 'Mailbox unavailable',
      errorCode: 'ErrorMailboxUnavailable',
      metadata: { status: 503, requestId: 'meta-req', clientRequestId: 'meta-cli' },
    });
    expect(failure).toMatchObject({
      status: 503,
      code: 'ErrorMailboxUnavailable',
      requestId: 'meta-req',
      clientRequestId: 'meta-cli',
    });
  });

  it('keeps the classified code when no provider code is present', () => {
    const failure = normalizeOutboundGraphFailure({
      response: {
        status: 401,
        headers: { 'request-id': 'req-401' },
        data: { error: { code: 'InvalidAuthenticationToken', message: 'expired' } },
      },
    });
    expect(failure).toMatchObject({ status: 401, code: 'InvalidAuthenticationToken', requestId: 'req-401' });
  });

  it('falls back to a body-only native response.data.error.innerError correlation id', () => {
    const failure = normalizeOutboundGraphFailure({
      response: {
        status: 403,
        headers: {},
        data: {
          error: {
            code: 'ErrorSendAsDenied',
            message: 'Denied',
            innerError: { 'request-id': 'body-req', 'client-request-id': 'body-cli' },
          },
        },
      },
    });
    expect(failure).toMatchObject({
      status: 403,
      code: 'ErrorSendAsDenied',
      requestId: 'body-req',
      clientRequestId: 'body-cli',
    });
  });

  it('falls back to a sanitized responseBody.error.innerError correlation id', () => {
    const failure = normalizeOutboundGraphFailure({
      message: 'Microsoft rejected the send.',
      status: 403,
      errorCode: 'ErrorSendAsDenied',
      responseBody: {
        error: {
          code: 'ErrorSendAsDenied',
          innerError: { 'request-id': 'sanitized-req', 'client-request-id': 'sanitized-cli' },
        },
      },
    });
    expect(failure).toMatchObject({
      status: 403,
      code: 'ErrorSendAsDenied',
      requestId: 'sanitized-req',
      clientRequestId: 'sanitized-cli',
    });
  });

  it('keeps header, top-level, and metadata ids ahead of body ids when they conflict', () => {
    const conflictingBody = {
      error: {
        code: 'ErrorSendAsDenied',
        innerError: { 'request-id': 'body-req', 'client-request-id': 'body-cli' },
      },
    };
    const headerWins = normalizeOutboundGraphFailure({
      response: { status: 403, headers: { 'request-id': 'header-req' }, data: conflictingBody },
      requestId: 'top-req',
      metadata: { clientRequestId: 'meta-cli' },
    });
    // Header wins over top-level/metadata/body for requestId; metadata wins over
    // body for clientRequestId because no header/top-level client id is present.
    expect(headerWins).toMatchObject({ requestId: 'header-req', clientRequestId: 'meta-cli' });

    const topLevelWins = normalizeOutboundGraphFailure({
      response: { status: 403, headers: {}, data: conflictingBody },
      requestId: 'top-req',
      clientRequestId: 'top-cli',
      metadata: { requestId: 'meta-req', clientRequestId: 'meta-cli' },
    });
    expect(topLevelWins).toMatchObject({ requestId: 'top-req', clientRequestId: 'top-cli' });

    const metadataWins = normalizeOutboundGraphFailure({
      response: { status: 403, headers: {}, data: conflictingBody },
      metadata: { requestId: 'meta-req', clientRequestId: 'meta-cli' },
    });
    expect(metadataWins).toMatchObject({ requestId: 'meta-req', clientRequestId: 'meta-cli' });
  });

  it('leaves inbound classifyGraphFailure body-only ids untouched (inbound behavior unchanged)', () => {
    const bodyOnly = {
      response: {
        status: 403,
        headers: {},
        data: {
          error: {
            code: 'ErrorSendAsDenied',
            message: 'Denied',
            innerError: { 'request-id': 'inbound-body-req', 'client-request-id': 'inbound-body-cli' },
          },
        },
      },
    };
    // Inbound still uses classifyGraphFailure: header-only extraction, so the
    // body ids are intentionally not surfaced there. Only outbound normalization
    // gains the body fallback.
    const meta = toDiagnosticsErrorMeta(classifyGraphFailure(bodyOnly));
    expect(meta.requestId).toBeUndefined();
    expect(meta.clientRequestId).toBeUndefined();
    expect(normalizeOutboundGraphFailure(bodyOnly)).toMatchObject({
      requestId: 'inbound-body-req',
      clientRequestId: 'inbound-body-cli',
    });
  });
});

describe('classifySendPermissionDenial', () => {
  it('recognizes explicit Exchange send denials and generic access denials', () => {
    expect(classifySendPermissionDenial('ErrorSendAsDenied')).toBe('send-as-denied');
    expect(classifySendPermissionDenial('ErrorSendOnBehalfDenied')).toBe('send-on-behalf-denied');
    expect(classifySendPermissionDenial('ErrorAccessDenied')).toBe('access-denied');
    expect(classifySendPermissionDenial(undefined)).toBe('unknown');
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

  it('names the provider-confirmed Exchange denial when a code is present', () => {
    const denied = mapOutboundRecommendations({
      status: 403,
      code: 'ErrorSendAsDenied',
      message: 'Denied',
    }).join(' ');
    expect(denied).toMatch(/ErrorSendAsDenied/);
    expect(denied).toMatch(/provider-confirmed/);

    const generic = mapOutboundRecommendations({ status: 403, message: 'Forbidden' }).join(' ');
    expect(generic).toMatch(/does not identify the missing permission/i);
    expect(generic).not.toMatch(/ErrorSendAsDenied/);
  });

  it('adds shared-mailbox Send As advice only when shared', () => {
    const shared = mapOutboundRecommendations({ status: undefined, message: '', sharedMailbox: true });
    expect(shared.some((r) => r.includes('Exchange Send As'))).toBe(true);
    const self = mapOutboundRecommendations({ status: undefined, message: '' });
    expect(self.some((r) => r.includes('Exchange Send As'))).toBe(false);
  });
});
