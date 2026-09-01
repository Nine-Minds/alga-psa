import { tenantDb } from '@alga-psa/db';
import { Knex } from 'knex';
import { normalizeLocale } from '@alga-psa/core/i18n/config';
import {
  InternalNotification,
  InternalNotificationTemplate,
  InternalNotificationPriority,
  CreateInternalNotificationRequest,
} from '../../types/internalNotification';
import { pickNotificationPriority } from './priorityResolution';

/**
 * The transactional heart of template-based notification creation: locale ->
 * template -> enablement -> priority -> render -> insert.
 *
 * Intentionally NOT a "use server" module, and free of the realtime/auth
 * stack, so the temporal worker (whose build stubs
 * @alga-psa/notifications/actions to keep next-auth and the UI deps out) can
 * import it directly and create real notification rows. The after-commit
 * effects (workflow event, realtime broadcast, push hooks) stay with the
 * callers that can perform them.
 */

function tenantScopedTable(conn: Knex | Knex.Transaction, table: string, tenant: string) {
  return tenantDb(conn, tenant).table(table) as Knex.QueryBuilder<any, any>;
}

/**
 * Get user's locale preference with fallback hierarchy:
 *
 * Internal (MSP) users:
 * 1. User's language preference (user_preferences.locale)
 * 2. Tenant MSP portal default (tenant_settings.settings.mspPortal.defaultLocale)
 * 3. Tenant-wide default (tenant_settings.settings.defaultLocale)
 * 4. System default ('en')
 *
 * Client portal users:
 * 1. User's language preference (user_preferences.locale)
 * 2. Client company language (clients.properties.defaultLocale)
 * 3. Tenant client portal default (tenant_settings.settings.clientPortal.defaultLocale)
 * 4. Tenant-wide default (tenant_settings.settings.defaultLocale)
 * 5. System default ('en')
 */
export async function getUserLocale(
  trx: Knex.Transaction,
  tenant: string,
  userId: string
): Promise<string> {
  const db = tenantDb(trx, tenant);
  const userQuery = db.table('users as u')
    .select('u.user_type', 'u.contact_id', 'c.properties')
    .where('u.user_id', userId);
  db.tenantJoin(userQuery, 'contacts as con', 'u.contact_id', 'con.contact_name_id', { type: 'left' });
  db.tenantJoin(userQuery, 'clients as c', 'con.client_id', 'c.client_id', { type: 'left' });
  const user = (await userQuery.first()) as any;

  // 1. User's language preference (applies to both internal and client users)
  const userPreference = await tenantScopedTable(trx, 'user_preferences', tenant)
    .where({
      user_id: userId,
      setting_name: 'locale'
    })
    .first();

  if (userPreference?.setting_value) {
    const raw = userPreference.setting_value;
    // Every read normalizes: these columns hold values like 'pt_BR' that name a
    // language we ship under a code we don't, and an unnormalized one reaches
    // the renderer as a locale with no pack behind it.
    const locale = normalizeLocale(typeof raw === 'string' ? raw.replace(/"/g, '') : raw);
    if (locale) return locale;
  }

  // 2. Client-specific default (client users only)
  if (user?.user_type !== 'internal') {
    const clientLocale = normalizeLocale(user?.properties?.defaultLocale);
    if (clientLocale) return clientLocale;
  }

  // 3. Tenant settings — portal-specific default then tenant-wide default
  const tenantSettings = await tenantScopedTable(trx, 'tenant_settings', tenant)
    .select('settings')
    .first();

  if (user?.user_type === 'internal') {
    const mspPortalLocale = normalizeLocale(tenantSettings?.settings?.mspPortal?.defaultLocale);
    if (mspPortalLocale) return mspPortalLocale;
  } else {
    const clientPortalLocale = normalizeLocale(tenantSettings?.settings?.clientPortal?.defaultLocale);
    if (clientPortalLocale) return clientPortalLocale;
  }

  const tenantDefaultLocale = normalizeLocale(tenantSettings?.settings?.defaultLocale);
  if (tenantDefaultLocale) {
    return tenantDefaultLocale;
  }

  // 4. System default
  return 'en';
}

/**
 * Get notification template in the specified language with fallback to English
 * Note: The locale parameter comes from getUserLocale() which already handles:
 * 1. User's language preference
 * 2. Client company language
 * 3. Tenant language
 * 4. English default
 */
export async function getNotificationTemplate(
  trx: Knex.Transaction,
  tenant: string,
  templateName: string,
  locale: string
): Promise<InternalNotificationTemplate | null> {
  // 1. Try the requested language (from getUserLocale hierarchy)
  let template = await tenantScopedTable(trx, 'internal_notification_templates', tenant)
    .where({ name: templateName, language_code: locale })
    .first();

  if (template) return template;

  // 2. Try English as final fallback
  template = await tenantScopedTable(trx, 'internal_notification_templates', tenant)
    .where({ name: templateName, language_code: 'en' })
    .first();

  if (template) return template;

  // 3. Return null if no template found
  return null;
}

/**
 * Render template with provided data
 * Supports simple {{variable}} replacement
 */
export function renderTemplate(template: string, data: Record<string, any>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return data[key] !== undefined ? String(data[key]) : match;
  });
}

