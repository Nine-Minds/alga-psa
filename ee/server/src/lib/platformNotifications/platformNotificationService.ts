/**
 * Platform Notification Service for cross-tenant announcements/alerts.
 *
 * Uses a materialized recipient model:
 * - platform_notifications: the content (reference table)
 * - platform_notification_recipients: frozen snapshot of who should see it,
 *   plus per-user read/dismiss state
 *
 * Recipients are resolved and materialized at create/update time.
 * No runtime audience matching — the recipient table IS the source of truth.
 */

import { getAdminConnection } from '@alga-psa/db/admin';

// ── Types ──

export interface TargetAudienceFilters {
  roles?: string[];
  tenant_ids?: string[];
  user_types?: string[];
  email_search?: string;
  subscription_statuses?: string[];
  product_names?: string[];
}

export interface TargetAudience {
  filters: TargetAudienceFilters;
  excluded_user_ids?: string[];
  resolved_user_count?: number;
}

export interface PlatformNotification {
  notification_id: string;
  title: string;
  banner_content: string;
  detail_content: string;
  target_audience: TargetAudience;
  variant: 'info' | 'warning' | 'destructive' | 'success' | 'default';
  starts_at: Date;
  expires_at: Date | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  is_active: boolean;
}

export interface RecipientInput {
  user_id: string;
  tenant: string;
  excluded?: boolean;
}

export interface CreateNotificationInput {
  title: string;
  banner_content: string;
  detail_content: string;
  target_audience?: TargetAudience;
  variant?: string;
  starts_at?: string;
  expires_at?: string;
  recipients?: RecipientInput[];
}

export interface UpdateNotificationInput {
  title?: string;
  banner_content?: string;
  detail_content?: string;
  target_audience?: TargetAudience;
  variant?: string;
  starts_at?: string;
  expires_at?: string;
  is_active?: boolean;
  recipients?: RecipientInput[];
}

export interface NotificationStats {
  notification_id: string;
  total_recipients: number;
  total_dismissed: number;
  total_detail_viewed: number;
  reads_by_tenant: Array<{
    tenant: string;
    tenant_name: string | null;
    total: number;
    dismissed: number;
    detail_viewed: number;
  }>;
}

export interface NotificationRecipientRead {
  user_id: string;
  tenant: string;
  tenant_name: string | null;
  email: string;
  first_name: string | null;
  last_name: string | null;
  matched_at: string | null;
  dismissed_at: string | null;
  detail_viewed_at: string | null;
}

export interface ResolvedRecipient {
  user_id: string;
  tenant: string;
  tenant_name: string | null;
  email: string;
  first_name: string | null;
  last_name: string | null;
  roles: string[];
  user_type: string;
  subscription_status: string | null;
  product_name: string | null;
}

// ── Service ──

export class PlatformNotificationService {
  private masterTenantId: string;

  constructor(masterTenantId: string) {
    this.masterTenantId = masterTenantId;
  }

  // ── Admin CRUD ──

  async listNotifications(options?: { activeOnly?: boolean }): Promise<PlatformNotification[]> {
    const knex = await getAdminConnection();

    let query = knex('platform_notifications')
      .select('*');

    if (options?.activeOnly !== false) {
      query = query.where('is_active', true);
    }

    const rows = await query.orderBy('created_at', 'desc');
    return rows.map(this.parseRow);
  }

  async getNotification(notificationId: string): Promise<PlatformNotification | null> {
    const knex = await getAdminConnection();

    const row = await knex('platform_notifications')
      .where({ notification_id: notificationId })
      .first();

    return row ? this.parseRow(row) : null;
  }

  async createNotification(input: CreateNotificationInput, createdBy?: string): Promise<PlatformNotification> {
    const knex = await getAdminConnection();

    const notification = await knex.transaction(async (trx) => {
      const [row] = await trx('platform_notifications')
        .insert({
          title: input.title,
          banner_content: input.banner_content,
          detail_content: input.detail_content,
          target_audience: JSON.stringify(input.target_audience ?? { filters: {} }),
          variant: input.variant || 'info',
          starts_at: input.starts_at ? new Date(input.starts_at) : new Date(),
          expires_at: input.expires_at ? new Date(input.expires_at) : null,
          created_by: createdBy || null,
        })
        .returning('*');

      if (input.recipients && input.recipients.length > 0) {
        await this.materializeRecipientsInTrx(trx, row.notification_id, input.recipients);
      }

      return this.parseRow(row);
    });

    return notification;
  }

