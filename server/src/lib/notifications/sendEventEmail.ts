import { getConnection } from '../db/db';
// Note: Email sending is routed through TenantEmailService
import logger from '@alga-psa/shared/core/logger';
import { TenantEmailService } from '../services/TenantEmailService';
import { StaticTemplateProcessor } from '../email/tenant/templateProcessors';

export interface SendEmailParams {
  tenantId: string;
  to: string;
  subject: string;
  template: string;
  context: Record<string, unknown>;
}

//
// Template lookup and sending are handled below using DatabaseTemplateProcessor

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

    // Build template content below and send via TenantEmailService

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

    // Send via TenantEmailService (handles tenant provider and EE fallback)
    const service = TenantEmailService.getInstance(params.tenantId);
    const processor = new StaticTemplateProcessor(subject, html, text);
    const result = await service.sendEmail({
      to: params.to,
      tenantId: params.tenantId,
      templateProcessor: processor
    });

    if (!result.success) {
      throw new Error(`Failed to send email: ${result.error || 'Unknown error'}`);
    }

    logger.info('[SendEventEmail] Email sent successfully via TenantEmailService:', {
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
