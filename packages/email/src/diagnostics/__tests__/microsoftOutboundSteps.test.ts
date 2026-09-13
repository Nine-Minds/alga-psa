import { describe, it, expect, vi } from 'vitest';
import { buildMicrosoftOutboundSteps } from '../microsoftOutboundSteps';
import type { OutboundDiagnosticsContext, OutboundStepDefinition } from '../outboundTypes';

function stepById(id: string, steps: OutboundStepDefinition[]): OutboundStepDefinition {
  const step = steps.find((s) => s.id === id);
  if (!step) throw new Error(`missing step ${id}`);
  return step;
}

function makeContext(overrides: {
  adapter?: any;
  configuredMailbox?: string;
  authenticatedUserEmail?: string;
  identityPreflight?: OutboundDiagnosticsContext['identityPreflight'];
}): OutboundDiagnosticsContext {
  const configuredMailbox = overrides.configuredMailbox ?? 'sender@example.com';
  return {
    tenant: 'tenant-1',
    knex: {} as any,
    settings: { ticketingFromEmail: 'ticketing@example.com' } as any,
    options: { liveSendTest: false, includeIdentifiers: false },
    ticketingFromEmail: 'ticketing@example.com',
    defaultFromEmail: 'default@example.com',
    provider: {
      providerId: 'p1',
      providerType: 'microsoft',
      configuredMailbox,
      rawConfig: {},
      adapter: overrides.adapter,
    },
    effectiveSender: configuredMailbox,
    authenticatedUserEmail: overrides.authenticatedUserEmail,
    identityPreflight: overrides.identityPreflight,
    liveSend: async () => ({ success: true }),
    checkedCapabilities: [],
  } as any;
}

const baseAdapter = (): any => ({
  inspectStoredCredentials: vi.fn(async () => ({ accessTokenPresent: true, refreshTokenPresent: true })),
  decodeCurrentAccessTokenClaims: vi.fn(async () => ({
    decoded: true,
    scopesAvailable: true,
    scopes: ['Mail.Send', 'Mail.Send.Shared', 'Mail.Read'],
    claims: {},
  })),
  getMailboxRoute: vi.fn(() => ({
    basePath: '/me',
    configuredMailbox: 'sender@example.com',
    authenticatedUserEmail: 'sender@example.com',
    isSharedOrDelegated: false,
    rationale: 'Configured mailbox matches authenticated user; using /me',
  })),
  fetchSentItemsFolder: vi.fn(async () => ({
    status: 200,
    displayName: 'Sent Items',
    totalItemCount: 4,
    http: { method: 'GET' as const, path: '/me/mailFolders/sentitems', status: 200 },
  })),
});

describe('tokens_present', () => {
  it('fails without credentials and never exposes token values', async () => {
    const adapter = baseAdapter();
    adapter.inspectStoredCredentials = vi.fn(async () => ({ accessTokenPresent: false, refreshTokenPresent: true }));
    const ctx = makeContext({ adapter });
    const outcome = await stepById('tokens_present', buildMicrosoftOutboundSteps()).run(ctx);
    expect(outcome.status).toBe('fail');
    // Presence booleans and fingerprints only: no raw token value is surfaced.
    expect(outcome.data).toEqual({ accessTokenPresent: false, refreshTokenPresent: true });
  });

  it('passes with credentials and reports only presence/fingerprints', async () => {
    const ctx = makeContext({ adapter: baseAdapter() });
    const outcome = await stepById('tokens_present', buildMicrosoftOutboundSteps()).run(ctx);
    expect(outcome.status).toBe('pass');
    expect(outcome.data).toMatchObject({ accessTokenPresent: true, refreshTokenPresent: true });
  });
});