export async function checkInternalNotificationEnabled(
  trx: Knex.Transaction,
  tenant: string,
  userId: string,
  subtypeId: number
): Promise<boolean> {
  // 1. Get subtype info
  const subtype = await tenantScopedTable(trx, 'internal_notification_subtypes', tenant)
    .where({ internal_notification_subtype_id: subtypeId })
    .first();

  if (!subtype) {
    return false;
  }

  // 2. Check tenant-specific subtype setting (replaces global check)
  const subtypeSetting = await tenantScopedTable(trx, 'tenant_internal_notification_subtype_settings', tenant)
    .where({ subtype_id: subtypeId })
    .first();

  const isSubtypeEnabled = subtypeSetting?.is_enabled ?? true;
  if (!isSubtypeEnabled) {
    return false;
  }

  // 3. Verify category exists
  const category = await tenantScopedTable(trx, 'internal_notification_categories', tenant)
    .where({ internal_notification_category_id: subtype.internal_category_id })
    .first();

  if (!category) {
    return false; // Category not found - don't send notification
  }

  // 4. Check tenant-specific category setting (replaces global check)
  const categorySetting = await tenantScopedTable(trx, 'tenant_internal_notification_category_settings', tenant)
    .where({ category_id: subtype.internal_category_id })
    .first();

  const isCategoryEnabled = categorySetting?.is_enabled ?? true;
  if (!isCategoryEnabled) {
    return false;
  }

  // 5. Check user-specific preferences (EXISTING - unchanged)
  const userSubtypePreference = await tenantScopedTable(trx, 'user_internal_notification_preferences', tenant)
    .where({ user_id: userId, subtype_id: subtypeId })
    .first();

  if (userSubtypePreference) {
    return userSubtypePreference.is_enabled;
  }

  // 6. Check user category preference (EXISTING - unchanged)
  const userCategoryPreference = await tenantScopedTable(trx, 'user_internal_notification_preferences', tenant)
    .where({ user_id: userId, category_id: subtype.internal_category_id })
    .whereNull('subtype_id')
    .first();

  if (userCategoryPreference) {
    return userCategoryPreference.is_enabled;
  }

  // 7. Fall back to tenant's default
  return subtypeSetting?.is_default_enabled ?? true;
}

/**
 * Resolve the effective priority for a notification about to be created.
 *
 * Runs inside the creation transaction, alongside the enablement lookup, so
 * call sites cannot influence the stamped priority — it is governed centrally
 * by configuration only. Per-user priority is meaningful on subtype-level rows.
 */
export async function resolveNotificationPriority(
  trx: Knex.Transaction,
  tenant: string,
  userId: string,
  subtypeId: number
): Promise<InternalNotificationPriority> {
  const userPreference = await tenantScopedTable(trx, 'user_internal_notification_preferences', tenant)
    .where({ user_id: userId, subtype_id: subtypeId })
    .first();
  const tenantSetting = await tenantScopedTable(trx, 'tenant_internal_notification_subtype_settings', tenant)
    .where({ subtype_id: subtypeId })
    .first();
  const subtype = await tenantScopedTable(trx, 'internal_notification_subtypes', tenant)
    .where({ internal_notification_subtype_id: subtypeId })
    .first();

  return pickNotificationPriority(
    userPreference?.priority,
    tenantSetting?.priority,
    subtype?.default_priority
  );
}

/**
 * Create one notification row from a template, inside the caller's
 * transaction. Returns null when the target user has the notification type
 * disabled. Performs no external effects — publishing, broadcasting, and push
 * hooks are the caller's, after commit.
 */
export async function createNotificationRowFromTemplate(
  trx: Knex.Transaction,
  tenant: string,
  userId: string,
  request: CreateInternalNotificationRequest
): Promise<InternalNotification | null> {
  // Get user's locale
  const userLocale = await getUserLocale(trx, tenant, userId);

  // Get template in user's language
  const template = await getNotificationTemplate(trx, tenant, request.template_name, userLocale);

  if (!template) {
    throw new Error(`Template '${request.template_name}' not found`);
  }

  // Check if user has this notification type enabled
  const subtypeId = template.subtype_id;
  const isEnabled = await checkInternalNotificationEnabled(trx, tenant, userId, subtypeId);

  if (!isEnabled) {
    console.log(`Internal notification disabled for user ${userId}, subtype ${subtypeId}`);
    return null;
  }

  // Resolve the configured priority (user ?? tenant ?? subtype default ?? 'normal').
  // Governed centrally by configuration — the caller cannot supply a priority.
  const priority = await resolveNotificationPriority(trx, tenant, userId, subtypeId);

  // Render template with data
  const title = renderTemplate(template.title, request.data);
  const message = renderTemplate(template.message, request.data);

  // Insert notification
  const [notification] = await tenantDb(trx, tenant).table<any>('internal_notifications')
    .insert({
      tenant,
      user_id: userId,
      template_name: request.template_name,
      language_code: userLocale,
      title,
      message,
      type: request.type || 'info',
      priority,
      category: request.category || null,
      link: request.link || null,
      metadata: request.metadata ? JSON.stringify(request.metadata) : null,
      is_read: false,
      delivery_status: 'pending',
      delivery_attempts: 0
    })
    .returning('*') as InternalNotification[];

  return notification;
}