  async updateNotification(notificationId: string, input: UpdateNotificationInput): Promise<PlatformNotification | null> {
    const knex = await getAdminConnection();

    const result = await knex.transaction(async (trx) => {
      const updateData: Record<string, unknown> = { updated_at: new Date() };

      if (input.title !== undefined) updateData.title = input.title;
      if (input.banner_content !== undefined) updateData.banner_content = input.banner_content;
      if (input.detail_content !== undefined) updateData.detail_content = input.detail_content;
      if (input.target_audience !== undefined) updateData.target_audience = JSON.stringify(input.target_audience);
      if (input.variant !== undefined) updateData.variant = input.variant;
      if (input.starts_at !== undefined) updateData.starts_at = new Date(input.starts_at);
      if (input.expires_at !== undefined) updateData.expires_at = input.expires_at ? new Date(input.expires_at) : null;
      if (input.is_active !== undefined) updateData.is_active = input.is_active;

      const [row] = await trx('platform_notifications')
        .where({ notification_id: notificationId })
        .update(updateData)
        .returning('*');

      if (!row) return null;

      if (input.recipients !== undefined) {
        await this.materializeRecipientsInTrx(trx, notificationId, input.recipients || []);
      }

      return this.parseRow(row);
    });

    return result;
  }

  async deleteNotification(notificationId: string): Promise<boolean> {
    const knex = await getAdminConnection();

    const count = await knex('platform_notifications')
      .where({ notification_id: notificationId })
      .update({ is_active: false, updated_at: new Date() });

    return count > 0;
  }

  // ── Recipient materialization (runs inside a transaction) ──

  async materializeRecipients(
    notificationId: string,
    recipients: Array<{ user_id: string; tenant: string; excluded?: boolean }>
  ): Promise<void> {
    const knex = await getAdminConnection();
    await knex.transaction(async (trx) => {
      await this.materializeRecipientsInTrx(trx, notificationId, recipients);
    });
  }

  private async materializeRecipientsInTrx(
    trx: import('knex').Knex.Transaction,
    notificationId: string,
    recipients: Array<{ user_id: string; tenant: string; excluded?: boolean }>
  ): Promise<void> {
    // Get existing recipients to preserve their read state and matched_at
    const existing = await trx('platform_notification_recipients')
      .where({ notification_id: notificationId })
      .select('tenant', 'user_id', 'matched_at', 'excluded_at', 'dismissed_at', 'detail_viewed_at');

    const existingMap = new Map(
      existing.map((r: Record<string, unknown>) => [`${r.tenant}:${r.user_id}`, r])
    );

    // Delete all current recipients
    await trx('platform_notification_recipients')
      .where({ notification_id: notificationId })
      .delete();

    if (recipients.length === 0) return;

    const now = new Date();

    // Insert new recipients, preserving read state for those who were already there
    const rows = recipients.map((r) => {
      const prev = existingMap.get(`${r.tenant}:${r.user_id}`) as Record<string, unknown> | undefined;
      return {
        tenant: r.tenant,
        notification_id: notificationId,
        user_id: r.user_id,
        matched_at: prev ? (prev.matched_at as Date) : now,
        excluded_at: r.excluded ? now : null,
        dismissed_at: prev ? (prev.dismissed_at as Date | null) : null,
        detail_viewed_at: prev ? (prev.detail_viewed_at as Date | null) : null,
      };
    });

    // Batch insert
    const batchSize = 500;
    for (let i = 0; i < rows.length; i += batchSize) {
      await trx('platform_notification_recipients').insert(rows.slice(i, i + batchSize));
    }
  }

  // ── User-facing ──

