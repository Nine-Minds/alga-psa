import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  type MicrosoftProfileRecord = {
    tenant: string;
    profile_id: string;
    client_id: string;
    tenant_id: string;
    client_secret_ref: string;
    is_archived: boolean;
  };

  type TeamsIntegrationRecord = {
    tenant: string;
    selected_profile_id: string | null;
    install_status: 'not_configured' | 'install_pending' | 'active' | 'error';
    enabled_capabilities: string[];
    notification_categories: string[];
    allowed_actions: string[];
    last_error: string | null;
    created_by: string | null;
    updated_by: string | null;
    created_at: string | Date;
    updated_at: string | Date;
  };

  const state = {
    mockUser: { user_id: 'user-1', user_type: 'internal' } as any,
    mockCtx: { tenant: 'tenant-1' } as any,
    tenantSecrets: new Map<string, string>(),
    microsoftProfiles: [] as MicrosoftProfileRecord[],
    teamsIntegrations: [] as TeamsIntegrationRecord[],
  };

  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
  const matchesWhere = (row: Record<string, unknown>, conditions: Record<string, unknown>): boolean =>
    Object.entries(conditions).every(([key, value]) => row[key] === value);

  const createQuery = (table: string) => {
    const filters: Record<string, unknown>[] = [];

    const getRows = () => {
      if (table === 'microsoft_profiles') {
        return state.microsoftProfiles;
      }
      if (table === 'teams_integrations') {
        return state.teamsIntegrations;
      }
      return [] as Array<Record<string, unknown>>;
    };

    const filteredRows = () => getRows().filter((row) => filters.every((filter) => matchesWhere(row, filter)));

    return {
      where(conditions: Record<string, unknown>) {
        filters.push(conditions);
        return this;
      },
      async first() {
        const row = filteredRows()[0];
        return row ? clone(row) : undefined;
      },
      async insert(values: Record<string, unknown> | Array<Record<string, unknown>>) {
        const rows = Array.isArray(values) ? values : [values];
        if (table === 'teams_integrations') {
          rows.forEach((row) => state.teamsIntegrations.push(clone(row) as TeamsIntegrationRecord));
        }
        return rows.length;
      },
      async update(values: Record<string, unknown>) {
        const rows = filteredRows();
        rows.forEach((row) => Object.assign(row, values));
        return rows.length;
      },
      async select(..._args: unknown[]) {
        return filteredRows().map((row) => clone(row));
      },
    };
  };

  const knexMock: any = ((table: string) => createQuery(table)) as any;
  knexMock.fn = {
    now: vi.fn(() => 'now()'),
  };

  return {
    state,
    hasPermissionMock: vi.fn(async (..._args: unknown[]) => true),
    knexMock,
  };
});

const { microsoftProfiles, teamsIntegrations, tenantSecrets } = hoisted.state;
const { hasPermissionMock, knexMock } = hoisted;

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth:
    (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action(hoisted.state.mockUser, hoisted.state.mockCtx, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: hoisted.hasPermissionMock,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: hoisted.knexMock }),
}));

vi.mock('./providerReadiness', () => ({
  getMicrosoftProfileReadiness: vi.fn(async (tenant: string, config: any) => {
    const secret = tenantSecrets.get(`${tenant}:${config.clientSecretRef}`) || null;
    const ready = Boolean(config.clientId && config.tenantId && secret && !config.isArchived);
    return {
      ready,
      clientIdConfigured: Boolean(config.clientId),
      clientSecretConfigured: Boolean(secret),
      tenantIdConfigured: Boolean(config.tenantId),
      active: !config.isArchived,
    };
  }),
}));

import {
  getTeamsIntegrationStatus,
  saveTeamsIntegrationSettings,
} from './teamsActions';

function addMicrosoftProfile({
  tenant,
  profileId,
  clientId,
  tenantId,
  secretRef,
  archived = false,
}: {
  tenant: string;
  profileId: string;
  clientId: string;
  tenantId: string;
  secretRef: string;
  archived?: boolean;
}) {
  microsoftProfiles.push({
    tenant,
    profile_id: profileId,
    client_id: clientId,
    tenant_id: tenantId,
    client_secret_ref: secretRef,
    is_archived: archived,
  });
}

