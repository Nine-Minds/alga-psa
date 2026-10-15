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
    expect(outcome.recommendations?.join(' ')).toMatch(/Reconnect.*approve the requested email permissions/);
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
    expect(outcome.recommendations).toBeUndefined();
    expect(outcome.detail).toMatch(/Email permissions could not be checked/i);
  });

  it('does not require Mail.Send.Shared when the authenticated identity is unknown', async () => {
    const adapter = baseAdapter();
    adapter.decodeCurrentAccessTokenClaims = vi.fn(async () => ({ decoded: true, scopesAvailable: true, scopes: ['Mail.Send'], claims: {} }));
    const ctx = makeContext({ adapter, configuredMailbox: 'shared@example.com', authenticatedUserEmail: undefined });
    const outcome = await stepById('token_claims', buildMicrosoftOutboundSteps()).run(ctx);
    expect(outcome.status).toBe('pass');
    expect(outcome.data).toMatchObject({ missing: [], mailboxRelation: 'unknown' });
    expect(outcome.recommendations).toBeUndefined();
    expect(outcome.detail).toMatch(/connected account could not be identified/i);
  });

  it('warns, never passes, when a decoded token carries no usable scope claim', async () => {
    const adapter = baseAdapter();
    adapter.decodeCurrentAccessTokenClaims = vi.fn(async () => ({ decoded: true, scopesAvailable: false, scopes: [], claims: {} }));
    const ctx = makeContext({ adapter, authenticatedUserEmail: 'sender@example.com' });
    const outcome = await stepById('token_claims', buildMicrosoftOutboundSteps()).run(ctx);
    expect(outcome.status).toBe('warn');
    expect(outcome.data).toMatchObject({ decoded: true, scopesAvailable: false });
    expect(outcome.recommendations).toBeUndefined();
    expect(outcome.detail).toMatch(/Email permissions could not be checked/i);
  });
});

describe('send_as_probe', () => {
  it('skips as not applicable for a confirmed self-send', async () => {
    const ctx = makeContext({
      adapter: baseAdapter(),
      configuredMailbox: 'sender@example.com',
      authenticatedUserEmail: 'sender@example.com',
    });
    const outcome = await stepById('send_as_probe', buildMicrosoftOutboundSteps()).run(ctx);
    expect(outcome.status).toBe('skip');
    expect(outcome.data).toMatchObject({ mailboxRelation: 'self', requiresSendAs: false });
  });

  it('warns and names Exchange Send As for a confirmed shared mailbox without an authoritative probe', async () => {
    const ctx = makeContext({
      adapter: baseAdapter(),
      configuredMailbox: 'shared@example.com',
      authenticatedUserEmail: 'auth@example.com',
    });
    const outcome = await stepById('send_as_probe', buildMicrosoftOutboundSteps()).run(ctx);
    expect(outcome.status).toBe('warn');
    expect(outcome.data).toMatchObject({
      isSharedMailbox: true,
      mailboxRelation: 'shared',
      requiresSendAs: true,
      authoritative: false,
      draftProbePerformed: false,
    });
    expect(outcome.detail).toMatch(/Exchange Send As has not been confirmed/i);
    expect(outcome.recommendations?.join(' ')).toMatch(/Exchange Send As/);
    expect(outcome.recommendations?.join(' ')).toMatch(/not verified/i);
  });

  it('warns without classifying an unknown identity as a confirmed shared mailbox', async () => {
    const ctx = makeContext({
      adapter: baseAdapter(),
      configuredMailbox: 'shared@example.com',
      authenticatedUserEmail: undefined,
    });
    const outcome = await stepById('send_as_probe', buildMicrosoftOutboundSteps()).run(ctx);
    expect(outcome.status).toBe('warn');
    expect(outcome.data).toMatchObject({
      isSharedMailbox: false,
      mailboxRelation: 'unknown',
      requiresSendAs: null,
      authoritative: false,
    });
  });
});

describe('sent_items_writable', () => {
  it('warns when the folder is readable but writability cannot be verified', async () => {
    const ctx = makeContext({
      adapter: baseAdapter(),
      configuredMailbox: 'sender@example.com',
      authenticatedUserEmail: 'sender@example.com',
    });
    const outcome = await stepById('sent_items_writable', buildMicrosoftOutboundSteps()).run(ctx);
    expect(outcome.status).toBe('warn');
    expect(outcome.data).toMatchObject({ writabilityVerified: false, saveToSentItems: true });
    expect(outcome.detail).toMatch(/does not verify the ability to write or save sent messages/i);
    expect(outcome.http).toMatchObject({ status: 200 });
    expect(outcome.recommendations?.join(' ')).toMatch(/does not prove sent messages can be saved/i);
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
    expect(outcome.detail).toMatch(/saving sent messages remains unverified/);
    expect(outcome.recommendations?.join(' ')).toMatch(/saving sent messages remains unverified/);
  });

  it('retains body-only innerError correlation ids with a sanitized message', async () => {
    const adapter = baseAdapter();
    adapter.fetchSentItemsFolder = vi.fn(async () => {
      throw {
        response: {
          status: 403,
          headers: {},
          data: {
            error: {
              code: 'ErrorAccessDenied',
              message: 'PRIVATE-SENTITEMS-MESSAGE',
              innerError: {
                'request-id': 'body-req-403',
                'client-request-id': 'body-client-403',
                secret: 'seeded-secret',
              },
            },
          },
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
    expect(outcome.error).toMatchObject({
      status: 403,
      code: 'ErrorAccessDenied',
      requestId: 'body-req-403',
      clientRequestId: 'body-client-403',
    });
    expect(outcome.http).toMatchObject({
      method: 'GET',
      status: 403,
      requestId: 'body-req-403',
      clientRequestId: 'body-client-403',
    });
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain('PRIVATE-SENTITEMS-MESSAGE');
    expect(serialized).not.toContain('seeded-secret');
    expect(outcome.error?.message).not.toContain('Access denied');
  });
});

describe('mailbox_base_path', () => {
  it('explains Exchange Send As for shared/delegated routing', async () => {
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

  it('does not claim Exchange Send As is required for a confirmed self-send', async () => {
    const ctx = makeContext({
      adapter: baseAdapter(),
      configuredMailbox: 'sender@example.com',
      authenticatedUserEmail: 'sender@example.com',
    });
    const outcome = await stepById('mailbox_base_path', buildMicrosoftOutboundSteps()).run(ctx);
    expect(outcome.status).toBe('pass');
    expect(outcome.recommendations).toBeUndefined();
  });
});
