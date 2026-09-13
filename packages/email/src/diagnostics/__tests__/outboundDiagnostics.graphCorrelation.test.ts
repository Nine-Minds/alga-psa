/**
 * End-to-end regression for the body-only Graph 403 correlation defect.
 *
 * The real MicrosoftGraphAdapter (with only its Axios client stubbed), the real
 * MicrosoftGraphEmailProvider.toProviderError boundary, and the real outbound
 * diagnostics runner are chained together. Only EmailProviderManager is mocked
 * (the runner's default live-send dependency) so the production
 * adapter -> provider -> report/export path is what actually runs.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MicrosoftGraphAdapter } from '@alga-psa/shared/services/email/providers/MicrosoftGraphAdapter';
import { MicrosoftGraphEmailProvider } from '../../providers/MicrosoftGraphEmailProvider';
import { runOutboundEmailDiagnosticsWithSettings } from '../outboundDiagnostics';
import type { ResolvedOutboundProvider } from '../outboundTypes';

const { providerHolder } = vi.hoisted(() => ({
  providerHolder: { current: undefined as unknown },
}));

vi.mock('../../providers/EmailProviderManager', () => ({
  EmailProviderManager: class {
    async initialize(): Promise<void> {}
    async sendEmail(message: unknown, tenant: string) {
      return (providerHolder.current as MicrosoftGraphEmailProvider).sendEmail(message as any, tenant);
    }
  },
}));

vi.mock('../../senderIdentity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../senderIdentity')>();
  return { ...actual, resolveTenantCompanyName: vi.fn(async () => 'Acme Corp') };
});

function makeJwt(scopes: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ scp: scopes })).toString('base64url');
  return `${header}.${payload}.signature`;
}

function makeAdapter(): MicrosoftGraphAdapter {
  return new MicrosoftGraphAdapter({
    id: 'provider-1',
    tenant: 'tenant-1',
    name: 'Outbound Diagnostics Smoke',
    provider_type: 'microsoft',
    mailbox: 'shared@example.com',
    folder_to_monitor: 'Inbox',
    active: true,
    webhook_notification_url: '',
    connection_status: 'connected',
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    provider_config: {
      access_token: makeJwt('Mail.Read Mail.Send Mail.Send.Shared'),
      refresh_token: 'refresh-token',
      token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
  });
}

function settings() {
  return {
    tenantId: 'tenant-1',
    emailProvider: 'microsoft',
    providerConfigs: [
      {
        providerId: 'provider-1',
        providerType: 'microsoft',
        isEnabled: true,
        config: { from: 'shared@example.com' },
      },
    ],
    ticketingFromEmail: 'ticketing@example.com',
    ticketingFromName: 'Acme',
    customDomains: [],
    trackingEnabled: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any;
}

const BODY_ONLY_RESPONSE = {
  status: 403,
  headers: {},
  data: {
    error: {
      code: 'ErrorSendAsDenied',
      message:
        'The user account does not have the right to send mail on behalf of the specified sending account.',
      innerError: {
        'request-id': 'body-request-403',
        'client-request-id': 'body-client-403',
      },
    },
  },
};

const HEADER_RESPONSE = {
  status: 403,
  headers: { 'request-id': 'header-request-403', 'client-request-id': 'header-client-403' },
  data: {
    error: {
      code: 'ErrorSendAsDenied',
      message: 'Denied',
      innerError: {
        'request-id': 'body-request-403',
        'client-request-id': 'body-client-403',
      },
    },
  },
};

async function runAgainstGraph(response: unknown) {
  const adapter = makeAdapter();
  const post = vi.fn(async () => {
    throw {
      message: 'Forbidden',
      response,
    };
  });
  const get = vi.fn(async (url: string) => {
    if (url === '/me') {
      return {
        status: 200,
        headers: {},
        data: { id: 'u1', userPrincipalName: 'auth@example.com', mail: 'auth@example.com' },
      };
    }
    if (String(url).includes('/mailFolders/sentitems')) {
      throw {
        response: {
          status: 404,
          headers: {},
          data: { error: { code: 'ErrorItemNotFound', message: 'Mailbox folder not found' } },
        },
      };
    }
    return { status: 200, headers: {}, data: {} };
  });
  (adapter as any).httpClient = { get, post };

  const provider = new MicrosoftGraphEmailProvider('provider-1');
  (provider as any).adapter = adapter;
  (provider as any).initialized = true;
  (provider as any).mailbox = 'shared@example.com';
  providerHolder.current = provider;

  return runOutboundEmailDiagnosticsWithSettings({
    tenant: 'tenant-1',
    knex: {} as any,
    settings: settings(),
    options: { liveSendTest: true, recipient: 'admin@example.com' },
    deps: {
      resolveProvider: vi.fn(async (): Promise<ResolvedOutboundProvider> => ({
        providerId: 'provider-1',
        providerType: 'microsoft',
        providerName: 'Outbound Diagnostics Smoke',
        configuredMailbox: 'shared@example.com',
        rawConfig: {},
        adapter,
      })),
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  providerHolder.current = undefined;
});

describe('outbound Graph body-only correlation ids (adapter -> provider -> report/export)', () => {
  it('retains HTTP 403, ErrorSendAsDenied, and both body-only correlation ids through to the export', async () => {
    const report = await runAgainstGraph(BODY_ONLY_RESPONSE);

    const live = report.steps.find((s) => s.id === 'live_send_test');
    expect(live?.status).toBe('fail');
    expect(live?.error).toMatchObject({
      status: 403,
      code: 'ErrorSendAsDenied',
      requestId: 'body-request-403',
      clientRequestId: 'body-client-403',
    });
    expect(live?.http).toMatchObject({
      method: 'POST',
      status: 403,
      requestId: 'body-request-403',
      clientRequestId: 'body-client-403',
    });
    expect(live?.data).toMatchObject({
      status: 403,
      requestId: 'body-request-403',
      clientRequestId: 'body-client-403',
      errorCode: 'ErrorSendAsDenied',
    });

    const recommendations = report.recommendations.join(' ');
    expect(recommendations).toMatch(/does not have permission to send as/);
    expect(recommendations).toMatch(/Send As permission.*Exchange admin center/);
    expect(recommendations).not.toMatch(/Mail\.Read/);

    const bundleJson = JSON.stringify(report.supportBundle);
    expect(bundleJson).toContain('body-request-403');
    expect(bundleJson).toContain('body-client-403');
    expect(bundleJson).toContain('ErrorSendAsDenied');

    // The raw Graph body message and any seeded secret must never be serialized.
    const reportJson = JSON.stringify(report);
    expect(reportJson).not.toContain('does not have the right to send mail');
    expect(reportJson).not.toContain('seeded-secret-value');
    expect(bundleJson).not.toContain('does not have the right to send mail');
    expect(bundleJson).not.toContain('seeded-secret-value');
  });

  it('does not let a body-only secret field leak even when innerError carries extra data', async () => {
    const report = await runAgainstGraph({
      status: 403,
      headers: {},
      data: {
        error: {
          code: 'ErrorSendAsDenied',
          message: 'Denied',
          innerError: {
            'request-id': 'body-request-403',
            'client-request-id': 'body-client-403',
            secret: 'seeded-secret-value',
            access_token: 'seeded-access-token',
          },
        },
      },
    });

    const serialized = `${JSON.stringify(report)}${JSON.stringify(report.supportBundle)}`;
    expect(serialized).not.toContain('seeded-secret-value');
    expect(serialized).not.toContain('seeded-access-token');
    expect(serialized).toContain('body-request-403');
  });

  it('keeps header correlation ids ahead of conflicting body ids through to the export', async () => {
    const report = await runAgainstGraph(HEADER_RESPONSE);

    const live = report.steps.find((s) => s.id === 'live_send_test');
    expect(live?.error).toMatchObject({
      status: 403,
      code: 'ErrorSendAsDenied',
      requestId: 'header-request-403',
      clientRequestId: 'header-client-403',
    });
    expect(live?.http).toMatchObject({
      requestId: 'header-request-403',
      clientRequestId: 'header-client-403',
    });

    const bundleJson = JSON.stringify(report.supportBundle);
    expect(bundleJson).toContain('header-request-403');
    expect(bundleJson).toContain('header-client-403');
    expect(bundleJson).not.toContain('body-request-403');
    expect(bundleJson).not.toContain('body-client-403');
  });
});