  async getActiveNotificationsForUser(
    tenantId: string,
    userId: string,
    _userRoles: string[],
    _userType: string
  ): Promise<PlatformNotification[]> {
    const knex = await getAdminConnection();

    // Join recipients with notifications — only return notifications
    // where this user is a materialized recipient and hasn't dismissed
    const query = knex('platform_notification_recipients as r')
      .join('platform_notifications as n', 'r.notification_id', 'n.notification_id')
      .where('r.tenant', tenantId)
      .where('r.user_id', userId)
      .whereNull('r.excluded_at')
      .whereNull('r.dismissed_at')
      .where('n.is_active', true)
      .where('n.starts_at', '<=', knex.fn.now())
      .andWhere(function () {
        this.whereNull('n.expires_at').orWhere('n.expires_at', '>', knex.fn.now());
      })
      .select('n.*');

    const rows = await query;
    const notifications = rows.map(this.parseRow);

    // Sort by variant, then by starts_at desc
    const variantOrder: Record<string, number> = { destructive: 0, warning: 1, info: 2, success: 3, default: 4 };
    return notifications.sort((a, b) => {
      const pDiff = (variantOrder[a.variant] ?? 2) - (variantOrder[b.variant] ?? 2);
      if (pDiff !== 0) return pDiff;
      return new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime();
    });
  }

  async dismissNotification(tenantId: string, notificationId: string, userId: string): Promise<void> {
    const knex = await getAdminConnection();

    await knex('platform_notification_recipients')
      .where({ tenant: tenantId, notification_id: notificationId, user_id: userId })
      .whereNull('dismissed_at')
      .update({ dismissed_at: new Date() });
  }

  async recordDetailView(tenantId: string, notificationId: string, userId: string): Promise<void> {
    const knex = await getAdminConnection();

    await knex('platform_notification_recipients')
      .where({ tenant: tenantId, notification_id: notificationId, user_id: userId })
      .whereNull('detail_viewed_at')
      .update({ detail_viewed_at: new Date() });
  }

  // ── Recipient resolution (for the extension UI, before materialization) ──

