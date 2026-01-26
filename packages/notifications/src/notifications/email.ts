/**
 * Email Notification Service
 *
 * Handles system-wide and tenant-specific email notifications.
 */

import { createTenantKnex, getConnection } from '@alga-psa/db';
import type {
  NotificationSettings,
  SystemEmailTemplate,
  TenantEmailTemplate,
  NotificationCategory,
  NotificationSubtype,
  UserNotificationPreference,
  NotificationLog,
  NotificationService
} from '../types/notification';
import { TenantEmailService, StaticTemplateProcessor } from '@alga-psa/email';
import type { TenantEmailSettings } from '@alga-psa/types';
import { resolveEmailLocale } from './emailLocaleResolver';
import type { SupportedLocale } from '@alga-psa/ui/lib/i18n/config';

export class EmailNotificationService implements NotificationService {
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
    const Handlebars = (await import('handlebars')).default;
    const compiledTemplate = Handlebars.compile(template);
    return compiledTemplate(data);
  }

  private async getTenantKnex() {
    const { knex } = await createTenantKnex();
    return knex;
  }

  async getSettings(tenant: string): Promise<NotificationSettings> {
    const knex = await this.getTenantKnex();
    const settings = await knex('notification_settings')
      .where({ tenant })
      .first();

    if (!settings) {
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

    if (locale) {
      let template = await knex('tenant_email_templates')
        .where({ tenant, name, language_code: locale })
        .first();

      if (template) return template;

      if (locale !== 'en') {
        template = await knex('tenant_email_templates')
          .where({ tenant, name, language_code: 'en' })
          .first();

        if (template) return template;
      }
    }

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

  async getEffectiveTemplate(
    tenant: string,
    name: string,
    locale?: SupportedLocale
  ): Promise<SystemEmailTemplate | TenantEmailTemplate> {
    const tenantTemplate = await this.getTenantTemplate(tenant, name, locale);
    if (tenantTemplate) {
      return tenantTemplate;
    }

    const knex = await this.getTenantKnex();

    if (locale) {
      let systemTemplate = await knex('system_email_templates')
        .where({ name, language_code: locale })
        .first();

      if (systemTemplate) return systemTemplate;

      if (locale !== 'en') {
        systemTemplate = await knex('system_email_templates')
          .where({ name, language_code: 'en' })
          .first();

        if (systemTemplate) return systemTemplate;
      }
    }

    return this.getSystemTemplate(name);
  }

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

  async sendNotification(params: {
    tenant: string;
    userId: string;
    subtypeId: number;
    emailAddress: string;
    templateName: string;
    data: Record<string, any>;
  }): Promise<void> {
    const knex = await this.getTenantKnex();

    const settings = await this.getSettings(params.tenant);
    if (!settings.is_enabled) {
      throw new Error('Notifications are disabled for this tenant');
    }

    // Rate limiting is now centralized in TenantEmailService.sendEmail()

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
      return;
    }

    const categorySetting = await knex('tenant_notification_category_settings')
      .where({ tenant: params.tenant, category_id: subtype.category_id })
      .first();

    const isCategoryEnabled = categorySetting?.is_enabled ?? true;
    if (!isCategoryEnabled) {
      return;
    }

    const preference = await knex('user_notification_preferences')
      .where({
        user_id: params.userId,
        subtype_id: params.subtypeId
      })
      .first();

    if (preference && !preference.is_enabled) {
      return;
    }

    try {
      const recipientLocale = await resolveEmailLocale(params.tenant, {
        email: params.emailAddress,
        userId: params.userId
      });

      const template = await this.getEffectiveTemplate(params.tenant, params.templateName, recipientLocale);
      const compiledSubject = await this.compileTemplate(template.subject, params.data);
      const compiledBody = await this.compileTemplate(template.html_content || '', params.data);

      const service = TenantEmailService.getInstance(params.tenant);
      const processor = new StaticTemplateProcessor(
        compiledSubject,
        compiledBody,
        compiledBody.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
      );
      const result = await service.sendEmail({
        to: params.emailAddress,
        tenantId: params.tenant,
        templateProcessor: processor,
        userId: params.userId
      });
      const success = result.success;

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

let instance: EmailNotificationService | undefined;

export function getEmailNotificationService(): EmailNotificationService {
  if (!instance) {
    instance = new EmailNotificationService();
  }
  return instance;
}

