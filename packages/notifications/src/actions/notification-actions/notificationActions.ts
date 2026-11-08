"use server"

import { readUserEmailPreferenceState, saveUserEmailPreferences } from '../../notifications/userEmailPreferences';
import { getEmailNotificationService } from "../../notifications/email";
import { readDontNotifyCustomerDefault } from "../../notifications/notificationPolicy";
import { revalidatePath } from "next/cache";
import { withTransaction, createTenantKnex, tenantDb } from '@alga-psa/db';
import { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth';
import {
  NotificationSettings,
  SystemEmailTemplate,
  TenantEmailTemplate,
  NotificationCategory,
  NotificationSubtype,
  UserNotificationPreference,
  UserEmailPreferenceCategoryState,
  isLockedCategory
} from "../../types/notification";
import {
  notificationActionErrorFrom,
  type NotificationActionError,
} from '../notificationActionErrors';

function tenantScopedTable(conn: Knex | Knex.Transaction, table: string, tenant: string) {
  return tenantDb(conn, tenant).table(table) as Knex.QueryBuilder<any, any>;
}

/**
 * Templates and notification settings are tenant-owned outbound mail: every
 * entry point here takes its tenant from the session and is gated on the
 * settings permission, never on an argument the caller could name.
 */
async function requireSettingsRead(user: any, trx: Knex.Transaction): Promise<void> {
  const { hasPermission } = await import('@alga-psa/auth');
  if (!(await hasPermission(user, 'settings', 'read', trx))) {
    throw new Error('Permission denied: Cannot read settings');
  }
}

async function requireSettingsUpdate(user: any, trx: Knex.Transaction): Promise<void> {
  const { hasPermission } = await import('@alga-psa/auth');
  if (!(await hasPermission(user, 'settings', 'update', trx))) {
    throw new Error('Permission denied: Cannot update settings');
  }
}

export type NotificationSettingsUpdate = Partial<Pick<NotificationSettings, 'is_enabled' | 'default_dont_notify_customer'>>;

const UPDATABLE_NOTIFICATION_SETTINGS = ['is_enabled', 'default_dont_notify_customer'] as const;

export const getNotificationSettingsAction = withAuth(async (
  user,
  { tenant },
): Promise<NotificationSettings> => {
  const { knex } = await createTenantKnex();
  await withTransaction(knex, (trx: Knex.Transaction) => requireSettingsRead(user, trx));

  const notificationService = getEmailNotificationService();
  return notificationService.getSettings(tenant);
});

export const updateNotificationSettingsAction = withAuth(async (
  user,
  { tenant },
  settings: NotificationSettingsUpdate
): Promise<NotificationSettings> => {
  const { knex } = await createTenantKnex();
  await withTransaction(knex, (trx: Knex.Transaction) => requireSettingsUpdate(user, trx));

  if (!settings || typeof settings !== 'object') {
    throw new Error('Notification settings update must be an object');
  }

  const unknownKeys = Object.keys(settings).filter(
    (key) => !(UPDATABLE_NOTIFICATION_SETTINGS as readonly string[]).includes(key)
  );
  if (unknownKeys.length > 0) {
    throw new Error(`Notification settings cannot update: ${unknownKeys.join(', ')}`);
  }

  const update: NotificationSettingsUpdate = {};
  for (const key of UPDATABLE_NOTIFICATION_SETTINGS) {
    const value = settings[key];
    if (value === undefined) continue;
    if (typeof value !== 'boolean') {
      throw new Error(`${key} must be a boolean`);
    }
    update[key] = value;
  }
  if (Object.keys(update).length === 0) {
    throw new Error('Notification settings update has no changes');
  }

  const notificationService = getEmailNotificationService();
  // Creates the tenant row on first use so the update below always lands.
  await notificationService.getSettings(tenant);
  const updated = await notificationService.updateSettings(tenant, update);
  revalidatePath("/msp/settings/notifications");
  // Ticket screens receive the default from the MSP layout.
  revalidatePath("/msp", "layout");
  return updated;
});

/**
 * The tenant's "Don't notify the customer" default for ticket screens. Any
 * signed-in internal user may read it: agents need the policy, not settings
 * access.
 */
export const getDontNotifyCustomerDefaultAction = withAuth(async (
  user,
  { tenant }
): Promise<boolean> => {
  if (user.user_type !== 'internal') {
    return false;
  }
  const { knex } = await createTenantKnex();
  return readDontNotifyCustomerDefault(knex, tenant);
});

export const getTemplatesAction = withAuth(async (
  user,
  { tenant },
): Promise<{
  systemTemplates: (SystemEmailTemplate & { category: string })[];
  tenantTemplates: TenantEmailTemplate[];
}> => {
  const { knex } = await createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    await requireSettingsRead(user, trx);
    const db = tenantDb(trx, tenant);
    let systemTemplatesQuery = tenantScopedTable(trx, "system_email_templates as t", tenant)
      .select(
        "t.*",
        "c.name as category"
      );
    systemTemplatesQuery = db.tenantJoin(systemTemplatesQuery, "notification_subtypes as s", "t.notification_subtype_id", "s.id");
    systemTemplatesQuery = db.tenantJoin(systemTemplatesQuery, "notification_categories as c", "s.category_id", "c.id");
    const systemTemplates = await systemTemplatesQuery.orderBy(["c.name", "t.name"]);
      
    const tenantTemplates = await tenantScopedTable(trx, "tenant_email_templates", tenant)
      .orderBy("name");
      
    return { systemTemplates, tenantTemplates };
  });
});