describe('token_claims', () => {
  it('passes when Mail.Send is present for the authenticated user', async () => {
    const adapter = baseAdapter();
    adapter.decodeCurrentAccessTokenClaims = vi.fn(async () => ({ decoded: true, scopesAvailable: true, scopes: ['Mail.Send'], claims: {} }));
    const ctx = makeContext({ adapter, authenticatedUserEmail: 'sender@example.com' });
    const outcome = await stepById('token_claims', buildMicrosoftOutboundSteps()).run(ctx);
    expect(outcome.status).toBe('pass');
    expect(outcome.data).toMatchObject({ missing: [], isSharedMailbox: false });
  });

  it('fails with reconnection advice when Mail.Send is missing', async () => {
    const adapter = baseAdapter();
    adapter.decodeCurrentAccessTokenClaims = vi.fn(async () => ({ decoded: true, scopesAvailable: true, scopes: ['Mail.Read'], claims: {} }));
    const ctx = makeContext({ adapter, authenticatedUserEmail: 'sender@example.com' });
    const outcome = await stepById('token_claims', buildMicrosoftOutboundSteps()).run(ctx);
    expect(outcome.status).toBe('fail');
    expect(outcome.data).toMatchObject({ missing: ['Mail.Send'] });
    expect(outcome.recommendations?.join(' ')).toContain('Mail.Send');
    expect(outcome.recommendations?.join(' ')).not.toMatch(/Mail\.Read and Mail\.Read\.Shared/);
  });

  it('requires Mail.Send.Shared when the sending mailbox differs from the authenticated user', async () => {
    const adapter = baseAdapter();
    adapter.decodeCurrentAccessTokenClaims = vi.fn(async () => ({ decoded: true, scopesAvailable: true, scopes: ['Mail.Send'], claims: {} }));
    const ctx = makeContext({
      adapter,
      configuredMailbox: 'shared@example.com',
      authenticatedUserEmail: 'auth@example.com',
    });
    const outcome = await stepById('token_claims', buildMicrosoftOutboundSteps()).run(ctx);
    expect(outcome.status).toBe('fail');
    expect(outcome.data).toMatchObject({ missing: ['Mail.Send.Shared'], isSharedMailbox: true });
  });

  it('warns, never passes, when the token cannot be decoded', async () => {
    const adapter = baseAdapter();
    adapter.decodeCurrentAccessTokenClaims = vi.fn(async () => ({ decoded: false, scopes: [], claims: null }));
    const ctx = makeContext({ adapter, authenticatedUserEmail: 'sender@example.com' });
    const outcome = await stepById('token_claims', buildMicrosoftOutboundSteps()).run(ctx);
    expect(outcome.status).toBe('warn');
    expect(outcome.data).toMatchObject({ decoded: false });
    expect(outcome.recommendations?.join(' ')).toMatch(/could not be decoded/i);
  });

  it('does not require Mail.Send.Shared when the authenticated identity is unknown', async () => {
    const adapter = baseAdapter();
    adapter.decodeCurrentAccessTokenClaims = vi.fn(async () => ({ decoded: true, scopesAvailable: true, scopes: ['Mail.Send'], claims: {} }));
    const ctx = makeContext({ adapter, configuredMailbox: 'shared@example.com', authenticatedUserEmail: undefined });
    const outcome = await stepById('token_claims', buildMicrosoftOutboundSteps()).run(ctx);
    expect(outcome.status).toBe('pass');
    expect(outcome.data).toMatchObject({ missing: [], mailboxRelation: 'unknown' });
    expect(outcome.recommendations?.join(' ')).toMatch(/identity could not be confirmed/i);
  });

  it('warns, never passes, when a decoded token carries no usable scope claim', async () => {
    const adapter = baseAdapter();
    adapter.decodeCurrentAccessTokenClaims = vi.fn(async () => ({ decoded: true, scopesAvailable: false, scopes: [], claims: {} }));
    const ctx = makeContext({ adapter, authenticatedUserEmail: 'sender@example.com' });
    const outcome = await stepById('token_claims', buildMicrosoftOutboundSteps()).run(ctx);
    expect(outcome.status).toBe('warn');
    expect(outcome.data).toMatchObject({ decoded: true, scopesAvailable: false });
    expect(outcome.recommendations?.join(' ')).toMatch(/no usable scp claim/i);
  });
});

