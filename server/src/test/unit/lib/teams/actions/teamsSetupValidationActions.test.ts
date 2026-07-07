import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const state = {
    hasPermission: true,
    availability: { enabled: true as boolean, reason: 'enabled', message: undefined as string | undefined },
    resolution: {
      status: 'ready',
      tenantId: 'tenant-1',
      profileId: 'profile-1',
      clientId: 'client-1',
      clientSecret: 'client-secret-1',
      microsoftTenantId: 'aad-tenant-1',
    } as Record<string, unknown>,
  };

  return {
    state,
    hasPermissionMock: vi.fn(async () => state.hasPermission),
    getTeamsAvailabilityMock: vi.fn(async () =>
      state.availability.enabled
        ? { enabled: true, reason: 'enabled' }
        : { enabled: false, reason: 'addon_required', message: state.availability.message }
    ),
    resolveProviderConfigMock: vi.fn(async () => state.resolution),
  };
});

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: hoisted.hasPermissionMock,
}));

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth: (fn: unknown) => fn,
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/teams/teamsAvailability', () => ({
  getTeamsAvailability: hoisted.getTeamsAvailabilityMock,
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/auth/teamsMicrosoftProviderResolution', () => ({
  resolveTeamsMicrosoftProviderConfigImpl: hoisted.resolveProviderConfigMock,
}));

import {
  probeTeamsGraphPermissionsImpl,
  validateTeamsBotConnectorImpl,
  validateTeamsGraphCredentialsImpl,
} from '@alga-psa/ee-microsoft-teams/lib/actions/integrations/teamsSetupValidationActions';

const TENANT = '22222222-2222-2222-2222-222222222222';
const USER = {
  user_id: 'psa-user-1',
  user_type: 'internal',
};

const ALL_REQUIRED_PERMISSIONS = [
  'Calendars.ReadWrite',
  'OnlineMeetings.ReadWrite.All',
  'OnlineMeetingRecording.Read.All',
  'OnlineMeetingTranscript.Read.All',
  'TeamsActivity.Send',
  'User.Read.All',
];

const fetchMock = vi.fn();

function mintJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fake-signature`;
}

function tokenResponse(accessToken: string) {
  return new Response(
    JSON.stringify({ token_type: 'Bearer', expires_in: 3599, access_token: accessToken }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

function aadErrorResponse(aadstsCode: string, description: string, status = 401) {
  return new Response(
    JSON.stringify({
      error: 'invalid_client',
      error_description: `${aadstsCode}: ${description}`,
      error_codes: [Number(aadstsCode.replace('AADSTS', ''))],
    }),
    { status, headers: { 'Content-Type': 'application/json' } }
  );
}

function readyResolution(overrides: Record<string, unknown> = {}) {
  hoisted.state.resolution = {
    status: 'ready',
    tenantId: TENANT,
    profileId: 'profile-1',
    clientId: 'client-1',
    clientSecret: 'client-secret-1',
    microsoftTenantId: 'aad-tenant-1',
    ...overrides,
  };
}

function stubBotEnv(overrides: Record<string, string> = {}) {
  vi.stubEnv('TEAMS_BOT_APP_ID', overrides.TEAMS_BOT_APP_ID ?? 'bot-app-1');
  vi.stubEnv('TEAMS_BOT_APP_TENANT_ID', overrides.TEAMS_BOT_APP_TENANT_ID ?? 'bot-tenant-1');
  vi.stubEnv('TEAMS_BOT_APP_PASSWORD', overrides.TEAMS_BOT_APP_PASSWORD ?? 'bot-password-1');
}

beforeEach(() => {
  hoisted.state.hasPermission = true;
  hoisted.state.availability = { enabled: true, reason: 'enabled', message: undefined };
  readyResolution();
  hoisted.hasPermissionMock.mockClear();
  hoisted.getTeamsAvailabilityMock.mockClear();
  hoisted.resolveProviderConfigMock.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('TEAMS_BOT_APP_ID', '');
  vi.stubEnv('TEAMS_BOT_APP_TENANT_ID', '');
  vi.stubEnv('TEAMS_BOT_APP_PASSWORD', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('validateTeamsGraphCredentials (T091)', () => {
  it('denies callers that lack the Teams settings permission', async () => {
    hoisted.state.hasPermission = false;

    await expect(validateTeamsGraphCredentialsImpl(USER, { tenant: TENANT })).rejects.toThrow('Forbidden');
    expect(hoisted.hasPermissionMock).toHaveBeenCalledWith(USER, 'system_settings', 'update');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('short-circuits with addon_inactive when the Teams add-on is unavailable', async () => {
    hoisted.state.availability = {
      enabled: false,
      reason: 'addon_required',
      message: 'Microsoft Teams integration requires the Teams add-on.',
    };

    await expect(validateTeamsGraphCredentialsImpl(USER, { tenant: TENANT })).resolves.toEqual({
      status: 'failed',
      reason: 'addon_inactive',
      message: 'Microsoft Teams integration requires the Teams add-on.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns profile_not_ready naming what is missing when the profile cannot resolve', async () => {
    hoisted.state.resolution = {
      status: 'not_configured',
      tenantId: TENANT,
      message: 'Teams is not configured for this tenant',
    };

    await expect(validateTeamsGraphCredentialsImpl(USER, { tenant: TENANT })).resolves.toEqual({
      status: 'failed',
      reason: 'profile_not_ready',
      message: 'Teams is not configured for this tenant',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats a ready resolution without a client secret as profile_not_ready', async () => {
    readyResolution({ clientSecret: undefined, message: undefined });

    const result = await validateTeamsGraphCredentialsImpl(USER, { tenant: TENANT });
    expect(result).toMatchObject({ status: 'failed', reason: 'profile_not_ready' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('acquires a real app-only token against the profile tenant authority on success', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse(mintJwt({ roles: ALL_REQUIRED_PERMISSIONS })));

    await expect(validateTeamsGraphCredentialsImpl(USER, { tenant: TENANT })).resolves.toEqual({
      status: 'ok',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://login.microsoftonline.com/aad-tenant-1/oauth2/v2.0/token');
    const body = init.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('client_id')).toBe('client-1');
    expect(body.get('client_secret')).toBe('client-secret-1');
    expect(body.get('scope')).toBe('https://graph.microsoft.com/.default');
  });

  it('maps a bad client secret (AADSTS7000215) to a typed, user-readable failure', async () => {
    fetchMock.mockResolvedValueOnce(
      aadErrorResponse('AADSTS7000215', 'Invalid client secret provided.')
    );

    const result = await validateTeamsGraphCredentialsImpl(USER, { tenant: TENANT });
    expect(result).toMatchObject({ status: 'failed', reason: 'invalid_client_secret' });
    expect((result as { message: string }).message).toContain('AADSTS7000215');
    expect((result as { message: string }).message).toContain('client secret');
  });

  it('maps an unknown client id (AADSTS700016) to invalid_client_id', async () => {
    fetchMock.mockResolvedValueOnce(
      aadErrorResponse('AADSTS700016', "Application with identifier 'client-1' was not found in the directory.", 400)
    );

    const result = await validateTeamsGraphCredentialsImpl(USER, { tenant: TENANT });
    expect(result).toMatchObject({ status: 'failed', reason: 'invalid_client_id' });
    expect((result as { message: string }).message).toContain('AADSTS700016');
  });

  it('maps an unknown Microsoft tenant (AADSTS90002) to invalid_microsoft_tenant_id', async () => {
    fetchMock.mockResolvedValueOnce(
      aadErrorResponse('AADSTS90002', "Tenant 'aad-tenant-1' not found.", 400)
    );

    const result = await validateTeamsGraphCredentialsImpl(USER, { tenant: TENANT });
    expect(result).toMatchObject({ status: 'failed', reason: 'invalid_microsoft_tenant_id' });
    expect((result as { message: string }).message).toContain('AADSTS90002');
  });

  it('maps token endpoint rejections without a known AADSTS code to token_failure', async () => {
    fetchMock.mockResolvedValueOnce(
      aadErrorResponse('AADSTS500011', 'The resource principal was not found.', 400)
    );

    const result = await validateTeamsGraphCredentialsImpl(USER, { tenant: TENANT });
    expect(result).toMatchObject({ status: 'failed', reason: 'token_failure' });
    expect((result as { message: string }).message).toContain('AADSTS500011');
  });

  it('maps a fetch failure to network_error', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));

    const result = await validateTeamsGraphCredentialsImpl(USER, { tenant: TENANT });
    expect(result).toMatchObject({ status: 'failed', reason: 'network_error' });
    expect((result as { message: string }).message).toContain('fetch failed');
  });
});

describe('probeTeamsGraphPermissions (T092)', () => {
  it('reports every required application permission as granted when the roles claim has them all', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse(mintJwt({ roles: ALL_REQUIRED_PERMISSIONS })));

    const result = await probeTeamsGraphPermissionsImpl(USER, { tenant: TENANT });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.permissions.map((entry) => entry.permission).sort()).toEqual(
      [...ALL_REQUIRED_PERMISSIONS].sort()
    );
    expect(result.permissions.every((entry) => entry.granted)).toBe(true);
  });

  it('reports granted/missing per permission and remedies missing Calendars.ReadWrite', async () => {
    fetchMock.mockResolvedValueOnce(
      tokenResponse(
        mintJwt({
          roles: ALL_REQUIRED_PERMISSIONS.filter((permission) => permission !== 'Calendars.ReadWrite'),
        })
      )
    );

    const result = await probeTeamsGraphPermissionsImpl(USER, { tenant: TENANT });
    expect(result.status).toBe('missing_permissions');
    if (result.status !== 'missing_permissions') throw new Error('expected missing_permissions');
    expect(result.missingPermissions).toEqual(['Calendars.ReadWrite']);
    expect(result.permissions).toContainEqual({ permission: 'Calendars.ReadWrite', granted: false });
    expect(result.permissions).toContainEqual({ permission: 'TeamsActivity.Send', granted: true });
    expect(result.message).toBe('Grant admin consent for Calendars.ReadWrite in the Azure app registration.');
  });

  it('treats a token without a roles claim as all permissions missing', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse(mintJwt({ aud: 'https://graph.microsoft.com' })));

    const result = await probeTeamsGraphPermissionsImpl(USER, { tenant: TENANT });
    expect(result.status).toBe('missing_permissions');
    if (result.status !== 'missing_permissions') throw new Error('expected missing_permissions');
    expect(result.missingPermissions.sort()).toEqual([...ALL_REQUIRED_PERMISSIONS].sort());
    expect(result.message).toContain('Grant admin consent for');
    expect(result.message).toContain('Calendars.ReadWrite');
  });

  it('propagates the typed token failure from credential validation', async () => {
    fetchMock.mockResolvedValueOnce(
      aadErrorResponse('AADSTS7000215', 'Invalid client secret provided.')
    );

    const result = await probeTeamsGraphPermissionsImpl(USER, { tenant: TENANT });
    expect(result).toMatchObject({ status: 'failed', reason: 'invalid_client_secret' });
  });

  it('fails with token_failure when the minted token is not decodable as a JWT', async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse('opaque-token-without-segments'));

    const result = await probeTeamsGraphPermissionsImpl(USER, { tenant: TENANT });
    expect(result).toMatchObject({ status: 'failed', reason: 'token_failure' });
  });

  it('short-circuits with addon_inactive when the Teams add-on is unavailable', async () => {
    hoisted.state.availability = {
      enabled: false,
      reason: 'addon_required',
      message: 'Microsoft Teams integration requires the Teams add-on.',
    };

    await expect(probeTeamsGraphPermissionsImpl(USER, { tenant: TENANT })).resolves.toMatchObject({
      status: 'failed',
      reason: 'addon_inactive',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('validateTeamsBotConnector (T093)', () => {
  it('returns not_configured naming all three env vars when credentials are unset', async () => {
    const result = await validateTeamsBotConnectorImpl(USER, { tenant: TENANT });
    expect(result).toMatchObject({ status: 'failed', reason: 'not_configured' });
    const message = (result as { message: string }).message;
    expect(message).toContain('TEAMS_BOT_APP_ID');
    expect(message).toContain('TEAMS_BOT_APP_TENANT_ID');
    expect(message).toContain('TEAMS_BOT_APP_PASSWORD');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('acquires a real Bot Framework token and returns the app id on success', async () => {
    stubBotEnv();
    fetchMock.mockResolvedValueOnce(tokenResponse(mintJwt({ aud: 'https://api.botframework.com' })));

    await expect(validateTeamsBotConnectorImpl(USER, { tenant: TENANT })).resolves.toEqual({
      status: 'ok',
      appId: 'bot-app-1',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://login.microsoftonline.com/bot-tenant-1/oauth2/v2.0/token');
    const body = init.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('client_id')).toBe('bot-app-1');
    expect(body.get('client_secret')).toBe('bot-password-1');
    expect(body.get('scope')).toBe('https://api.botframework.com/.default');
  });

  it('maps a wrong password (AADSTS7000215) to invalid_password naming TEAMS_BOT_APP_PASSWORD', async () => {
    stubBotEnv({ TEAMS_BOT_APP_PASSWORD: 'wrong-password' });
    fetchMock.mockResolvedValueOnce(
      aadErrorResponse('AADSTS7000215', 'Invalid client secret provided.')
    );

    const result = await validateTeamsBotConnectorImpl(USER, { tenant: TENANT });
    expect(result).toMatchObject({ status: 'failed', reason: 'invalid_password' });
    const message = (result as { message: string }).message;
    expect(message).toContain('TEAMS_BOT_APP_PASSWORD');
    expect(message).toContain('AADSTS7000215');
  });

  it('maps an unknown app id (AADSTS700016) to invalid_app_id naming TEAMS_BOT_APP_ID', async () => {
    stubBotEnv();
    fetchMock.mockResolvedValueOnce(
      aadErrorResponse('AADSTS700016', "Application with identifier 'bot-app-1' was not found in the directory.", 400)
    );

    const result = await validateTeamsBotConnectorImpl(USER, { tenant: TENANT });
    expect(result).toMatchObject({ status: 'failed', reason: 'invalid_app_id' });
    expect((result as { message: string }).message).toContain('TEAMS_BOT_APP_ID');
  });

  it('maps an unknown tenant (AADSTS90002) to invalid_tenant_id naming TEAMS_BOT_APP_TENANT_ID', async () => {
    stubBotEnv();
    fetchMock.mockResolvedValueOnce(
      aadErrorResponse('AADSTS90002', "Tenant 'bot-tenant-1' not found.", 400)
    );

    const result = await validateTeamsBotConnectorImpl(USER, { tenant: TENANT });
    expect(result).toMatchObject({ status: 'failed', reason: 'invalid_tenant_id' });
    expect((result as { message: string }).message).toContain('TEAMS_BOT_APP_TENANT_ID');
  });

  it('maps a fetch failure to network_error', async () => {
    stubBotEnv();
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));

    const result = await validateTeamsBotConnectorImpl(USER, { tenant: TENANT });
    expect(result).toMatchObject({ status: 'failed', reason: 'network_error' });
  });

  it('short-circuits with addon_inactive before touching bot credentials', async () => {
    stubBotEnv();
    hoisted.state.availability = {
      enabled: false,
      reason: 'addon_required',
      message: 'Microsoft Teams integration requires the Teams add-on.',
    };

    await expect(validateTeamsBotConnectorImpl(USER, { tenant: TENANT })).resolves.toMatchObject({
      status: 'failed',
      reason: 'addon_inactive',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('denies callers that lack the Teams settings permission', async () => {
    stubBotEnv();
    hoisted.state.hasPermission = false;

    await expect(validateTeamsBotConnectorImpl(USER, { tenant: TENANT })).rejects.toThrow('Forbidden');
  });
});