describe('Teams integration actions', () => {
  beforeEach(() => {
    hoisted.state.mockUser = { user_id: 'user-1', user_type: 'internal' };
    hoisted.state.mockCtx = { tenant: 'tenant-1' };
    microsoftProfiles.length = 0;
    teamsIntegrations.length = 0;
    tenantSecrets.clear();
    hasPermissionMock.mockResolvedValue(true);
  });

  it('T083/T084: keeps the Teams integration record tenant-scoped and returns defaults when missing', async () => {
    addMicrosoftProfile({
      tenant: 'tenant-2',
      profileId: 'profile-tenant-2',
      clientId: 'tenant-two-client',
      tenantId: 'tenant-two-guid',
      secretRef: 'tenant-two-secret-ref',
    });
    tenantSecrets.set('tenant-2:tenant-two-secret-ref', 'tenant-two-secret');

    hoisted.state.mockCtx = { tenant: 'tenant-2' };
    await saveTeamsIntegrationSettings({
      selectedProfileId: 'profile-tenant-2',
      installStatus: 'install_pending',
    });

    hoisted.state.mockCtx = { tenant: 'tenant-1' };
    const tenantOneStatus = await getTeamsIntegrationStatus();
    expect(tenantOneStatus).toEqual({
      success: true,
      integration: {
        selectedProfileId: null,
        installStatus: 'not_configured',
        enabledCapabilities: ['personal_tab', 'personal_bot', 'message_extension', 'activity_notifications'],
        notificationCategories: ['assignment', 'customer_reply', 'approval_request', 'escalation', 'sla_risk'],
        allowedActions: ['assign_ticket', 'add_note', 'reply_to_contact', 'log_time', 'approval_response'],
        lastError: null,
      },
    });

    expect(teamsIntegrations.filter((row) => row.tenant === 'tenant-1')).toHaveLength(0);
    expect(teamsIntegrations.filter((row) => row.tenant === 'tenant-2')).toHaveLength(1);
  });

  it('T085/T087/T089/T091/T093: stores selected profile, install status, capabilities, notification categories, and allowed actions', async () => {
    addMicrosoftProfile({
      tenant: 'tenant-1',
      profileId: 'profile-1',
      clientId: 'tenant-one-client',
      tenantId: 'tenant-one-guid',
      secretRef: 'tenant-one-secret-ref',
    });
    tenantSecrets.set('tenant-1:tenant-one-secret-ref', 'tenant-one-secret');

    const saved = await saveTeamsIntegrationSettings({
      selectedProfileId: 'profile-1',
      installStatus: 'active',
      enabledCapabilities: ['personal_tab', 'message_extension'],
      notificationCategories: ['assignment', 'approval_request'],
      allowedActions: ['assign_ticket', 'log_time'],
    });

    expect(saved).toEqual({
      success: true,
      integration: {
        selectedProfileId: 'profile-1',
        installStatus: 'active',
        enabledCapabilities: ['personal_tab', 'message_extension'],
        notificationCategories: ['assignment', 'approval_request'],
        allowedActions: ['assign_ticket', 'log_time'],
        lastError: null,
      },
    });

    const reloaded = await getTeamsIntegrationStatus();
    expect(reloaded).toEqual(saved);
  });

  it('T086/T088/T090/T092/T094: rejects missing, archived, or unready profiles and unsupported install states', async () => {
    const missingProfile = await saveTeamsIntegrationSettings({
      selectedProfileId: 'missing-profile',
      installStatus: 'install_pending',
    });
    expect(missingProfile).toEqual({
      success: false,
      error: 'Selected Microsoft profile was not found',
    });

    addMicrosoftProfile({
      tenant: 'tenant-1',
      profileId: 'archived-profile',
      clientId: 'archived-client',
      tenantId: 'archived-guid',
      secretRef: 'archived-secret-ref',
      archived: true,
    });

    const archivedProfile = await saveTeamsIntegrationSettings({
      selectedProfileId: 'archived-profile',
      installStatus: 'install_pending',
    });
    expect(archivedProfile).toEqual({
      success: false,
      error: 'Archived Microsoft profiles cannot be selected for Teams',
    });

    addMicrosoftProfile({
      tenant: 'tenant-1',
      profileId: 'unready-profile',
      clientId: 'unready-client',
      tenantId: 'unready-guid',
      secretRef: 'unready-secret-ref',
    });

    const unreadyActivation = await saveTeamsIntegrationSettings({
      selectedProfileId: 'unready-profile',
      installStatus: 'active',
    });
    expect(unreadyActivation).toEqual({
      success: false,
      error: 'Selected Microsoft profile is not ready for Teams setup',
    });

    const unsupportedStatus = await saveTeamsIntegrationSettings({
      installStatus: 'unsupported' as any,
    });
    expect(unsupportedStatus).toEqual({
      success: false,
      error: 'Unsupported Teams install status',
    });
  });
});