export const createTenantTemplateAction = withAuth(async (
  user,
  { tenant },
  template: Omit<TenantEmailTemplate, "id" | "created_at" | "updated_at">
): Promise<TenantEmailTemplate> => {
  const { knex } = await createTenantKnex();
  await withTransaction(knex, (trx: Knex.Transaction) => requireSettingsUpdate(user, trx));

  const notificationService = getEmailNotificationService();
  const created = await notificationService.createTenantTemplate(tenant, template);
  revalidatePath("/msp/settings/notifications");
  return created;
});

export const cloneSystemTemplateAction = withAuth(async (
  user,
  { tenant },
  systemTemplateId: number
): Promise<TenantEmailTemplate | NotificationActionError> => {
  const { knex } = await createTenantKnex();

  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      await requireSettingsUpdate(user, trx);

      // Get the system template
      const systemTemplate = await tenantScopedTable(trx, "system_email_templates", tenant)
        .where({ id: systemTemplateId })
        .first();

      if (!systemTemplate) {
        throw new Error("System template not found");
      }

      // Create new tenant template based on system template
      const template: Omit<TenantEmailTemplate, "id" | "created_at" | "updated_at"> = {
        tenant,
        name: systemTemplate.name,
        subject: systemTemplate.subject,
        html_content: systemTemplate.html_content,
        text_content: systemTemplate.text_content,
        language_code: systemTemplate.language_code,
        system_template_id: systemTemplateId
      };

      const notificationService = getEmailNotificationService();
      const created = await notificationService.createTenantTemplate(tenant, template);
      revalidatePath("/msp/settings/notifications");
      return created;
    });
  } catch (error) {
    const expected = notificationActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export const updateTenantTemplateAction = withAuth(async (
  user,
  { tenant },
  id: number,
  template: Partial<TenantEmailTemplate>
): Promise<TenantEmailTemplate> => {
  const { knex } = await createTenantKnex();
  await withTransaction(knex, (trx: Knex.Transaction) => requireSettingsUpdate(user, trx));

  const notificationService = getEmailNotificationService();
  const updated = await notificationService.updateTenantTemplate(tenant, id, template);
  revalidatePath("/msp/settings/notifications");
  return updated;
});

export const deactivateTenantTemplateAction = withAuth(async (
  user,
  { tenant },
  name: string
): Promise<void> => {
  const { knex } = await createTenantKnex();

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    await requireSettingsUpdate(user, trx);
    await tenantScopedTable(trx, "tenant_email_templates", tenant)
      .where({ name })
      .del();
  });

  revalidatePath("/msp/settings/notifications");
});

export const getCategoriesAction = withAuth(async (_user, { tenant }): Promise<NotificationCategory[]> => {
  const { knex } = await createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    const db = tenantDb(trx, tenant);
    const query = db.table('notification_categories as nc') as Knex.QueryBuilder<any, any>;
    db.tenantJoin(query, 'tenant_notification_category_settings as tcs', 'tcs.category_id', 'nc.id', {
      type: 'left',
      tenantPredicate: 'literal',
    });

    const categories = await query
      .select(
        'nc.id',
        'nc.name',
        'nc.description',
        'nc.created_at',
        'nc.updated_at',
        trx.raw('COALESCE(tcs.is_enabled, true) as is_enabled'),
        trx.raw('COALESCE(tcs.is_default_enabled, true) as is_default_enabled')
      )
      .orderBy('nc.name');

    // Add is_locked flag based on category name
    return categories.map((cat: NotificationCategory) => ({
      ...cat,
      is_locked: isLockedCategory(cat.name)
    }));
  });
});