  async resolveRecipients(
    filters: TargetAudienceFilters,
    emailSearch?: string
  ): Promise<ResolvedRecipient[]> {
    const knex = await getAdminConnection();

    let query = knex('users as u')
      .leftJoin('tenants as t', 'u.tenant', 't.tenant')
      .select(
        'u.user_id',
        'u.tenant',
        't.client_name as tenant_name',
        'u.email',
        'u.first_name',
        'u.last_name',
        'u.user_type'
      )
      .where('u.is_inactive', false);

    if (filters.tenant_ids && filters.tenant_ids.length > 0) {
      query = query.whereIn('u.tenant', filters.tenant_ids);
    }

    if (filters.user_types && filters.user_types.length > 0) {
      query = query.whereIn('u.user_type', filters.user_types);
    }

    if (emailSearch && emailSearch.trim()) {
      query = query.where('u.email', 'ilike', `%${emailSearch.trim()}%`);
    }

    const users = await query.orderBy(['u.tenant', 'u.last_name', 'u.first_name']);

    const userIds = users.map((u: { user_id: string }) => u.user_id);
    const userRolesMap: Map<string, string[]> = new Map();

    if (userIds.length > 0) {
      const roleRows = await knex('user_roles as ur')
        .join('roles as r', function () {
          this.on('ur.tenant', '=', 'r.tenant').andOn('ur.role_id', '=', 'r.role_id');
        })
        .whereIn('ur.user_id', userIds)
        .select('ur.user_id', 'r.role_name');

      for (const row of roleRows) {
        const existing = userRolesMap.get(row.user_id) || [];
        existing.push(row.role_name);
        userRolesMap.set(row.user_id, existing);
      }
    }

    // Fetch subscription info per tenant
    const tenantIds = [...new Set(users.map((u: { tenant: string }) => u.tenant))];
    const tenantSubMap = new Map<string, { subscription_status: string; product_name: string }>();

    if (tenantIds.length > 0) {
      try {
        // Use LEFT JOINs so tenants with partial Stripe data (e.g. customer but no
        // subscription, or subscription but no matching price/product) still appear
        // with whatever data is available.
        const subRows = await knex('stripe_customers as sc')
          .leftJoin('stripe_subscriptions as ss', function () {
            this.on('sc.tenant', '=', 'ss.tenant')
              .andOn('sc.stripe_customer_id', '=', 'ss.stripe_customer_id');
          })
          .leftJoin('stripe_prices as sp', function () {
            this.on('ss.tenant', '=', 'sp.tenant')
              .andOn('ss.stripe_price_id', '=', 'sp.stripe_price_id');
          })
          .leftJoin('stripe_products as sprod', function () {
            this.on('sp.tenant', '=', 'sprod.tenant')
              .andOn('sp.stripe_product_id', '=', 'sprod.stripe_product_id');
          })
          .whereIn('sc.tenant', tenantIds)
          .select(
            'sc.tenant',
            'ss.status as subscription_status',
            'sprod.name as product_name',
            'ss.created_at'
          )
          .orderBy('ss.created_at', 'desc');

        // Keep the most relevant subscription per tenant (active > trialing > others, then newest)
        for (const row of subRows) {
          const status = row.subscription_status as string | null;
          const existing = tenantSubMap.get(row.tenant as string);
          if (!existing) {
            if (status) {
              tenantSubMap.set(row.tenant as string, {
                subscription_status: status,
                product_name: (row.product_name as string) || '',
              });
            }
          } else {
            // Prefer active/trialing over other statuses
            const priority: Record<string, number> = { active: 0, trialing: 1, past_due: 2, canceled: 3 };
            const existingPrio = priority[existing.subscription_status] ?? 4;
            const newPrio = priority[status ?? ''] ?? 4;
            if (newPrio < existingPrio) {
              tenantSubMap.set(row.tenant as string, {
                subscription_status: status!,
                product_name: (row.product_name as string) || '',
              });
            }
          }
        }
      } catch (err) {
        // Stripe tables may not exist in CE — log and continue without subscription data
        console.warn('[PlatformNotificationService] Failed to fetch subscription data for recipient filtering:', err);
      }
    }

    let results: ResolvedRecipient[] = users.map((u: Record<string, unknown>) => {
      const sub = tenantSubMap.get(u.tenant as string);
      return {
        user_id: u.user_id as string,
        tenant: u.tenant as string,
        tenant_name: (u.tenant_name as string) || null,
        email: u.email as string,
        first_name: (u.first_name as string) || null,
        last_name: (u.last_name as string) || null,
        roles: userRolesMap.get(u.user_id as string) || [],
        user_type: u.user_type as string,
        subscription_status: sub?.subscription_status ?? null,
        product_name: sub?.product_name ?? null,
      };
    });

    if (filters.roles && filters.roles.length > 0) {
      const rolesLower = filters.roles.map((r) => r.toLowerCase());
      results = results.filter((u) =>
        u.roles.some((r) => rolesLower.includes(r.toLowerCase()))
      );
    }

    if (filters.subscription_statuses && filters.subscription_statuses.length > 0) {
      const statusesLower = filters.subscription_statuses.map((s) => s.toLowerCase());
      results = results.filter((u) =>
        u.subscription_status && statusesLower.includes(u.subscription_status.toLowerCase())
      );
    }

    if (filters.product_names && filters.product_names.length > 0) {
      const namesLower = filters.product_names.map((n) => n.toLowerCase());
      results = results.filter((u) =>
        u.product_name && namesLower.includes(u.product_name.toLowerCase())
      );
    }

    return results;
  }

  // ── Stats ──

  async getNotificationStats(notificationId: string): Promise<NotificationStats> {
    const knex = await getAdminConnection();

    const rows = await knex('platform_notification_recipients as r')
      .leftJoin('tenants as t', 'r.tenant', 't.tenant')
      .where('r.notification_id', notificationId)
      .whereNull('r.excluded_at')
      .select(
        'r.tenant',
        't.client_name as tenant_name'
      )
      .count({ total: '*' })
      .count({ dismissed: knex.raw('CASE WHEN r.dismissed_at IS NOT NULL THEN 1 END') })
      .count({ detail_viewed: knex.raw('CASE WHEN r.detail_viewed_at IS NOT NULL THEN 1 END') })
      .groupBy('r.tenant', 't.client_name');

    let totalRecipients = 0;
    let totalDismissed = 0;
    let totalDetailViewed = 0;
    const readsByTenant = rows.map((row: Record<string, unknown>) => {
      const total = Number(row.total || 0);
      const dismissed = Number(row.dismissed || 0);
      const detailViewed = Number(row.detail_viewed || 0);
      totalRecipients += total;
      totalDismissed += dismissed;
      totalDetailViewed += detailViewed;
      return {
        tenant: row.tenant as string,
        tenant_name: (row.tenant_name as string) || null,
        total,
        dismissed,
        detail_viewed: detailViewed,
      };
    });

    return {
      notification_id: notificationId,
      total_recipients: totalRecipients,
      total_dismissed: totalDismissed,
      total_detail_viewed: totalDetailViewed,
      reads_by_tenant: readsByTenant,
    };
  }

