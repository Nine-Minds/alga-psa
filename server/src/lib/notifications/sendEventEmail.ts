import { getConnection } from '../db/db';
import { EmailProviderManager } from 'server/src/services/email/EmailProviderManager';
import { TenantEmailSettings, EmailMessage } from 'server/src/types/email.types';
import logger from '@alga-psa/shared/core/logger.js';

export interface SendEmailParams {
  tenantId: string;
  to: string;
  subject: string;
  template: string;
  context: Record<string, unknown>;
}

/**
 * Send an email using the email service
 * @param params Email parameters
 */

function flattenObject(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  return Object.entries(obj).reduce((acc: Record<string, unknown>, [key, value]) => {
    const newKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(acc, flattenObject(value as Record<string, unknown>, newKey));
    } else {
      acc[newKey] = value;
    }
    return acc;
  }, {});
}

/**
 * Get tenant email settings from database
 */
async function getTenantEmailSettings(tenantId: string, knex: any): Promise<TenantEmailSettings | null> {
  try {
    const settings = await knex('tenant_email_settings')
      .where({ tenant: tenantId })
      .first();
    
    if (!settings) {
      logger.warn(`[SendEventEmail] No email settings found for tenant ${tenantId}`);
      return null;
    }
    
    // Log the tenant settings (mask sensitive data)
    logger.info(`[SendEventEmail] Retrieved tenant email settings:`, {
      tenantId,
      emailProvider: settings.email_provider,
      defaultFromDomain: settings.default_from_domain,
      providerConfigsCount: (settings.provider_configs || []).length,
      trackingEnabled: settings.tracking_enabled,
      maxDailyEmails: settings.max_daily_emails
    });
    
    // Log provider configurations (with masked API keys)
    const enabledProviders = (settings.provider_configs || []).filter((c: any) => c.isEnabled);
    logger.debug(`[SendEventEmail] Found ${enabledProviders.length} enabled email provider(s)`);
    
    return {
      tenantId,
      defaultFromDomain: settings.default_from_domain,
      customDomains: settings.custom_domains || [],
      emailProvider: settings.email_provider,
      providerConfigs: settings.provider_configs || [],
      trackingEnabled: settings.tracking_enabled,
      maxDailyEmails: settings.max_daily_emails,
      createdAt: new Date(settings.created_at || new Date()),
      updatedAt: new Date(settings.updated_at || new Date())
    };
  } catch (error) {
    logger.error(`[SendEventEmail] Error fetching tenant email settings:`, error);
    return null;
  }
}

