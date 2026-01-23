"use server"

import { getEmailNotificationService } from "../../notifications/email";
import { revalidatePath } from "next/cache";
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth';
import {
  NotificationSettings,
  SystemEmailTemplate,
  TenantEmailTemplate,
  NotificationCategory,
  NotificationSubtype,
  UserNotificationPreference,
  isLockedCategory
} from "../../types/notification";

export async function getNotificationSettingsAction(tenant: string): Promise<NotificationSettings> {
  const notificationService = getEmailNotificationService();
  return notificationService.getSettings(tenant);
}

export async function updateNotificationSettingsAction(
  tenant: string, 
  settings: Partial<NotificationSettings>
): Promise<NotificationSettings> {
  const notificationService = getEmailNotificationService();
  const updated = await notificationService.updateSettings(tenant, settings);
  revalidatePath("/msp/settings/notifications");
  return updated;
}

export async function getTemplatesAction(tenant: string): Promise<{
  systemTemplates: (SystemEmailTemplate & { category: string })[];
  tenantTemplates: TenantEmailTemplate[];
}> {
  const { knex } = await (await import("@alga-psa/db")).createTenantKnex();
  
  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    const systemTemplates = await trx("system_email_templates as t")
      .select(
        "t.*",
        "c.name as category"
      )
      .join("notification_subtypes as s", "t.notification_subtype_id", "s.id")
      .join("notification_categories as c", "s.category_id", "c.id")
      .orderBy(["c.name", "t.name"]);
      
    const tenantTemplates = await trx("tenant_email_templates")
      .where({ tenant })
      .orderBy("name");
      
    return { systemTemplates, tenantTemplates };
  });
}

export async function createTenantTemplateAction(
  tenant: string,
  template: Omit<TenantEmailTemplate, "id" | "created_at" | "updated_at">
): Promise<TenantEmailTemplate> {
  const notificationService = getEmailNotificationService();
  const created = await notificationService.createTenantTemplate(tenant, template);
  revalidatePath("/msp/settings/notifications");
  return created;
}

export async function cloneSystemTemplateAction(
  tenant: string,
  systemTemplateId: number
): Promise<TenantEmailTemplate> {
  const { knex } = await (await import("@alga-psa/db")).createTenantKnex();
  
  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Get the system template
    const systemTemplate = await trx("system_email_templates")
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
}

export async function updateTenantTemplateAction(
  tenant: string,
  id: number,
  template: Partial<TenantEmailTemplate>
): Promise<TenantEmailTemplate> {
  const notificationService = getEmailNotificationService();
  const updated = await notificationService.updateTenantTemplate(tenant, id, template);
  revalidatePath("/msp/settings/notifications");
  return updated;
}

export async function deactivateTenantTemplateAction(
  tenant: string,
  name: string
): Promise<void> {
  const { knex } = await (await import("@alga-psa/db")).createTenantKnex();
  
  await withTransaction(knex, async (trx: Knex.Transaction) => {
    await trx("tenant_email_templates")
      .where({ tenant, name })
      .del();
  });
    
  revalidatePath("/msp/settings/notifications");
}

export const getCategoriesAction = withAuth(async (_user, { tenant }): Promise<NotificationCategory[]> => {
  const { knex } = await createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    const categories = await trx('notification_categories as nc')
      .leftJoin('tenant_notification_category_settings as tcs', function() {
        this.on('tcs.category_id', 'nc.id')
            .andOn('tcs.tenant', trx.raw('?', [tenant]));
      })
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
    return categories.map(cat => ({
      ...cat,
      is_locked: isLockedCategory(cat.name)
    }));
  });
});

export const getCategoryWithSubtypesAction = withAuth(async (
  _user,
  { tenant },
  categoryId: number
): Promise<NotificationCategory & { subtypes: NotificationSubtype[] }> => {
  const { knex } = await createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    const category = await trx('notification_categories as nc')
      .leftJoin('tenant_notification_category_settings as tcs', function() {
        this.on('tcs.category_id', 'nc.id')
            .andOn('tcs.tenant', trx.raw('?', [tenant]));
      })
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

    const subtypes = await trx('notification_subtypes as ns')
      .leftJoin('tenant_notification_subtype_settings as tss', function() {
        this.on('tss.subtype_id', 'ns.id')
            .andOn('tss.tenant', trx.raw('?', [tenant]));
      })
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
});