  // ── Per-user reads ──

  async getNotificationReads(notificationId: string): Promise<NotificationRecipientRead[]> {
    const knex = await getAdminConnection();

    // Step 1: Fetch recipients (distributed by tenant — avoids cross-shard join with users)
    const recipientRows = await knex('platform_notification_recipients')
      .where({ notification_id: notificationId })
      .whereNull('excluded_at')
      .select('user_id', 'tenant', 'matched_at', 'dismissed_at', 'detail_viewed_at');

    if (recipientRows.length === 0) return [];

    // Step 2: Batch-fetch user info per tenant to keep queries shard-local
    const tenantGroups = new Map<string, string[]>();
    for (const r of recipientRows) {
      const list = tenantGroups.get(r.tenant as string) || [];
      list.push(r.user_id as string);
      tenantGroups.set(r.tenant as string, list);
    }

    const userMap = new Map<string, { email: string; first_name: string | null; last_name: string | null }>();
    for (const [tenant, userIds] of tenantGroups) {
      const users = await knex('users')
        .where('tenant', tenant)
        .whereIn('user_id', userIds)
        .select('user_id', 'tenant', 'email', 'first_name', 'last_name');
      for (const u of users) {
        userMap.set(`${u.tenant}:${u.user_id}`, {
          email: u.email as string,
          first_name: (u.first_name as string) || null,
          last_name: (u.last_name as string) || null,
        });
      }
    }

    // Step 3: Fetch tenant names (reference table — no shard issues)
    const tenantIds = [...tenantGroups.keys()];
    const tenantNameMap = new Map<string, string>();
    if (tenantIds.length > 0) {
      const tenantRows = await knex('tenants')
        .whereIn('tenant', tenantIds)
        .select('tenant', 'client_name');
      for (const t of tenantRows) {
        tenantNameMap.set(t.tenant as string, (t.client_name as string) || '');
      }
    }

    // Step 4: Merge and sort
    const results: NotificationRecipientRead[] = recipientRows.map((r: Record<string, unknown>) => {
      const user = userMap.get(`${r.tenant}:${r.user_id}`);
      return {
        user_id: r.user_id as string,
        tenant: r.tenant as string,
        tenant_name: tenantNameMap.get(r.tenant as string) || null,
        email: user?.email || '',
        first_name: user?.first_name || null,
        last_name: user?.last_name || null,
        matched_at: r.matched_at ? (r.matched_at as Date).toISOString() : null,
        dismissed_at: r.dismissed_at ? (r.dismissed_at as Date).toISOString() : null,
        detail_viewed_at: r.detail_viewed_at ? (r.detail_viewed_at as Date).toISOString() : null,
      };
    });

    // Sort: viewed first, then dismissed, then pending; within each group by last_name
    results.sort((a, b) => {
      // detail_viewed_at desc nulls last
      if (a.detail_viewed_at && !b.detail_viewed_at) return -1;
      if (!a.detail_viewed_at && b.detail_viewed_at) return 1;
      if (a.detail_viewed_at && b.detail_viewed_at) {
        const cmp = b.detail_viewed_at.localeCompare(a.detail_viewed_at);
        if (cmp !== 0) return cmp;
      }
      // dismissed_at desc nulls last
      if (a.dismissed_at && !b.dismissed_at) return -1;
      if (!a.dismissed_at && b.dismissed_at) return 1;
      if (a.dismissed_at && b.dismissed_at) {
        const cmp = b.dismissed_at.localeCompare(a.dismissed_at);
        if (cmp !== 0) return cmp;
      }
      // last_name asc
      return (a.last_name || '').localeCompare(b.last_name || '');
    });

    return results;
  }

  // ── Private helpers ──

  private parseRow(row: Record<string, unknown>): PlatformNotification {
    return {
      ...row,
      target_audience: typeof row.target_audience === 'string'
        ? JSON.parse(row.target_audience)
        : row.target_audience,
    } as PlatformNotification;
  }
}
