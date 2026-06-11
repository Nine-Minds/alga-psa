import { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
import { createNotificationFromTemplateInternal } from '@alga-psa/notifications/actions/internal-notification-actions/internalNotificationActions';

/**
 * Targeted notifications for accounting sync events: connection failures,
 * refresh-token expiry countdown, and per-cycle exception summaries.
 * Recipients are the tenant's internal admins (the population that holds
 * billing_settings update).
 *
 * Threshold notices are remembered in tenant_settings.settings.accountingSync
 * (tokenNotices per realm) so each 14/7/2-day threshold fires once.
 */

export const TOKEN_EXPIRY_THRESHOLD_DAYS = [14, 7, 2] as const;

export interface SyncNotificationService {
  notifyConnectionExpired(realm: string, detail: string): Promise<void>;
  notifyTokenExpiring(realm: string, daysLeft: number, thresholdDays: number): Promise<void>;
  notifyNewExceptions(realm: string, count: number): Promise<void>;
}

async function findAdminUserIds(knex: Knex, tenantId: string): Promise<string[]> {
  const rows = await knex('users')
    .join('user_roles', function joinRoles() {
      this.on('user_roles.user_id', '=', 'users.user_id').andOn('user_roles.tenant', '=', 'users.tenant');
    })
    .join('roles', function joinRoleDefs() {
      this.on('roles.role_id', '=', 'user_roles.role_id').andOn('roles.tenant', '=', 'user_roles.tenant');
    })
    .where('users.tenant', tenantId)
    .where('users.user_type', 'internal')
    .whereRaw('LOWER(roles.role_name) = ?', ['admin'])
    .whereNot('users.is_inactive', true)
    .distinct('users.user_id');

  return rows.map((row: { user_id: string }) => row.user_id);
}

export class DefaultSyncNotificationService implements SyncNotificationService {
  constructor(
    private readonly knex: Knex,
    private readonly tenantId: string
  ) {}

  private async broadcast(params: { title: string; message: string; link?: string }): Promise<void> {
    let userIds: string[] = [];
    try {
      userIds = await findAdminUserIds(this.knex, this.tenantId);
    } catch (error) {
      logger.warn('[accountingSync] Failed to enumerate admin recipients for notification', {
        tenantId: this.tenantId,
        error: error instanceof Error ? error.message : error
      });
      return;
    }

    for (const userId of userIds) {
      try {
        // 'system-announcement' renders its message from {{announcementTitle}}.
        await createNotificationFromTemplateInternal(this.knex, {
          tenant: this.tenantId,
          user_id: userId,
          template_name: 'system-announcement',
          data: { announcementTitle: `${params.title} — ${params.message}` },
          link: params.link ?? '/msp/settings?tab=integrations&category=accounting'
        } as any);
      } catch (error) {
        // Notification delivery is best-effort; the exception task is the durable record.
        logger.warn('[accountingSync] Failed to deliver sync notification', {
          tenantId: this.tenantId,
          userId,
          error: error instanceof Error ? error.message : error
        });
      }
    }
  }

  async notifyConnectionExpired(realm: string, detail: string): Promise<void> {
    await this.broadcast({
      title: 'Accounting connection needs attention',
      message: `The QuickBooks connection for company ${realm} failed authentication and sync is paused: ${detail}. Reconnect from Settings → Integrations → Accounting.`
    });
  }

  async notifyTokenExpiring(realm: string, daysLeft: number, thresholdDays: number): Promise<void> {
    await this.broadcast({
      title: `Accounting connection expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
      message: `The QuickBooks connection for company ${realm} will stop working in about ${daysLeft} days unless someone reconnects (threshold: ${thresholdDays}d). Reconnect from Settings → Integrations → Accounting.`
    });
  }

  async notifyNewExceptions(realm: string, count: number): Promise<void> {
    await this.broadcast({
      title: `${count} new accounting sync exception${count === 1 ? '' : 's'}`,
      message: `The latest QuickBooks sync cycle for company ${realm} filed ${count} new exception${count === 1 ? '' : 's'} in the task inbox.`,
      link: '/msp/user-activities'
    });
  }
}

/**
 * Remember which token-expiry threshold has been announced for a realm.
 * Returns the threshold to announce now, or null.
 */
export async function resolveTokenThresholdToAnnounce(
  knex: Knex,
  tenantId: string,
  realm: string,
  refreshTokenExpiresAt: string | null | undefined,
  now: Date
): Promise<number | null> {
  if (!refreshTokenExpiresAt) {
    return null;
  }

  const msLeft = new Date(refreshTokenExpiresAt).getTime() - now.getTime();
  if (!Number.isFinite(msLeft) || msLeft <= 0) {
    return null; // Expired tokens surface through the auth-failure path instead.
  }

  const daysLeft = msLeft / (24 * 60 * 60 * 1000);
  // Pick the NARROWEST crossed band (e.g. 6 days left → the 7-day notice, not
  // the 14-day one) so each escalation step fires as expiry approaches.
  const threshold = [...TOKEN_EXPIRY_THRESHOLD_DAYS]
    .sort((a, b) => a - b)
    .find((days) => daysLeft <= days);
  if (!threshold) {
    return null;
  }

  const row = await knex('tenant_settings').where({ tenant: tenantId }).select('settings').first();
  const settings = row?.settings ?? {};
  const accountingSync = settings.accountingSync ?? {};
  const tokenNotices: Record<string, number> = accountingSync.tokenNotices ?? {};

  if (tokenNotices[realm] !== undefined && tokenNotices[realm] <= threshold) {
    return null; // Already announced this threshold (or a closer one).
  }

  const nextSettings = {
    ...settings,
    accountingSync: {
      ...accountingSync,
      tokenNotices: { ...tokenNotices, [realm]: threshold }
    }
  };

  if (row) {
    await knex('tenant_settings').where({ tenant: tenantId }).update({ settings: nextSettings });
  } else {
    await knex('tenant_settings').insert({ tenant: tenantId, settings: nextSettings });
  }

  return threshold;
}
