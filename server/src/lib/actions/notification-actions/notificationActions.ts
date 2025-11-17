"use server"

import { getEmailNotificationService } from "../../notifications/email";
import { revalidatePath } from "next/cache";
import { withTransaction } from '@shared/db';
import { Knex } from 'knex';
import { 
  NotificationSettings,
  SystemEmailTemplate,
  TenantEmailTemplate,
  NotificationCategory,
  NotificationSubtype,
  UserNotificationPreference
} from "../../models/notification";

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
  const { knex } = await (await import("../../db")).createTenantKnex();
  
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
  const { knex } = await (await import("../../db")).createTenantKnex();
  
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
  const { knex } = await (await import("../../db")).createTenantKnex();
  
  await withTransaction(knex, async (trx: Knex.Transaction) => {
    await trx("tenant_email_templates")
      .where({ tenant, name })
      .del();
  });
    
  revalidatePath("/msp/settings/notifications");
}

export async function getCategoriesAction(): Promise<NotificationCategory[]> {
  const { knex } = await (await import("../../db")).createTenantKnex();
  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx("notification_categories")
      .orderBy("name");
  });
}

export async function getCategoryWithSubtypesAction(
  categoryId: number
): Promise<NotificationCategory & { subtypes: NotificationSubtype[] }> {
  const { knex } = await (await import("../../db")).createTenantKnex();
  
  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    const category = await trx("notification_categories")
      .where({ id: categoryId })
      .first();
      
    if (!category) {
      throw new Error("Category not found");
    }
    
    const subtypes = await trx("notification_subtypes")
      .where({ category_id: categoryId })
      .orderBy("name");
      
    return { ...category, subtypes };
  });
}

export async function updateCategoryAction(
  id: number,
  category: Partial<NotificationCategory>
): Promise<NotificationCategory> {
  // Check permissions - requires 'settings' 'update' permission
  const { getCurrentUser } = await import('../user-actions/userActions');
  const { hasPermission } = await import('server/src/lib/auth/rbac');
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('User not authenticated');
  }

  const { knex } = await (await import("../../db")).createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Check permission within transaction context
    const hasUpdatePermission = await hasPermission(currentUser, 'settings', 'update', trx);
    if (!hasUpdatePermission) {
      throw new Error('Permission denied: Cannot update settings');
    }

    const [updated] = await trx("notification_categories")
      .where({ id })
      .update(category)
      .returning("*");

    if (!updated) {
      throw new Error("Category not found");
    }

    revalidatePath("/msp/settings/notifications");
    return updated;
  });
}

export async function updateSubtypeAction(
  id: number,
  subtype: Partial<NotificationSubtype>
): Promise<NotificationSubtype> {
  // Check permissions - requires 'settings' 'update' permission
  const { getCurrentUser } = await import('../user-actions/userActions');
  const { hasPermission } = await import('server/src/lib/auth/rbac');
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('User not authenticated');
  }

  const { knex } = await (await import("../../db")).createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Check permission within transaction context
    const hasUpdatePermission = await hasPermission(currentUser, 'settings', 'update', trx);
    if (!hasUpdatePermission) {
      throw new Error('Permission denied: Cannot update settings');
    }

    const [updated] = await trx("notification_subtypes")
      .where({ id })
      .update(subtype)
      .returning("*");

    if (!updated) {
      throw new Error("Subtype not found");
    }

    revalidatePath("/msp/settings/notifications");
    return updated;
  });
}

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
