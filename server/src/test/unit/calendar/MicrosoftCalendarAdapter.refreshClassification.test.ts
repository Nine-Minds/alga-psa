import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarProviderConfig } from '@alga-psa/types';

const axiosPost = vi.hoisted(() => vi.fn());

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return { ...actual, default: { ...actual.default, post: axiosPost, create: actual.default.create } };
});

vi.mock('../../../../../ee/packages/calendar/src/lib/microsoftConsumerProfileResolution', () => ({
  resolveMicrosoftConsumerProfileConfig: async () => ({
    status: 'ready',
    clientId: 'app-id',
    clientSecret: 'app-secret',
    credentialSource: 'tenant-secret',
    microsoftTenantId: null,
  }),
}));

import { MicrosoftCalendarAdapter } from '../../../../../ee/packages/calendar/src/lib/services/calendar/providers/MicrosoftCalendarAdapter';
import {
  describeMicrosoftOAuthFailureForMailboxFlow,
} from '../../../../../shared/services/email/microsoftOAuthErrors';

const config: CalendarProviderConfig = {
  id: 'provider', tenant: 'tenant', user_id: 'user', name: 'Outlook',
  provider_type: 'microsoft', calendar_id: 'calendar', active: true,
  sync_direction: 'bidirectional', connection_status: 'connected',
  created_at: '', updated_at: '', provider_config: {},
};

const rejection = (status: number, data: Record<string, unknown>) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data, headers: {} },
    config: { data: 'client_id=app-id&client_secret=app-secret&refresh_token=refresh-token' },
  });

function makeAdapter() {
  const adapter = new MicrosoftCalendarAdapter(config) as any;
  adapter.refreshToken = 'refresh-token';
  return adapter;
}

describe('enterprise MicrosoftCalendarAdapter refresh classification', () => {
  beforeEach(() => { axiosPost.mockReset(); });

  it('throws <code>: <message> for an expired client secret without leaking secrets', async () => {
    axiosPost.mockImplementation(async () => { throw rejection(401, {
      error: 'invalid_client',
      error_codes: [7000222],
      error_description: "AADSTS7000222: The provided client secret keys for app 'app-id' are expired.",
    }); });
    const logSpies = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const adapter = makeAdapter();
    const error: any = await adapter.refreshAccessToken().catch((e: unknown) => e);
    expect(error.message).toBe(
      `aadsts_7000222_expired_secret: ${describeMicrosoftOAuthFailureForMailboxFlow('expired_client_secret')}`
    );
    expect(error.message).not.toContain('Request failed with status code');
    expect(error.status).toBe(401);
    expect(JSON.stringify(error)).not.toMatch(/app-secret|refresh-token/);

    // testConnection (used by the UI / sync error state) carries the same text.
    adapter.accessToken = 'stale-access-token';
    adapter.tokenExpiresAt = new Date(0);
    const result = await adapter.testConnection();
    expect(result.success).toBe(false);
    expect(result.error).toBe(error.message);

    const logged = JSON.stringify(logSpies.flatMap((spy) => spy.mock.calls));
    expect(logged).not.toContain('client_secret');
    expect(logged).not.toContain('app-secret');
    expect(logged).not.toContain('refresh-token');
    logSpies.forEach((spy) => spy.mockRestore());
  });

  it('keeps the existing wrapped message for an unmapped 401 (AADSTS70008)', async () => {
    axiosPost.mockImplementation(async () => { throw rejection(401, {
      error: 'invalid_grant',
      error_codes: [70008],
      error_description: 'AADSTS70008: The refresh token has expired.',
    }); });
    const error: any = await makeAdapter().refreshAccessToken().catch((e: unknown) => e);
    expect(error.message).toMatch(/^Error in refreshAccessToken: /);
    expect(error.microsoftOAuthFailureKind).toBeUndefined();
  });

  it('handleError returns a classified Microsoft OAuth error unchanged, but still prefixes other errors', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const adapter = makeAdapter();
    const mapped = Object.assign(
      new Error(`aadsts_7000215_invalid_secret: ${describeMicrosoftOAuthFailureForMailboxFlow('invalid_client_secret')}`),
      { code: 'aadsts_7000215_invalid_secret', microsoftOAuthFailureKind: 'invalid_client_secret' }
    );

    const passed = adapter.handleError(mapped, 'createEvent');
    expect(passed).toBe(mapped);
    expect(passed.message).toBe(mapped.message);
    expect(passed.message.startsWith('Error in')).toBe(false);
    expect(passed.microsoftOAuthFailureKind).toBe('invalid_client_secret');

    const plain = adapter.handleError(new Error('boom'), 'createEvent');
    expect(plain.message).toBe('Error in createEvent: boom');
  });
});
