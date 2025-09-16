import { randomUUID } from 'node:crypto';
import { getConnection } from '../db/db';
// Note: Email sending is routed through TenantEmailService
import logger from '@alga-psa/shared/core/logger';
import { TenantEmailService } from '../services/TenantEmailService';
import { StaticTemplateProcessor } from '../email/tenant/templateProcessors';

const REPLY_BANNER_TEXT = '--- Please reply above this line ---';

interface ReplyMarkerPayload {
  token: string;
  ticketId?: string;
  projectId?: string;
  commentId?: string;
  threadId?: string;
}

export interface SendEmailParams {
  tenantId: string;
  to: string;
  subject: string;
  template: string;
  context: Record<string, unknown>;
  replyContext?: {
    ticketId?: string;
    projectId?: string;
    commentId?: string;
    threadId?: string;
    conversationToken?: string;
  };
}

function applyReplyMarkers(
  html: string,
  text: string,
  payload: ReplyMarkerPayload
): { html: string; text: string } {
  const attrs = [
    `data-alga-reply-token="${payload.token}"`,
    payload.ticketId ? `data-alga-ticket-id="${payload.ticketId}"` : null,
    payload.projectId ? `data-alga-project-id="${payload.projectId}"` : null,
    payload.commentId ? `data-alga-comment-id="${payload.commentId}"` : null,
    payload.threadId ? `data-alga-thread-id="${payload.threadId}"` : null
  ]
    .filter(Boolean)
    .join(' ');

  const hiddenToken = `<div ${attrs} style="display:none;max-height:0;overflow:hidden;">ALGA-REPLY-TOKEN</div>`;
  const hiddenBoundary = `<div data-alga-reply-boundary="true" style="display:none;max-height:0;overflow:hidden;">${REPLY_BANNER_TEXT}</div>`;
  const visibleBanner = `<p style="margin:0 0 12px 0;color:#666;text-transform:uppercase;font-size:12px;letter-spacing:0.08em;">${REPLY_BANNER_TEXT}</p>`;

  const augmentedHtml = `${hiddenToken}${hiddenBoundary}${visibleBanner}${html}`;

  const footerLines = [`[ALGA-REPLY-TOKEN ${payload.token}${payload.ticketId ? ` ticketId=${payload.ticketId}` : ''}${payload.projectId ? ` projectId=${payload.projectId}` : ''}${payload.commentId ? ` commentId=${payload.commentId}` : ''}${payload.threadId ? ` threadId=${payload.threadId}` : ''}]`];
  if (payload.ticketId) {
    footerLines.push(`ALGA-TICKET-ID:${payload.ticketId}`);
  }
  if (payload.projectId) {
    footerLines.push(`ALGA-PROJECT-ID:${payload.projectId}`);
  }
  if (payload.commentId) {
    footerLines.push(`ALGA-COMMENT-ID:${payload.commentId}`);
  }
  if (payload.threadId) {
    footerLines.push(`ALGA-THREAD-ID:${payload.threadId}`);
  }

  const augmentedText = `${REPLY_BANNER_TEXT}\n\n${text}\n\n${footerLines.join('\n')}`;

  return {
    html: augmentedHtml,
    text: augmentedText,
  };
}

async function persistReplyToken(
  knex: any,
  tenantId: string,
  payload: ReplyMarkerPayload,
  metadata: { template: string; subject: string; recipient: string }
): Promise<void> {
  try {
    const tableExists = await knex.schema.hasTable('email_reply_tokens');
    if (!tableExists) {
      return;
    }

    const record: Record<string, any> = {
      tenant: tenantId,
      token: payload.token,
      ticket_id: payload.ticketId || null,
      project_id: payload.projectId || null,
      comment_id: payload.commentId || null,
      metadata: JSON.stringify({ ...metadata, threadId: payload.threadId }),
      template: metadata.template,
      recipient_email: metadata.recipient,
      entity_type: payload.projectId ? 'project' : 'ticket',
    };

    await knex('email_reply_tokens')
      .insert(record)
      .onConflict(['tenant', 'token'])
      .ignore();
  } catch (error) {
    logger.warn('[SendEventEmail] Failed to persist email reply token', {
      error: error instanceof Error ? error.message : 'Unknown error',
      tenantId,
      ticketId: payload.ticketId,
      projectId: payload.projectId,
      commentId: payload.commentId
    });
  }
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

    let text = html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

    let replyPayload: ReplyMarkerPayload | null = null;
    if (params.replyContext?.ticketId || params.replyContext?.projectId) {
      replyPayload = {
        token: params.replyContext.conversationToken || randomUUID(),
        ticketId: params.replyContext.ticketId,
        projectId: params.replyContext.projectId,
        commentId: params.replyContext.commentId,
        threadId: params.replyContext.threadId,
      };

      const augmented = applyReplyMarkers(html, text, replyPayload);
      html = augmented.html;
      text = augmented.text;
    }

    // Send via TenantEmailService (handles tenant provider and EE fallback)
    const service = TenantEmailService.getInstance(params.tenantId);
    const processor = new StaticTemplateProcessor(subject, html, text);
    const systemFrom = process.env.EMAIL_FROM;
    const systemFromName = process.env.EMAIL_FROM_NAME || 'Portal Notifications';
    const result = await service.sendEmail({
      to: params.to,
      tenantId: params.tenantId,
      templateProcessor: processor,
      ...(systemFrom ? { from: /<[^>]+>/.test(systemFrom) ? systemFrom : `${systemFromName} <${systemFrom}>` } : {})
    });

    if (!result.success) {
      throw new Error(`Failed to send email: ${result.error || 'Unknown error'}`);
    }

    if (replyPayload) {
      await persistReplyToken(knex, params.tenantId, replyPayload, {
        template: params.template,
        subject,
        recipient: params.to,
      });
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
