import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAILBOX_SETUP_ENTRY_PATH } from '@alga-psa/types';

const {
  createTenantKnexMock,
  hasPermissionMock,
  isCalendarEnterpriseEditionMock,
  getCalendarProvidersMock,
  getStoredQboCredentialsMapMock,
  getStoredXeroConnectionsMock,
  getTeamsAvailabilityMock,
  emailProviderRows,
  tableRows,
  tableCalls,
  sessionUser,
} = vi.hoisted(() => ({
  createTenantKnexMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  isCalendarEnterpriseEditionMock: vi.fn(),
  getCalendarProvidersMock: vi.fn(),
  getStoredQboCredentialsMapMock: vi.fn(),
  getStoredXeroConnectionsMock: vi.fn(),
  getTeamsAvailabilityMock: vi.fn(),
  emailProviderRows: { current: [] as any[] },
  tableRows: { current: {} as Record<string, any[]> },
  tableCalls: { current: [] as Array<{ table: string; method: string; args: unknown[] }> },
  sessionUser: {
    user_id: 'user-1',
    user_type: 'internal' as 'internal' | 'client',
    tenant: 'tenant-123',
  },
}));

/**
 * Chainable stub: the sources compose where/andWhere/orWhere/whereNotNull/
 * orderBy and resolve on .select() or .first(), so only those terminal calls
 * need to return rows. Rows are per table name because the registry now reads
 * five tables, and the filter calls are recorded so a test can assert the
 * narrowing a dumb stub cannot apply (e.g. is_active).
 */
function rowsForTable(table: string): any[] {
  if (table === 'email_providers') return emailProviderRows.current;
  return tableRows.current[table] ?? [];
}

function queryBuilderStub(table: string) {
  const builder: any = {};
  for (const method of ['where', 'andWhere', 'orWhere', 'whereNotNull', 'orderBy']) {
    builder[method] = (...args: unknown[]) => {
      tableCalls.current.push({ table, method, args });
      if (typeof args[0] === 'function') (args[0] as (b: unknown) => void)(builder);
      return builder;
    };
  }
  builder.select = async () => rowsForTable(table);
  builder.first = async () => rowsForTable(table)[0];
  return builder;
}

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
  tenantDb: () => ({ table: (table: string) => queryBuilderStub(table) }),
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

// Stored OAuth state, not a live vendor call: the banner must never validate
// against QuickBooks or Xero. Mocking the services also keeps their secret
// provider and HTTP clients out of this suite.
vi.mock('../lib/qbo/qboClientService', () => ({
  getStoredQboCredentialsMap: getStoredQboCredentialsMapMock,
}));

vi.mock('../lib/xero/xeroClientService', () => ({
  getStoredXeroConnections: getStoredXeroConnectionsMock,
}));

