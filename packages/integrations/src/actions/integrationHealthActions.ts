'use server';

import type { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import type { CalendarProviderConfig, IUserWithRoles } from '@alga-psa/types';
import { CALENDAR_PROFILE_TAB, isCalendarEnterpriseEdition } from '../lib/calendarAvailability';

export type IntegrationHealthIntegration = 'inbound_email' | 'calendar_sync';

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
  | 'calendar_disconnected';

export interface IntegrationHealthAlert {
  /** Stable per provider + failure mode; the banner dismisses by this id. */
  id: string;
  integration: IntegrationHealthIntegration;
  severity: IntegrationHealthSeverity;
  reason: IntegrationHealthReason;
  providerName: string;
  /** Mailbox for email, calendar name for calendar sync. */
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
 * Registry of health sources. Future integrations (NinjaOne reconnect_required,
 * Teams bot credentials, QBO/Xero token expiry) join by adding a source here.
 */
const INTEGRATION_HEALTH_SOURCES: IntegrationHealthSource[] = [
  inboundEmailSource,
  calendarSyncSource,
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
