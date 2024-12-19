import { getEmailService } from './emailService';
import { getConnection } from '../db/db';
import logger from '../../utils/logger';

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
    let templateContent;

    const template = await knex('tenant_email_templates')
      .where({ tenant: params.tenantId, name: params.template })
      .first();

    if (template) {
      templateContent = template.html_content;
    } else {
      // Fall back to system template
      const systemTemplate = await knex('system_email_templates')
        .where({ name: params.template })
        .first();
      if (!systemTemplate) {
        throw new Error(`Template not found: ${params.template}`);
      }
      templateContent = systemTemplate.html_content;
    }

    // Get email service instance and ensure it's initialized
    const emailService = getEmailService();
    await emailService.initialize();

    // Send email
    const success = await emailService.sendEmail({
      to: params.to,
      subject: params.subject,
      template: templateContent,
      data: params.context,
    });

    if (!success) {
      throw new Error('Failed to send email');
    }

    logger.info('[SendEventEmail] Email sent successfully:', {
      to: params.to,
      subject: params.subject,
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
