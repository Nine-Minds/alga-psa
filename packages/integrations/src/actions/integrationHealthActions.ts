'use server';

import type { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { MAILBOX_SETUP_ENTRY_PATH } from '@alga-psa/types';
import type { CalendarProviderConfig, IUserWithRoles, RmmProvider } from '@alga-psa/types';
import { CALENDAR_PROFILE_TAB, isCalendarEnterpriseEdition } from '../lib/calendarAvailability';
import { isAccountingReconnectRequired } from '../lib/accountingReconnectHeuristic';
import { getRmmProviderMetadata } from '../lib/rmm/providerRegistry';
import { safeParseSettings } from '../lib/rmm/rmmIntegrationStatus';
import { getStoredQboCredentialsMap } from '../lib/qbo/qboClientService';
import type { QboTenantCredentials } from '../lib/qbo/types';
import { getStoredXeroConnections, type XeroConnectionsStore } from '../lib/xero/xeroClientService';
import { getTeamsAvailability } from '../lib/teamsAvailability';
import { isBotConnectorConfiguredFromEnv } from '../lib/teamsBotConnector';

export type IntegrationHealthIntegration =
  | 'inbound_email'
  | 'calendar_sync'
  | 'rmm'
  | 'accounting'
  | 'teams_bot';

export type IntegrationHealthSeverity = 'error' | 'warning';

/**
 * Why the integration is unhealthy. The banner maps the reason to copy, so a
 * new failure mode means one new reason plus one new translation key — the
 * action never carries user-facing strings.
 */
export type IntegrationHealthReason =
  | 'inbound_email_auth_failure'
  | 'inbound_email_error'
  | 'calendar_error'
  | 'calendar_disconnected'
  | 'rmm_sync_error'
  | 'rmm_reconnect_required'
  | 'accounting_reconnect_required'
  | 'accounting_sync_error'
  | 'teams_bot_credentials_missing';

export interface IntegrationHealthAlert {
  /** Stable per provider + failure mode; the banner dismisses by this id. */
  id: string;
  integration: IntegrationHealthIntegration;
  severity: IntegrationHealthSeverity;
  reason: IntegrationHealthReason;
  providerName: string;
  /**
   * Mailbox for email, calendar id for calendar sync, sync error for RMM,
   * organisation/realm for accounting.
   */
  detail: string;
  href: string;
}

type IntegrationHealthSourceContext = {
  user: IUserWithRoles;
  tenant: string;
  knex: Knex;
};

type IntegrationHealthSource = (
  context: IntegrationHealthSourceContext
) => Promise<IntegrationHealthAlert[]>;

type EeCalendarProviderServiceModule = {
  CalendarProviderService?: new () => {
    getProviders: (filters: {
      tenant: string;
      userId?: string;
      isActive?: boolean;
    }) => Promise<CalendarProviderConfig[]>;
  };
};

const EMAIL_SETTINGS_HREF = '/msp/settings/email';
const CALENDAR_PROFILE_HREF = `/msp/profile?tab=${CALENDAR_PROFILE_TAB}`;
const RMM_SETTINGS_HREF = '/msp/settings/integrations?category=rmm';
const ACCOUNTING_SETTINGS_HREF = '/msp/settings/integrations?category=accounting';
// Teams bot config lives in the Communication category alongside the mailbox
// provider list, so it resolves through the same product-neutral dispatcher
// target rather than linking straight at the PSA-only integrations page (see
// PRODUCT_NAV_DESTINATIONS / productSurfaceRegistry).
const COMMUNICATION_SETTINGS_HREF = MAILBOX_SETUP_ENTRY_PATH;

/** Sync adapter types as stored in accounting_sync_cycles.adapter_type. */
const ACCOUNTING_PROVIDER_NAMES: Record<string, string> = {
  xero: 'Xero',
  quickbooks_online: 'QuickBooks Online',
};

function isAccountingEnterpriseEdition(): boolean {
  return (
    (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
    (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise'
  );
}

/**
 * Tenant-wide inbound email health. Mirrors the pause/error semantics the
 * provider card already renders: an auth-failure pause stops inbound mail, and
 * a provider left in `error` is broken even while it is nominally running.
 */
const inboundEmailSource: IntegrationHealthSource = async ({ user, tenant, knex }) => {
  const permitted = await hasPermission(user, 'ticket_settings', 'read', knex);
  if (!permitted) {
    return [];
  }

  const rows = await tenantDb(knex, tenant)
    .table('email_providers')
    .where('is_active', true)
    .andWhere((builder: Knex.QueryBuilder) => {
      builder
        .where((paused: Knex.QueryBuilder) => {
          paused.whereNotNull('inbound_paused_at').andWhere('inbound_pause_reason', 'auth_failure');
        })
        .orWhere('status', 'error');
    })
    .select(
      'id',
      'provider_name',
      'mailbox',
      'inbound_paused_at',
      'inbound_pause_reason',
      'status'
    );

  return (rows ?? []).map((row): IntegrationHealthAlert => {
    const authFailurePaused =
      Boolean(row.inbound_paused_at) && row.inbound_pause_reason === 'auth_failure';
    const reason: IntegrationHealthReason = authFailurePaused
      ? 'inbound_email_auth_failure'
      : 'inbound_email_error';

    return {
      id: `inbound_email-${row.id}-${reason}`,
      integration: 'inbound_email',
      severity: 'error',
      reason,
      providerName: row.provider_name ?? row.mailbox ?? '',
      detail: row.mailbox ?? row.provider_name ?? '',
      href: EMAIL_SETTINGS_HREF,
    };
  });
};

/**
 * Per-user calendar sync health. Calendar sync is Enterprise-only, so Community
 * Edition never loads the implementation and never reports calendar alerts.
 */
const calendarSyncSource: IntegrationHealthSource = async ({ user, tenant }) => {
  if (!isCalendarEnterpriseEdition()) {
    return [];
  }

  // The EE `/actions` entry point is a 'use server' module that exports only
  // the session-wrapped actions — never the `*Impl` helpers — so reaching for
  // those silently yielded no calendar alerts at all. Use the provider service
  // the EE callback routes import, which takes the tenant/user explicitly.
  const ee = (await import(
    '@alga-psa/ee-calendar/lib/services/calendar/CalendarProviderService'
  )) as EeCalendarProviderServiceModule;
  if (!ee.CalendarProviderService) {
    return [];
  }

  // A deactivated provider is not syncing by choice; only live ones are news.
  const providers = await new ee.CalendarProviderService().getProviders({
    tenant,
    userId: user.user_id,
    isActive: true,
  });

  return (providers ?? [])
    .filter((provider) =>
      provider.connection_status === 'error' || provider.connection_status === 'disconnected'
    )
    .map((provider): IntegrationHealthAlert => {
      const reason: IntegrationHealthReason =
        provider.connection_status === 'error' ? 'calendar_error' : 'calendar_disconnected';

      return {
        id: `calendar_sync-${provider.id}-${reason}`,
        integration: 'calendar_sync',
        severity: reason === 'calendar_error' ? 'error' : 'warning',
        reason,
        providerName: provider.name ?? provider.provider_type ?? '',
        detail: provider.calendar_id ?? '',
        href: CALENDAR_PROFILE_HREF,
      };
    });
};

/**
 * Tenant-wide RMM health. Two failure modes: the provider sync itself errored,
 * and the proactive token-refresh job gave up on the OAuth refresh — the
 * credentials are still stored, so only a human re-auth clears that one.
 */
const rmmSource: IntegrationHealthSource = async ({ user, tenant, knex }) => {
  // Same gate as getNinjaOneConnectionStatus, which is what the RMM settings
  // cards this banner links to read their state through.
  const permitted = await hasPermission(user, 'settings', 'read', knex);
  if (!permitted) {
    return [];
  }

  // A deactivated integration is not syncing by choice; only live ones are news.
  const rows = await tenantDb(knex, tenant)
    .table('rmm_integrations')
    .where('is_active', true)
    .select('integration_id', 'provider', 'sync_status', 'sync_error', 'settings');

  const alerts: IntegrationHealthAlert[] = [];

  for (const row of rows ?? []) {
    const providerName = getRmmProviderMetadata(row.provider as RmmProvider)?.title ?? row.provider ?? '';
    const settings = (typeof row.settings === 'string' ? safeParseSettings(row.settings) : row.settings) ?? {};
    const lifecycle = (settings as Record<string, unknown>).tokenLifecycle as
      | { status?: unknown }
      | null
      | undefined;

    const push = (reason: IntegrationHealthReason, detail: string) => {
      alerts.push({
        id: `rmm-${row.integration_id}-${reason}`,
        integration: 'rmm',
        severity: 'error',
        reason,
        providerName,
        detail,
        href: RMM_SETTINGS_HREF,
      });
    };

    if (row.sync_status === 'error') {
      push('rmm_sync_error', row.sync_error ?? providerName);
    }

    // Deliberately the same condition as isIntegrationReconnectRequired in the
    // RMM job handlers, so the banner fires exactly when sync is being skipped.
    if (lifecycle?.status === 'reconnect_required') {
      push('rmm_reconnect_required', providerName);
    }
  }

  return alerts;
};

/** Latest sync cycle for one adapter + realm; the shape the heuristic needs. */
async function readLatestAccountingCycle(
  knex: Knex,
  tenant: string,
  adapterType: string,
  realm: string
): Promise<{ status?: string | null; error?: string | null } | undefined> {
  // Read directly rather than through packages/billing's SyncCycleRepository:
  // billing depends on this package, so importing it back would be a cycle.
  return tenantDb(knex, tenant)
    .table('accounting_sync_cycles')
    .where({ adapter_type: adapterType, target_realm: realm })
    .orderBy('started_at', 'desc')
    .first('status', 'error');
}

type AccountingConnectionSnapshot = {
  adapterType: 'xero' | 'quickbooks_online';
  realm: string;
  organisationName: string | null;
  accessTokenExpiresAt: string | null;
  refreshTokenExpiresAt: string | null;
};

/**
 * Accounting sync health, straight from the stored OAuth connections plus the
 * last sync cycle per connection. Enterprise-only, like accounting sync itself.
 *
 * Reads state rather than validating live against QuickBooks/Xero: the banner
 * loads on every shell render, so it must never call a vendor API.
 */
const accountingSource: IntegrationHealthSource = async ({ user, tenant, knex }) => {
  if (!isAccountingEnterpriseEdition()) {
    return [];
  }

  const permitted = await hasPermission(user, 'accounting_integrations', 'catalog_read', knex);
  if (!permitted) {
    return [];
  }

  const [qboCredentials, xeroConnections] = await Promise.all([
    getStoredQboCredentialsMap(tenant).catch(() => ({}) as Record<string, QboTenantCredentials>),
    getStoredXeroConnections(tenant).catch(() => ({}) as XeroConnectionsStore),
  ]);

  const connections: AccountingConnectionSnapshot[] = [
    ...Object.entries(xeroConnections ?? {}).map(([realm, connection]): AccountingConnectionSnapshot => ({
      adapterType: 'xero',
      realm,
      organisationName: connection?.tenantName ?? null,
      accessTokenExpiresAt: connection?.accessTokenExpiresAt ?? null,
      refreshTokenExpiresAt: connection?.refreshTokenExpiresAt ?? null,
    })),
    ...Object.entries(qboCredentials ?? {}).map(([realm, credentials]): AccountingConnectionSnapshot => ({
      adapterType: 'quickbooks_online',
      realm,
      organisationName: null,
      accessTokenExpiresAt: credentials?.accessTokenExpiresAt ?? null,
      refreshTokenExpiresAt: credentials?.refreshTokenExpiresAt ?? null,
    })),
  ];

  if (connections.length === 0) {
    return [];
  }

  const cycles = await Promise.all(
    connections.map((connection) =>
      readLatestAccountingCycle(knex, tenant, connection.adapterType, connection.realm)
    )
  );

  const now = Date.now();

  return connections.flatMap((connection, index): IntegrationHealthAlert[] => {
    const lastCycle = cycles[index];
    const providerName = ACCOUNTING_PROVIDER_NAMES[connection.adapterType] ?? connection.adapterType;
    const detail = connection.organisationName ?? connection.realm;
    const refreshTokenExpiresAt = connection.refreshTokenExpiresAt
      ? Date.parse(connection.refreshTokenExpiresAt)
      : Number.NaN;
    // A refresh token that has already lapsed cannot be renewed silently; the
    // next sync will fail no matter how healthy the last cycle looked.
    const refreshTokenExpired = Number.isFinite(refreshTokenExpiresAt) && refreshTokenExpiresAt <= now;

    const alert = (reason: IntegrationHealthReason, severity: IntegrationHealthSeverity) => ({
      id: `accounting-${connection.adapterType}-${connection.realm}-${reason}`,
      integration: 'accounting' as const,
      severity,
      reason,
      providerName,
      detail,
      href: ACCOUNTING_SETTINGS_HREF,
    });

    if (
      refreshTokenExpired ||
      isAccountingReconnectRequired({
        adapterType: connection.adapterType,
        accessTokenExpiresAt: connection.accessTokenExpiresAt,
        lastCycleError: lastCycle?.error ?? null,
        nowMs: now,
      })
    ) {
      // A connection needing re-auth also has a failed cycle; one alert is enough.
      return [alert('accounting_reconnect_required', 'error')];
    }

    if (lastCycle?.status === 'failed' || lastCycle?.status === 'aborted') {
      return [alert('accounting_sync_error', 'warning')];
    }

    return [];
  });
};

/**
 * Teams bot reachability. The Teams settings page already warns in-page when an
 * active integration has no bot connector credentials on the server; this
 * raises the same condition to the shell, because the bot silently failing to
 * reply is not something an admin visits that page to discover.
 */
const teamsBotSource: IntegrationHealthSource = async ({ user, tenant, knex }) => {
  const availability = await getTeamsAvailability({ tenantId: tenant, userId: user.user_id });
  if (availability.enabled === false) {
    return [];
  }

  // Only the admins who can act on it — the same gate the Teams settings
  // actions use — should be told the server config is incomplete.
  const permitted = await hasPermission(user, 'system_settings', 'update', knex);
  if (!permitted) {
    return [];
  }

  if (isBotConnectorConfiguredFromEnv()) {
    return [];
  }

  const row = await tenantDb(knex, tenant)
    .table('teams_integrations')
    .first('install_status');
  if (row?.install_status !== 'active') {
    return [];
  }

  return [
    {
      id: 'teams_bot-teams_bot_credentials_missing',
      integration: 'teams_bot',
      severity: 'warning',
      reason: 'teams_bot_credentials_missing',
      providerName: 'Microsoft Teams',
      detail: '',
      href: COMMUNICATION_SETTINGS_HREF,
    },
  ];
};

/**
 * Registry of health sources. Future integrations join by adding a source here.
 *
 * Hudu is deliberately absent: its EE-only storage table is readable only
 * through ee/server, which has no importable package alias, so it needs an
 * EE package seam first.
 */
const INTEGRATION_HEALTH_SOURCES: IntegrationHealthSource[] = [
  inboundEmailSource,
  calendarSyncSource,
  rmmSource,
  accountingSource,
  teamsBotSource,
];

/**
 * Aggregate failing-integration alerts for the shell banner. A source that
 * throws contributes nothing rather than taking the whole shell down with it.
 */
export const getIntegrationHealthAlerts = withAuth(async (
  user,
  { tenant }
): Promise<IntegrationHealthAlert[]> => {
  const { knex } = await createTenantKnex();

  const results = await Promise.all(
    INTEGRATION_HEALTH_SOURCES.map(async (source) => {
      try {
        return await source({ user, tenant, knex });
      } catch (error) {
        logger.warn('[IntegrationHealth] Failed to collect integration health alerts', {
          tenant,
          error: error instanceof Error ? error.message : String(error),
        });
        return [];
      }
    })
  );

  return results.flat();
});