describe('send_as_probe', () => {
  it('is an advisory warn for shared/delegated sending and never claims verification', async () => {
    const ctx = makeContext({
      adapter: baseAdapter(),
      configuredMailbox: 'shared@example.com',
      authenticatedUserEmail: 'auth@example.com',
    });
    const outcome = await stepById('send_as_probe', buildMicrosoftOutboundSteps()).run(ctx);
    expect(outcome.status).toBe('warn');
    expect(outcome.data).toMatchObject({ authoritative: false, draftProbePerformed: false, requiresSendAs: true });
    expect(outcome.recommendations?.join(' ')).toContain('Exchange Send As');
  });

  it('skips as not applicable for confirmed self-send', async () => {
    const ctx = makeContext({
      adapter: baseAdapter(),
      configuredMailbox: 'sender@example.com',
      authenticatedUserEmail: 'sender@example.com',
    });
    const outcome = await stepById('send_as_probe', buildMicrosoftOutboundSteps()).run(ctx);
    expect(outcome.status).toBe('skip');
    expect(outcome.data).toMatchObject({ requiresSendAs: false });
  });
});

describe('sent_items_writable', () => {
  it('stays warn with writability unverified even when the folder is readable', async () => {
    const ctx = makeContext({
      adapter: baseAdapter(),
      configuredMailbox: 'sender@example.com',
      authenticatedUserEmail: 'sender@example.com',
    });
    const outcome = await stepById('sent_items_writable', buildMicrosoftOutboundSteps()).run(ctx);
    expect(outcome.status).toBe('warn');
    expect(outcome.data).toMatchObject({ writabilityVerified: false, saveToSentItems: true });
    expect(outcome.http).toMatchObject({ status: 200 });
  });

  it('treats a 403 lookup as an access-check failure, not proof sendMail cannot save', async () => {
    const adapter = baseAdapter();
    adapter.fetchSentItemsFolder = vi.fn(async () => {
      throw {
        response: {
          status: 403,
          headers: { 'request-id': 'req-403' },
          data: { error: { code: 'ErrorAccessDenied', message: 'Access denied' } },
        },
      };
    });
    const ctx = makeContext({
      adapter,
      configuredMailbox: 'shared@example.com',
      authenticatedUserEmail: 'auth@example.com',
    });
    const outcome = await stepById('sent_items_writable', buildMicrosoftOutboundSteps()).run(ctx);
    expect(outcome.status).toBe('warn');
    expect(outcome.error).toMatchObject({ status: 403, code: 'ErrorAccessDenied', requestId: 'req-403' });
    expect(outcome.detail).toMatch(/does not prove sendMail cannot save/i);
  });
});

describe('mailbox_base_path', () => {
  it('explains Exchange Send As for shared/delegated routing with request evidence', async () => {
    const adapter = baseAdapter();
    adapter.getMailboxRoute = vi.fn(() => ({
      basePath: '/users/shared@example.com',
      configuredMailbox: 'shared@example.com',
      authenticatedUserEmail: 'auth@example.com',
      isSharedOrDelegated: true,
      rationale: 'Configured mailbox differs from authenticated user; using /users/{mailbox}',
    }));
    const ctx = makeContext({
      adapter,
      configuredMailbox: 'shared@example.com',
      authenticatedUserEmail: 'auth@example.com',
    });
    const outcome = await stepById('mailbox_base_path', buildMicrosoftOutboundSteps()).run(ctx);
    expect(outcome.status).toBe('pass');
    expect(outcome.data).toMatchObject({ mailboxBasePath: '/users/shared@example.com', isSharedOrDelegated: true });
    expect(outcome.recommendations?.join(' ')).toMatch(/Exchange Send As/);
    expect(ctx.mailboxBasePath).toBe('/users/shared@example.com');
  });
});
