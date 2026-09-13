import { describe, it, expect, vi, beforeEach } from 'vitest';
import { liveSendResultFromEmailSendResult, runOutboundEmailDiagnosticsWithSettings } from '../outboundDiagnostics';
import type { ResolvedOutboundProvider, OutboundLiveSend } from '../outboundTypes';
import { SMTPEmailProvider } from '../../providers/SMTPEmailProvider';

const smtpCreateTransport = vi.hoisted(() => vi.fn());
vi.mock('nodemailer', () => ({
  default: { createTransport: (...args: unknown[]) => smtpCreateTransport(...args) },
}));

// Exercise the real production sender resolver; only the DB-backed tenant
// company lookup is stubbed.
vi.mock('../../senderIdentity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../senderIdentity')>();
  return {
    ...actual,
    resolveTenantCompanyName: vi.fn(async () => 'Acme Corp'),
  };
});

function makeSettings(overrides: Record<string, any> = {}) {
  return {
    tenantId: 'tenant-1',
    emailProvider: 'microsoft',
    providerConfigs: [
      {
        providerId: 'p1',
        providerType: 'microsoft',
        isEnabled: true,
        config: { from: 'sender@example.com' },
      },
    ],
    ticketingFromEmail: 'ticketing@example.com',
    ticketingFromName: 'Acme',
    customDomains: [],
    trackingEnabled: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as any;
}

function makeAdapter(overrides: Record<string, any> = {}) {
  return {
    fetchAuthenticatedIdentity: vi.fn(async () => ({
      email: 'auth@example.com',
      data: { id: 'u1', userPrincipalName: 'auth@example.com' },
      http: { method: 'GET' as const, path: '/me', status: 200, requestId: 'rid-me' },
    })),
    inspectStoredCredentials: vi.fn(async () => ({
      accessTokenPresent: true,
      refreshTokenPresent: true,
      accessTokenFingerprint: 'abcd...(20)',
      refreshTokenFingerprint: 'efgh...(20)',
      tokenExpiresAt: new Date().toISOString(),
    })),
    decodeCurrentAccessTokenClaims: vi.fn(async () => ({
      decoded: true,
      scopesAvailable: true,
      scopes: ['Mail.Send', 'Mail.Send.Shared', 'Mail.Read'],
      claims: {},
    })),
    getMailboxRoute: vi.fn(() => ({
      basePath: '/users/sender@example.com',
      configuredMailbox: 'sender@example.com',
      authenticatedUserEmail: 'auth@example.com',
      isSharedOrDelegated: true,
      rationale: 'Configured mailbox differs from authenticated user; using /users/{mailbox}',
    })),
    fetchSentItemsFolder: vi.fn(async () => ({
      status: 200,
      displayName: 'Sent Items',
      totalItemCount: 3,
      http: { method: 'GET' as const, path: '/users/sender@example.com/mailFolders/sentitems', status: 200 },
    })),
    ...overrides,
  };
}

async function runWith(
  provider: ResolvedOutboundProvider | { error: string },
  options: Record<string, any> = {},
  sendLive?: OutboundLiveSend,
  settings: any = makeSettings(),
) {
  return runOutboundEmailDiagnosticsWithSettings({
    tenant: 'tenant-1',
    knex: {} as any,
    settings,
    options,
    deps: {
      resolveProvider: vi.fn(async () => provider),
      ...(sendLive ? { sendLive } : {}),
    },
  });
}

/**
 * Run a real SMTPEmailProvider rejection (mocked transporter only) through the
 * production-result mapper and the report, so the classification is exercised
 * against native provider metadata rather than a hand-built sendLive result.
 */
async function runSmtpProviderFailure(nativeError: unknown) {
  const transporter = {
    verify: vi.fn(async () => true),
    close: vi.fn(),
    sendMail: vi.fn(async () => {
      throw nativeError;
    }),
  };
  smtpCreateTransport.mockReturnValue(transporter);

  const provider = new SMTPEmailProvider('smtp-1');
  await provider.initialize({
    host: 'smtp.example.com',
    port: 587,
    username: 'u',
    password: 'p',
    from: 'sender@example.com',
  });

  const sendLive = async () =>
    liveSendResultFromEmailSendResult(
      await provider.sendEmail(
        { from: { email: 'sender@example.com' }, to: [{ email: 'admin@example.com' }], subject: 'diag', text: 'body' },
        'tenant-1',
      ),
    );

  return runWith(
    {
      providerId: 'smtp-1',
      providerType: 'smtp',
      rawConfig: { host: 'smtp.example.com', port: 587, username: 'u', password: 'p', from: 'sender@example.com' },
    },
    { liveSendTest: true, recipient: 'admin@example.com' },
    sendLive as any,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runOutboundEmailDiagnosticsWithSettings', () => {
  it('fails the selection step and skips dependent work when no provider is enabled', async () => {
    const sendLive = vi.fn();
    const report = await runWith({ error: 'No outbound email provider is enabled.' }, {}, sendLive as any);

    const selection = report.steps.find((s) => s.id === 'outbound_provider_selected');
    expect(selection?.status).toBe('fail');
    expect(selection?.error?.message).toContain('No outbound email provider is enabled');

    const skip = report.steps.find((s) => s.id === 'outbound_provider_steps');
    expect(skip?.status).toBe('skip');
    expect(report.steps.some((s) => s.id === 'live_send_test')).toBe(false);
    expect(report.summary.overallStatus).toBe('fail');
    expect(sendLive).not.toHaveBeenCalled();
  });

  it('dispatches Microsoft steps and reports effective sender separately from ticketing From', async () => {
    const adapter = makeAdapter();
    const report = await runWith({
      providerId: 'p1',
      providerType: 'microsoft',
      configuredMailbox: 'sender@example.com',
      rawConfig: {},
      adapter: adapter as any,
    });

    expect(report.steps.map((s) => s.id)).toEqual([
      'outbound_provider_selected',
      'tokens_present',
      'token_claims',
      'graph_me',
      'mailbox_base_path',
      'send_as_probe',
      'sent_items_writable',
      'live_send_test',
    ]);
    expect(report.summary.providerType).toBe('microsoft');
    expect(report.summary.effectiveSender).toBe('sender@example.com');
    expect(report.summary.effectiveSenderName).toBe('Acme Corp');
    expect(report.summary.ticketingFromEmail).toBe('ticketing@example.com');
    expect(report.summary.defaultFromEmail).toBe('sender@example.com');
    expect(report.summary.authenticatedUserEmail).toBe('auth@example.com');
    expect(report.summary.mailboxBasePath).toBe('/users/sender@example.com');
  });

  it('resolves the SMTP effective sender through the production resolver (domain rewrite + display name)', async () => {
    const settings = makeSettings({
      emailProvider: 'smtp',
      defaultFromDomain: 'acme.example',
      providerConfigs: [
        {
          providerId: 'smtp-1',
          providerType: 'smtp',
          isEnabled: true,
          config: {
            host: '',
            port: 587,
            from: '"Support Team" <support@provider.example>',
            fromName: 'Support Team',
          },
        },
      ],
    });
    const report = await runWith(
      { providerId: 'smtp-1', providerType: 'smtp', rawConfig: { host: '', port: 587 } },
      {},
      undefined,
      settings,
    );

    // The provider From is re-homed onto defaultFromDomain and its display name
    // is preserved, matching what a real test send would use.
    expect(report.summary.effectiveSender).toBe('support@acme.example');
    expect(report.summary.effectiveSenderName).toBe('Support Team');
    expect(report.summary.defaultFromEmail).toBe('support@acme.example');
    expect(report.steps.find((s) => s.id === 'outbound_provider_selected')?.data).toMatchObject({
      effectiveSender: 'support@acme.example',
      effectiveSenderName: 'Support Team',
    });
  });

  it('keeps Microsoft effective sender as the bound mailbox while preserving the resolved name', async () => {
    const adapter = makeAdapter();
    const report = await runWith(
      { providerId: 'p1', providerType: 'microsoft', configuredMailbox: 'mailbox@contoso.example', rawConfig: {}, adapter: adapter as any },
      {},
      undefined,
      makeSettings({ defaultFromDomain: 'contoso.example' }),
    );

    expect(report.summary.effectiveSender).toBe('mailbox@contoso.example');
    expect(report.summary.effectiveSenderName).toBe('Acme Corp');
  });

  it('does not send by default and skips the live-send step', async () => {
    const sendLive = vi.fn();
    const adapter = makeAdapter();
    const report = await runWith(
      { providerId: 'p1', providerType: 'microsoft', configuredMailbox: 'sender@example.com', rawConfig: {}, adapter: adapter as any },
      {},
      sendLive as any,
    );
    const live = report.steps.find((s) => s.id === 'live_send_test');
    expect(live?.status).toBe('skip');
    expect(report.summary.liveSendRequested).toBe(false);
    expect(report.summary.liveSendPerformed).toBe(false);
    expect(sendLive).not.toHaveBeenCalled();
  });

  it('requires a recipient before live sending', async () => {
    const sendLive = vi.fn();
    const adapter = makeAdapter();
    const report = await runWith(
      { providerId: 'p1', providerType: 'microsoft', configuredMailbox: 'sender@example.com', rawConfig: {}, adapter: adapter as any },
      { liveSendTest: true },
      sendLive as any,
    );
    const live = report.steps.find((s) => s.id === 'live_send_test');
    expect(live?.status).toBe('fail');
    expect(sendLive).not.toHaveBeenCalled();
  });

  it('sends once through the effective sender when opted in and reports acceptance not delivery', async () => {
    const sendLive = vi.fn(async () => ({ success: true, messageId: 'mid-1' }));
    const adapter = makeAdapter();
    const report = await runWith(
      { providerId: 'p1', providerType: 'microsoft', configuredMailbox: 'sender@example.com', rawConfig: {}, adapter: adapter as any },
      { liveSendTest: true, recipient: 'admin@example.com' },
      sendLive as any,
    );

    expect(sendLive).toHaveBeenCalledTimes(1);
    expect(sendLive).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'sender@example.com',
        fromName: 'Acme Corp',
        recipient: 'admin@example.com',
      }),
    );
    const live = report.steps.find((s) => s.id === 'live_send_test');
    expect(live?.status).toBe('pass');
    expect(live?.data).toMatchObject({ accepted: true, delivered: false, messageId: 'mid-1' });
    expect((live?.data as any)?.note).toMatch(/acceptance is not delivery/i);
    expect(report.summary.liveSendPerformed).toBe(true);
  });

  it('names Exchange Send As when a live send fails with ErrorSendAsDenied and preserves correlation ids', async () => {
    const sendLive = vi.fn(async () => ({
      success: false,
      error: 'The send-as permission was denied.',
      errorCode: 'ErrorSendAsDenied',
      status: 403,
      requestId: 'req-send',
      clientRequestId: 'cli-send',
      definitelyNotSent: true,
      requiresReconciliation: false,
    }));
    const adapter = makeAdapter();
    const report = await runWith(
      { providerId: 'p1', providerType: 'microsoft', configuredMailbox: 'shared@example.com', rawConfig: {}, adapter: adapter as any },
      { liveSendTest: true, recipient: 'admin@example.com' },
      sendLive as any,
    );
    const live = report.steps.find((s) => s.id === 'live_send_test');
    expect(live?.status).toBe('fail');
    expect(live?.error).toMatchObject({
      status: 403,
      code: 'ErrorSendAsDenied',
      requestId: 'req-send',
      clientRequestId: 'cli-send',
    });
    expect(live?.http).toMatchObject({ status: 403, requestId: 'req-send', clientRequestId: 'cli-send' });
    expect(report.recommendations.join(' ')).toMatch(/ErrorSendAsDenied/);
    expect(report.recommendations.join(' ')).toMatch(/Exchange Send As/);
    // Outbound advice must never inherit the inbound Mail.Read remediation.
    expect(report.recommendations.join(' ')).not.toMatch(/Mail\.Read/);
    expect(report.recommendations.join(' ')).not.toMatch(/delegated access to the target mailbox/i);
  });

  it('treats a generic live-send 403 as inconclusive rather than a confirmed Send As denial', async () => {
    const sendLive = vi.fn(async () => ({
      success: false,
      error: 'Forbidden',
      status: 403,
      requestId: 'req-generic',
    }));
    const adapter = makeAdapter();
    const report = await runWith(
      { providerId: 'p1', providerType: 'microsoft', configuredMailbox: 'sender@example.com', rawConfig: {}, adapter: adapter as any },
      { liveSendTest: true, recipient: 'admin@example.com' },
      sendLive as any,
    );
    const text = report.recommendations.join(' ');
    expect(text).toMatch(/does not identify the missing permission/i);
    expect(text).not.toMatch(/ErrorSendAsDenied/);
  });

  it('preserves Graph status and request id when the identity preflight fails', async () => {
    const adapter = makeAdapter({
      fetchAuthenticatedIdentity: vi.fn(async () => {
        throw {
          response: {
            status: 401,
            headers: { 'request-id': 'req-auth', 'client-request-id': 'cli-auth' },
            data: { error: { code: 'InvalidAuthenticationToken', message: 'Access token expired' } },
          },
        };
      }),
    });
    const report = await runWith({
      providerId: 'p1',
      providerType: 'microsoft',
      configuredMailbox: 'sender@example.com',
      rawConfig: {},
      adapter: adapter as any,
    });
    const me = report.steps.find((s) => s.id === 'graph_me');
    expect(me?.status).toBe('fail');
    expect(me?.error).toMatchObject({
      status: 401,
      code: 'InvalidAuthenticationToken',
      requestId: 'req-auth',
      clientRequestId: 'cli-auth',
    });
  });

  it('dispatches SMTP steps and skips network work when configuration is incomplete', async () => {
    const report = await runWith({
      providerId: 'smtp-1',
      providerType: 'smtp',
      rawConfig: { port: 587, from: 'sender@example.com' },
    });
    expect(report.steps.map((s) => s.id)).toEqual([
      'outbound_provider_selected',
      'smtp_configuration',
      'smtp_connection',
      'smtp_tls',
      'smtp_auth',
      'live_send_test',
    ]);
    expect(report.steps.find((s) => s.id === 'smtp_configuration')?.status).toBe('fail');
    expect(report.steps.find((s) => s.id === 'smtp_connection')?.status).toBe('skip');
  });

  it.each([
    {
      name: 'AUTH failure',
      error: Object.assign(new Error('auth failed'), {
        code: 'EAUTH',
        responseCode: 535,
        command: 'AUTH',
        response: '535 5.7.8 Authentication credentials invalid',
      }),
      expected: /SMTP authentication was rejected/i,
      forbidden: /rejected the recipient or message|could not be reached|TLS handshake failed/i,
      data: { errorCode: 'EAUTH', responseCode: 535, command: 'AUTH' },
    },
    {
      name: 'recipient rejection',
      error: Object.assign(new Error('550 5.1.1 User unknown'), {
        code: 'EENVELOPE',
        command: 'RCPT',
        responseCode: 550,
        response: '550 5.1.1 User unknown',
      }),
      expected: /rejected the recipient or message/i,
      forbidden: /authentication was rejected|could not be reached|TLS handshake failed/i,
      data: { errorCode: 'EENVELOPE', responseCode: 550, command: 'RCPT' },
    },
    {
      name: 'connection failure',
      error: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:25'), {
        code: 'ECONNREFUSED',
        command: 'CONN',
      }),
      expected: /could not be reached/i,
      forbidden: /authentication was rejected|rejected the recipient or message|TLS handshake failed/i,
      data: { errorCode: 'ECONNREFUSED', command: 'CONN' },
    },
    {
      name: 'TLS failure',
      error: Object.assign(new Error('self-signed certificate in certificate chain'), {
        code: 'ETLS',
      }),
      expected: /TLS handshake failed/i,
      forbidden: /authentication was rejected|rejected the recipient or message|could not be reached/i,
      data: { errorCode: 'ETLS' },
    },
  ])(
    'classifies a real SMTP $name from native protocol evidence',
    async ({ error, expected, forbidden, data }) => {
      // The provider's generic message names host/port/credentials/TLS for every
      // failure; classification must ignore it and use only native evidence.
      const report = await runSmtpProviderFailure(error);

      const live = report.steps.find((s) => s.id === 'live_send_test');
      expect(live?.status).toBe('fail');
      expect(live?.data).toMatchObject(data);

      const text = report.recommendations.join(' ');
      expect(text).toMatch(expected);
      expect(text).not.toMatch(forbidden);
      expect(text).not.toMatch(/Microsoft Graph|Exchange Send As|Mail\.Read/i);
    },
  );

  it('uses Resend-specific live-send advice rather than Graph advice', async () => {
    const sendLive = vi.fn(async () => ({
      success: false,
      error: 'Forbidden',
      status: 403,
    }));
    const report = await runWith(
      { providerId: 'resend-1', providerType: 'resend', rawConfig: {} },
      { liveSendTest: true, recipient: 'admin@example.com' },
      sendLive as any,
    );
    const live = report.steps.find((s) => s.id === 'live_send_test');
    expect(live?.status).toBe('fail');
    const text = report.recommendations.join(' ');
    expect(text).toMatch(/Resend denied the send/i);
    expect(text).not.toMatch(/Microsoft Graph|Exchange Send As|Mail\.Read/i);
  });

  it('dispatches Resend steps and skips the domains call without an API key', async () => {
    const report = await runWith({
      providerId: 'resend-1',
      providerType: 'resend',
      rawConfig: {},
    });
    expect(report.steps.map((s) => s.id)).toEqual([
      'outbound_provider_selected',
      'resend_configuration',
      'resend_domains_check',
      'live_send_test',
    ]);
    expect(report.steps.find((s) => s.id === 'resend_configuration')?.status).toBe('fail');
    expect(report.steps.find((s) => s.id === 'resend_domains_check')?.status).toBe('skip');
  });

  it('redacts identifiers and never serializes secrets in the support bundle by default', async () => {
    const adapter = makeAdapter();
    const report = await runWith(
      { providerId: 'p1', providerType: 'microsoft', configuredMailbox: 'sender@example.com', rawConfig: {}, adapter: adapter as any },
      {},
    );
    const bundle = JSON.stringify(report.supportBundle);
    expect(bundle).not.toContain('sender@example.com');
    expect(bundle).not.toContain('auth@example.com');
    expect(bundle).not.toContain('ticketing@example.com');
    expect(bundle).toContain('[redacted-email]');
    // Top-level report identities remain visible to the authorized admin; only the exported bundle is redacted.
    expect(report.summary.effectiveSender).toBe('sender@example.com');
  });

  it('keeps identifiers when includeIdentifiers is explicitly set', async () => {
    const report = await runWith(
      {
        providerId: 'p1',
        providerType: 'microsoft',
        configuredMailbox: 'sender@example.com',
        rawConfig: {},
        adapter: makeAdapter() as any,
      },
      { includeIdentifiers: true },
    );
    const bundle = JSON.stringify(report.supportBundle);
    expect(bundle).toContain('sender@example.com');
    expect(bundle).toContain('auth@example.com');
  });
});
