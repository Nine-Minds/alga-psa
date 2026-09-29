import { describe, it, expect } from 'vitest';
import {
  applyReportRedaction,
  createSupportBundle,
  redactText,
  sanitizeClient,
  sanitizeContinuationResults,
} from '@ee/lib/integrations/entra/diagnostics/redaction';
import {
  signContinuation,
  verifyContinuation,
  type EntraClientContinuationPayload,
} from '@ee/lib/integrations/entra/diagnostics/continuation';
import type { EntraDiagnosticsReport } from '@alga-psa/types';

const GUID = '11111111-2222-3333-4444-555555555555';
const OTHER_GUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const JWT = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature';
const REFRESH = 'raw-refresh-token-value-1234567890';
const SECRET = 'raw-client-secret-value-abcdefghij';

function makeReport(): EntraDiagnosticsReport {
  return {
    createdAt: '2026-09-16T00:00:00.000Z',
    scope: 'connection',
    summary: {
      connectionType: 'direct',
      connectionStatus: 'connected',
      profileName: 'Partner App',
      partnerTenantId: GUID,
      authenticatedUpn: 'admin@partner.example',
      tokenExpiresAt: '2026-09-16T01:00:00.000Z',
      managedTenantCount: 2,
      mappedClientCount: 1,
      overallStatus: 'fail',
    },
    steps: [
      {
        id: 'connection_row',
        title: 'Active Entra connection',
        status: 'fail',
        startedAt: '2026-09-16T00:00:00.000Z',
        durationMs: 3,
        http: { method: 'GET', path: `/users/${GUID}`, status: 403, requestId: 'rid-1' },
        data: {
          storedValidationMessage: `Bearer ${JWT}`,
          clientSecretRef: 'ref-1',
          nested: { access_token: SECRET },
        },
        error: {
          message: `failed for ${GUID} with Bearer ${JWT}`,
          status: 403,
          requestId: 'rid-2',
          clientRequestId: 'crid-2',
          responseBody: { error: { message: 'denied' }, refresh_token: REFRESH },
        },
        recommendations: [
          {
            code: 'customer_consent_required',
            severity: 'fail',
            text: `Grant consent for ${GUID}`,
            messageKey: 'customerConsentRequired',
            params: { client: 'Acme', tenant: GUID },
            action: {
              kind: 'open_url',
              payload: `https://login.microsoftonline.com/${GUID}/adminconsent?client_id=${OTHER_GUID}`,
            },
          },
        ],
      },
    ],
    clients: [],
    recommendations: [],
    supportBundle: {},
  };
}

function makeClient() {
  return {
    clientId: 'client-1',
    clientName: 'Acme Corp',
    entraTenantId: GUID,
    entraTenantDisplayName: 'Acme Tenant',
    overallStatus: 'fail' as const,
    category: 'need_consent' as const,
    remedy: `Grant consent for ${GUID} at ${OTHER_GUID}`,
    isComplete: true,
    steps: [
      {
        id: 'tenant_token_mint',
        title: 'Mint customer tenant token',
        status: 'fail' as const,
        startedAt: '2026-09-16T00:00:00.000Z',
        durationMs: 5,
        error: {
          message: `AADSTS65001 for admin@customer.example Bearer ${JWT}`,
          requestId: 'rid-3',
          aadstsCode: 'AADSTS65001',
        },
        data: { refreshToken: REFRESH, applicationClientId: OTHER_GUID },
      },
    ],
  };
}

