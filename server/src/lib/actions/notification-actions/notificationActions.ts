"use server"

import { getEmailNotificationService } from "../../notifications/email";
import { revalidatePath } from "next/cache";
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
  
  const systemTemplates = await knex("system_email_templates as t")
    .select(
      "t.*",
      "c.name as category"
    )
    .join("notification_subtypes as s", "t.notification_subtype_id", "s.id")
    .join("notification_categories as c", "s.category_id", "c.id")
    .orderBy(["c.name", "t.name"]);
    
  const tenantTemplates = await knex("tenant_email_templates")
    .where({ tenant })
    .orderBy("name");
    
  return { systemTemplates, tenantTemplates };
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
  
  // Get the system template
  const systemTemplate = await knex("system_email_templates")
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
    system_template_id: systemTemplateId
  };
  
  const notificationService = getEmailNotificationService();
  const created = await notificationService.createTenantTemplate(tenant, template);
  revalidatePath("/msp/settings/notifications");
  return created;
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
  
  await knex("tenant_email_templates")
    .where({ tenant, name })
    .del();
    
  revalidatePath("/msp/settings/notifications");
}

export async function getCategoriesAction(): Promise<NotificationCategory[]> {
  const { knex } = await (await import("../../db")).createTenantKnex();
  return knex("notification_categories")
    .orderBy("name");
}

export async function getCategoryWithSubtypesAction(
  categoryId: number
): Promise<NotificationCategory & { subtypes: NotificationSubtype[] }> {
  const { knex } = await (await import("../../db")).createTenantKnex();
  
  const category = await knex("notification_categories")
    .where({ id: categoryId })
    .first();
    
  if (!category) {
    throw new Error("Category not found");
  }
  
  const subtypes = await knex("notification_subtypes")
    .where({ category_id: categoryId })
    .orderBy("name");
    
  return { ...category, subtypes };
}

export async function updateCategoryAction(
  id: number,
  category: Partial<NotificationCategory>
): Promise<NotificationCategory> {
  const { knex } = await (await import("../../db")).createTenantKnex();
  
  const [updated] = await knex("notification_categories")
    .where({ id })
    .update(category)
    .returning("*");
    
  if (!updated) {
    throw new Error("Category not found");
  }
  
  revalidatePath("/msp/settings/notifications");
  return updated;
}

export async function updateSubtypeAction(
  id: number,
  subtype: Partial<NotificationSubtype>
): Promise<NotificationSubtype> {
  const { knex } = await (await import("../../db")).createTenantKnex();
  
  const [updated] = await knex("notification_subtypes")
    .where({ id })
    .update(subtype)
    .returning("*");
    
  if (!updated) {
    throw new Error("Subtype not found");
  }
  
  revalidatePath("/msp/settings/notifications");
  return updated;
}

export async function getUserPreferencesAction(
  tenant: string,
  userId: number
): Promise<UserNotificationPreference[]> {
  const notificationService = getEmailNotificationService();
  return notificationService.getUserPreferences(tenant, userId);
}

export async function updateUserPreferenceAction(
  tenant: string,
  userId: number,
  preference: Partial<UserNotificationPreference>
): Promise<UserNotificationPreference> {
  const notificationService = getEmailNotificationService();
  const updated = await notificationService.updateUserPreference(tenant, userId, preference);
  revalidatePath("/msp/settings/notifications");
  return updated;
}