export const getCategoryWithSubtypesAction = withAuth(async (
  _user,
  { tenant },
  categoryId: number
): Promise<(NotificationCategory & { subtypes: NotificationSubtype[] }) | NotificationActionError> => {
  const { knex } = await createTenantKnex();

  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const db = tenantDb(trx, tenant);
      const categoryQuery = db.table('notification_categories as nc') as Knex.QueryBuilder<any, any>;
      db.tenantJoin(categoryQuery, 'tenant_notification_category_settings as tcs', 'tcs.category_id', 'nc.id', {
        type: 'left',
        tenantPredicate: 'literal',
      });

      const category = await categoryQuery
        .select(
          'nc.id',
          'nc.name',
          'nc.description',
          'nc.created_at',
          'nc.updated_at',
          trx.raw('COALESCE(tcs.is_enabled, true) as is_enabled'),
          trx.raw('COALESCE(tcs.is_default_enabled, true) as is_default_enabled')
        )
        .where('nc.id', categoryId)
        .first();

      if (!category) {
        throw new Error("Category not found");
      }

      const subtypesQuery = db.table('notification_subtypes as ns') as Knex.QueryBuilder<any, any>;
      db.tenantJoin(subtypesQuery, 'tenant_notification_subtype_settings as tss', 'tss.subtype_id', 'ns.id', {
        type: 'left',
        tenantPredicate: 'literal',
      });

      const subtypes = await subtypesQuery
        .select(
          'ns.id',
          'ns.category_id',
          'ns.name',
          'ns.description',
          'ns.created_at',
          'ns.updated_at',
          trx.raw('COALESCE(tss.is_enabled, true) as is_enabled'),
          trx.raw('COALESCE(tss.is_default_enabled, true) as is_default_enabled')
        )
        .where('ns.category_id', categoryId)
        .orderBy('ns.name');

      return { ...category, subtypes };
    });
  } catch (error) {
    const expected = notificationActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export const updateCategoryAction = withAuth(async (
  currentUser,
  { tenant },
  id: number,
  category: Partial<NotificationCategory>
): Promise<NotificationCategory | NotificationActionError> => {
  const { hasPermission } = await import('@alga-psa/auth');
  const { knex } = await createTenantKnex();

  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
    const db = tenantDb(trx, tenant);

    // Check permission within transaction context
    const hasUpdatePermission = await hasPermission(currentUser, 'settings', 'update', trx);
    if (!hasUpdatePermission) {
      throw new Error('Permission denied: Cannot update settings');
    }

    // Verify the category exists
    const exists = await tenantScopedTable(trx, "notification_categories", tenant)
      .where({ id })
      .first();

    if (!exists) {
      throw new Error("Category not found");
    }

    // Check if category is locked and prevent disabling
    if (isLockedCategory(exists.name)) {
      // Locked categories cannot be disabled
      if (category.is_enabled === false) {
        throw new Error(`Cannot disable '${exists.name}' category: This category contains system-critical notifications that must always be sent.`);
      }
    }

    // Get existing tenant settings (if any) to preserve values not being updated
    const existingSettings = await tenantScopedTable(trx, 'tenant_notification_category_settings', tenant)
      .where({ category_id: id })
      .first();

    // Build update object with only defined values, defaulting to existing or true
    const is_enabled = category.is_enabled ?? existingSettings?.is_enabled ?? true;
    const is_default_enabled = category.is_default_enabled ?? existingSettings?.is_default_enabled ?? true;
    // Compute timestamp before query - CitusDB requires IMMUTABLE values in ON CONFLICT UPDATE
    const now = new Date();

    // Upsert into tenant-specific settings table
    await db.table('tenant_notification_category_settings')
      .insert({
        tenant,
        category_id: id,
        is_enabled,
        is_default_enabled
      })
      .onConflict(['tenant', 'category_id'])
      .merge({
        is_enabled,
        is_default_enabled,
        updated_at: now
      });

    // Return the updated category with tenant-specific settings
    const updatedQuery = db.table('notification_categories as nc') as Knex.QueryBuilder<any, any>;
    db.tenantJoin(updatedQuery, 'tenant_notification_category_settings as tcs', 'tcs.category_id', 'nc.id', {
      type: 'left',
      tenantPredicate: 'literal',
    });

    const updated = await updatedQuery
      .select(
        'nc.id',
        'nc.name',
        'nc.description',
        'nc.created_at',
        'nc.updated_at',
        trx.raw('COALESCE(tcs.is_enabled, true) as is_enabled'),
        trx.raw('COALESCE(tcs.is_default_enabled, true) as is_default_enabled')
      )
      .where('nc.id', id)
      .first();

    if (!updated) {
      throw new Error("Category not found");
    }

    revalidatePath("/msp/settings/notifications");
      return updated;
    });
  } catch (error) {
    const expected = notificationActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export const updateSubtypeAction = withAuth(async (
  currentUser,
  { tenant },
  id: number,
  subtype: Partial<NotificationSubtype>
): Promise<NotificationSubtype | NotificationActionError> => {
  const { hasPermission } = await import('@alga-psa/auth');
  const { knex } = await createTenantKnex();

  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
    const db = tenantDb(trx, tenant);

    // Check permission within transaction context
    const hasUpdatePermission = await hasPermission(currentUser, 'settings', 'update', trx);
    if (!hasUpdatePermission) {
      throw new Error('Permission denied: Cannot update settings');
    }

    // Verify the subtype exists
    const exists = await db.table("notification_subtypes")
      .where({ id })
      .first();

    if (!exists) {
      throw new Error("Subtype not found");
    }

    // Get existing tenant settings (if any) to preserve values not being updated
    const existingSettings = await tenantScopedTable(trx, 'tenant_notification_subtype_settings', tenant)
      .where({ subtype_id: id })
      .first();

    // Build update object with only defined values, defaulting to existing or true
    const is_enabled = subtype.is_enabled ?? existingSettings?.is_enabled ?? true;
    const is_default_enabled = subtype.is_default_enabled ?? existingSettings?.is_default_enabled ?? true;
    // Compute timestamp before query - CitusDB requires IMMUTABLE values in ON CONFLICT UPDATE
    const now = new Date();

    // Upsert into tenant-specific settings table
    await db.table('tenant_notification_subtype_settings')
      .insert({
        tenant,
        subtype_id: id,
        is_enabled,
        is_default_enabled
      })
      .onConflict(['tenant', 'subtype_id'])
      .merge({
        is_enabled,
        is_default_enabled,
        updated_at: now
      });

    // Return the updated subtype with tenant-specific settings
    const updatedQuery = db.table('notification_subtypes as ns') as Knex.QueryBuilder<any, any>;
    db.tenantJoin(updatedQuery, 'tenant_notification_subtype_settings as tss', 'tss.subtype_id', 'ns.id', {
      type: 'left',
      tenantPredicate: 'literal',
    });

    const updated = await updatedQuery
      .select(
        'ns.id',
        'ns.category_id',
        'ns.name',
        'ns.description',
        'ns.created_at',
        'ns.updated_at',
        trx.raw('COALESCE(tss.is_enabled, true) as is_enabled'),
        trx.raw('COALESCE(tss.is_default_enabled, true) as is_default_enabled')
      )
      .where('ns.id', id)
      .first();

    if (!updated) {
      throw new Error("Subtype not found");
    }

    revalidatePath("/msp/settings/notifications");
      return updated;
    });
  } catch (error) {
    const expected = notificationActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

/**
 * Send a test email using the specified template to the current user's email address.
 * The subject is prefixed with "[TEST] " to distinguish from real emails.
 */
export const sendTestEmailAction = withAuth(async (
  user,
  { tenant },
  templateId: number,
  templateType: 'system' | 'tenant',
  overrideContent?: {
    subject?: string;
    html_content?: string;
    text_content?: string;
  }
): Promise<{ success: boolean; error?: string; sentTo?: string }> => {
  const { knex } = await createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    // 1. Get the user's email from the database
    const userRecord = await tenantScopedTable(trx, 'users', tenant)
      .where({ user_id: user.user_id })
      .select('email')
      .first();

    if (!userRecord?.email) {
      return { success: false, error: 'No email address found for your account.' };
    }

    // 2. Validate that email settings are configured
    const { TenantEmailService: TenantEmailSvc } = await import('@alga-psa/email');
    const validation = await TenantEmailSvc.validateEmailSettings(tenant);
    if (!validation.valid) {
      return { success: false, error: validation.error || 'Email settings are not configured.' };
    }

    // 3. Load the template
    const template = templateType === 'system'
      ? await tenantScopedTable(trx, 'system_email_templates', tenant).where({ id: templateId }).first()
      : await tenantScopedTable(trx, 'tenant_email_templates', tenant).where({ id: templateId }).first();
    if (!template) {
      return { success: false, error: 'Template not found.' };
    }

    // 4. Use override content if provided (for previewing unsaved edits)
    const subject = overrideContent?.subject ?? template.subject;
    const htmlContent = overrideContent?.html_content ?? template.html_content;
    const textContent = overrideContent?.text_content ?? template.text_content;

    // 5. Get sample data and substitute variables
    const { getSampleDataForPreview } = await import('../../lib/templateSampleData');
    const sampleData = getSampleDataForPreview(template.name, htmlContent, subject);

    const { StaticTemplateProcessor } = await import('@alga-psa/email');
    const renderedSubject = `[TEST] ${replaceVars(subject, sampleData)}`;
    const renderedHtml = replaceVars(htmlContent, sampleData);
    const renderedText = replaceVars(textContent, sampleData);

    const templateProcessor = new StaticTemplateProcessor(renderedSubject, renderedHtml, renderedText);

    // 6. Send the test email
    const service = TenantEmailSvc.getInstance(tenant);
    const result = await service.sendEmail({
      mailClass: 'general',
      to: userRecord.email,
      templateProcessor,
      tenantId: tenant,
    });

    if (!result.success) {
      return { success: false, error: result.error || 'Failed to send test email.' };
    }

    return { success: true, sentTo: userRecord.email };
  });
});

