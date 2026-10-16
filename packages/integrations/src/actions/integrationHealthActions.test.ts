import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createTenantKnexMock,
  hasPermissionMock,
  isCalendarEnterpriseEditionMock,
  getCalendarProvidersImplMock,
  emailProviderRows,
  sessionUser,
} = vi.hoisted(() => ({
  createTenantKnexMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  isCalendarEnterpriseEditionMock: vi.fn(),
  getCalendarProvidersImplMock: vi.fn(),
  emailProviderRows: { current: [] as any[] },
  sessionUser: {
    user_id: 'user-1',
    user_type: 'internal' as 'internal' | 'client',
    tenant: 'tenant-123',
  },
}));

/**
 * Chainable stub: the action composes where/andWhere/orWhere/whereNotNull and
 * resolves on .select(), so only that terminal call needs to return rows.
 */
function queryBuilderStub() {
  const builder: any = {};
  for (const method of ['where', 'andWhere', 'orWhere', 'whereNotNull']) {
    builder[method] = (arg?: unknown) => {
      if (typeof arg === 'function') (arg as (b: unknown) => void)(builder);
      return builder;
    };
  }
  builder.select = async () => emailProviderRows.current;
  return builder;
}

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
  tenantDb: () => ({ table: () => queryBuilderStub() }),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => async (...args: any[]) =>
    fn({ ...sessionUser }, { tenant: sessionUser.tenant }, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: hasPermissionMock,
}));

vi.mock('../lib/calendarAvailability', () => ({
  CALENDAR_PROFILE_TAB: 'calendar',
  isCalendarEnterpriseEdition: isCalendarEnterpriseEditionMock,
}));

vi.mock('@alga-psa/ee-calendar/actions', () => ({
  getCalendarProvidersImpl: getCalendarProvidersImplMock,
}));

function calendarProvider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cal-1',
    tenant: 'tenant-123',
    user_id: 'user-1',
    name: 'Outlook Calendar',
    provider_type: 'microsoft',
    calendar_id: 'primary',
    active: true,
    sync_direction: 'bidirectional',
    connection_status: 'error',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

async function loadAction() {
  const mod = await import('./integrationHealthActions');
  return mod.getIntegrationHealthAlerts;
}

describe('getIntegrationHealthAlerts', () => {
  beforeEach(() => {
    vi.resetModules();
    createTenantKnexMock.mockReset().mockResolvedValue({ knex: {} });
    hasPermissionMock.mockReset().mockResolvedValue(true);
    isCalendarEnterpriseEditionMock.mockReset().mockReturnValue(false);
    getCalendarProvidersImplMock.mockReset().mockResolvedValue({ success: true, providers: [] });
    emailProviderRows.current = [];
    sessionUser.user_type = 'internal';
  });

  it('reports auth-failure paused and status=error email providers as error alerts', async () => {
    emailProviderRows.current = [
      {
        id: 'provider-1',
        provider_name: 'Support Mailbox',
        mailbox: 'support@contoso.example',
        inbound_paused_at: '2026-10-01T10:00:00Z',
        inbound_pause_reason: 'auth_failure',
        status: 'error',
      },
      {
        id: 'provider-2',
        provider_name: 'Billing Mailbox',
        mailbox: 'billing@contoso.example',
        inbound_paused_at: null,
        inbound_pause_reason: null,
        status: 'error',
      },
    ];

    const getIntegrationHealthAlerts = await loadAction();
    const alerts = await getIntegrationHealthAlerts();

    expect(alerts).toEqual([
      {
        id: 'inbound_email-provider-1-inbound_email_auth_failure',
        integration: 'inbound_email',
        severity: 'error',
        reason: 'inbound_email_auth_failure',
        providerName: 'Support Mailbox',
        detail: 'support@contoso.example',
        href: '/msp/settings/email',
      },
      {
        id: 'inbound_email-provider-2-inbound_email_error',
        integration: 'inbound_email',
        severity: 'error',
        reason: 'inbound_email_error',
        providerName: 'Billing Mailbox',
        detail: 'billing@contoso.example',
        href: '/msp/settings/email',
      },
    ]);
    expect(hasPermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1' }),
      'ticket_settings',
      'read',
      expect.anything()
    );
  });

  it('returns no email alerts for a caller without ticket_settings:read', async () => {
    hasPermissionMock.mockResolvedValue(false);
    emailProviderRows.current = [
      {
        id: 'provider-1',
        provider_name: 'Support Mailbox',
        mailbox: 'support@contoso.example',
        inbound_paused_at: '2026-10-01T10:00:00Z',
        inbound_pause_reason: 'auth_failure',
        status: 'error',
      },
    ];

    const getIntegrationHealthAlerts = await loadAction();

    await expect(getIntegrationHealthAlerts()).resolves.toEqual([]);
  });

  it('yields no calendar alerts on Community Edition', async () => {
    getCalendarProvidersImplMock.mockResolvedValue({
      success: true,
      providers: [calendarProvider()],
    });

    const getIntegrationHealthAlerts = await loadAction();

    await expect(getIntegrationHealthAlerts()).resolves.toEqual([]);
    expect(getCalendarProvidersImplMock).not.toHaveBeenCalled();
  });

  it('reports failing calendar providers on Enterprise Edition, warning when disconnected', async () => {
    isCalendarEnterpriseEditionMock.mockReturnValue(true);
    getCalendarProvidersImplMock.mockResolvedValue({
      success: true,
      providers: [
        calendarProvider(),
        calendarProvider({ id: 'cal-2', name: 'Team Calendar', connection_status: 'disconnected' }),
        calendarProvider({ id: 'cal-3', connection_status: 'connected' }),
        calendarProvider({ id: 'cal-4', connection_status: 'error', active: false }),
      ],
    });

    const getIntegrationHealthAlerts = await loadAction();
    const alerts = await getIntegrationHealthAlerts();

    expect(alerts).toEqual([
      {
        id: 'calendar_sync-cal-1-calendar_error',
        integration: 'calendar_sync',
        severity: 'error',
        reason: 'calendar_error',
        providerName: 'Outlook Calendar',
        detail: 'primary',
        href: '/msp/profile?tab=calendar',
      },
      {
        id: 'calendar_sync-cal-2-calendar_disconnected',
        integration: 'calendar_sync',
        severity: 'warning',
        reason: 'calendar_disconnected',
        providerName: 'Team Calendar',
        detail: 'primary',
        href: '/msp/profile?tab=calendar',
      },
    ]);
    expect(getCalendarProvidersImplMock).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1' }),
      { tenant: 'tenant-123' }
    );
  });

  it('aggregates both integrations and never lets a failing source break the banner', async () => {
    isCalendarEnterpriseEditionMock.mockReturnValue(true);
    emailProviderRows.current = [
      {
        id: 'provider-1',
        provider_name: 'Support Mailbox',
        mailbox: 'support@contoso.example',
        inbound_paused_at: '2026-10-01T10:00:00Z',
        inbound_pause_reason: 'auth_failure',
        status: 'paused',
      },
    ];
    getCalendarProvidersImplMock.mockRejectedValue(new Error('EE calendar unavailable'));

    const getIntegrationHealthAlerts = await loadAction();
    const alerts = await getIntegrationHealthAlerts();

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      integration: 'inbound_email',
      reason: 'inbound_email_auth_failure',
    });
  });
});
