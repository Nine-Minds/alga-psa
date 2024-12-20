import { createTenantKnex } from '../db';
import { 
  NotificationSettings,
  SystemEmailTemplate,
  TenantEmailTemplate,
  NotificationCategory,
  NotificationSubtype,
  UserNotificationPreference,
  NotificationLog,
  NotificationService
} from '../models/notification';
import { emailService } from './emailService';
import Handlebars from 'handlebars';

export class EmailNotificationService implements NotificationService {
  private async getTenantKnex() {
    const { knex } = await createTenantKnex();
    return knex;
  }

  // Global settings
  async getSettings(tenant: string): Promise<NotificationSettings> {
    const knex = await this.getTenantKnex();
    const settings = await knex('notification_settings')
      .where({ tenant })
      .first();
    
    if (!settings) {
      // Create default settings if none exist
      return knex('notification_settings')
        .insert({
          tenant,
          is_enabled: true,
          rate_limit_per_minute: 60
        })
        .returning('*')
        .then(rows => rows[0]);
    }
    
    return settings;
  }

  async updateSettings(tenant: string, settings: Partial<NotificationSettings>): Promise<NotificationSettings> {
    const knex = await this.getTenantKnex();
    const [updated] = await knex('notification_settings')
      .where({ tenant })
      .update(settings)
      .returning('*');
    return updated;
  }

  // Template management
  async getSystemTemplate(name: string): Promise<SystemEmailTemplate> {
    const knex = await this.getTenantKnex();
    const template = await knex('system_email_templates')
      .where({ name, is_active: true })
      .orderBy('version', 'desc')
      .first();
    
    if (!template) {
      throw new Error(`System template '${name}' not found`);
    }
    
    return template;
  }

  async getTenantTemplate(tenant: string, name: string): Promise<TenantEmailTemplate | null> {
    const knex = await this.getTenantKnex();
    return knex('tenant_email_templates')
      .where({ tenant, name, is_active: true })
      .orderBy('version', 'desc')
      .first();
  }

  async createTenantTemplate(
    tenant: string, 
    template: Omit<TenantEmailTemplate, 'id' | 'created_at' | 'updated_at'>
  ): Promise<TenantEmailTemplate> {
    const knex = await this.getTenantKnex();
    
    // Get latest version
    const latest = await knex('tenant_email_templates')
      .where({ tenant, name: template.name })
      .orderBy('version', 'desc')
      .first();
    
    const version = latest ? latest.version + 1 : 1;
    
    // Deactivate previous versions
    if (latest) {
      await knex('tenant_email_templates')
        .where({ tenant, name: template.name })
        .update({ is_active: false });
    }
    
    // If system_template_id is not provided, try to find matching system template
    if (!template.system_template_id) {
      const systemTemplate = await knex('system_email_templates')
        .where({ name: template.name, is_active: true })
        .first();
      
      if (systemTemplate) {
        template.system_template_id = systemTemplate.id;
      }
    }
    
    const [created] = await knex('tenant_email_templates')
      .insert({
        ...template,
        tenant,
        version,
        is_active: true
      })
      .returning('*');
    
    return created;
  }

  async updateTenantTemplate(
    tenant: string,
    id: number,
    template: Partial<TenantEmailTemplate>
  ): Promise<TenantEmailTemplate> {
    const knex = await this.getTenantKnex();
    const [updated] = await knex('tenant_email_templates')
      .where({ tenant, id })
      .update(template)
      .returning('*');
    return updated;
  }

  async getEffectiveTemplate(tenant: string, name: string): Promise<SystemEmailTemplate | TenantEmailTemplate> {
    // First try to get tenant-specific template
    const tenantTemplate = await this.getTenantTemplate(tenant, name);
    if (tenantTemplate) {
      return tenantTemplate;
    }
    
    // Fall back to system template
    return this.getSystemTemplate(name);
  }

  // Category management
  async getCategories(tenant: string): Promise<NotificationCategory[]> {
    const knex = await this.getTenantKnex();
    return knex('notification_categories')
      .where({ tenant })
      .orderBy('name');
  }

  async getCategoryWithSubtypes(
    tenant: string,
    categoryId: number
  ): Promise<NotificationCategory & { subtypes: NotificationSubtype[] }> {
    const knex = await this.getTenantKnex();
    
    const category = await knex('notification_categories')
      .where({ tenant, id: categoryId })
      .first();
      
    if (!category) {
      throw new Error('Category not found');
    }
    
    const subtypes = await knex('notification_subtypes')
      .where({ category_id: categoryId })
      .orderBy('name');
      
    return {
      ...category,
      subtypes
    };
  }