/**
 * Simple variable replacement for test email rendering.
 * Handles {{#if condition}}...{{/if}} blocks and {{variable}} placeholders.
 */
function replaceVars(content: string, data: Record<string, string>): string {
  // Process {{#if condition}}...{{/if}} blocks first — show content when sample data exists
  let result = content.replace(
    /\{\{#if\s+([^}]+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_match, condition, blockContent) => {
      const key = condition.trim();
      return key in data ? blockContent : '';
    }
  );

  // Then replace simple {{variable}} placeholders
  result = result.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const trimmedKey = key.trim();
    return trimmedKey in data ? data[trimmedKey] : match;
  });

  return result;
}

/** Compatibility entry points reject caller identities that differ from the session. */
export const getUserPreferencesAction = withAuth(async (
  currentUser, { tenant }, callerTenant?: string, callerUserId?: string,
): Promise<UserNotificationPreference[]> => {
  assertPersonalIdentity(tenant, currentUser.user_id, callerTenant, callerUserId);
  return getEmailNotificationService().getUserPreferences(tenant, currentUser.user_id);
});

function assertPersonalIdentity(tenant: string, userId: string, callerTenant?: string, callerUserId?: string) {
  if ((callerTenant !== undefined && callerTenant !== tenant) || (callerUserId !== undefined && callerUserId !== userId)) {
    throw new Error('Cannot access another user or tenant notification preferences');
  }
}

