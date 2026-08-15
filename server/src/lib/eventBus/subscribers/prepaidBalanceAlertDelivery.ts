/**
 * Prepaid balance alert delivery planning and drain (task 29.8.20).
 *
 * Plans one delivery row per (alert, channel, recipient_key), dedupes manager
 * and client email addresses into a single email delivery retaining both
 * roles, then drains pending/retryable rows:
 *
 *  - internal: createNotificationFromTemplateInternal + `sent` commit together
 *    in one transaction (preference-disabled results in a terminal `skipped`);
 *  - email: preference-gated, sent outside the transaction through the
 *    existing event-email path, then marked `sent` afterwards. The
 *    provider-acceptance/crash window makes email explicitly at-least-once,
 *    bounded by MAX_DELIVERY_ATTEMPTS.
 *
 * Claims use FOR UPDATE SKIP LOCKED with a worker lease and stale-lease
 * reclamation so concurrent drains cannot double-process one delivery.
 */

import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { tenantDb } from '@alga-psa/db';
import { isValidEmail } from '@alga-psa/core';
import { formatCurrencyFromMinorUnits } from '@alga-psa/core/formatters';
import { createNotificationFromTemplateInternal } from '@alga-psa/notifications/actions';
import { resolveEmailLocale } from '@alga-psa/notifications/notifications/emailLocaleResolver';
import { resolveInvoiceBillingRecipient } from '@alga-psa/billing/services';
import {
  DELIVERY_CHANNEL_EMAIL,
  DELIVERY_CHANNEL_INTERNAL,
  DELIVERY_STATUS_EXHAUSTED,
  DELIVERY_STATUS_FAILED,
  DELIVERY_STATUS_PENDING,
  DELIVERY_STATUS_PROCESSING,
  DELIVERY_STATUS_SENT,
  DELIVERY_STATUS_SKIPPED,
  MAX_DELIVERY_ATTEMPTS,
  RECIPIENT_ROLE_ACCOUNT_MANAGER,
  RECIPIENT_ROLE_CLIENT_BILLING,
  normalizeRecipientKey,
} from '@alga-psa/billing/lib/prepaidBalanceAlerts';
import { sendEventEmail } from '../../notifications/sendEventEmail';
import {
  BUCKET_THRESHOLD_REACHED_SUBTYPE,
  BUCKET_THRESHOLD_REACHED_TEMPLATE,
  CREDIT_LOW_BALANCE_SUBTYPE,
  CREDIT_LOW_BALANCE_TEMPLATE,
  buildBucketAlertContext,
  buildCreditAlertContext,
  buildInternalAlertContext,
  clientAlertLink,
  managerAlertLink,
} from '../../notifications/prepaidBalanceAlertTemplates';

const CLAIM_BATCH_SIZE = 50;
const LEASE_DURATION_MS = 15 * 60 * 1000;

export interface DeliveryWarning {
  code: 'missing_manager' | 'inactive_manager' | 'unresolved_client_recipient' | 'preference_skipped' | 'exhausted' | 'reclaimed_lease';
  clientId?: string;
  clientName?: string;
  alertId?: string;
  deliveryId?: string;
  channel?: string;
  message: string;
}

export interface DeliverySummary {
  plannedInternal: number;
  plannedEmail: number;
  sent: number;
  skipped: number;
  retried: number;
  exhausted: number;
  unroutable: number;
  warnings: DeliveryWarning[];
}

interface AlertForDelivery {
  alert_id: string;
  client_id: string;
  client_name: string;
  alert_type: 'credit' | 'bucket';
  credit_currency_code: string | null;
  credit_threshold: number | string | null;
  bucket_percent: number | string | null;
  observed_value: number | string | null;
  observed_capacity: number | string | null;
  notify_client_on_prepaid_alert: boolean;
  account_manager_id: string | null;
  billing_email: string | null;
  billing_contact_id: string | null;
  default_currency_code: string | null;
}

interface PlannedDelivery {
  channel: 'internal' | 'email';
  recipientKey: string;
  roles: string[];
  recipientUserId: string | null;
  recipientEmail: string | null;
}

interface EmailGroup {
  key: string;
  email: string;
  roles: string[];
  userId: string | null;
}