  async updateCategory(
    tenant: string,
    id: number,
    category: Partial<NotificationCategory>
  ): Promise<NotificationCategory> {
    const knex = await this.getTenantKnex();
    const [updated] = await knex('notification_categories')
      .where({ tenant, id })
      .update(category)
      .returning('*');
    return updated;
  }

  // User preferences
  async getUserPreferences(tenant: string, userId: number): Promise<UserNotificationPreference[]> {
    const knex = await this.getTenantKnex();
    return knex('user_notification_preferences')
      .where({ user_id: userId })
      .orderBy('id');
  }

  async updateUserPreference(
    tenant: string,
    userId: number,
    preference: Partial<UserNotificationPreference>
  ): Promise<UserNotificationPreference> {
    const knex = await this.getTenantKnex();
    const [updated] = await knex('user_notification_preferences')
      .where({
        user_id: userId,
        subtype_id: preference.subtype_id
      })
      .update(preference)
      .returning('*');
    return updated;
  }

  // Notification sending
  async sendNotification(params: {
    tenant: string;
    userId: number;
    subtypeId: number;
    emailAddress: string;
    templateName: string;
    data: Record<string, any>;
  }): Promise<void> {
    const knex = await this.getTenantKnex();
    
    // Check global settings
    const settings = await this.getSettings(params.tenant);
    if (!settings.is_enabled) {
      throw new Error('Notifications are disabled for this tenant');
    }
    
    // Check rate limit
    const recentCount = await knex('notification_logs')
      .where({
        tenant: params.tenant,
        user_id: params.userId
      })
      .where('created_at', '>', new Date(Date.now() - 60000))
      .count('id as count')
      .first();
      
    if (Number(recentCount?.count) >= settings.rate_limit_per_minute) {
      throw new Error('Rate limit exceeded');
    }
    
    // Check user preferences
    const preference = await knex('user_notification_preferences')
      .where({
        user_id: params.userId,
        subtype_id: params.subtypeId
      })
      .first();
      
    if (preference && !preference.is_enabled) {
      return; // User has opted out
    }
    
    try {
      // Get the effective template and compile subject
      const template = await this.getEffectiveTemplate(params.tenant, params.templateName);
      const compiledSubject = Handlebars.compile(template.subject)(params.data);
      
      // Send email
      const success = await emailService.sendEmail({
        to: params.emailAddress,
        subject: compiledSubject,
        template: template.html_content,
        data: params.data
      });

      // Log result
      await knex('notification_logs').insert({
        tenant: params.tenant,
        user_id: params.userId,
        subtype_id: params.subtypeId,
        email_address: params.emailAddress,
        subject: compiledSubject,
        status: success ? 'sent' : 'failed',
        error_message: success ? null : 'Email service failed to send'
      });

      if (!success) {
        throw new Error('Failed to send email');
      }
      
    } catch (error) {
      // Log failure
      
      // Log failure with generic subject
      await knex('notification_logs').insert({
        tenant: params.tenant,
        user_id: params.userId,
        subtype_id: params.subtypeId,
        email_address: params.emailAddress,
        subject: 'Failed to send notification',
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Unknown error'
      });
      
      throw error;
    }
  }

  // Logging
  async getLogs(tenant: string, filters: {
    userId?: number;
    subtypeId?: number;
    status?: 'sent' | 'failed' | 'bounced';
    startDate?: string;
    endDate?: string;
  }): Promise<NotificationLog[]> {
    const knex = await this.getTenantKnex();
    
    const query = knex('notification_logs')
      .where({ tenant })
      .orderBy('created_at', 'desc');
      
    if (filters.userId) {
      query.where('user_id', filters.userId);
    }
    
    if (filters.subtypeId) {
      query.where('subtype_id', filters.subtypeId);
    }
    
    if (filters.status) {
      query.where('status', filters.status);
    }
    
    if (filters.startDate) {
      query.where('created_at', '>=', filters.startDate);
    }
    
    if (filters.endDate) {
      query.where('created_at', '<=', filters.endDate);
    }
    
    return query;
  }
}

// Export singleton instance
export const emailNotificationService = new EmailNotificationService();