export const updateUserPreferenceAction = withAuth(async (
  currentUser, { tenant }, callerTenant: string, callerUserId: string,
  preference: Partial<UserNotificationPreference> & { tenant?: string },
): Promise<UserNotificationPreference> => {
  assertPersonalIdentity(tenant, currentUser.user_id, callerTenant, callerUserId);
  assertPersonalIdentity(tenant, currentUser.user_id, preference.tenant, preference.user_id);
  const { knex } = await createTenantKnex();
  const { preferences } = await saveUserEmailPreferences(knex, tenant, currentUser.user_id, {
    kind: 'subtype', id: preference.subtype_id!, enabled: preference.is_enabled!,
  });
  revalidatePersonalPreferences();
  // Preserve the legacy response contract for callers outside the profile UI.
  return preferences[0];
});

export const getUserEmailPreferenceStateAction = withAuth(async (
  currentUser, { tenant },
): Promise<UserEmailPreferenceCategoryState[]> => {
  const { knex } = await createTenantKnex();
  return withTransaction(knex, trx => readUserEmailPreferenceState(trx, tenant, currentUser.user_id));
});

function revalidatePersonalPreferences() {
  revalidatePath('/msp/profile');
  revalidatePath('/client-portal/profile');
}

async function savePersonalPreferences(
  tenant: string, userId: string, kind: 'category' | 'subtype', id: number, enabled: boolean,
): Promise<UserEmailPreferenceCategoryState[] | NotificationActionError> {
  try {
    const { knex } = await createTenantKnex();
    const { state } = await saveUserEmailPreferences(knex, tenant, userId, { kind, id, enabled });
    // Invalidation only happens after commit. Failure is reconciled by the UI read.
    revalidatePersonalPreferences();
    return state;
  } catch (error) {
    const expected = notificationActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
}

export const updateUserEmailSubtypePreferenceAction = withAuth(async (
  currentUser, { tenant }, subtypeId: number, isEnabled: boolean,
) => savePersonalPreferences(tenant, currentUser.user_id, 'subtype', subtypeId, isEnabled));

export const updateUserEmailCategoryPreferencesAction = withAuth(async (
  currentUser, { tenant }, categoryId: number, isEnabled: boolean,
) => savePersonalPreferences(tenant, currentUser.user_id, 'category', categoryId, isEnabled));