export async function sendEventEmail(params: SendEmailParams): Promise<void> {
  try {
    logger.info('[SendEventEmail] 🚀 NEW EMAIL PROVIDER MANAGER VERSION - Preparing to send email:', {
      to: params.to,
      subject: params.subject,
      tenantId: params.tenantId,
      template: params.template,
      contextKeys: Object.keys(params.context)
    });

    // Get the template content using tenant-aware connection
    const knex = await getConnection(params.tenantId);
    logger.debug('[SendEventEmail] Database connection established:', {
      tenantId: params.tenantId,
      database: knex.client.config.connection.database
    });

    let templateContent;
    let emailSubject = params.subject; 
    let templateSource = 'system';

    logger.debug('[SendEventEmail] Looking up tenant template:', {
      tenant: params.tenantId,
      template: params.template
    });

    try {
      // First try to get tenant-specific template
      const tenantTemplateQuery = knex('tenant_email_templates')
        .where({ tenant: params.tenantId, name: params.template })
        .first();

      logger.debug('[SendEventEmail] Executing tenant template query:', {
        sql: tenantTemplateQuery.toSQL().sql,
        bindings: tenantTemplateQuery.toSQL().bindings
      });

      const template = await tenantTemplateQuery;

      if (template) {
        logger.debug('[SendEventEmail] Found tenant template:', {
          templateId: template.id,
          templateName: template.name,
          tenant: template.tenant,
          htmlContentLength: template.html_content?.length,
          subject: template.subject
        });
        templateContent = template.html_content;
        emailSubject = template.subject || params.subject;
        templateSource = 'tenant';
      } else {
        logger.debug('[SendEventEmail] Tenant template not found, falling back to system template');
        
        // Fall back to system template
        const systemTemplateQuery = knex('system_email_templates')
          .where({ name: params.template })
          .first();

        logger.debug('[SendEventEmail] Executing system template query:', {
          sql: systemTemplateQuery.toSQL().sql,
          bindings: systemTemplateQuery.toSQL().bindings
        });

        const systemTemplate = await systemTemplateQuery;

        if (!systemTemplate) {
          throw new Error(`Template not found: ${params.template}`);
        }

        logger.debug('[SendEventEmail] Found system template:', {
          templateId: systemTemplate.id,
          templateName: systemTemplate.name,
          htmlContentLength: systemTemplate.html_content?.length,
          subject: systemTemplate.subject
        });
        templateContent = systemTemplate.html_content;
        emailSubject = systemTemplate.subject || params.subject;
      }
    } catch (error) {
      logger.error('[SendEventEmail] Error during template lookup:', {
        error,
        tenantId: params.tenantId,
        template: params.template,
        errorMessage: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error(`Failed to lookup email template: ${params.template}`);
    }

    if (!templateContent) {
      throw new Error(`No template content found for: ${params.template}`);
    }

    logger.debug('[SendEventEmail] Using template:', {
      template: params.template,
      source: templateSource,
      contentLength: templateContent.length,
      subject: emailSubject
    });

    // Get tenant email settings and initialize provider manager
    const tenantSettings = await getTenantEmailSettings(params.tenantId, knex);
    
    if (!tenantSettings) {
      throw new Error(`No email settings configured for tenant ${params.tenantId}`);
    }
    
    const emailProviderManager = new EmailProviderManager();
    await emailProviderManager.initialize(tenantSettings);
    
    logger.info('[SendEventEmail] Using EmailProviderManager with settings:', {
      tenantId: params.tenantId,
      provider: tenantSettings.emailProvider,
      enabledConfigs: tenantSettings.providerConfigs.filter(c => c.isEnabled).length
    });

    // Replace template variables with context values in both HTML and subject
    let html = templateContent;
    let subject = emailSubject;
    
    Object.entries(params.context).forEach(([contextKey, contextValue]) => {
      if (typeof contextValue === 'object' && contextValue !== null) {
        Object.entries(contextValue).forEach(([key, value]) => {
          const placeholder = `{{${contextKey}.${key}}}`;
          const regex = new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
          html = html.replace(regex, String(value));
          subject = subject.replace(regex, String(value));
        });
      }
    });

    logger.debug('[SendEventEmail] Template variables replaced:', {
      originalContent: templateContent,
      finalContent: html,
      originalSubject: emailSubject,
      finalSubject: subject
    });

    const text = html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

    // Create email message for provider manager
    const emailMessage: EmailMessage = {
      from: { email: tenantSettings.providerConfigs.find(c => c.isEnabled)?.config?.from || 'noreply@example.com' },
      to: [{ email: params.to }],
      subject: subject,
      html,
      text
    };

    // Log right before sending email
    logger.info('[SendEventEmail] About to send email via EmailProviderManager:', {
      to: params.to,
      subject: subject,
      htmlLength: html.length,
      textLength: text.length,
      provider: tenantSettings.emailProvider
    });

    // Send email using the provider manager
    const result = await emailProviderManager.sendEmail(emailMessage, params.tenantId);

    logger.info('[SendEventEmail] Email send result:', {
      success: result.success,
      to: params.to,
      subject: subject,
      providerId: result.providerId,
      providerType: result.providerType
    });

    if (!result.success) {
      throw new Error(`Failed to send email: ${result.error || 'Unknown error'}`);
    }

    logger.info('[SendEventEmail] Email sent successfully:', {
      to: params.to,
      subject: subject,
      tenantId: params.tenantId,
      template: params.template
    });
  } catch (error) {
    logger.error('[SendEventEmail] Failed to publish email event:', {
      error,
      to: params.to,
      subject: params.subject,
      tenantId: params.tenantId,
      template: params.template,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      errorStack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  }
}