export const updateCategoryAction = withAuth(async (
  currentUser,
  { tenant },
  id: number,
  category: Partial<NotificationCategory>
): Promise<NotificationCategory> => {
  const { hasPermission } = await import('@alga-psa/auth');
  const { knex } = await createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Check permission within transaction context
    const hasUpdatePermission = await hasPermission(currentUser, 'settings', 'update', trx);
    if (!hasUpdatePermission) {
      throw new Error('Permission denied: Cannot update settings');
    }

    // Verify the category exists
    const exists = await trx("notification_categories")
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
    const existingSettings = await trx('tenant_notification_category_settings')
      .where({ tenant, category_id: id })
      .first();

    // Build update object with only defined values, defaulting to existing or true
    const is_enabled = category.is_enabled ?? existingSettings?.is_enabled ?? true;
    const is_default_enabled = category.is_default_enabled ?? existingSettings?.is_default_enabled ?? true;
    // Compute timestamp before query - CitusDB requires IMMUTABLE values in ON CONFLICT UPDATE
    const now = new Date();

    // Upsert into tenant-specific settings table
    await trx('tenant_notification_category_settings')
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
    const updated = await trx('notification_categories as nc')
      .leftJoin('tenant_notification_category_settings as tcs', function() {
        this.on('tcs.category_id', 'nc.id')
            .andOn('tcs.tenant', trx.raw('?', [tenant]));
      })
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
});

export const updateSubtypeAction = withAuth(async (
  currentUser,
  { tenant },
  id: number,
  subtype: Partial<NotificationSubtype>
): Promise<NotificationSubtype> => {
  const { hasPermission } = await import('@alga-psa/auth');
  const { knex } = await createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Check permission within transaction context
    const hasUpdatePermission = await hasPermission(currentUser, 'settings', 'update', trx);
    if (!hasUpdatePermission) {
      throw new Error('Permission denied: Cannot update settings');
    }

    // Verify the subtype exists
    const exists = await trx("notification_subtypes")
      .where({ id })
      .first();

    if (!exists) {
      throw new Error("Subtype not found");
    }

    // Get existing tenant settings (if any) to preserve values not being updated
    const existingSettings = await trx('tenant_notification_subtype_settings')
      .where({ tenant, subtype_id: id })
      .first();

    // Build update object with only defined values, defaulting to existing or true
    const is_enabled = subtype.is_enabled ?? existingSettings?.is_enabled ?? true;
    const is_default_enabled = subtype.is_default_enabled ?? existingSettings?.is_default_enabled ?? true;
    // Compute timestamp before query - CitusDB requires IMMUTABLE values in ON CONFLICT UPDATE
    const now = new Date();

    // Upsert into tenant-specific settings table
    await trx('tenant_notification_subtype_settings')
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
    const updated = await trx('notification_subtypes as ns')
      .leftJoin('tenant_notification_subtype_settings as tss', function() {
        this.on('tss.subtype_id', 'ns.id')
            .andOn('tss.tenant', trx.raw('?', [tenant]));
      })
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
});

export async function getUserPreferencesAction(
  tenant: string,
  userId: string
): Promise<UserNotificationPreference[]> {
  const notificationService = getEmailNotificationService();
  return notificationService.getUserPreferences(tenant, userId);
}

export async function updateUserPreferenceAction(
  tenant: string,
  userId: string,
  preference: Partial<UserNotificationPreference>
): Promise<UserNotificationPreference> {
  const notificationService = getEmailNotificationService();
  const updated = await notificationService.updateUserPreference(tenant, userId, preference);
  revalidatePath("/msp/settings/notifications");
  return updated;
}
