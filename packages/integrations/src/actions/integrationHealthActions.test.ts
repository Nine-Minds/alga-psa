import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createTenantKnexMock,
  hasPermissionMock,
  isCalendarEnterpriseEditionMock,
  getCalendarProvidersMock,
  emailProviderRows,
  sessionUser,
} = vi.hoisted(() => ({
  createTenantKnexMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  isCalendarEnterpriseEditionMock: vi.fn(),
  getCalendarProvidersMock: vi.fn(),
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

// The EE 'use server' actions entry point exports only session-wrapped
// actions, so the health source reaches calendar state through the provider
// service — mock the same module it imports.
vi.mock('@alga-psa/ee-calendar/lib/services/calendar/CalendarProviderService', () => ({
  CalendarProviderService: class {
    getProviders = getCalendarProvidersMock;
  },
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
    getCalendarProvidersMock.mockReset().mockResolvedValue([]);
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
    getCalendarProvidersMock.mockResolvedValue([calendarProvider()]);

    const getIntegrationHealthAlerts = await loadAction();

    await expect(getIntegrationHealthAlerts()).resolves.toEqual([]);
    expect(getCalendarProvidersMock).not.toHaveBeenCalled();
  });

  it('reports failing calendar providers on Enterprise Edition, warning when disconnected', async () => {
    isCalendarEnterpriseEditionMock.mockReturnValue(true);
    getCalendarProvidersMock.mockResolvedValue([
      calendarProvider(),
      calendarProvider({ id: 'cal-2', name: 'Team Calendar', connection_status: 'disconnected' }),
      calendarProvider({ id: 'cal-3', connection_status: 'connected' }),
    ]);

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
    // Per-user, active-only: a colleague's calendar or a provider the user
    // switched off is not this user's problem to see in the shell.
    expect(getCalendarProvidersMock).toHaveBeenCalledWith({
      tenant: 'tenant-123',
      userId: 'user-1',
      isActive: true,
    });
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
    getCalendarProvidersMock.mockRejectedValue(new Error('EE calendar unavailable'));

    const getIntegrationHealthAlerts = await loadAction();
    const alerts = await getIntegrationHealthAlerts();

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      integration: 'inbound_email',
      reason: 'inbound_email_auth_failure',
    });
  });

  /**
   * The first cut of this source read `getCalendarProvidersImpl` off
   * `@alga-psa/ee-calendar/actions`, which exports only session-wrapped
   * actions — the lookup quietly returned undefined and calendar failures were
   * never surfaced while every mocked test still passed. Assert against the
   * real EE module so a renamed export or moved path fails here instead.
   */
  it('imports an EE calendar surface that really exposes per-user providers', async () => {
    const eeModule = await vi.importActual<
      typeof import('@alga-psa/ee-calendar/lib/services/calendar/CalendarProviderService')
    >('@alga-psa/ee-calendar/lib/services/calendar/CalendarProviderService');

    expect(typeof eeModule.CalendarProviderService).toBe('function');
    expect(typeof eeModule.CalendarProviderService.prototype.getProviders).toBe('function');
  });
});