describe('redaction (adversarial)', () => {
  it('scrubs repeatedly serialized errors and prefixed log fragments without losing safe metadata', () => {
    let nested = JSON.stringify({ refresh_token: REFRESH, client_secret: SECRET });
    for (let depth = 0; depth < 6; depth += 1) {
      nested = JSON.stringify({ cause: nested });
      for (const includeIdentifiers of [false, true]) {
        for (const message of [nested, `Temporal activity failed AADSTS65001: ${nested}`]) {
          const report = makeReport();
          report.steps[0].data = { storedValidationMessage: message };
          expect(JSON.stringify(applyReportRedaction(report, includeIdentifiers))).not.toContain(REFRESH);
          expect(JSON.stringify(createSupportBundle(report, includeIdentifiers))).not.toContain(SECRET);
        }
      }
    }
  });
  it('strips secrets from every field even when identifiers are included', () => {
    const sanitized = applyReportRedaction(makeReport(), true);
    const serialized = JSON.stringify(sanitized);

    expect(serialized).not.toContain(JWT);
    expect(serialized).not.toContain(REFRESH);
    expect(serialized).not.toContain(SECRET);
    // Identifiers are retained in the live report.
    expect(serialized).toContain(GUID);
    // Correlation ids survive.
    expect(sanitized.steps[0].http?.requestId).toBe('rid-1');
    expect(sanitized.steps[0].error?.requestId).toBe('rid-2');
  });

  it('redacts identifiers, emails, and secret-bearing fields in the support bundle by default', () => {
    const bundle = createSupportBundle(makeReport(), false);
    const serialized = JSON.stringify(bundle);

    expect(serialized).not.toContain(GUID);
    expect(serialized).not.toContain(OTHER_GUID);
    expect(serialized).not.toContain('admin@partner.example');
    expect(serialized).not.toContain(JWT);
    expect(serialized).not.toContain(REFRESH);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).toContain('rid-1');
    // The consent action URL has its identifiers redacted.
    expect(serialized).toContain('<id>/adminconsent');
  });

  it('sanitizes client responses deeply including remedies and step data', () => {
    const sanitized = sanitizeClient(makeClient() as any, true);
    const serialized = JSON.stringify(sanitized);
    expect(serialized).not.toContain(JWT);
    expect(serialized).not.toContain(REFRESH);
    expect(sanitized.steps[0].error?.requestId).toBe('rid-3');
  });

  it('redactText handles error-text credentials', () => {
    expect(redactText('Bearer abc123 access_token=xyz', true)).not.toContain('abc123');
    expect(redactText('Bearer abc123 access_token=xyz', true)).not.toContain('xyz');
  });

  it('redacts credentials embedded in serialized JSON (quoted, escaped, nested)', () => {
    const cases = [
      '{"refresh_token":"synthetic-refresh-secret"}',
      '{"client_secret":"synthetic-client-secret"}',
      '{"error":{"code":"x"},"access_token":"synthetic-access-secret"}',
      '{"nested":"{\\"refresh_token\\":\\"synthetic-escaped-secret\\"}"}',
      "refresh_token='synthetic-single-quoted'",
      'client_secret=synthetic-unquoted',
    ];
    for (const input of cases) {
      for (const includeIdentifiers of [true, false]) {
        const out = redactText(input, includeIdentifiers);
        expect(out).not.toMatch(/synthetic-(refresh|client|access|escaped|single|unquoted)/);
        expect(out).toContain('<redacted>');
      }
    }
  });

  it('preserves expiry/presence metadata rather than treating it as a secret', () => {
    const report = makeReport();
    report.steps[0].data = {
      accessTokenExpiresAt: '2026-09-16T01:00:00.000Z',
      secretExpiryKnown: false,
      refreshTokenPresent: true,
      accessTokenFingerprint: 'eyJh...(120)',
    };
    const sanitized = applyReportRedaction(report, true);
    expect(sanitized.steps[0].data?.accessTokenExpiresAt).toBe('2026-09-16T01:00:00.000Z');
    expect(sanitized.steps[0].data?.secretExpiryKnown).toBe(false);
    expect(sanitized.steps[0].data?.refreshTokenPresent).toBe(true);
    expect(sanitized.steps[0].data?.accessTokenFingerprint).toBe('eyJh...(120)');
  });

  it('sanitizes continuation results before signing', () => {
    const payload: EntraClientContinuationPayload = {
      v: 1,
      tenant: 'tenant-1',
      userId: 'user-1',
      scope: 'clients',
      connectionType: 'direct',
      connectionId: 'conn-1',
      selection: [{ clientId: 'client-1', managedTenantId: 'm1', entraTenantId: GUID }],
      includeUserYield: false,
      offset: 1,
      total: 1,
      recentResults: [makeClient() as any],
      aggregate: { ok: 0, need_consent: 1, conditional_access: 0, missing_role: 0, other: 0 },
      failedCount: 1,
      warnCount: 0,
      recommendations: [],
      pending: null,
      startedAt: Date.now(),
      exp: Date.now() + 60_000,
    };
    const token = signContinuation(payload, 'test-signing-secret-1234');
    // The serialized token must not carry the raw secrets.
    const decodedBody = Buffer.from(token.split('.')[0], 'base64url').toString('utf8');
    expect(decodedBody).not.toContain(JWT);
    expect(decodedBody).not.toContain(REFRESH);
    expect(verifyContinuation(token, 'test-signing-secret-1234')?.tenant).toBe('tenant-1');
  });

  it('sanitizeContinuationResults removes secrets from arbitrary results', () => {
    const [result] = sanitizeContinuationResults([makeClient()], true) as any[];
    expect(JSON.stringify(result)).not.toContain(REFRESH);
    expect(result.steps[0].error.requestId).toBe('rid-3');
  });
});
