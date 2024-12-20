"use server"

import { emailNotificationService } from "../../notifications/email";
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
  return emailNotificationService.getSettings(tenant);
}

export async function updateNotificationSettingsAction(
  tenant: string, 
  settings: Partial<NotificationSettings>
): Promise<NotificationSettings> {
  const updated = await emailNotificationService.updateSettings(tenant, settings);
  revalidatePath("/msp/settings/notifications");
  return updated;
}

export async function getTemplatesAction(tenant: string): Promise<{
  systemTemplates: SystemEmailTemplate[];
  tenantTemplates: TenantEmailTemplate[];
}> {
  const { knex } = await (await import("../../db")).createTenantKnex();
  
  const systemTemplates = await knex("system_email_templates")
    .where({ is_active: true })
    .orderBy(["name", "version"]);
    
  const tenantTemplates = await knex("tenant_email_templates")
    .where({ tenant, is_active: true })
    .orderBy(["name", "version"]);
    
  return { systemTemplates, tenantTemplates };
}

export async function createTenantTemplateAction(
  tenant: string,
  template: Omit<TenantEmailTemplate, "id" | "created_at" | "updated_at">
): Promise<TenantEmailTemplate> {
  const created = await emailNotificationService.createTenantTemplate(tenant, template);
  revalidatePath("/msp/settings/notifications");
  return created;
}

export async function updateTenantTemplateAction(
  tenant: string,
  id: number,
  template: Partial<TenantEmailTemplate>
): Promise<TenantEmailTemplate> {
  const updated = await emailNotificationService.updateTenantTemplate(tenant, id, template);
  revalidatePath("/msp/settings/notifications");
  return updated;
}

export async function getCategoriesAction(tenant: string): Promise<NotificationCategory[]> {
  return emailNotificationService.getCategories(tenant);
}

export async function getCategoryWithSubtypesAction(
  tenant: string,
  categoryId: number
): Promise<NotificationCategory & { subtypes: NotificationSubtype[] }> {
  return emailNotificationService.getCategoryWithSubtypes(tenant, categoryId);
}

export async function updateCategoryAction(
  tenant: string,
  id: number,
  category: Partial<NotificationCategory>
): Promise<NotificationCategory> {
  const updated = await emailNotificationService.updateCategory(tenant, id, category);
  revalidatePath("/msp/settings/notifications");
  return updated;
}

export async function getUserPreferencesAction(
  tenant: string,
  userId: number
): Promise<UserNotificationPreference[]> {
  return emailNotificationService.getUserPreferences(tenant, userId);
}

export async function updateUserPreferenceAction(
  tenant: string,
  userId: number,
  preference: Partial<UserNotificationPreference>
): Promise<UserNotificationPreference> {
  const updated = await emailNotificationService.updateUserPreference(tenant, userId, preference);
  revalidatePath("/msp/settings/notifications");
  return updated;
}
