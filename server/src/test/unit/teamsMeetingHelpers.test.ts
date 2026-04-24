import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.hoisted(() => vi.fn());
const resolveProviderConfigMock = vi.hoisted(() => vi.fn());
const fetchMicrosoftGraphAppTokenMock = vi.hoisted(() => vi.fn());
const loggerWarnMock = vi.hoisted(() => vi.fn());
const loggerInfoMock = vi.hoisted(() => vi.fn());
const enterpriseState = vi.hoisted(() => ({ value: true }));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
}));

vi.mock('@alga-psa/core/features', () => ({
  get isEnterprise() {
    return enterpriseState.value;
  },
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    warn: loggerWarnMock,
    info: loggerInfoMock,
  },
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/auth/teamsMicrosoftProviderResolution', () => ({
  resolveTeamsMicrosoftProviderConfigImpl: resolveProviderConfigMock,
}));

vi.mock('@alga-psa/ee-microsoft-teams/lib/graphAuth', () => ({
  fetchMicrosoftGraphAppToken: fetchMicrosoftGraphAppTokenMock,
}));

import { createTeamsMeeting } from '@alga-psa/ee-microsoft-teams/lib/meetings/createTeamsMeeting';
import { updateTeamsMeeting } from '@alga-psa/ee-microsoft-teams/lib/meetings/updateTeamsMeeting';
import { deleteTeamsMeeting } from '@alga-psa/ee-microsoft-teams/lib/meetings/deleteTeamsMeeting';
import { getTeamsMeetingCapability } from '@alga-psa/ee-microsoft-teams/lib/actions/meetings/meetingCapabilityActions';
import { resolveTeamsMeetingService } from '@alga-psa/scheduling/lib/teamsMeetingService';

function buildTeamsIntegrationKnex(row: Record<string, unknown> | undefined | null) {
  const first = vi.fn().mockResolvedValue(row ?? undefined);
  const where = vi.fn(() => ({ first }));
  const knex = vi.fn(() => ({ where }));
  return { knex, where, first };
}

