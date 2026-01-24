/**
 * Email Notification Service
 *
 * This service handles both system-wide and tenant-specific email notifications.
 *
 * Table Structure:
 * - System-wide tables (shared across all tenants):
 *   - system_email_templates: Base templates that can be customized per tenant
 *
 * - Tenant-specific tables (filtered by tenant):
 *   - notification_settings: Tenant-specific notification configuration
 *   - tenant_email_templates: Tenant customizations of system templates
 *   - notification_categories: Tenant-specific notification groupings
 *   - notification_subtypes: Tenant-specific notification types
 *   - user_notification_preferences: User preferences for each tenant
 *   - notification_logs: Record of notifications sent per tenant
 */

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
import { EmailProviderManager } from '@alga-psa/email';
import { TenantEmailSettings, EmailMessage } from '@alga-psa/types';
import { TenantEmailService } from '@alga-psa/email';
import { StaticTemplateProcessor } from '../email/tenant/templateProcessors';
import { getConnection } from '../db/db';
import { resolveEmailLocale } from './emailLocaleResolver';
import { SupportedLocale } from '@alga-psa/ui/lib/i18n/config';
export class EmailNotificationService implements NotificationService {
  /**
   * Get tenant email settings from database
   */
  private async getTenantEmailSettings(tenantId: string): Promise<TenantEmailSettings | null> {
    try {
      const knex = await getConnection(tenantId);
      const settings = await knex('tenant_email_settings')
        .where({ tenant_id: tenantId })
        .first();
      
      if (!settings) {
        console.warn(`No email settings found for tenant ${tenantId}`);
        return null;
      }
      
      return {
        tenantId,
        defaultFromDomain: settings.default_from_domain,
        ticketingFromEmail: settings.ticketing_from_email,
        customDomains: settings.custom_domains || [],
        emailProvider: settings.email_provider,
        providerConfigs: settings.provider_configs || [],
        trackingEnabled: settings.tracking_enabled,
        maxDailyEmails: settings.max_daily_emails,
        createdAt: settings.created_at,
        updatedAt: settings.updated_at
      };
    } catch (error) {
      console.error(`Error fetching tenant email settings:`, error);
      return null;
    }
  }

  private async compileTemplate(template: string, data: Record<string, any>): Promise<string> {
    // Dynamically import Handlebars only when needed
    const Handlebars = (await import('handlebars')).default;
    const compiledTemplate = Handlebars.compile(template);
    return compiledTemplate(data);
  }

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
      .where({ name })
      .first();
    
    if (!template) {
      throw new Error(`System template '${name}' not found`);
    }
    