vi.mock('../lib/teamsAvailability', () => ({
  getTeamsAvailability: getTeamsAvailabilityMock,
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

const RMM_HREF = '/msp/settings/integrations?category=rmm';
const ACCOUNTING_HREF = '/msp/settings/integrations?category=accounting';
const COMMUNICATION_HREF = MAILBOX_SETUP_ENTRY_PATH;

function isoFromNow(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

/** Deny exactly one resource:action pair, allow everything else. */
function denyPermission(resource: string, action: string) {
  hasPermissionMock.mockImplementation(async (_user: unknown, res: string, act: string) =>
    !(res === resource && act === action)
  );
}

describe('getIntegrationHealthAlerts', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    createTenantKnexMock.mockReset().mockResolvedValue({ knex: {} });
    hasPermissionMock.mockReset().mockResolvedValue(true);
    isCalendarEnterpriseEditionMock.mockReset().mockReturnValue(false);
    getCalendarProvidersMock.mockReset().mockResolvedValue([]);
    getStoredQboCredentialsMapMock.mockReset().mockResolvedValue({});
    getStoredXeroConnectionsMock.mockReset().mockResolvedValue({});
    getTeamsAvailabilityMock
      .mockReset()
      .mockResolvedValue({ enabled: false, reason: 'ce_unavailable', message: 'EE only' });
    emailProviderRows.current = [];
    tableRows.current = {};
    tableCalls.current = [];
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

  it('reports RMM sync errors and reconnect-required token lifecycles', async () => {
    tableRows.current.rmm_integrations = [
      {
        integration_id: 'int-1',
        provider: 'ninjaone',
        sync_status: 'error',
        sync_error: 'NinjaOne returned HTTP 500',
        settings: { tokenLifecycle: { status: 'healthy' } },
      },
      // settings arrives as JSON text from some writers; both shapes must parse.
      {
        integration_id: 'int-2',
        provider: 'tacticalrmm',
        sync_status: 'success',
        sync_error: null,
        settings: JSON.stringify({ tokenLifecycle: { status: 'reconnect_required' } }),
      },
      {
        integration_id: 'int-3',
        provider: 'huntress',
        sync_status: 'success',
        sync_error: null,
        settings: null,
      },
    ];

    const getIntegrationHealthAlerts = await loadAction();
    const alerts = await getIntegrationHealthAlerts();

    expect(alerts).toEqual([
      {
        id: 'rmm-int-1-rmm_sync_error',
        integration: 'rmm',
        severity: 'error',
        reason: 'rmm_sync_error',
        providerName: 'NinjaOne',
        detail: 'NinjaOne returned HTTP 500',
        href: RMM_HREF,
      },
      {
        id: 'rmm-int-2-rmm_reconnect_required',
        integration: 'rmm',
        severity: 'error',
        reason: 'rmm_reconnect_required',
        providerName: 'Tactical RMM',
        detail: 'Tactical RMM',
        href: RMM_HREF,
      },
    ]);
  });

  it('asks only for active RMM integrations', async () => {
    const getIntegrationHealthAlerts = await loadAction();
    await getIntegrationHealthAlerts();

    // A deactivated integration is not syncing by choice, so the narrowing has
    // to be in the query — nothing downstream re-checks it.
    expect(tableCalls.current).toContainEqual({
      table: 'rmm_integrations',
      method: 'where',
      args: ['is_active', true],
    });
  });

  it('returns no RMM alerts for a caller without settings:read', async () => {
    denyPermission('settings', 'read');
    tableRows.current.rmm_integrations = [
      {
        integration_id: 'int-1',
        provider: 'ninjaone',
        sync_status: 'error',
        sync_error: 'NinjaOne returned HTTP 500',
        settings: null,
      },
    ];

    const getIntegrationHealthAlerts = await loadAction();

    await expect(getIntegrationHealthAlerts()).resolves.toEqual([]);
  });

  it('yields no accounting alerts on Community Edition', async () => {
    getStoredXeroConnectionsMock.mockResolvedValue({
      'xero-realm': { accessTokenExpiresAt: isoFromNow(-60_000) },
    });

    const getIntegrationHealthAlerts = await loadAction();

    await expect(getIntegrationHealthAlerts()).resolves.toEqual([]);
    expect(getStoredXeroConnectionsMock).not.toHaveBeenCalled();
  });

  it('reports a rejected Xero refresh token as reconnect required', async () => {
    vi.stubEnv('EDITION', 'ee');
    getStoredXeroConnectionsMock.mockResolvedValue({
      'xero-realm': {
        tenantName: 'Contoso Books',
        accessTokenExpiresAt: isoFromNow(-60_000),
        refreshTokenExpiresAt: isoFromNow(60 * 60_000),
      },
    });
    tableRows.current.accounting_sync_cycles = [
      { status: 'failed', error: 'Xero refresh token was rejected' },
    ];

    const getIntegrationHealthAlerts = await loadAction();

    await expect(getIntegrationHealthAlerts()).resolves.toEqual([
      {
        id: 'accounting-xero-xero-realm-accounting_reconnect_required',
        integration: 'accounting',
        severity: 'error',
        reason: 'accounting_reconnect_required',
        providerName: 'Xero',
        detail: 'Contoso Books',
        href: ACCOUNTING_HREF,
      },
    ]);
  });

  it('reports a lapsed QuickBooks refresh token as reconnect required', async () => {
    vi.stubEnv('EDITION', 'ee');
    getStoredQboCredentialsMapMock.mockResolvedValue({
      '4620816': { refreshTokenExpiresAt: isoFromNow(-60_000) },
    });

    const getIntegrationHealthAlerts = await loadAction();

    await expect(getIntegrationHealthAlerts()).resolves.toEqual([
      {
        id: 'accounting-quickbooks_online-4620816-accounting_reconnect_required',
        integration: 'accounting',
        severity: 'error',
        reason: 'accounting_reconnect_required',
        providerName: 'QuickBooks Online',
        detail: '4620816',
        href: ACCOUNTING_HREF,
      },
    ]);
  });

  it('warns when the last accounting cycle failed but the connection is fine', async () => {
    vi.stubEnv('EDITION', 'ee');
    getStoredQboCredentialsMapMock.mockResolvedValue({
      '4620816': { refreshTokenExpiresAt: isoFromNow(30 * 24 * 60 * 60_000) },
    });
    tableRows.current.accounting_sync_cycles = [{ status: 'failed', error: 'Invoice 42 rejected' }];

    const getIntegrationHealthAlerts = await loadAction();

    await expect(getIntegrationHealthAlerts()).resolves.toEqual([
      {
        id: 'accounting-quickbooks_online-4620816-accounting_sync_error',
        integration: 'accounting',
        severity: 'warning',
        reason: 'accounting_sync_error',
        providerName: 'QuickBooks Online',
        detail: '4620816',
        href: ACCOUNTING_HREF,
      },
    ]);
  });

  it('returns no accounting alerts without accounting_integrations:catalog_read', async () => {
    vi.stubEnv('EDITION', 'ee');
    denyPermission('accounting_integrations', 'catalog_read');
    getStoredQboCredentialsMapMock.mockResolvedValue({
      '4620816': { refreshTokenExpiresAt: isoFromNow(-60_000) },
    });

    const getIntegrationHealthAlerts = await loadAction();

    await expect(getIntegrationHealthAlerts()).resolves.toEqual([]);
    expect(getStoredQboCredentialsMapMock).not.toHaveBeenCalled();
  });

  it('warns when an active Teams integration has no bot connector credentials', async () => {
    getTeamsAvailabilityMock.mockResolvedValue({ enabled: true, reason: 'enabled' });
    tableRows.current.teams_integrations = [{ install_status: 'active' }];

    const getIntegrationHealthAlerts = await loadAction();

    await expect(getIntegrationHealthAlerts()).resolves.toEqual([
      {
        id: 'teams_bot-teams_bot_credentials_missing',
        integration: 'teams_bot',
        severity: 'warning',
        reason: 'teams_bot_credentials_missing',
        providerName: 'Microsoft Teams',
        detail: '',
        href: COMMUNICATION_HREF,
      },
    ]);
  });

  it('stays quiet when the Teams bot connector is configured', async () => {
    getTeamsAvailabilityMock.mockResolvedValue({ enabled: true, reason: 'enabled' });
    tableRows.current.teams_integrations = [{ install_status: 'active' }];
    vi.stubEnv('TEAMS_BOT_APP_ID', 'app-id');
    vi.stubEnv('TEAMS_BOT_APP_TENANT_ID', 'tenant-id');
    vi.stubEnv('TEAMS_BOT_APP_PASSWORD', 'secret');

    const getIntegrationHealthAlerts = await loadAction();

    await expect(getIntegrationHealthAlerts()).resolves.toEqual([]);
  });

  it('stays quiet when the Teams integration is not active', async () => {
    getTeamsAvailabilityMock.mockResolvedValue({ enabled: true, reason: 'enabled' });
    tableRows.current.teams_integrations = [{ install_status: 'install_pending' }];

    const getIntegrationHealthAlerts = await loadAction();

    await expect(getIntegrationHealthAlerts()).resolves.toEqual([]);
  });

  it('returns no Teams alert for a caller without system_settings:update', async () => {
    getTeamsAvailabilityMock.mockResolvedValue({ enabled: true, reason: 'enabled' });
    denyPermission('system_settings', 'update');
    tableRows.current.teams_integrations = [{ install_status: 'active' }];

    const getIntegrationHealthAlerts = await loadAction();

    await expect(getIntegrationHealthAlerts()).resolves.toEqual([]);
  });

  it('aggregates every integration and never lets a failing source break the banner', async () => {
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
    tableRows.current.rmm_integrations = [
      {
        integration_id: 'int-1',
        provider: 'ninjaone',
        sync_status: 'error',
        sync_error: 'NinjaOne returned HTTP 500',
        settings: null,
      },
    ];
    getCalendarProvidersMock.mockRejectedValue(new Error('EE calendar unavailable'));
    getTeamsAvailabilityMock.mockRejectedValue(new Error('Teams availability unavailable'));

    const getIntegrationHealthAlerts = await loadAction();
    const alerts = await getIntegrationHealthAlerts();

    expect(alerts.map((alert) => alert.reason)).toEqual([
      'inbound_email_auth_failure',
      'rmm_sync_error',
    ]);
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
