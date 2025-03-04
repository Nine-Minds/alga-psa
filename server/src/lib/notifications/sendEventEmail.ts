import { getEmailService } from 'server/src/services/emailService';
import { getConnection } from '../db/db';
import logger from '@shared/core/logger';

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

export async function sendEventEmail(params: SendEmailParams): Promise<void> {
  try {
    logger.info('[SendEventEmail] Preparing to send email:', {
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

    // Get email service instance and ensure it's initialized
    const emailService = await getEmailService();
    await emailService.initialize();

    // Replace template variables with context values
    let html = templateContent;
    Object.entries(params.context).forEach(([contextKey, contextValue]) => {
      if (typeof contextValue === 'object' && contextValue !== null) {
        Object.entries(contextValue).forEach(([key, value]) => {
          const placeholder = `{{${contextKey}.${key}}}`;
          html = html.replace(new RegExp(placeholder, 'g'), String(value));
        });
      }
    });

    logger.debug('[SendEventEmail] Template variables replaced:', {
      originalContent: templateContent,
      finalContent: html
    });

    const text = html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

    // Send email using the email service
    const success = await emailService.sendEmail({
      to: params.to,
      subject: emailSubject,
      html,
      text
    });

    if (!success) {
      throw new Error('Failed to send email');
    }

    logger.info('[SendEventEmail] Email sent successfully:', {
      to: params.to,
      subject: emailSubject,
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