function emptySummary(): DeliverySummary {
  return { plannedInternal: 0, plannedEmail: 0, sent: 0, skipped: 0, retried: 0, exhausted: 0, unroutable: 0, warnings: [] };
}

function hasSentForRole(existing: Array<{ recipient_roles: unknown; status: string }>, role: string): boolean {
  return existing.some((row) => {
    const roles = Array.isArray(row.recipient_roles) ? row.recipient_roles : [];
    return roles.includes(role) && row.status === DELIVERY_STATUS_SENT;
  });
}

function trimEmail(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

async function loadOpenAlerts(knex: Knex, tenantId: string): Promise<AlertForDelivery[]> {
  const db = tenantDb(knex, tenantId);
  const query = db.table('prepaid_balance_alerts as a')
    .select(
      'a.alert_id',
      'a.client_id',
      'cl.client_name',
      'a.alert_type',
      'a.credit_currency_code',
      'a.credit_threshold',
      'a.bucket_percent',
      'a.observed_value',
      'a.observed_capacity',
      'cbs.notify_client_on_prepaid_alert',
      'cl.account_manager_id',
      'cl.billing_email',
      'cl.billing_contact_id',
      'cl.default_currency_code'
    );
  db.tenantJoin(query, 'clients as cl', 'a.client_id', 'cl.client_id');
  db.tenantJoin(query, 'client_billing_settings as cbs', 'a.client_id', 'cbs.client_id', { type: 'left' });
  query
    .where('a.tenant', tenantId)
    .whereNull('a.resolved_at');
  return (await query) as AlertForDelivery[];
}

async function resolveManager(
  knex: Knex,
  tenantId: string,
  alert: AlertForDelivery
): Promise<{ userId: string; email: string | null } | null> {
  if (!alert.account_manager_id) return null;
  const db = tenantDb(knex, tenantId);
  const user = await db.table('users')
    .where({ user_id: alert.account_manager_id })
    .first('user_id', 'email', 'is_inactive');
  if (!user || user.is_inactive) return null;
  return { userId: user.user_id, email: trimEmail(user.email) };
}

async function planDeliveriesForAlert(
  knex: Knex,
  tenantId: string,
  alert: AlertForDelivery,
  summary: DeliverySummary
): Promise<void> {
  const db = tenantDb(knex, tenantId);

  const existing = (await db.table('prepaid_balance_alert_deliveries')
    .where({ alert_id: alert.alert_id })
    .select('recipient_roles', 'status')) as Array<{ recipient_roles: unknown; status: string }>;

  const managerRoleSent = hasSentForRole(existing, RECIPIENT_ROLE_ACCOUNT_MANAGER);
  const clientRoleSent = hasSentForRole(existing, RECIPIENT_ROLE_CLIENT_BILLING);

  const planned: PlannedDelivery[] = [];

  // Account manager: internal warning always when an active manager resolves,
  // email only when a valid address exists.
  const manager = await resolveManager(knex, tenantId, alert);
  if (!manager) {
    summary.unroutable += 1;
    summary.warnings.push({
      code: alert.account_manager_id ? 'inactive_manager' : 'missing_manager',
      clientId: alert.client_id,
      clientName: alert.client_name,
      alertId: alert.alert_id,
      message: `No active account manager for client ${alert.client_id}`,
    });
  } else if (!managerRoleSent) {
    planned.push({
      channel: DELIVERY_CHANNEL_INTERNAL,
      recipientKey: `user:${manager.userId}`,
      roles: [RECIPIENT_ROLE_ACCOUNT_MANAGER],
      recipientUserId: manager.userId,
      recipientEmail: null,
    });
    if (manager.email && isValidEmail(manager.email)) {
      planned.push({
        channel: DELIVERY_CHANNEL_EMAIL,
        recipientKey: normalizeRecipientKey(manager.email),
        roles: [RECIPIENT_ROLE_ACCOUNT_MANAGER],
        recipientUserId: manager.userId,
        recipientEmail: manager.email,
      });
    }
  }

  // Client billing recipient: email only, canonical precedence, opt-in required.
  if (alert.notify_client_on_prepaid_alert && !clientRoleSent) {
    const recipient = await resolveInvoiceBillingRecipient({
      knexOrTrx: knex,
      tenantId,
      clientId: alert.client_id,
    });
    if (recipient.recipientEmail && isValidEmail(recipient.recipientEmail)) {
      planned.push({
        channel: DELIVERY_CHANNEL_EMAIL,
        recipientKey: normalizeRecipientKey(recipient.recipientEmail),
        roles: [RECIPIENT_ROLE_CLIENT_BILLING],
        recipientUserId: null,
        recipientEmail: recipient.recipientEmail,
      });
    } else {
      summary.unroutable += 1;
      summary.warnings.push({
        code: 'unresolved_client_recipient',
        clientId: alert.client_id,
        clientName: alert.client_name,
        alertId: alert.alert_id,
        message: `No canonical billing recipient resolved for client ${alert.client_id}`,
      });
    }
  }

  // Collapse email rows by normalized address, retaining both roles.
  const emailGroups = new Map<string, EmailGroup>();
  for (const p of planned) {
    if (p.channel !== DELIVERY_CHANNEL_EMAIL || !p.recipientEmail) continue;
    const existingGroup = emailGroups.get(p.recipientKey);
    if (existingGroup) {
      existingGroup.roles = Array.from(new Set([...existingGroup.roles, ...p.roles]));
      if (p.recipientUserId && !existingGroup.userId) existingGroup.userId = p.recipientUserId;
    } else {
      emailGroups.set(p.recipientKey, {
        key: p.recipientKey,
        email: p.recipientEmail,
        roles: [...p.roles],
        userId: p.recipientUserId,
      });
    }
  }

  const rows: PlannedDelivery[] = planned.filter((p) => p.channel === DELIVERY_CHANNEL_INTERNAL);
  for (const group of emailGroups.values()) {
    rows.push({
      channel: DELIVERY_CHANNEL_EMAIL,
      recipientKey: group.key,
      roles: group.roles,
      recipientUserId: group.userId,
      recipientEmail: group.email,
    });
  }

  for (const row of rows) {
    await db.table('prepaid_balance_alert_deliveries')
      .insert({
        tenant: tenantId,
        delivery_id: randomUUID(),
        alert_id: alert.alert_id,
        channel: row.channel,
        recipient_roles: JSON.stringify(row.roles),
        recipient_key: row.recipientKey,
        recipient_user_id: row.recipientUserId,
        recipient_email: row.recipientEmail,
        status: DELIVERY_STATUS_PENDING,
        attempt_count: 0,
      })
      .onConflict(['tenant', 'alert_id', 'channel', 'recipient_key'])
      // Union the roles instead of overwriting: when a client opt-in arrives
      // for an address that already carries a sent manager delivery, the
      // metadata must retain both roles without resending the message. The
      // left side is qualified because the tenant-scoped facade adds a WHERE
      // to the DO UPDATE that would otherwise make the bare column ambiguous.
      .merge({
        recipient_roles: knex.raw('prepaid_balance_alert_deliveries.recipient_roles || excluded.recipient_roles'),
        updated_at: knex.raw('excluded.updated_at'),
      });
    if (row.channel === DELIVERY_CHANNEL_INTERNAL) summary.plannedInternal += 1;
    else summary.plannedEmail += 1;
  }
}

interface ClaimedDelivery {
  delivery_id: string;
  alert_id: string;
  channel: string;
  recipient_key: string;
  recipient_roles: unknown;
  recipient_user_id: string | null;
  recipient_email: string | null;
  attempt_count: number;
}

/**
 * Atomically claim pending/retryable deliveries. The SELECT ... FOR UPDATE
 * SKIP LOCKED and the per-row `processing` mark run inside ONE transaction so
 * the row locks are held until the claim commits; two concurrent drains can
 * never both claim the same row (the second blocks on the lock, then SKIP
 * LOCKED skips it once it sees the fresh lease). Stale processing leases are
 * reclaimed; rows whose attempt budget is already spent are exhausted.
 */
async function claimDeliveries(
  knex: Knex,
  tenantId: string,
  summary: DeliverySummary
): Promise<Array<ClaimedDelivery & { alert: AlertForDelivery }>> {
  return knex.transaction(async (trx) => {
    const db = tenantDb(trx, tenantId);
    const query = db.table('prepaid_balance_alert_deliveries as d')
      .select(
        'd.delivery_id',
        'd.alert_id',
        'd.channel',
        'd.recipient_key',
        'd.recipient_roles',
        'd.recipient_user_id',
        'd.recipient_email',
        'd.attempt_count',
        'd.status',
        'a.alert_type',
        'a.client_id',
        'cl.client_name',
        'a.credit_currency_code',
        'a.credit_threshold',
        'a.bucket_percent',
        'a.observed_value',
        'a.observed_capacity',
        'cl.account_manager_id',
        'cl.billing_email',
        'cl.billing_contact_id',
        'cl.default_currency_code'
      );
    db.tenantJoin(query, 'prepaid_balance_alerts as a', 'd.alert_id', 'a.alert_id');
    db.tenantJoin(query, 'clients as cl', 'a.client_id', 'cl.client_id');
    query
      .where('d.tenant', tenantId)
      .andWhere((qb) => {
        qb.where('d.status', DELIVERY_STATUS_PENDING)
          .orWhere('d.status', DELIVERY_STATUS_PROCESSING)
          .orWhere('d.status', DELIVERY_STATUS_FAILED);
      })
      .andWhere((qb) => {
        qb.whereNull('d.lease_expires_at')
          .orWhere('d.lease_expires_at', '<', new Date(Date.now() - 1).toISOString());
      })
      .orderBy('d.created_at', 'asc')
      .limit(CLAIM_BATCH_SIZE)
      .forUpdate()
      .skipLocked();

    const rows = (await query) as Array<Record<string, unknown> & {
      delivery_id: string;
      alert_id: string;
      channel: string;
      recipient_key: string;
      recipient_user_id: string | null;
      recipient_email: string | null;
      attempt_count: number;
      status: string;
    }>;

    const workerId = `worker:${randomUUID()}`;
    const leaseExpiresAt = new Date(Date.now() + LEASE_DURATION_MS).toISOString();
    const claimed: Array<ClaimedDelivery & { alert: AlertForDelivery }> = [];
    for (const row of rows) {
      const wasStaleProcessing = row.status === DELIVERY_STATUS_PROCESSING;
      const nextAttempt = Number(row.attempt_count) + 1;
      if (nextAttempt > MAX_DELIVERY_ATTEMPTS) {
        await db.table('prepaid_balance_alert_deliveries')
          .where({ tenant: tenantId, delivery_id: row.delivery_id })
          .update({
            status: DELIVERY_STATUS_EXHAUSTED,
            exhausted_at: new Date().toISOString(),
            last_error: `Exhausted after ${MAX_DELIVERY_ATTEMPTS} attempts`,
          });
        summary.exhausted += 1;
        summary.warnings.push({
          code: 'exhausted',
          clientId: String(row.client_id),
          clientName: String(row.client_name ?? ''),
          alertId: row.alert_id,
          deliveryId: row.delivery_id,
          channel: row.channel,
          message: `Delivery ${row.delivery_id} exhausted after ${MAX_DELIVERY_ATTEMPTS} attempts`,
        });
        continue;
      }
      await db.table('prepaid_balance_alert_deliveries')
        .where({ tenant: tenantId, delivery_id: row.delivery_id })
        .update({
          status: DELIVERY_STATUS_PROCESSING,
          worker_id: workerId,
          lease_expires_at: leaseExpiresAt,
          attempt_count: nextAttempt,
        });
      if (wasStaleProcessing) {
        summary.warnings.push({
          code: 'reclaimed_lease',
          clientId: String(row.client_id),
          clientName: String(row.client_name ?? ''),
          alertId: row.alert_id,
          deliveryId: row.delivery_id,
          channel: row.channel,
          message: `Reclaimed stale processing lease for delivery ${row.delivery_id}`,
        });
      }
      claimed.push({
        delivery_id: row.delivery_id,
        alert_id: row.alert_id,
        channel: row.channel,
        recipient_key: row.recipient_key,
        recipient_roles: row.recipient_roles,
        recipient_user_id: row.recipient_user_id,
        recipient_email: row.recipient_email,
        attempt_count: nextAttempt,
        alert: {
          alert_id: row.alert_id,
          client_id: String(row.client_id),
          client_name: String(row.client_name ?? ''),
          alert_type: row.alert_type as 'credit' | 'bucket',
          credit_currency_code: row.credit_currency_code as string | null,
          credit_threshold: row.credit_threshold as number | string | null,
          bucket_percent: row.bucket_percent as number | string | null,
          observed_value: row.observed_value as number | string | null,
          observed_capacity: row.observed_capacity as number | string | null,
          notify_client_on_prepaid_alert: true,
          account_manager_id: row.account_manager_id as string | null,
          billing_email: row.billing_email as string | null,
          billing_contact_id: row.billing_contact_id as string | null,
          default_currency_code: row.default_currency_code as string | null,
        },
      });
    }
    return claimed;
  });
}

function rolesOf(delivery: ClaimedDelivery): string[] {
  if (Array.isArray(delivery.recipient_roles)) return delivery.recipient_roles.map(String);
  if (typeof delivery.recipient_roles === 'string') {
    try {
      const parsed = JSON.parse(delivery.recipient_roles);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function emailPreferencesEnabled(
  knex: Knex,
  tenantId: string,
  subtypeName: string,
  userId?: string | null
): Promise<{ enabled: boolean; subtypeId?: number }> {
  const db = tenantDb(knex, tenantId);

  const settingsRow = await db.table('notification_settings').first('is_enabled');
  if (settingsRow && settingsRow.is_enabled === false) {
    return { enabled: false };
  }

  const subtype = await db.table('notification_subtypes').where({ name: subtypeName }).first('id', 'category_id');
  if (!subtype) {
    return { enabled: false };
  }

  const subtypeSetting = await db.table('tenant_notification_subtype_settings')
    .where({ subtype_id: subtype.id })
    .first('is_enabled');
  if (subtypeSetting && subtypeSetting.is_enabled === false) {
    return { enabled: false };
  }

  const categorySetting = await db.table('tenant_notification_category_settings')
    .where({ category_id: subtype.category_id })
    .first('is_enabled');
  if (categorySetting && categorySetting.is_enabled === false) {
    return { enabled: false };
  }

  if (userId) {
    const preference = await db.table('user_notification_preferences')
      .where({ user_id: userId, subtype_id: subtype.id })
      .first('is_enabled');
    if (preference && preference.is_enabled === false) {
      return { enabled: false };
    }
  }

  return { enabled: true, subtypeId: subtype.id };
}

function subtypeAndTemplateFor(alertType: 'credit' | 'bucket'): { subtypeName: string; templateName: string } {
  if (alertType === 'credit') {
    return { subtypeName: CREDIT_LOW_BALANCE_SUBTYPE, templateName: CREDIT_LOW_BALANCE_TEMPLATE };
  }
  return { subtypeName: BUCKET_THRESHOLD_REACHED_SUBTYPE, templateName: BUCKET_THRESHOLD_REACHED_TEMPLATE };
}

function formatHours(minutes: number, locale: string): string {
  const hours = minutes / 60;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(hours)} h`;
}

function roundPercent(value: number, locale: string): number {
  return Number(new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value));
}

async function buildEmailContext(
  alert: AlertForDelivery,
  locale: string,
  link: string
): Promise<Record<string, unknown>> {
  const currency = alert.credit_currency_code || alert.default_currency_code || 'USD';
  if (alert.alert_type === 'credit') {
    const available = Number(alert.observed_value) || 0;
    const threshold = Number(alert.credit_threshold) || 0;
    return buildCreditAlertContext(alert.client_name, {
      currency,
      threshold: formatCurrencyFromMinorUnits(threshold, locale, currency),
      available: formatCurrencyFromMinorUnits(available, locale, currency),
      link,
    });
  }
  const used = Number(alert.observed_value) || 0;
  const capacity = Number(alert.observed_capacity) || 0;
  const percent = Number(alert.bucket_percent) || 0;
  const usedPercent = capacity > 0 ? (used * 100) / capacity : 0;
  return buildBucketAlertContext(alert.client_name, {
    percent,
    usedPercent: roundPercent(usedPercent, locale),
    capacity: formatHours(capacity, locale),
    used: formatHours(used, locale),
    link,
  });
}

/**
 * Flat template context for the INTERNAL notification channel (locale-aware
 * formatting). The internal renderer substitutes only top-level `\w+` keys, so
 * buildInternalAlertContext flattens values to match the seeded placeholders.
 */
function buildInternalAlertContextForDelivery(
  alert: AlertForDelivery,
  locale: string,
  link: string
): Record<string, unknown> {
  const currency = alert.credit_currency_code || alert.default_currency_code || 'USD';
  if (alert.alert_type === 'credit') {
    const available = Number(alert.observed_value) || 0;
    const threshold = Number(alert.credit_threshold) || 0;
    return buildInternalAlertContext(alert.client_name, {
      currency,
      available: formatCurrencyFromMinorUnits(available, locale, currency),
      threshold: formatCurrencyFromMinorUnits(threshold, locale, currency),
      link,
    });
  }
  const used = Number(alert.observed_value) || 0;
  const capacity = Number(alert.observed_capacity) || 0;
  const percent = Number(alert.bucket_percent) || 0;
  const usedPercent = capacity > 0 ? (used * 100) / capacity : 0;
  return buildInternalAlertContext(alert.client_name, {
    percent,
    usedPercent: roundPercent(usedPercent, locale),
    capacity: formatHours(capacity, locale),
    used: formatHours(used, locale),
    link,
  });
}

async function processDelivery(
  knex: Knex,
  tenantId: string,
  delivery: ClaimedDelivery & { alert: AlertForDelivery },
  summary: DeliverySummary
): Promise<void> {
  const db = tenantDb(knex, tenantId);
  const roles = rolesOf(delivery);
  const isManager = roles.includes(RECIPIENT_ROLE_ACCOUNT_MANAGER);
  const { subtypeName, templateName } = subtypeAndTemplateFor(delivery.alert.alert_type);

  const markSkipped = async () => {
    await db.table('prepaid_balance_alert_deliveries')
      .where({ delivery_id: delivery.delivery_id })
      .update({ status: DELIVERY_STATUS_SKIPPED, skipped_at: new Date().toISOString() });
    summary.skipped += 1;
  };

  const markSent = async () => {
    await db.table('prepaid_balance_alert_deliveries')
      .where({ delivery_id: delivery.delivery_id })
      .update({
        status: DELIVERY_STATUS_SENT,
        sent_at: new Date().toISOString(),
        lease_expires_at: null,
        worker_id: null,
      });
    summary.sent += 1;
  };

  const markFailure = async (error: unknown) => {
    const exhausted = delivery.attempt_count >= MAX_DELIVERY_ATTEMPTS;
    const message = error instanceof Error ? error.message : String(error);
    if (exhausted) {
      await db.table('prepaid_balance_alert_deliveries')
        .where({ delivery_id: delivery.delivery_id })
        .update({
          status: DELIVERY_STATUS_EXHAUSTED,
          exhausted_at: new Date().toISOString(),
          last_error: message,
        });
      summary.exhausted += 1;
      summary.warnings.push({
        code: 'exhausted',
        clientId: delivery.alert.client_id,
        clientName: delivery.alert.client_name,
        alertId: delivery.alert.alert_id,
        deliveryId: delivery.delivery_id,
        channel: delivery.channel,
        message: `Delivery ${delivery.delivery_id} exhausted after ${MAX_DELIVERY_ATTEMPTS} attempts`,
      });
    } else {
      await db.table('prepaid_balance_alert_deliveries')
        .where({ delivery_id: delivery.delivery_id })
        .update({
          status: DELIVERY_STATUS_FAILED,
          last_error: message,
          // Clear the lease so the next drain can reclaim the retryable row
          // immediately (a failed delivery must not wait out the lease).
          lease_expires_at: null,
          worker_id: null,
        });
      summary.retried += 1;
    }
  };

  if (delivery.channel === DELIVERY_CHANNEL_INTERNAL) {
    // Transactional: notification insert + `sent` commit together. The
    // delivery-status updates go through the tenant-scoped facade inside the
    // transaction so the (tenant, delivery_id) predicate is always applied
    // (Citus shard pruning relies on it).
    await knex.transaction(async (trx) => {
      const db = tenantDb(trx, tenantId);
      const link = managerAlertLink(delivery.alert.client_id);
      const locale = await resolveEmailLocale(tenantId, {
        email: delivery.recipient_email ?? '',
        userId: delivery.recipient_user_id as string,
      });
      const data = buildInternalAlertContextForDelivery(delivery.alert, locale, link);
      const created = await createNotificationFromTemplateInternal(trx, {
        tenant: tenantId,
        user_id: delivery.recipient_user_id as string,
        template_name: templateName,
        type: 'warning',
        category: 'prepaid-alerts',
        link,
        data,
      });
      if (!created) {
        await db.table('prepaid_balance_alert_deliveries')
          .where({ tenant: tenantId, delivery_id: delivery.delivery_id })
          .update({ status: DELIVERY_STATUS_SKIPPED, skipped_at: new Date().toISOString() });
        summary.skipped += 1;
        summary.warnings.push({
          code: 'preference_skipped',
          clientId: delivery.alert.client_id,
          clientName: delivery.alert.client_name,
          alertId: delivery.alert.alert_id,
          deliveryId: delivery.delivery_id,
          channel: delivery.channel,
          message: `Internal delivery ${delivery.delivery_id} disabled by user preference`,
        });
      } else {
        await db.table('prepaid_balance_alert_deliveries')
          .where({ tenant: tenantId, delivery_id: delivery.delivery_id })
          .update({
            status: DELIVERY_STATUS_SENT,
            sent_at: new Date().toISOString(),
            lease_expires_at: null,
            worker_id: null,
          });
        summary.sent += 1;
      }
    });
    return;
  }

  // Email channel.
  const prefs = await emailPreferencesEnabled(knex, tenantId, subtypeName, delivery.recipient_user_id);
  if (!prefs.enabled || !delivery.recipient_email) {
    await markSkipped();
    return;
  }

  const locale = await resolveEmailLocale(tenantId, {
    email: delivery.recipient_email,
    ...(delivery.recipient_user_id ? { userId: delivery.recipient_user_id } : {}),
    ...(isManager ? {} : { clientId: delivery.alert.client_id }),
  });

  const link = isManager
    ? managerAlertLink(delivery.alert.client_id)
    : clientAlertLink();
  const context = await buildEmailContext(delivery.alert, locale, link);

  try {
    // Email send is deliberately OUTSIDE the database transaction; sent is
    // marked afterwards. A provider-acceptance/process-crash window can
    // duplicate an email, so delivery is explicitly at-least-once.
    await sendEventEmail({
      tenantId,
      to: delivery.recipient_email,
      subject: 'Prepaid balance alert',
      template: templateName,
      context,
      notificationSubtypeId: prefs.subtypeId,
      recipientUserId: delivery.recipient_user_id ?? undefined,
      recipientClientId: isManager ? undefined : delivery.alert.client_id,
      entityType: 'prepaid-balance-alert',
      entityId: delivery.alert.alert_id,
    });
    await markSent();
  } catch (error) {
    await markFailure(error);
  }
}

export async function planAndDrainDeliveriesForTenant(knex: Knex, tenantId: string): Promise<DeliverySummary> {
  const summary = emptySummary();

  const alerts = await loadOpenAlerts(knex, tenantId);
  for (const alert of alerts) {
    try {
      await planDeliveriesForAlert(knex, tenantId, alert, summary);
    } catch (error) {
      // One alert's recipient planning failure (e.g. recipient resolution
      // throwing) never aborts the rest of the tenant's drain.
      summary.warnings.push({
        code: 'unresolved_client_recipient',
        clientId: alert.client_id,
        clientName: alert.client_name,
        alertId: alert.alert_id,
        message: `Delivery planning failed for alert ${alert.alert_id}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  const claimed = await claimDeliveries(knex, tenantId, summary);
  for (const delivery of claimed) {
    try {
      await processDelivery(knex, tenantId, delivery, summary);
    } catch (error) {
      summary.warnings.push({
        code: 'exhausted',
        clientId: delivery.alert.client_id,
        clientName: delivery.alert.client_name,
        alertId: delivery.alert.alert_id,
        deliveryId: delivery.delivery_id,
        channel: delivery.channel,
        message: `Unexpected delivery processing failure: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  return summary;
}
