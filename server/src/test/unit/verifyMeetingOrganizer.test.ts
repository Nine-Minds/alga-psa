import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.hoisted(() => vi.fn());
const resolveProviderConfigMock = vi.hoisted(() => vi.fn());
const fetchMicrosoftGraphAppTokenMock = vi.hoisted(() => vi.fn());
const loggerWarnMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    warn: loggerWarnMock,
  },
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/auth/teamsMicrosoftProviderResolution', () => ({
  resolveTeamsMicrosoftProviderConfigImpl: resolveProviderConfigMock,
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/graphAuth', () => ({
  fetchMicrosoftGraphAppToken: fetchMicrosoftGraphAppTokenMock,
}));

import { verifyMeetingOrganizer } from '@alga-psa/ee-microsoft-teams/lib/meetings/verifyMeetingOrganizer';

function buildTeamsIntegrationKnex(row: Record<string, unknown> | undefined | null) {
  const first = vi.fn().mockResolvedValue(row ?? undefined);
  const where = vi.fn(() => ({ first }));
  const knex = vi.fn(() => ({ where }));
  return { knex };
}

describe('verifyMeetingOrganizer', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    createTenantKnexMock.mockReset();
    resolveProviderConfigMock.mockReset();
    fetchMicrosoftGraphAppTokenMock.mockReset();
    loggerWarnMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);

    createTenantKnexMock.mockResolvedValue({
      knex: buildTeamsIntegrationKnex({
        tenant: 'tenant-1',
        install_status: 'active',
        selected_profile_id: 'profile-1',
        default_meeting_organizer_upn: null,
      }).knex,
      tenant: 'tenant-1',
    });
    resolveProviderConfigMock.mockResolvedValue({
      status: 'ready',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      microsoftTenantId: 'microsoft-tenant-id',
    });
    fetchMicrosoftGraphAppTokenMock.mockResolvedValue('graph-token');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns valid:true with displayName for an existing Microsoft user', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ displayName: 'Alex Organizer' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ id: 'verification-meeting-1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 204,
        text: async () => '',
      });

    await expect(verifyMeetingOrganizer({
      tenantId: 'tenant-1',
      organizerUpn: 'alex.organizer@example.com',
    })).resolves.toEqual({
      valid: true,
      displayName: 'Alex Organizer',
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://graph.microsoft.com/v1.0/users/alex.organizer%40example.com',
      expect.any(Object)
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://graph.microsoft.com/v1.0/users/alex.organizer%40example.com/onlineMeetings',
      expect.objectContaining({ method: 'POST' })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://graph.microsoft.com/v1.0/users/alex.organizer%40example.com/onlineMeetings/verification-meeting-1',
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('returns valid:false with reason user_not_found when Graph returns 404 for the organizer user', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => 'User not found',
    });

    await expect(verifyMeetingOrganizer({
      tenantId: 'tenant-1',
      organizerUpn: 'missing@example.com',
    })).resolves.toEqual({
      valid: false,
      reason: 'user_not_found',
    });
  });

  it('returns valid:false with reason policy_missing when the dry-run meeting create is blocked', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ displayName: 'Alex Organizer' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: async () => 'Application access policy does not allow this app to create meetings for the user.',
      });

    await expect(verifyMeetingOrganizer({
      tenantId: 'tenant-1',
      organizerUpn: 'alex.organizer@example.com',
    })).resolves.toEqual({
      valid: false,
      displayName: 'Alex Organizer',
      reason: 'policy_missing',
    });

    expect(loggerWarnMock).toHaveBeenCalledWith(
      '[TeamsMeetings] Failed to verify meeting organizer policy access',
      expect.objectContaining({
        tenant: 'tenant-1',
        operation: 'verify',
        status: 403,
      })
    );
  });
});