    return template;
  }

  async getTenantTemplate(tenant: string, name: string, locale?: SupportedLocale): Promise<TenantEmailTemplate | null> {
    if (!tenant) {
      throw new Error('Tenant is required for tenant-specific templates');
    }

    const knex = await this.getTenantKnex();

    // If locale is specified, try to get language-specific template
    if (locale) {
      // Try requested language first
      let template = await knex('tenant_email_templates')
        .where({ tenant, name, language_code: locale })
        .first();

      if (template) return template;

      // Fallback to English if not found and not already English
      if (locale !== 'en') {
        template = await knex('tenant_email_templates')
          .where({ tenant, name, language_code: 'en' })
          .first();

        if (template) return template;
      }
    }

    // Fallback to template without language code (legacy)
    return knex('tenant_email_templates')
      .where({ tenant, name })
      .whereNull('language_code')
      .first();
  }

  async createTenantTemplate(
    tenant: string, 
    template: Omit<TenantEmailTemplate, 'id' | 'created_at' | 'updated_at'>
  ): Promise<TenantEmailTemplate> {
    const knex = await this.getTenantKnex();
    
    // If system_template_id is not provided, try to find matching system template
    if (!template.system_template_id) {
      const systemTemplate = await knex('system_email_templates')
        .where({ name: template.name })
        .first();
      
      if (systemTemplate) {
        template.system_template_id = systemTemplate.id;
      }
    }
    
    const [created] = await knex('tenant_email_templates')
      .insert({
        ...template,
        tenant,
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

  async getEffectiveTemplate(tenant: string, name: string, locale?: SupportedLocale): Promise<SystemEmailTemplate | TenantEmailTemplate> {
    // First try to get tenant-specific template with locale
    const tenantTemplate = await this.getTenantTemplate(tenant, name, locale);
    if (tenantTemplate) {
      return tenantTemplate;
    }

    // Fall back to system template with locale
    const knex = await this.getTenantKnex();

    if (locale) {
      // Try requested language first
      let systemTemplate = await knex('system_email_templates')
        .where({ name, language_code: locale })
        .first();

      if (systemTemplate) return systemTemplate;

      // Fallback to English if not found and not already English
      if (locale !== 'en') {
        systemTemplate = await knex('system_email_templates')
          .where({ name, language_code: 'en' })
          .first();

        if (systemTemplate) return systemTemplate;
      }
    }

    // Final fallback to template without language code (legacy)
    return this.getSystemTemplate(name);
  }

  // Category management
  async getCategories(tenant: string): Promise<NotificationCategory[]> {
    const knex = await this.getTenantKnex();
    return knex('notification_categories as nc')
      .leftJoin('tenant_notification_category_settings as tcs', function() {
        this.on('tcs.category_id', 'nc.id')
            .andOn('tcs.tenant', knex.raw('?', [tenant]));
      })
      .select(
        'nc.id',
        'nc.name',
        'nc.description',
        'nc.created_at',
        'nc.updated_at',
        knex.raw('COALESCE(tcs.is_enabled, true) as is_enabled'),
        knex.raw('COALESCE(tcs.is_default_enabled, true) as is_default_enabled')
      )
      .orderBy('nc.name');
  }

  async getCategoryWithSubtypes(
    tenant: string,
    categoryId: number
  ): Promise<NotificationCategory & { subtypes: NotificationSubtype[] }> {
    const knex = await this.getTenantKnex();

    const category = await knex('notification_categories as nc')
      .leftJoin('tenant_notification_category_settings as tcs', function() {
        this.on('tcs.category_id', 'nc.id')
            .andOn('tcs.tenant', knex.raw('?', [tenant]));
      })
      .select(
        'nc.id',
        'nc.name',
        'nc.description',
        'nc.created_at',
        'nc.updated_at',
        knex.raw('COALESCE(tcs.is_enabled, true) as is_enabled'),
        knex.raw('COALESCE(tcs.is_default_enabled, true) as is_default_enabled')
      )
      .where('nc.id', categoryId)
      .first();

    if (!category) {
      throw new Error('Category not found');
    }

    const subtypes = await knex('notification_subtypes as ns')
      .leftJoin('tenant_notification_subtype_settings as tss', function() {
        this.on('tss.subtype_id', 'ns.id')
            .andOn('tss.tenant', knex.raw('?', [tenant]));
      })
      .select(
        'ns.id',
        'ns.category_id',
        'ns.name',
        'ns.description',
        'ns.created_at',
        'ns.updated_at',
        knex.raw('COALESCE(tss.is_enabled, true) as is_enabled'),
        knex.raw('COALESCE(tss.is_default_enabled, true) as is_default_enabled')
      )
      .where('ns.category_id', categoryId)
      .orderBy('ns.name');

    return { ...category, subtypes };
  }

  async updateCategory(
    tenant: string,
    id: number,
    category: Partial<Pick<NotificationCategory, 'is_enabled' | 'is_default_enabled'>>
  ): Promise<NotificationCategory> {
    const knex = await this.getTenantKnex();

    await knex('tenant_notification_category_settings')
      .insert({
        tenant,
        category_id: id,
        is_enabled: category.is_enabled,
        is_default_enabled: category.is_default_enabled
      })
      .onConflict(['tenant', 'category_id'])
      .merge({
        is_enabled: category.is_enabled,
        is_default_enabled: category.is_default_enabled,
        updated_at: knex.fn.now()
      });

    // Return the effective category
    const result = await knex('notification_categories as nc')
      .leftJoin('tenant_notification_category_settings as tcs', function() {
        this.on('tcs.category_id', 'nc.id')
            .andOn('tcs.tenant', knex.raw('?', [tenant]));
      })
      .select(
        'nc.id',
        'nc.name',
        'nc.description',
        'nc.created_at',
        'nc.updated_at',
        knex.raw('COALESCE(tcs.is_enabled, true) as is_enabled'),
        knex.raw('COALESCE(tcs.is_default_enabled, true) as is_default_enabled')
      )
      .where('nc.id', id)
      .first();

    return result;
  }

  // User preferences
  async getUserPreferences(tenant: string, userId: string): Promise<UserNotificationPreference[]> {
    const knex = await this.getTenantKnex();
    return knex('user_notification_preferences')
      .where({
        tenant,
        user_id: userId
      })
      .orderBy('id');
  }

  async updateUserPreference(
    tenant: string,
    userId: string,
    preference: Partial<UserNotificationPreference>
  ): Promise<UserNotificationPreference> {
    const knex = await this.getTenantKnex();

    if (!preference.subtype_id) {
      throw new Error('subtype_id is required');
    }

    const [updated] = await knex('user_notification_preferences')
      .insert({
        tenant,
        user_id: userId,
        subtype_id: preference.subtype_id,
        is_enabled: preference.is_enabled ?? true
      })
      .onConflict(['tenant', 'user_id', 'subtype_id'])
      .merge({
        is_enabled: preference.is_enabled,
        updated_at: knex.fn.now()
      })
      .returning('*');

    return updated;
  }

  // Notification sending
  async sendNotification(params: {
    tenant: string;
    userId: string;
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
      .count('id')
      .first()
      .then(result => Number(result?.count));

    if (recentCount >= settings.rate_limit_per_minute) {
      throw new Error('Rate limit exceeded');
    }

    // Check if subtype is enabled FOR THIS TENANT
    const subtype = await knex('notification_subtypes')
      .where({ id: params.subtypeId })
      .first();

    if (!subtype) {
      throw new Error('Notification subtype not found');
    }

    const subtypeSetting = await knex('tenant_notification_subtype_settings')
      .where({ tenant: params.tenant, subtype_id: params.subtypeId })
      .first();

    const isSubtypeEnabled = subtypeSetting?.is_enabled ?? true;
    if (!isSubtypeEnabled) {
      return; // Subtype disabled for this tenant - silently skip
    }

    // Check if category is enabled FOR THIS TENANT
    const categorySetting = await knex('tenant_notification_category_settings')
      .where({ tenant: params.tenant, category_id: subtype.category_id })
      .first();

    const isCategoryEnabled = categorySetting?.is_enabled ?? true;
    if (!isCategoryEnabled) {
      return; // Category disabled for this tenant - silently skip
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
      // Resolve recipient locale based on user preferences hierarchy
      const recipientLocale = await resolveEmailLocale(params.tenant, {
        email: params.emailAddress,
        userId: params.userId
      });

      console.log('[EmailNotificationService] Resolved locale for notification:', {
        userId: params.userId,
        email: params.emailAddress,
        locale: recipientLocale
      });

      // Get the effective template with locale support and compile content
      const template = await this.getEffectiveTemplate(params.tenant, params.templateName, recipientLocale);
      const compiledSubject = await this.compileTemplate(template.subject, params.data);
      const compiledBody = await this.compileTemplate(template.html_content || '', params.data);

      // Use TenantEmailService which internally handles EE-hosted fallback
      const service = TenantEmailService.getInstance(params.tenant);
      const processor = new StaticTemplateProcessor(compiledSubject, compiledBody, compiledBody.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim());
      const result = await service.sendEmail({
        to: params.emailAddress,
        tenantId: params.tenant,
        templateProcessor: processor
      });
      const success = result.success;

      // Log result
      await knex('notification_logs').insert({
        tenant: params.tenant,
        user_id: params.userId,
        subtype_id: params.subtypeId,
        email_address: params.emailAddress,
        subject: compiledSubject,
        status: success ? 'sent' : 'failed',
        error_message: success ? null : (result.error || 'Email service failed to send')
      });

      if (!success) {
        throw new Error(result.error || 'Failed to send email');
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

// Singleton instance management
let instance: EmailNotificationService | undefined;

export function getEmailNotificationService(): EmailNotificationService {
  if (!instance) {
    instance = new EmailNotificationService();
  }
  return instance;
}