describe('Teams meeting helpers', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    enterpriseState.value = true;
    createTenantKnexMock.mockReset();
    resolveProviderConfigMock.mockReset();
    fetchMicrosoftGraphAppTokenMock.mockReset();
    loggerWarnMock.mockReset();
    loggerInfoMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);

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

  describe('createTeamsMeeting', () => {
    it('returns joinWebUrl and meetingId from the Graph response', async () => {
      const db = buildTeamsIntegrationKnex({
        tenant: 'tenant-1',
        install_status: 'active',
        selected_profile_id: 'profile-1',
        default_meeting_organizer_upn: 'organizer@example.com',
      });
      createTenantKnexMock.mockResolvedValue({ knex: db.knex, tenant: 'tenant-1' });
      fetchMock.mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({
          id: 'meeting-123',
          joinWebUrl: 'https://teams.example.com/meeting/123',
        }),
      });

      const result = await createTeamsMeeting({
        tenantId: 'tenant-1',
        subject: 'Virtual consultation',
        startDateTime: '2026-04-24T14:00:00.000Z',
        endDateTime: '2026-04-24T14:30:00.000Z',
        appointmentRequestId: 'request-1',
      });

      expect(result).toEqual({
        joinWebUrl: 'https://teams.example.com/meeting/123',
        meetingId: 'meeting-123',
      });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://graph.microsoft.com/v1.0/users/organizer%40example.com/onlineMeetings',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            subject: 'Virtual consultation',
            startDateTime: '2026-04-24T14:00:00.000Z',
            endDateTime: '2026-04-24T14:30:00.000Z',
          }),
        })
      );
      expect(loggerInfoMock).toHaveBeenCalledWith(
        '[TeamsMeetings] Created Teams meeting',
        expect.objectContaining({
          tenant: 'tenant-1',
          appointment_request_id: 'request-1',
          operation: 'create',
          status: 201,
        })
      );
    });

    it('returns null and logs a warning when Graph responds 403', async () => {
      const db = buildTeamsIntegrationKnex({
        tenant: 'tenant-1',
        install_status: 'active',
        selected_profile_id: 'profile-1',
        default_meeting_organizer_upn: 'organizer@example.com',
      });
      createTenantKnexMock.mockResolvedValue({ knex: db.knex, tenant: 'tenant-1' });
      fetchMock.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: async () => 'Missing OnlineMeetings.ReadWrite.All',
      });

      await expect(createTeamsMeeting({
        tenantId: 'tenant-1',
        subject: 'Virtual consultation',
        startDateTime: '2026-04-24T14:00:00.000Z',
        endDateTime: '2026-04-24T14:30:00.000Z',
      })).resolves.toBeNull();

      expect(loggerWarnMock).toHaveBeenCalledWith(
        '[TeamsMeetings] Failed to create Teams meeting',
        expect.objectContaining({
          operation: 'create',
          status: 403,
        })
      );
    });

    it('returns null and logs a warning when Graph responds 404', async () => {
      const db = buildTeamsIntegrationKnex({
        tenant: 'tenant-1',
        install_status: 'active',
        selected_profile_id: 'profile-1',
        default_meeting_organizer_upn: 'missing-organizer@example.com',
      });
      createTenantKnexMock.mockResolvedValue({ knex: db.knex, tenant: 'tenant-1' });
      fetchMock.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'User not found',
      });

      await expect(createTeamsMeeting({
        tenantId: 'tenant-1',
        subject: 'Virtual consultation',
        startDateTime: '2026-04-24T14:00:00.000Z',
        endDateTime: '2026-04-24T14:30:00.000Z',
      })).resolves.toBeNull();

      expect(loggerWarnMock).toHaveBeenCalledWith(
        '[TeamsMeetings] Failed to create Teams meeting',
        expect.objectContaining({
          operation: 'create',
          status: 404,
        })
      );
    });

    it('returns null and logs a warning when token fetch fails', async () => {
      const db = buildTeamsIntegrationKnex({
        tenant: 'tenant-1',
        install_status: 'active',
        selected_profile_id: 'profile-1',
        default_meeting_organizer_upn: 'organizer@example.com',
      });
      createTenantKnexMock.mockResolvedValue({ knex: db.knex, tenant: 'tenant-1' });
      fetchMicrosoftGraphAppTokenMock.mockRejectedValue(new Error('invalid client secret'));

      await expect(createTeamsMeeting({
        tenantId: 'tenant-1',
        subject: 'Virtual consultation',
        startDateTime: '2026-04-24T14:00:00.000Z',
        endDateTime: '2026-04-24T14:30:00.000Z',
      })).resolves.toBeNull();

      expect(loggerWarnMock).toHaveBeenCalledWith(
        '[TeamsMeetings] Failed to create Teams meeting',
        expect.objectContaining({
          operation: 'create',
          status: null,
          error: 'invalid client secret',
        })
      );
    });

    it('returns null when the Teams integration row is absent', async () => {
      const db = buildTeamsIntegrationKnex(undefined);
      createTenantKnexMock.mockResolvedValue({ knex: db.knex, tenant: 'tenant-1' });

      await expect(createTeamsMeeting({
        tenantId: 'tenant-1',
        subject: 'Virtual consultation',
        startDateTime: '2026-04-24T14:00:00.000Z',
        endDateTime: '2026-04-24T14:30:00.000Z',
      })).resolves.toBeNull();

      expect(fetchMicrosoftGraphAppTokenMock).not.toHaveBeenCalled();
    });

    it('returns null when the organizer UPN is blank', async () => {
      const db = buildTeamsIntegrationKnex({
        tenant: 'tenant-1',
        install_status: 'active',
        selected_profile_id: 'profile-1',
        default_meeting_organizer_upn: '   ',
      });
      createTenantKnexMock.mockResolvedValue({ knex: db.knex, tenant: 'tenant-1' });

      await expect(createTeamsMeeting({
        tenantId: 'tenant-1',
        subject: 'Virtual consultation',
        startDateTime: '2026-04-24T14:00:00.000Z',
        endDateTime: '2026-04-24T14:30:00.000Z',
      })).resolves.toBeNull();

      expect(fetchMicrosoftGraphAppTokenMock).not.toHaveBeenCalled();
    });

    it('uses only the requested tenant credentials when creating a meeting', async () => {
      const integrationsByTenant = new Map([
        ['tenant-a', {
          tenant: 'tenant-a',
          install_status: 'active',
          selected_profile_id: 'profile-a',
          default_meeting_organizer_upn: 'organizer-a@example.com',
        }],
        ['tenant-b', {
          tenant: 'tenant-b',
          install_status: 'active',
          selected_profile_id: 'profile-b',
          default_meeting_organizer_upn: 'organizer-b@example.com',
        }],
      ]);

      createTenantKnexMock.mockImplementation(async (tenantId: string) => {
        const db = buildTeamsIntegrationKnex(integrationsByTenant.get(tenantId));
        return { knex: db.knex, tenant: tenantId };
      });

      resolveProviderConfigMock.mockImplementation(async (tenantId: string) => ({
        status: 'ready',
        clientId: `client-${tenantId}`,
        clientSecret: `secret-${tenantId}`,
        microsoftTenantId: `microsoft-${tenantId}`,
      }));

      fetchMock.mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({
          id: 'meeting-tenant-a',
          joinWebUrl: 'https://teams.example.com/meeting/tenant-a',
        }),
      });

      await createTeamsMeeting({
        tenantId: 'tenant-a',
        subject: 'Tenant A meeting',
        startDateTime: '2026-04-24T14:00:00.000Z',
        endDateTime: '2026-04-24T14:30:00.000Z',
      });

      expect(createTenantKnexMock).toHaveBeenCalledWith('tenant-a');
      expect(resolveProviderConfigMock).toHaveBeenCalledWith('tenant-a');
      expect(fetchMicrosoftGraphAppTokenMock).toHaveBeenCalledWith({
        tenantAuthority: 'microsoft-tenant-a',
        clientId: 'client-tenant-a',
        clientSecret: 'secret-tenant-a',
      });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://graph.microsoft.com/v1.0/users/organizer-a%40example.com/onlineMeetings',
        expect.any(Object)
      );
      expect(fetchMock).not.toHaveBeenCalledWith(
        expect.stringContaining('organizer-b%40example.com'),
        expect.anything()
      );
    });
  });

  describe('updateTeamsMeeting', () => {
    it('PATCHes the meeting with the supplied UTC timestamps and returns true', async () => {
      const db = buildTeamsIntegrationKnex({
        tenant: 'tenant-1',
        install_status: 'active',
        selected_profile_id: 'profile-1',
        default_meeting_organizer_upn: 'organizer@example.com',
      });
      createTenantKnexMock.mockResolvedValue({ knex: db.knex, tenant: 'tenant-1' });
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => '',
      });

      await expect(updateTeamsMeeting({
        tenantId: 'tenant-1',
        meetingId: 'meeting-123',
        startDateTime: '2026-04-24T15:00:00.000Z',
        endDateTime: '2026-04-24T15:30:00.000Z',
      })).resolves.toBe(true);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://graph.microsoft.com/v1.0/users/organizer%40example.com/onlineMeetings/meeting-123',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            startDateTime: '2026-04-24T15:00:00.000Z',
            endDateTime: '2026-04-24T15:30:00.000Z',
          }),
        })
      );
    });

    it('returns false and logs a warning when Graph returns 404', async () => {
      const db = buildTeamsIntegrationKnex({
        tenant: 'tenant-1',
        install_status: 'active',
        selected_profile_id: 'profile-1',
        default_meeting_organizer_upn: 'organizer@example.com',
      });
      createTenantKnexMock.mockResolvedValue({ knex: db.knex, tenant: 'tenant-1' });
      fetchMock.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'Meeting not found',
      });

      await expect(updateTeamsMeeting({
        tenantId: 'tenant-1',
        meetingId: 'meeting-123',
        startDateTime: '2026-04-24T15:00:00.000Z',
        endDateTime: '2026-04-24T15:30:00.000Z',
      })).resolves.toBe(false);

      expect(loggerWarnMock).toHaveBeenCalledWith(
        '[TeamsMeetings] Failed to update Teams meeting',
        expect.objectContaining({
          operation: 'update',
          meeting_id: 'meeting-123',
          status: 404,
        })
      );
    });
  });

  describe('deleteTeamsMeeting', () => {
    it('returns true on 204 and false on errors while logging failures', async () => {
      const db = buildTeamsIntegrationKnex({
        tenant: 'tenant-1',
        install_status: 'active',
        selected_profile_id: 'profile-1',
        default_meeting_organizer_upn: 'organizer@example.com',
      });
      createTenantKnexMock.mockResolvedValue({ knex: db.knex, tenant: 'tenant-1' });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 204,
        text: async () => '',
      });

      await expect(deleteTeamsMeeting({
        tenantId: 'tenant-1',
        meetingId: 'meeting-123',
      })).resolves.toBe(true);

      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Server Error',
        text: async () => 'Boom',
      });

      await expect(deleteTeamsMeeting({
        tenantId: 'tenant-1',
        meetingId: 'meeting-123',
      })).resolves.toBe(false);

      expect(loggerWarnMock).toHaveBeenCalledWith(
        '[TeamsMeetings] Failed to delete Teams meeting',
        expect.objectContaining({
          operation: 'delete',
          meeting_id: 'meeting-123',
          status: 500,
        })
      );
    });

    it('emits structured info logs across create, update, and delete operations for the same appointment lifecycle', async () => {
      const db = buildTeamsIntegrationKnex({
        tenant: 'tenant-1',
        install_status: 'active',
        selected_profile_id: 'profile-1',
        default_meeting_organizer_upn: 'organizer@example.com',
      });
      createTenantKnexMock.mockResolvedValue({ knex: db.knex, tenant: 'tenant-1' });

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({
            id: 'meeting-123',
            joinWebUrl: 'https://teams.example.com/meeting/123',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '',
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 204,
          text: async () => '',
        });

      await createTeamsMeeting({
        tenantId: 'tenant-1',
        subject: 'Virtual consultation',
        startDateTime: '2026-04-24T14:00:00.000Z',
        endDateTime: '2026-04-24T14:30:00.000Z',
        appointmentRequestId: 'request-1',
      });

      await updateTeamsMeeting({
        tenantId: 'tenant-1',
        meetingId: 'meeting-123',
        startDateTime: '2026-04-24T15:00:00.000Z',
        endDateTime: '2026-04-24T15:30:00.000Z',
        appointmentRequestId: 'request-1',
      });

      await deleteTeamsMeeting({
        tenantId: 'tenant-1',
        meetingId: 'meeting-123',
        appointmentRequestId: 'request-1',
      });

      expect(loggerInfoMock).toHaveBeenCalledWith(
        '[TeamsMeetings] Created Teams meeting',
        expect.objectContaining({
          tenant: 'tenant-1',
          appointment_request_id: 'request-1',
          operation: 'create',
          status: 201,
        })
      );
      expect(loggerInfoMock).toHaveBeenCalledWith(
        '[TeamsMeetings] Updated Teams meeting',
        expect.objectContaining({
          tenant: 'tenant-1',
          appointment_request_id: 'request-1',
          operation: 'update',
          status: 200,
        })
      );
      expect(loggerInfoMock).toHaveBeenCalledWith(
        '[TeamsMeetings] Deleted Teams meeting',
        expect.objectContaining({
          tenant: 'tenant-1',
          appointment_request_id: 'request-1',
          operation: 'delete',
          status: 204,
        })
      );
    });
  });

  describe('getTeamsMeetingCapability', () => {
    it('returns not_configured when no teams integration row exists', async () => {
      const db = buildTeamsIntegrationKnex(undefined);
      createTenantKnexMock.mockResolvedValue({ knex: db.knex, tenant: 'tenant-1' });

      await expect(getTeamsMeetingCapability('tenant-1')).resolves.toEqual({
        available: false,
        reason: 'not_configured',
      });
    });

    it('returns not_configured when install_status is not active', async () => {
      const db = buildTeamsIntegrationKnex({
        tenant: 'tenant-1',
        install_status: 'install_pending',
        selected_profile_id: 'profile-1',
        default_meeting_organizer_upn: 'organizer@example.com',
      });
      createTenantKnexMock.mockResolvedValue({ knex: db.knex, tenant: 'tenant-1' });

      await expect(getTeamsMeetingCapability('tenant-1')).resolves.toEqual({
        available: false,
        reason: 'not_configured',
      });
    });

    it('returns no_organizer when the Teams integration is active without an organizer', async () => {
      const db = buildTeamsIntegrationKnex({
        tenant: 'tenant-1',
        install_status: 'active',
        selected_profile_id: 'profile-1',
        default_meeting_organizer_upn: null,
      });
      createTenantKnexMock.mockResolvedValue({ knex: db.knex, tenant: 'tenant-1' });

      await expect(getTeamsMeetingCapability('tenant-1')).resolves.toEqual({
        available: false,
        reason: 'no_organizer',
      });
    });

    it('returns available when the Teams integration is active and an organizer is set', async () => {
      const db = buildTeamsIntegrationKnex({
        tenant: 'tenant-1',
        install_status: 'active',
        selected_profile_id: 'profile-1',
        default_meeting_organizer_upn: 'organizer@example.com',
      });
      createTenantKnexMock.mockResolvedValue({ knex: db.knex, tenant: 'tenant-1' });

      await expect(getTeamsMeetingCapability('tenant-1')).resolves.toEqual({
        available: true,
      });
    });

    it('returns ee_disabled when enterprise features are disabled', async () => {
      enterpriseState.value = false;

      await expect(getTeamsMeetingCapability('tenant-1')).resolves.toEqual({
        available: false,
        reason: 'ee_disabled',
      });
      expect(createTenantKnexMock).not.toHaveBeenCalled();
    });
  });

  describe('resolveTeamsMeetingService', () => {
    it('returns no-op handlers when enterprise features are disabled', async () => {
      enterpriseState.value = false;

      const service = await resolveTeamsMeetingService();

      await expect(service.getTeamsMeetingCapability('tenant-1')).resolves.toEqual({
        available: false,
        reason: 'ee_disabled',
      });
      await expect(service.createTeamsMeeting({
        tenantId: 'tenant-1',
        subject: 'No-op',
        startDateTime: '2026-04-24T14:00:00.000Z',
        endDateTime: '2026-04-24T14:30:00.000Z',
      })).resolves.toBeNull();
      await expect(service.updateTeamsMeeting({
        tenantId: 'tenant-1',
        meetingId: 'meeting-123',
        startDateTime: '2026-04-24T14:00:00.000Z',
        endDateTime: '2026-04-24T14:30:00.000Z',
      })).resolves.toBe(false);
      await expect(service.deleteTeamsMeeting({
        tenantId: 'tenant-1',
        meetingId: 'meeting-123',
      })).resolves.toBe(false);
    });
  });
});
